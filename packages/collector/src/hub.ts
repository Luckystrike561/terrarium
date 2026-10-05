import type { TerrariumEvent } from "@terrarium/protocol";
import type { Log } from "./types";

/** Events kept while the hub is unreachable; the oldest go first. */
const MAX_QUEUE = 1_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export type HubSinkOptions = {
	/** ws:// or wss:// URL of the hub's /ingest endpoint. */
	url: string;
	token: string;
	log: Log;
};

export type HubSink = {
	send(event: TerrariumEvent): void;
	stop(): void;
};

export function startHubSink(options: HubSinkOptions): HubSink {
	const { url, token, log } = options;
	const queue: string[] = [];
	let socket: WebSocket | null = null;
	let retryMs = MIN_RETRY_MS;
	let retryTimer: Timer | undefined;
	let dropped = 0;
	let stopped = false;

	const connect = (): void => {
		const ws = new WebSocket(url, {
			headers: { authorization: `Bearer ${token}` },
		});
		socket = ws;
		ws.addEventListener("open", () => {
			log(`hub: connected to ${url}; sending ${queue.length} queued event(s)`);
			if (dropped > 0) {
				log(`hub: dropped ${dropped} event(s) while disconnected`);
				dropped = 0;
			}
			retryMs = MIN_RETRY_MS;
			for (const line of queue.splice(0)) ws.send(line);
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

	connect();

	return {
		send(event) {
			const line = JSON.stringify(event);
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(line);
				return;
			}
			queue.push(line);
			if (queue.length > MAX_QUEUE) {
				queue.shift();
				dropped++;
			}
		},
		stop() {
			stopped = true;
			clearTimeout(retryTimer);
			socket?.close(1000, "collector stopping");
		},
	};
}
