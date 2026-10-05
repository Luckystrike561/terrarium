import { connect, type Socket } from "node:net";
import { basename } from "node:path";
import type { AgentState, TerrariumEvent } from "@terrarium/protocol";
import { errorMessage, isRecord } from "../guards";
import type { Emit, Log, Source } from "../types";

const EXPECTED_PROTOCOL = 22;
const REQUEST_TIMEOUT_MS = 5_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 30_000;

const HERDR_STATUSES: Record<string, true> = {
	idle: true,
	working: true,
	blocked: true,
	done: true,
	unknown: true,
};

export type HerdrSourceOptions = {
	socketPath: string;
	host: string;
	emit: Emit;
	log: Log;
};

type RpcResponse = {
	id?: unknown;
	result?: unknown;
	error?: { code?: unknown; message?: unknown };
};

type AgentInfo = {
	pane_id?: unknown;
	agent?: unknown;
	agent_status?: unknown;
	agent_session?: { kind?: unknown; value?: unknown } | null;
	cwd?: unknown;
};

type Pane = {
	paneId: string;
	agentId: string;
	agentKind: string;
	folder: string | null;
	state: AgentState;
};

class LineReader {
	#buffer = "";

	push(chunk: string, onLine: (line: string) => void): void {
		this.#buffer += chunk;
		let newline = this.#buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line.length > 0) onLine(line);
			newline = this.#buffer.indexOf("\n");
		}
	}
}

function describeError(error: RpcResponse["error"]): string {
	const code = typeof error?.code === "string" ? error.code : "error";
	const message = typeof error?.message === "string" ? error.message : "";
	return `${code}: ${message}`;
}

/** herdr answers one request per connection and then closes it. */
function request(
	socketPath: string,
	method: string,
	params: unknown,
): Promise<unknown> {
	const { promise, resolve, reject } = Promise.withResolvers<unknown>();
	const socket = connect(socketPath);
	const reader = new LineReader();
	let settled = false;
	const finish = (outcome: () => void) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		socket.destroy();
		outcome();
	};
	const timer = setTimeout(
		() => finish(() => reject(new Error(`${method}: timed out`))),
		REQUEST_TIMEOUT_MS,
	);
	socket.setEncoding("utf8");
	socket.on("connect", () =>
		socket.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: "1", method, params })}\n`,
		),
	);
	socket.on("data", (chunk: string) =>
		reader.push(chunk, (line) => {
			let response: RpcResponse;
			try {
				response = JSON.parse(line) as RpcResponse;
			} catch {
				finish(() => reject(new Error(`${method}: invalid JSON reply`)));
				return;
			}
			if (response.error !== undefined) {
				const detail = describeError(response.error);
				finish(() => reject(new Error(`${method}: ${detail}`)));
			} else {
				finish(() => resolve(response.result));
			}
		}),
	);
	socket.on("error", (error) =>
		finish(() => reject(new Error(`${method}: ${error.message}`))),
	);
	socket.on("close", () =>
		finish(() => reject(new Error(`${method}: connection closed`))),
	);
	return promise;
}

/**
 * One long-lived `events.subscribe` connection. herdr fixes the subscription
 * list per connection, so a changed pane set needs a new Subscription.
 */
class Subscription {
	readonly paneIds: ReadonlySet<string>;
	/** Resolves once herdr acknowledges with `subscription_started`. */
	readonly started: Promise<void>;
	/** Resolves when the connection ends: a reason if herdr dropped it, null after `close()`. */
	readonly lost: Promise<string | null>;
	#socket: Socket;
	#intentional = false;

	constructor(
		socketPath: string,
		paneIds: ReadonlySet<string>,
		onNotification: (message: Record<string, unknown>) => void,
	) {
		this.paneIds = paneIds;
		const started = Promise.withResolvers<void>();
		const lost = Promise.withResolvers<string | null>();
		this.started = started.promise;
		this.lost = lost.promise;
		this.started.catch(() => {});

		const subscriptions: Record<string, string>[] = [
			{ type: "pane.agent_detected" },
			{ type: "pane.closed" },
		];
		for (const paneId of paneIds) {
			subscriptions.push({
				type: "pane.agent_status_changed",
				pane_id: paneId,
			});
		}

		const socket = connect(socketPath);
		this.#socket = socket;
		const reader = new LineReader();
		let closeReason = "connection closed";
		let isStarted = false;

		socket.setEncoding("utf8");
		socket.on("connect", () =>
			socket.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: "sub",
					method: "events.subscribe",
					params: { subscriptions },
				})}\n`,
			),
		);
		socket.on("data", (chunk: string) =>
			reader.push(chunk, (line) => {
				let message: unknown;
				try {
					message = JSON.parse(line);
				} catch {
					return;
				}
				if (!isRecord(message)) return;
				const response = message as RpcResponse;
				if (response.error !== undefined) {
					closeReason = describeError(response.error);
					if (!isStarted) started.reject(new Error(closeReason));
					socket.destroy();
					return;
				}
				if (
					!isStarted &&
					isRecord(response.result) &&
					response.result.type === "subscription_started"
				) {
					isStarted = true;
					started.resolve();
					return;
				}
				onNotification(message);
			}),
		);
		socket.on("error", (error) => {
			closeReason = error.message;
		});
		socket.on("close", () => {
			if (!isStarted) started.reject(new Error(closeReason));
			lost.resolve(this.#intentional ? null : closeReason);
		});
	}

	close(): void {
		this.#intentional = true;
		this.#socket.destroy();
	}
}

