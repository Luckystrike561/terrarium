import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { connect as connectUnix } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Subprocess } from "bun";
import type {
	TerrariumEvent,
	WorldDelta,
	WorldMessage,
	WorldSnapshot,
} from "../packages/protocol/src/index";

const HOST = "verify-b";
const COLLECTOR_TOKEN = "verify-collector-token-b-0000";
const VIEW_TOKEN = "verify-view-token-0000";
const AGENT = `${HOST}:/nonexistent/terrarium-verify-M5/session.jsonl`;
const HEARTBEAT_MS = 300;
const HEARTBEAT_TIMEOUT_MS = 1_500;
const BUFFER_SIZE = 40;
const TOOL_PAIRS = 30;
const TIMEOUT_MS = 20_000;

const { values: args } = parseArgs({
	options: { work: { type: "string" } },
	strict: true,
});
if (args.work === undefined)
	throw new Error("usage: verify-M5.ts --work <dir>");
const work = args.work;
const hubDb = join(work, "hub.db");
const statsDb = join(work, "stats.db");
const home = join(work, "home");
const runtimeDir = join(work, "run");
const pidFile = join(work, "pids");
let failures = 0;

function check(condition: boolean, message: string): void {
	console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
	if (!condition) failures++;
}

async function until<T>(
	what: string,
	probe: () => T | undefined | Promise<T | undefined>,
	timeoutMs = TIMEOUT_MS,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await probe();
		if (value !== undefined) return value;
		if (Date.now() > deadline) {
			throw new Error(`timed out after ${timeoutMs}ms: ${what}`);
		}
		await Bun.sleep(25);
	}
}

const children = new Set<Child>();

/** A child process whose output lines are kept in memory and in a log file. */
class Child {
	readonly stdout: string[] = [];
	readonly stderr: string[] = [];
	readonly proc: Subprocess<"ignore", "pipe", "pipe">;

	constructor(name: string, cmd: string[], env: Record<string, string>) {
		this.proc = Bun.spawn(cmd, {
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		appendFileSync(pidFile, `${this.proc.pid}\n`);
		children.add(this);
		const log = join(work, `${name}.log`);
		void this.#pump(this.proc.stdout, this.stdout, log);
		void this.#pump(this.proc.stderr, this.stderr, log);
	}

	async #pump(
		stream: ReadableStream<Uint8Array>,
		into: string[],
		log: string,
	): Promise<void> {
		const decoder = new TextDecoder();
		let pending = "";
		for await (const chunk of stream) {
			pending += decoder.decode(chunk, { stream: true });
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				into.push(line);
				appendFileSync(log, `${line}\n`);
			}
		}
	}

	get alive(): boolean {
		return this.proc.exitCode === null && this.proc.signalCode === null;
	}

	/** Index of the first stderr line at or after `from` matching `pattern`. */
	waitLog(pattern: RegExp, from: number, what: string): Promise<number> {
		return until(what, () => {
			const index = this.stderr.findIndex(
				(line, i) => i >= from && pattern.test(line),
			);
			return index < 0 ? undefined : index;
		});
	}

	async stop(): Promise<void> {
		if (!this.alive) return;
		this.proc.kill("SIGCONT");
		this.proc.kill("SIGTERM");
		const timer = setTimeout(() => this.proc.kill("SIGKILL"), 5_000);
		await this.proc.exited;
		clearTimeout(timer);
	}
}

const port = (() => {
	const probe = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const free = probe.port;
	void probe.stop(true);
	if (free === undefined) throw new Error("no free port");
	return free;
})();
const base = `127.0.0.1:${port}`;

mkdirSync(join(home, ".config"), { recursive: true });
mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
mkdirSync(join(work, "web"));
writeFileSync(
	join(work, "web", "index.html"),
	"<!doctype html><title>terrarium-verify-index</title>\n",
);
writeFileSync(
	join(work, "hub.json"),
	JSON.stringify({
		collectorTokens: { [HOST]: COLLECTOR_TOKEN },
		viewTokens: [VIEW_TOKEN],
	}),
);
const tokenFile = join(home, ".config", "terrarium", "collector.token");
mkdirSync(join(home, ".config", "terrarium"), { recursive: true });
writeFileSync(tokenFile, `${COLLECTOR_TOKEN}\n`, { mode: 0o600 });

