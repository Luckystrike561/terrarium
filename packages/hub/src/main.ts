#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Server } from "bun";
import { type Auth, createAuth, loadConfig } from "./config";
import { errorMessage } from "./guards";
import { Hub } from "./hub";
import { type SocketData, startServer, WORLD_TOPIC } from "./server";
import { Store } from "./store";
import { World } from "./world";

const DEFAULT_CONFIG = join(homedir(), ".config", "terrarium", "hub.json");
const DEFAULT_DB = join(homedir(), ".local", "share", "terrarium", "hub.db");
const DEFAULT_WEB_DIST = resolve(import.meta.dir, "..", "..", "web", "dist");

const USAGE = `Usage: terrarium-hub [options]

  --bind <address>     Address to listen on (default: 127.0.0.1)
  --port <n>           Port to listen on; 0 picks a free one (default: 8787)
  --config <path>      Token config (default: ${DEFAULT_CONFIG})
  --db <path>          SQLite database, created if missing (default: ${DEFAULT_DB})
  --web-dist <path>    Built frontend to serve (default: packages/web/dist)
  --heartbeat-timeout-ms <n>
                       A connected host with no heartbeat for this long is shown
                       offline (default: 30000, three missed 10 s heartbeats)
  --help               Show this help
`;

function fail(message: string): never {
	process.stderr.write(`${message}\n\n${USAGE}`);
	process.exit(2);
}

const args = (() => {
	try {
		return parseArgs({
			options: {
				bind: { type: "string" },
				port: { type: "string" },
				config: { type: "string" },
				db: { type: "string" },
				"web-dist": { type: "string" },
				"heartbeat-timeout-ms": { type: "string" },
				help: { type: "boolean" },
			},
			strict: true,
		}).values;
	} catch (error) {
		fail(errorMessage(error));
	}
})();

if (args.help) {
	process.stdout.write(USAGE);
	process.exit(0);
}

const port = Number(args.port ?? "8787");
if (!Number.isInteger(port) || port < 0 || port > 65535) {
	fail(`--port expects an integer from 0 to 65535, got "${args.port}"`);
}
const heartbeatTimeoutMs = Number(args["heartbeat-timeout-ms"] ?? "30000");
if (!Number.isInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs < 100) {
	fail(
		`--heartbeat-timeout-ms expects an integer of at least 100, got "${args["heartbeat-timeout-ms"]}"`,
	);
}
const log = (message: string): void => {
	process.stderr.write(`${new Date().toISOString()} ${message}\n`);
};

let auth: Auth;
try {
	auth = createAuth(loadConfig(args.config ?? DEFAULT_CONFIG));
} catch (error) {
	fail(errorMessage(error));
}

const dbPath = args.db ?? DEFAULT_DB;
mkdirSync(dirname(dbPath), { recursive: true });
const store = new Store(dbPath);
let server: Server<SocketData> | undefined;
const hub = new Hub(
	store,
	new World(auth.hosts, heartbeatTimeoutMs),
	(message) => {
		server?.publish(WORLD_TOPIC, message);
	},
);
server = startServer({
	hostname: args.bind ?? "127.0.0.1",
	port,
	auth,
	hub,
	webDist: args["web-dist"] ?? DEFAULT_WEB_DIST,
	log,
});

log(
	`hub: listening on http://${server.hostname}:${server.port} (hosts: ${auth.hosts.join(", ")}; db: ${dbPath}; heartbeat timeout: ${heartbeatTimeoutMs}ms)`,
);

const shutdown = (): void => {
	hub.stop();
	void server?.stop(true);
	store.close();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