/**
 * Extracts `{ type, data }` from a pushed event. Events arrive as
 * `{ event, data }` with `data.type` repeating the name; the dotted and the
 * underscored spelling both normalize to the underscored one.
 */
function parseNotification(
	message: Record<string, unknown>,
): { type: string; data: Record<string, unknown> } | null {
	const envelope = isRecord(message.params)
		? message.params
		: isRecord(message.result) && isRecord(message.result.event)
			? message.result.event
			: message;
	const data = isRecord(envelope.data) ? envelope.data : envelope;
	const name =
		typeof envelope.event === "string"
			? envelope.event
			: typeof data.type === "string"
				? data.type
				: null;
	if (name === null) return null;
	return { type: name.replaceAll(".", "_"), data };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) if (!b.has(value)) return false;
	return true;
}

export function startHerdrSource(options: HerdrSourceOptions): Source {
	const { socketPath, host, emit, log } = options;
	const panes = new Map<string, Pane>();
	const abort = new AbortController();
	const aborted = Promise.withResolvers<null>();
	abort.signal.addEventListener("abort", () => aborted.resolve(null), {
		once: true,
	});
	let subscription: Subscription | null = null;
	let refreshing: Promise<void> | null = null;
	let refreshAgain = false;
	let swapping: Promise<void> | null = null;
	let lastConnectError = "";

	const event = (
		agentId: string,
		kind: TerrariumEvent["kind"],
		data: Record<string, unknown>,
	): void => emit({ v: 1, host, ts: Date.now(), agentId, kind, data });

	const emitSeen = (pane: Pane): void => {
		event(pane.agentId, "agent.seen", {
			source: "herdr",
			agentKind: pane.agentKind,
			folder: pane.folder,
			paneId: pane.paneId,
		});
		event(pane.agentId, "agent.state", { source: "herdr", state: pane.state });
	};

	const toPane = (info: AgentInfo): Pane | null => {
		if (typeof info.pane_id !== "string") return null;
		const agentKind = typeof info.agent === "string" ? info.agent : "unknown";
		const session = info.agent_session;
		const sessionFile =
			agentKind === "omp" &&
			session?.kind === "path" &&
			typeof session.value === "string"
				? session.value
				: null;
		return {
			paneId: info.pane_id,
			agentId:
				sessionFile === null
					? `${host}:herdr:${info.pane_id}`
					: `${host}:${sessionFile}`,
			agentKind,
			folder:
				typeof info.cwd === "string" && info.cwd.length > 0
					? basename(info.cwd)
					: null,
			state:
				typeof info.agent_status === "string" &&
				HERDR_STATUSES[info.agent_status] === true
					? (info.agent_status as AgentState)
					: "unknown",
		};
	};

	const reconcile = (agents: AgentInfo[]): void => {
		const listed = new Set<string>();
		for (const info of agents) {
			const next = toPane(info);
			if (next === null) continue;
			listed.add(next.paneId);
			const current = panes.get(next.paneId);
			panes.set(next.paneId, next);
			if (current === undefined) {
				emitSeen(next);
			} else if (current.agentId !== next.agentId) {
				event(current.agentId, "agent.gone", { source: "herdr" });
				emitSeen(next);
			} else if (current.state !== next.state) {
				event(next.agentId, "agent.state", {
					source: "herdr",
					state: next.state,
				});
			}
		}
		for (const [paneId, pane] of panes) {
			if (listed.has(paneId)) continue;
			panes.delete(paneId);
			event(pane.agentId, "agent.gone", { source: "herdr" });
		}
	};

	/** Serialized: a refresh requested while one is in flight runs once more after it. */
	const refresh = (): Promise<void> => {
		if (refreshing !== null) {
			refreshAgain = true;
			return refreshing;
		}
		refreshing = (async () => {
			try {
				do {
					refreshAgain = false;
					const result = await request(socketPath, "agent.list", {});
					if (!isRecord(result) || !Array.isArray(result.agents)) {
						throw new Error("agent.list: unexpected reply shape");
					}
					reconcile(result.agents.filter(isRecord) as AgentInfo[]);
				} while (refreshAgain && !abort.signal.aborted);
			} finally {
				refreshing = null;
			}
		})();
		return refreshing;
	};

	/**
	 * Replaces the subscription when the pane set changed. The new one is
	 * acknowledged before the old one closes so no status change falls in a
	 * gap; the refresh afterwards catches changes made during setup.
	 */
	const syncSubscription = async (): Promise<void> => {
		while (swapping !== null) await swapping.catch(() => {});
		const paneIds = new Set(panes.keys());
		if (subscription !== null && sameSet(subscription.paneIds, paneIds)) return;
		swapping = (async () => {
			const next = new Subscription(socketPath, paneIds, onNotification);
			await next.started;
			if (abort.signal.aborted) {
				next.close();
				return;
			}
			subscription?.close();
			subscription = next;
		})();
		try {
			await swapping;
		} finally {
			swapping = null;
		}
		if (abort.signal.aborted) return;
		await refresh();
		await syncSubscription();
	};

	/** Events only invalidate state; `agent.list` stays authoritative. */
	const onNotification = (message: Record<string, unknown>): void => {
		const parsed = parseNotification(message);
		if (parsed === null) return;
		const { type, data } = parsed;
		if (type === "pane_agent_status_changed") {
			const pane =
				typeof data.pane_id === "string" ? panes.get(data.pane_id) : undefined;
			const status = data.agent_status;
			if (
				pane !== undefined &&
				typeof status === "string" &&
				HERDR_STATUSES[status] === true &&
				pane.state !== status
			) {
				pane.state = status as AgentState;
				event(pane.agentId, "agent.state", { source: "herdr", state: status });
			}
		}
		refresh()
			.then(syncSubscription)
			.catch((error: unknown) =>
				log(`herdr: refresh failed: ${errorMessage(error)}`),
			);
	};

	const checkProtocol = async (): Promise<void> => {
		const pong = await request(socketPath, "ping", {});
		const protocol = isRecord(pong) ? pong.protocol : undefined;
		if (protocol === EXPECTED_PROTOCOL) return;
		const version = isRecord(pong) ? String(pong.version) : "unknown";
		log(
			`herdr: PROTOCOL MISMATCH: server reports protocol ${String(protocol)} (herdr ${version}), collector expects ${EXPECTED_PROTOCOL}; agent events may be wrong or missing`,
		);
	};

	const run = async (): Promise<void> => {
		let backoff = BACKOFF_MIN_MS;
		while (!abort.signal.aborted) {
			try {
				await checkProtocol();
				await refresh();
				await syncSubscription();
				if (lastConnectError !== "") log(`herdr: connected to ${socketPath}`);
				lastConnectError = "";
				backoff = BACKOFF_MIN_MS;
				while (subscription !== null) {
					const current = subscription;
					const reason = await Promise.race([current.lost, aborted.promise]);
					if (abort.signal.aborted) return;
					if (subscription !== current) continue;
					subscription = null;
					log(`herdr: subscription lost (${reason ?? "closed"}); reconnecting`);
				}
			} catch (error) {
				subscription?.close();
				subscription = null;
				const message = errorMessage(error);
				if (message !== lastConnectError) {
					log(`herdr: ${message}; retrying with backoff`);
					lastConnectError = message;
				}
			}
			const wait = Promise.withResolvers<void>();
			const timer = setTimeout(wait.resolve, backoff);
			await Promise.race([wait.promise, aborted.promise]);
			clearTimeout(timer);
			backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
		}
	};

	run().catch((error: unknown) =>
		log(`herdr: adapter stopped: ${errorMessage(error)}`),
	);

	return {
		stop() {
			abort.abort();
			subscription?.close();
			subscription = null;
		},
	};
}