const stats = new Database(statsDb, { create: true });
stats.run(`CREATE TABLE messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_file TEXT NOT NULL, folder TEXT NOT NULL, model TEXT NOT NULL,
	provider TEXT NOT NULL, api TEXT NOT NULL, timestamp INTEGER NOT NULL,
	duration INTEGER, ttft INTEGER, stop_reason TEXT NOT NULL,
	input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
	cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL,
	total_tokens INTEGER NOT NULL, cost_total REAL NOT NULL, agent_type TEXT NOT NULL
)`);
let usageRows = 0;
/** Inserts one stats.db row the way omp would and returns its token count. */
function addUsage(): number {
	usageRows++;
	const tokensIn = 1_000 * usageRows;
	const tokensOut = 100 * usageRows;
	stats
		.query(
			`INSERT INTO messages (session_file, folder, model, provider, api, timestamp,
			duration, ttft, stop_reason, input_tokens, output_tokens, cache_read_tokens,
			cache_write_tokens, total_tokens, cost_total, agent_type)
			VALUES (?, 'terrarium-verify-M5', 'claude-verify', 'anthropic', 'messages', ?,
			1000, 200, 'stop', ?, ?, 0, 0, ?, 0.01, 'main')`,
		)
		.run(
			AGENT.slice(HOST.length + 1),
			Date.now(),
			tokensIn,
			tokensOut,
			tokensIn + tokensOut,
		);
	return tokensIn + tokensOut;
}

const inherited: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
	if (value !== undefined && !key.startsWith("TERRARIUM_")) {
		inherited[key] = value;
	}
}

async function startHub(): Promise<Child> {
	const child = new Child(
		"hub",
		[
			process.execPath,
			"packages/hub/src/main.ts",
			"--bind",
			"127.0.0.1",
			"--port",
			String(port),
			"--config",
			join(work, "hub.json"),
			"--db",
			hubDb,
			"--web-dist",
			join(work, "web"),
			"--heartbeat-timeout-ms",
			String(HEARTBEAT_TIMEOUT_MS),
		],
		{ ...inherited, HOME: home },
	);
	await until("hub healthy", async () => {
		try {
			return (await fetch(`http://${base}/healthz`)).ok ? true : undefined;
		} catch {
			return undefined;
		}
	});
	return child;
}

function startCollector(): Child {
	return new Child(
		"collector",
		[
			process.execPath,
			"packages/collector/src/main.ts",
			"--stdout",
			"--herdr-socket",
			join(runtimeDir, "no-herdr.sock"),
			"--stats-db",
			statsDb,
			"--poll-ms",
			"100",
			"--stats-sync-ms",
			"0",
			"--heartbeat-ms",
			String(HEARTBEAT_MS),
			"--buffer-size",
			String(BUFFER_SIZE),
		],
		{
			...inherited,
			HOME: home,
			XDG_CONFIG_HOME: join(home, ".config"),
			XDG_RUNTIME_DIR: runtimeDir,
			TERRARIUM_HOST: HOST,
			TERRARIUM_INGEST_URL: `ws://${base}/ingest`,
		},
	);
}

type View = {
	ws: WebSocket;
	inbox: WorldMessage[];
	next(
		match: (message: WorldMessage) => boolean,
		what: string,
	): Promise<WorldMessage>;
};

async function openView(): Promise<{ view: View; snapshot: WorldSnapshot }> {
	const ws = new WebSocket(
		`ws://${base}/view?token=${encodeURIComponent(VIEW_TOKEN)}`,
	);
	const inbox: WorldMessage[] = [];
	let cursor = 0;
	ws.addEventListener("message", (message) => {
		inbox.push(JSON.parse(String(message.data)) as WorldMessage);
	});
	const view: View = {
		ws,
		inbox,
		next: (match, what) =>
			until(what, () => {
				while (cursor < inbox.length) {
					const message = inbox[cursor++] as WorldMessage;
					if (match(message)) return message;
				}
				return undefined;
			}),
	};
	const first = await view.next(() => true, "view snapshot");
	if (first.type !== "snapshot")
		throw new Error("first view message is not a snapshot");
	return { view, snapshot: first };
}

const hostFlip = (online: boolean) => (message: WorldMessage) =>
	message.type === "delta" &&
	(message as WorldDelta).hostsUpserted.some(
		(host) => host.host === HOST && host.online === online,
	);

