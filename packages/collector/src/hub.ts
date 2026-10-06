import type { TerrariumEvent } from "@terrarium/protocol";
import { RingBuffer } from "./ring";
import type { Log } from "./types";

const MIN_RETRY_MS = 1_000;
/** Keeps a returning hub from waiting longer than about one heartbeat for us. */
const MAX_RETRY_MS = 10_000;
/**
 * A heartbeat tick this late means the machine slept. The old socket may look
 * open while the peer is long gone, so it is replaced instead of trusted.
 */
const SLEEP_FACTOR = 3;

export type HubSinkOptions = {
	/** ws:// or wss:// URL of the hub's /ingest endpoint. */
	url: string;
	token: string;
	host: string;
	/** Events kept while the hub is unreachable; the oldest are dropped first. */
	bufferSize: number;
	heartbeatMs: number;
	log: Log;
};

export type HubSink = {
	send(event: TerrariumEvent): void;
	stop(): void;
};

export function startHubSink(options: HubSinkOptions): HubSink {
	const { url, token, host, heartbeatMs, log } = options;
	const buffer = new RingBuffer<string>(options.bufferSize);
	let socket: WebSocket | null = null;
	let retryMs = MIN_RETRY_MS;
	let retryTimer: Timer | undefined;
	let dropped = 0;
	let stopped = false;
	let lastTick = Date.now();

	/** Heartbeats are never buffered: a replayed one would claim a liveness that was not there. */
	const heartbeat = (): void => {
		if (socket?.readyState !== WebSocket.OPEN) return;
		const event: TerrariumEvent = {
			v: 1,
			host,
			ts: Date.now(),
			agentId: `${host}:collector`,
			kind: "host.heartbeat",
			data: {},
		};
		socket.send(JSON.stringify(event));
	};

	const connect = (): void => {
		const ws = new WebSocket(url, {
			headers: { authorization: `Bearer ${token}` },
		});
		socket = ws;
		ws.addEventListener("open", () => {
			if (socket !== ws) return;
			log(
				`hub: connected to ${url}; replaying ${buffer.size} buffered event(s)`,
			);
			if (dropped > 0) {
				log(`hub: dropped ${dropped} event(s) while disconnected`);
				dropped = 0;
			}
			retryMs = MIN_RETRY_MS;
			heartbeat();
			for (const line of buffer.drain()) ws.send(line);
		});
		ws.addEventListener("close", (event) => {
			if (socket !== ws) return;
			socket = null;
			if (stopped) return;
			log(
				`hub: disconnected (code ${event.code}); retrying in ${retryMs / 1000}s`,
			);
			retryTimer = setTimeout(connect, retryMs);
			retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
		});
	};

	const reconnect = (): void => {
		const old = socket;
		socket = null;
		clearTimeout(retryTimer);
		retryMs = MIN_RETRY_MS;
		old?.close(1000, "collector reconnecting");
		connect();
	};

	const heartbeatTimer = setInterval(() => {
		const now = Date.now();
		const gap = now - lastTick;
		lastTick = now;
		if (gap > heartbeatMs * SLEEP_FACTOR) {
			log(`hub: timers stalled for ${Math.round(gap / 1000)}s; reconnecting`);
			reconnect();
			return;
		}
		heartbeat();
	}, heartbeatMs);

	connect();

	return {
		send(event) {
			const line = JSON.stringify(event);
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(line);
				return;
			}
			if (buffer.push(line)) dropped++;
		},
		stop() {
			stopped = true;
			clearInterval(heartbeatTimer);
			clearTimeout(retryTimer);
			socket?.close(1000, "collector stopping");
		},
	};
}
