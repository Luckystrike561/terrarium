#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { TerrariumEvent } from "@terrarium/protocol";
import { errorMessage } from "./guards";
import { type HubSink, startHubSink } from "./hub";
import { createMerger } from "./merge";
import { startHerdrSource } from "./sources/herdr";
import { startOmpSource } from "./sources/omp";
import { startStatsSource } from "./sources/stats";

const USAGE = `Usage: terrarium-collector (--stdout | --hub <url>) [options]

  --stdout                 Print one TerrariumEvent JSON line per event
  --hub <url>              Stream events to the hub, e.g. ws://127.0.0.1:8787/ingest
  --hub-token-file <path>  File holding this host's collector token
                           (default: the TERRARIUM_HUB_TOKEN environment variable)
  --host <name>            Host name stamped on events (default: hostname)
  --herdr-socket <path>    herdr socket (default: ~/.config/herdr/herdr.sock)
  --omp-socket <path>      socket the omp extension writes to
                           (default: $XDG_RUNTIME_DIR/terrarium.sock, else /tmp/terrarium.sock)
  --stats-db <path>        omp stats DB, opened read-only (default: ~/.omp/stats.db)
  --poll-ms <n>            stats.db poll interval (default: 5000)
  --stats-sync-ms <n>      run \`omp stats\` this often while an agent works,
                           and once when a turn ends; 0 disables (default: 30000)
  --help                   Show this help
`;

function fail(message: string): never {
	process.stderr.write(`${message}\n\n${USAGE}`);
	process.exit(2);
}

function nonNegativeInt(
	flag: string,
	raw: string | undefined,
	fallback: number,
): number {
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		fail(`${flag} expects a non-negative integer, got "${raw}"`);
	}
	return value;
}

const OPTIONS = {
	stdout: { type: "boolean" },
	hub: { type: "string" },
	"hub-token-file": { type: "string" },
	host: { type: "string" },
	"herdr-socket": { type: "string" },
	"omp-socket": { type: "string" },
	"stats-db": { type: "string" },
	"poll-ms": { type: "string" },
	"stats-sync-ms": { type: "string" },
	help: { type: "boolean" },
} as const;

const args = (() => {
	try {
		return parseArgs({ options: OPTIONS, strict: true }).values;
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
})();

if (args.help) {
	process.stdout.write(USAGE);
	process.exit(0);
}
if (!args.stdout && args.hub === undefined) {
	fail("one of --stdout or --hub is required");
}

const host = args.host ?? hostname();
const pollMs = Math.max(
	nonNegativeInt("--poll-ms", args["poll-ms"], 5_000),
	100,
);
const syncMs = nonNegativeInt("--stats-sync-ms", args["stats-sync-ms"], 30_000);
const log = (message: string): void => {
	process.stderr.write(`${new Date().toISOString()} ${message}\n`);
};

/** The token is read from a file or the environment so it never shows in `ps`. */
const hubToken = (() => {
	if (args.hub === undefined) return null;
	let token: string | undefined;
	try {
		token =
			args["hub-token-file"] === undefined
				? process.env.TERRARIUM_HUB_TOKEN
				: readFileSync(args["hub-token-file"], "utf8");
	} catch (error) {
		fail(`cannot read --hub-token-file: ${errorMessage(error)}`);
	}
	token = token?.trim();
	if (token === undefined || token.length === 0) {
		fail("--hub needs a token: --hub-token-file or TERRARIUM_HUB_TOKEN");
	}
	return token;
})();
const hub: HubSink | null =
	args.hub === undefined || hubToken === null
		? null
		: startHubSink({ url: args.hub, token: hubToken, log });

/**
 * Agents currently working. The stats source syncs stats.db while any exist
 * and once more when one stops, so a turn's usage lands promptly. `stats` is
 * only touched from agent events, which start after it exists.
 */
const working = new Set<string>();

const emit = createMerger((event: TerrariumEvent): void => {
	if (args.stdout) process.stdout.write(`${JSON.stringify(event)}\n`);
	hub?.send(event);
	if (event.kind === "agent.state" && event.data.state === "working") {
		working.add(event.agentId);
	} else if (
		(event.kind === "agent.state" || event.kind === "agent.gone") &&
		working.delete(event.agentId)
	) {
		stats.requestSync();
	}
});

const stats = startStatsSource({
	dbPath: args["stats-db"] ?? join(homedir(), ".omp", "stats.db"),
	host,
	pollMs,
	syncMs,
	shouldSync: () => working.size > 0,
	emit,
	log,
});

const herdr = startHerdrSource({
	socketPath:
		args["herdr-socket"] ?? join(homedir(), ".config", "herdr", "herdr.sock"),
	host,
	emit,
	log,
});

const runtimeDir = process.env.XDG_RUNTIME_DIR;
const omp = startOmpSource({
	socketPath:
		args["omp-socket"] ??
		join(
			runtimeDir !== undefined && runtimeDir.length > 0 ? runtimeDir : "/tmp",
			"terrarium.sock",
		),
	host,
	emit,
	log,
});

const outputs = [args.stdout ? "stdout" : null, args.hub ?? null];
log(
	`collector: host=${host} poll=${pollMs}ms stats-sync=${syncMs}ms output=${outputs.filter((output) => output !== null).join(",")}`,
);

const shutdown = (): void => {
	herdr.stop();
	omp.stop();
	stats.stop();
	hub?.stop();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