function dayTokens(snapshot: WorldSnapshot): number {
	const total = snapshot.usage.find((rollup) => rollup.window === "day")?.total;
	return total === undefined ? 0 : total.tokensIn + total.tokensOut;
}

/** Writes lines to the collector's omp socket, as the extension would. */
async function pushToExtensionSocket(events: TerrariumEvent[]): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const socket = connectUnix(join(runtimeDir, "terrarium.sock"));
	socket.once("error", reject);
	socket.once("connect", () => {
		socket.end(
			events.map((event) => `${JSON.stringify(event)}\n`).join(""),
			resolve,
		);
	});
	await promise;
}

function ompEvent(
	kind: TerrariumEvent["kind"],
	data: Record<string, unknown>,
): TerrariumEvent {
	return { v: 1, host: HOST, ts: Date.now(), agentId: AGENT, kind, data };
}

type Key = [
	kind: string,
	ts: number,
	agentId: string,
	toolCallId: string | null,
];

function keyOf(event: {
	kind: string;
	ts: number;
	agentId: string;
	data: Record<string, unknown>;
}): Key {
	const id = event.data.toolCallId;
	return [
		event.kind,
		event.ts,
		event.agentId,
		typeof id === "string" ? id : null,
	];
}

function lastEventId(): number {
	const db = new Database(hubDb, { readonly: true });
	try {
		return (
			db
				.query<{ id: number | null }, []>("SELECT max(id) AS id FROM events")
				.get()?.id ?? 0
		);
	} finally {
		db.close();
	}
}

function storedSince(id: number): Key[] {
	const db = new Database(hubDb, { readonly: true });
	try {
		return db
			.query<
				{ kind: string; ts: number; agent_id: string; data: string },
				[number]
			>("SELECT kind, ts, agent_id, data FROM events WHERE id > ? ORDER BY id")
			.all(id)
			.map((row) =>
				keyOf({
					kind: row.kind,
					ts: row.ts,
					agentId: row.agent_id,
					data: JSON.parse(row.data) as Record<string, unknown>,
				}),
			);
	} finally {
		db.close();
	}
}

const emitted = (child: Child, from: number): TerrariumEvent[] =>
	child.stdout.slice(from).map((line) => JSON.parse(line) as TerrariumEvent);

