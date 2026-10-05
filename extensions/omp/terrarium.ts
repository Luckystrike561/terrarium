import { createConnection, type Socket } from "node:net";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import type { TerrariumEvent } from "@terrarium/protocol";

export type HookContext = {
	cwd?: unknown;
	isIdle?: () => unknown;
	sessionManager?: {
		getSessionFile?: () => unknown;
	};
};

export type HookHandler = (event: unknown, ctx: HookContext) => unknown;

export type ExtensionApi = {
	on(hook: string, handler: HookHandler): void;
};

export type TerrariumOptions = {
	socketPath: string;
	host: string;
};

export type Terrarium = {
	register(pi: ExtensionApi): void;
	/** Flushes queued lines and closes the socket. */
	close(): Promise<void>;
};

export function defaultSocketPath(): string {
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	return join(
		runtimeDir !== undefined && runtimeDir.length > 0 ? runtimeDir : "/tmp",
		"terrarium.sock",
	);
}

export function defaultOptions(): TerrariumOptions {
	const host = process.env.TERRARIUM_HOST;
	return {
		socketPath: defaultSocketPath(),
		host: host !== undefined && host.length > 0 ? host : hostname(),
	};
}

function field(event: unknown, key: string): unknown {
	return typeof event === "object" && event !== null
		? (event as Record<string, unknown>)[key]
		: undefined;
}

function sessionFile(ctx: HookContext): string | null {
	try {
		const file = ctx.sessionManager?.getSessionFile?.();
		return typeof file === "string" && file.startsWith("/") ? file : null;
	} catch {
		return null;
	}
}

/**
 * One connection carries every line so the collector receives them in hook
 * order. A failed connection drops its pending lines; the next event opens a
 * new one.
 */
class LineSender {
	readonly #socketPath: string;
	#socket: Socket | null = null;

	constructor(socketPath: string) {
		this.#socketPath = socketPath;
	}

	send(line: string): void {
		try {
			if (this.#socket === null) {
				const socket = createConnection(this.#socketPath);
				socket.on("error", () => socket.destroy());
				socket.on("close", () => {
					if (this.#socket === socket) this.#socket = null;
				});
				socket.on("data", () => {});
				socket.unref();
				this.#socket = socket;
			}
			this.#socket.write(line);
		} catch {
			this.#socket?.destroy();
			this.#socket = null;
		}
	}

	close(): Promise<void> {
		const socket = this.#socket;
		this.#socket = null;
		if (socket === null || socket.destroyed) return Promise.resolve();
		const { promise, resolve } = Promise.withResolvers<void>();
		socket.once("close", () => resolve());
		try {
			socket.end();
		} catch {
			socket.destroy();
		}
		return promise;
	}
}

export function createTerrarium(options: TerrariumOptions): Terrarium {
	const { host } = options;
	const sender = new LineSender(options.socketPath);

	const emit = (
		ctx: HookContext,
		kind: TerrariumEvent["kind"],
		data: Record<string, unknown>,
	): void => {
		const file = sessionFile(ctx);
		if (file === null) return;
		const event: TerrariumEvent = {
			v: 1,
			host,
			ts: Date.now(),
			agentId: `${host}:${file}`,
			kind,
			data: { source: "omp", ...data },
		};
		sender.send(`${JSON.stringify(event)}\n`);
	};

	const toolName = (event: unknown): string => {
		const name = field(event, "toolName");
		return typeof name === "string" ? name : "unknown";
	};

	const toolCall = (event: unknown): Record<string, unknown> => {
		const id = field(event, "toolCallId");
		return {
			tool: toolName(event),
			toolCallId: typeof id === "string" ? id : null,
		};
	};

	const handlers: Record<string, HookHandler> = {
		session_start: (_event, ctx) => {
			emit(ctx, "agent.seen", {
				agentKind: "omp",
				folder:
					typeof ctx.cwd === "string" && ctx.cwd.length > 0
						? basename(ctx.cwd)
						: null,
			});
			emit(ctx, "agent.state", {
				state: ctx.isIdle?.() === false ? "working" : "idle",
			});
		},
		agent_start: (_event, ctx) =>
			emit(ctx, "agent.state", { state: "working" }),
		agent_end: (event, ctx) => {
			if (field(event, "willContinue") === true) return;
			emit(ctx, "agent.state", { state: "done" });
		},
		tool_execution_start: (event, ctx) =>
			emit(ctx, "tool.start", toolCall(event)),
		tool_execution_end: (event, ctx) =>
			emit(ctx, "tool.end", {
				...toolCall(event),
				isError: field(event, "isError") === true,
			}),
		tool_approval_requested: (event, ctx) =>
			emit(ctx, "agent.state", { state: "blocked", tool: toolName(event) }),
		session_shutdown: (_event, ctx) => {
			emit(ctx, "agent.gone", {});
			void sender.close();
		},
	};

	return {
		register(pi) {
			for (const [hook, handler] of Object.entries(handlers)) {
				pi.on(hook, (event, ctx) => {
					try {
						handler(event, ctx ?? {});
					} catch {
						// Telemetry must never disturb the agent.
					}
				});
			}
		},
		close: () => sender.close(),
	};
}

export default function terrarium(pi: ExtensionApi): void {
	try {
		createTerrarium(defaultOptions()).register(pi);
	} catch {
		// Telemetry must never disturb the agent.
	}
}
