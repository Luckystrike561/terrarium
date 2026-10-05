import { chmodSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import type { TerrariumEvent, TerrariumEventKind } from "@terrarium/protocol";
import { errorMessage, isRecord } from "../guards";
import { LineReader } from "../lines";
import type { Emit, Log, Source } from "../types";

/** Far above any real event; a peer exceeding it is not the extension. */
const MAX_LINE_BYTES = 64 * 1024;

const KINDS: Record<TerrariumEventKind, true> = {
	"agent.seen": true,
	"agent.state": true,
	"tool.start": true,
	"tool.end": true,
	"turn.usage": true,
	"agent.gone": true,
	"host.heartbeat": true,
};

export type OmpSourceOptions = {
	socketPath: string;
	host: string;
	emit: Emit;
	log: Log;
};

/**
 * Validates one extension line and restamps it with the collector's host, so
 * its agentId joins herdr's and stats.db's even when the extension guessed a
 * different host name.
 */
export function parseExtensionLine(
	line: string,
	host: string,
): TerrariumEvent | null {
	let raw: unknown;
	try {
		raw = JSON.parse(line);
	} catch {
		return null;
	}
	if (
		!isRecord(raw) ||
		raw.v !== 1 ||
		typeof raw.host !== "string" ||
		typeof raw.ts !== "number" ||
		typeof raw.agentId !== "string" ||
		typeof raw.kind !== "string" ||
		KINDS[raw.kind as TerrariumEventKind] !== true ||
		!isRecord(raw.data)
	) {
		return null;
	}
	const prefix = `${raw.host}:`;
	return {
		v: 1,
		host,
		ts: raw.ts,
		agentId: raw.agentId.startsWith(prefix)
			? `${host}:${raw.agentId.slice(prefix.length)}`
			: raw.agentId,
		kind: raw.kind as TerrariumEventKind,
		data: { ...raw.data, source: "omp" },
	};
}

/** True when a live process accepts connections on `socketPath`. */
function socketInUse(socketPath: string): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const probe = connect(socketPath);
	probe.once("connect", () => {
		probe.destroy();
		resolve(true);
	});
	probe.once("error", () => resolve(false));
	return promise;
}

function listen(server: Server, socketPath: string): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	server.once("error", reject);
	server.listen(socketPath, () => {
		server.off("error", reject);
		resolve();
	});
	return promise;
}

export function startOmpSource(options: OmpSourceOptions): Source {
	const { socketPath, host, emit, log } = options;
	let owned = false;
	let stopped = false;

	const server = createServer((connection) => {
		const reader = new LineReader();
		connection.setEncoding("utf8");
		connection.on("error", () => connection.destroy());
		connection.on("data", (chunk: string) => {
			reader.push(chunk, (line) => {
				const event = parseExtensionLine(line, host);
				if (event !== null) emit(event);
			});
			if (reader.pending > MAX_LINE_BYTES) connection.destroy();
		});
	});

	const start = async (): Promise<void> => {
		try {
			await listen(server, socketPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
			if (await socketInUse(socketPath)) {
				throw new Error(`${socketPath} is served by another process`);
			}
			unlinkSync(socketPath);
			await listen(server, socketPath);
		}
		owned = true;
		if (stopped) {
			stop();
			return;
		}
		chmodSync(socketPath, 0o600);
		log(`omp: listening on ${socketPath}`);
	};

	const stop = (): void => {
		stopped = true;
		server.close();
		if (!owned) return;
		owned = false;
		try {
			unlinkSync(socketPath);
		} catch {
			// Already removed.
		}
	};

	start().catch((error: unknown) =>
		log(`omp: extension socket disabled: ${errorMessage(error)}`),
	);

	return { stop };
}