async function main(): Promise<void> {
	console.log(
		`--- hub on ${base}, collector with HOME and XDG dirs under ${work}`,
	);
	let hub = await startHub();
	const c = startCollector();
	await c.waitLog(/omp: listening on /, 0, "collector omp socket");
	await c.waitLog(/hub: connected to /, 0, "collector connected");

	const live = await openView();
	await live.view.next(
		(message) =>
			message.type === "delta" &&
			(message as WorldDelta).event?.kind === "host.heartbeat",
		"first heartbeat delta",
	);
	check(true, "heartbeat: hub received host.heartbeat from the collector");

	await pushToExtensionSocket([
		ompEvent("agent.seen", { agentKind: "omp", folder: "terrarium-verify-M5" }),
	]);
	await live.view.next(
		(message) =>
			message.type === "delta" &&
			(message as WorldDelta).agentsUpserted.some((a) => a.agentId === AGENT),
		"live agent.seen reaches the hub",
	);
	check(true, "live: an extension event reaches the hub");
	live.view.ws.close();

	console.log("--- hub killed; events pushed while it is down");
	const beforeKill = lastEventId();
	const disconnectFrom = c.stderr.length;
	hub.proc.kill("SIGKILL");
	await hub.proc.exited;
	await c.waitLog(
		/hub: disconnected/,
		disconnectFrom,
		"collector notices the hub is gone",
	);

	const outageFrom = c.stdout.length;
	const outage: TerrariumEvent[] = [
		ompEvent("agent.state", { state: "working" }),
	];
	for (let i = 0; i < TOOL_PAIRS; i++) {
		outage.push(
			ompEvent("tool.start", { tool: "read", toolCallId: `call-${i}` }),
		);
		outage.push(
			ompEvent("tool.end", {
				tool: "read",
				toolCallId: `call-${i}`,
				isError: false,
			}),
		);
	}
	outage.push(ompEvent("agent.state", { state: "done" }));
	await pushToExtensionSocket(outage);
	await until("collector emits the pushed events", () =>
		c.stdout.length - outageFrom >= outage.length ? true : undefined,
	);
	const offlineTokens = addUsage() + addUsage();
	await until("collector emits the stats.db usage", () =>
		emitted(c, outageFrom).filter((event) => event.kind === "turn.usage")
			.length === 2
			? true
			: undefined,
	);
	await Bun.sleep(500);
	const buffered = emitted(c, outageFrom);
	check(
		buffered.length === outage.length + 2,
		`buffer: ${buffered.length} events emitted while the hub was down (${outage.length} extension, 2 usage)`,
	);
	check(c.alive, "buffer: the collector is still running with the hub down");

	console.log("--- hub restarted on the same database");
	const reconnectFrom = c.stderr.length;
	hub = await startHub();
	const replayLine =
		c.stderr[
			await c.waitLog(
				/hub: connected to .*replaying \d+ buffered/,
				reconnectFrom,
				"replay",
			)
		] ?? "";
	const replayed = Number(/replaying (\d+) buffered/.exec(replayLine)?.[1]);
	check(
		replayed === BUFFER_SIZE,
		`replay: collector replays ${replayed} buffered events (ring capacity ${BUFFER_SIZE})`,
	);
	const droppedCount = buffered.length - BUFFER_SIZE;
	check(
		c.stderr
			.slice(reconnectFrom)
			.some((line) => line.includes(`dropped ${droppedCount} event(s)`)),
		`replay: the ring is bounded; the ${droppedCount} oldest events were dropped and logged`,
	);
	const expected = buffered.slice(-BUFFER_SIZE).map(keyOf);
	const stored = await until("hub stores the replayed events", () => {
		const rows = storedSince(beforeKill);
		return rows.length >= expected.length ? rows : undefined;
	});
	check(
		JSON.stringify(stored) === JSON.stringify(expected),
		`replay: the hub stored the newest ${expected.length} buffered events, in emission order`,
	);

	const after = await openView();
	const hostView = after.snapshot.hosts[HOST];
	check(hostView?.online === true, "replay: host online after reconnect");
	check(
		hostView?.agents[AGENT]?.state === "done",
		"replay: agent state reflects the replayed events (done)",
	);
	check(
		dayTokens(after.snapshot) === offlineTokens,
		`replay: usage made while the hub was down is in the totals (${dayTokens(after.snapshot)} tokens)`,
	);

	console.log(
		"--- collector frozen (SIGSTOP): heartbeats stop, socket stays open",
	);
	const hubLogFrom = hub.stderr.length;
	const frozenAt = Date.now();
	c.proc.kill("SIGSTOP");
	await after.view.next(hostFlip(false), "host offline delta");
	const offlineAfter = Date.now() - frozenAt;
	check(
		offlineAfter >= HEARTBEAT_TIMEOUT_MS - HEARTBEAT_MS &&
			offlineAfter <= HEARTBEAT_TIMEOUT_MS + 2_000,
		`offline: host reported offline ${offlineAfter}ms after heartbeats stopped (timeout ${HEARTBEAT_TIMEOUT_MS}ms)`,
	);
	check(
		!hub.stderr
			.slice(hubLogFrom)
			.some((line) => line.includes("collector disconnected")),
		"offline: the collector socket was still open; the heartbeat timeout decided",
	);
	const frozen = await openView();
	check(
		frozen.snapshot.hosts[HOST]?.online === false &&
			frozen.snapshot.hosts[HOST]?.agents[AGENT] !== undefined,
		"offline: snapshot shows the host offline with its agent kept (zone turns to stone)",
	);
	frozen.view.ws.close();
	const sleepTokens = addUsage();

	console.log("--- collector resumed (SIGCONT)");
	c.proc.kill("SIGCONT");
	await after.view.next(hostFlip(true), "host online delta");
	check(true, "revive: host back online after heartbeats resume");
	const revived = await until(
		"usage from the frozen period arrives",
		async () => {
			const { view, snapshot } = await openView();
			view.ws.close();
			return dayTokens(snapshot) === offlineTokens + sleepTokens
				? snapshot
				: undefined;
		},
	);
	check(
		revived.hosts[HOST]?.online === true,
		`revive: usage recorded while frozen appears in the totals (${dayTokens(revived)} tokens)`,
	);
	check(c.alive, "revive: the collector is still running");
	after.view.ws.close();
}

try {
	await main();
} catch (error) {
	failures++;
	console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
	for (const child of children) await child.stop();
	writeFileSync(pidFile, "");
	stats.close();
}
if (failures > 0) {
	console.log(`${failures} check(s) failed`);
	process.exit(1);
}
