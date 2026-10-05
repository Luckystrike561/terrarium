#!/usr/bin/env bun
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { TerrariumEvent } from "@terrarium/protocol";
import { createMerger } from "./merge";
import { startHerdrSource } from "./sources/herdr";
import { startOmpSource } from "./sources/omp";
import { startStatsSource } from "./sources/stats";

const USAGE = `Usage: terrarium-collector --stdout [options]

  --stdout                 Print one TerrariumEvent JSON line per event
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
if (!args.stdout) {
	fail("--stdout is required: it is the only output until the hub exists");
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

/**
 * Agents currently working. The stats source syncs stats.db while any exist
 * and once more when one stops, so a turn's usage lands promptly. `stats` is
 * only touched from agent events, which start after it exists.
 */
const working = new Set<string>();

const emit = createMerger((event: TerrariumEvent): void => {
	process.stdout.write(`${JSON.stringify(event)}\n`);
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

log(`collector: host=${host} poll=${pollMs}ms stats-sync=${syncMs}ms`);

const shutdown = (): void => {
	herdr.stop();
	omp.stop();
	stats.stop();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
