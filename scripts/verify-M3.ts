import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type {
	AgentView,
	TerrariumEvent,
	TerrariumEventKind,
	WorldDelta,
	WorldMessage,
	WorldSnapshot,
} from "../packages/protocol/src/index";

const VERIFY_HOST = "verify-host";
const OTHER_HOST = "verify-other";
const COLLECTOR_TOKEN = "verify-collector-token-host";
const VIEW_TOKEN = "verify-view-token-0000";
const AGENT = `${VERIFY_HOST}:/nonexistent/terrarium-verify/session.jsonl`;
const SECRET = "PROMPT-TEXT-MUST-NOT-LEAK";
const TIMEOUT_MS = 5_000;

const { values: args } = parseArgs({
	options: {
		phase: { type: "string" },
		port: { type: "string" },
		db: { type: "string" },
		"usage-ts": { type: "string" },
	},
	strict: true,
});
const phase = args.phase;
const port = Number(args.port);
const usageTs = Number(args["usage-ts"]);
if (
	(phase !== "live" && phase !== "rebuilt") ||
	!Number.isInteger(port) ||
	!Number.isInteger(usageTs) ||
	args.db === undefined
) {
	throw new Error(
		"usage: verify-M3.ts --phase live|rebuilt --port <n> --db <path> --usage-ts <ms>",
	);
}
const dbPath = args.db;
const base = `127.0.0.1:${port}`;
let failures = 0;

function check(condition: boolean, message: string): void {
	console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
	if (!condition) failures++;
}

function within<T>(promise: Promise<T>, what: string): Promise<T> {
	const { promise: timeout, reject } = Promise.withResolvers<T>();
	const timer = setTimeout(
		() => reject(new Error(`timed out after ${TIMEOUT_MS}ms: ${what}`)),
		TIMEOUT_MS,
	);
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function event(
	kind: TerrariumEventKind,
	data: Record<string, unknown>,
	overrides: Partial<TerrariumEvent> = {},
): TerrariumEvent {
	return {
		v: 1,
		host: VERIFY_HOST,
		ts: Date.now(),
		agentId: AGENT,
		kind,
		data: { source: "omp", ...data },
		...overrides,
	};
}

/** turn.usage carrying fields outside the contract that the hub must drop. */
const USAGE_EVENT = event(
	"turn.usage",
	{
		source: "stats",
		provider: "anthropic",
		model: "claude-verify",
		tokensIn: 1200,
		tokensOut: 340,
		tokensCacheRead: 5000,
		tokensCacheWrite: 60,
		cost: 0.25,
		prompt: SECRET,
		response: { text: SECRET },
	},
	{ ts: usageTs },
);
const USAGE_TOKENS = 1200 + 340 + 5000 + 60;

type Connection = {
	ws: WebSocket;
	raw: string[];
	inbox: WorldMessage[];
	closed: Promise<CloseEvent>;
	/** Resolves with the first unconsumed message matching `match`. */
	next(
		match: (message: WorldMessage) => boolean,
		what: string,
	): Promise<WorldMessage>;
};

function connect(
	path: string,
	headers?: Record<string, string>,
): Promise<Connection> {
	const ws =
		headers === undefined
			? new WebSocket(`ws://${base}${path}`)
			: new WebSocket(`ws://${base}${path}`, { headers });
	const raw: string[] = [];
	const inbox: WorldMessage[] = [];
	let cursor = 0;
	let wake: (() => void) | null = null;
	const closing = Promise.withResolvers<CloseEvent>();
	ws.addEventListener("close", closing.resolve);
	ws.addEventListener("message", (message) => {
		const text = String(message.data);
		raw.push(text);
		inbox.push(JSON.parse(text) as WorldMessage);
		wake?.();
	});
	const next: Connection["next"] = (match, what) =>
		within(
			(async () => {
				for (;;) {
					while (cursor < inbox.length) {
						const message = inbox[cursor++] as WorldMessage;
						if (match(message)) return message;
					}
					const arrival = Promise.withResolvers<void>();
					wake = arrival.resolve;
					await arrival.promise;
				}
			})(),
			what,
		);
	const opening = Promise.withResolvers<Connection>();
	ws.addEventListener("open", () =>
		opening.resolve({ ws, raw, inbox, closed: closing.promise, next }),
	);
	ws.addEventListener("close", (close) =>
		opening.reject(new Error(`closed before open (code ${close.code})`)),
	);
	return within(opening.promise, `connect ${path}`);
}

async function rejected(
	path: string,
	headers?: Record<string, string>,
): Promise<boolean> {
	try {
		const connection = await connect(path, headers);
		connection.ws.close();
		return false;
	} catch {
		return true;
	}
}

async function waitForHub(): Promise<void> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		try {
			const response = await fetch(`http://${base}/healthz`);
			if (response.ok) return;
		} catch {
			// not listening yet
		}
		if (Date.now() > deadline) throw new Error("hub did not become healthy");
		await Bun.sleep(100);
	}
}

const isSnapshot = (message: WorldMessage): message is WorldSnapshot =>
	message.type === "snapshot";
const isDelta = (message: WorldMessage): message is WorldDelta =>
	message.type === "delta";

function snapshotAgent(snapshot: WorldSnapshot): AgentView | undefined {
	return snapshot.hosts[VERIFY_HOST]?.agents[AGENT];
}

function dayTokens(snapshot: WorldSnapshot): number {
	const total = snapshot.usage.find((rollup) => rollup.window === "day")?.total;
	return total === undefined
		? 0
		: total.tokensIn +
				total.tokensOut +
				total.tokensCacheRead +
				total.tokensCacheWrite;
}

async function browserSnapshot(): Promise<{
	browser: Connection;
	snapshot: WorldSnapshot;
}> {
	const browser = await connect(
		`/view?token=${encodeURIComponent(VIEW_TOKEN)}`,
	);
	const first = await browser.next(() => true, "first browser message");
	if (!isSnapshot(first))
		throw new Error("first browser message is not a snapshot");
	return { browser, snapshot: first };
}

const collectorHeaders = { authorization: `Bearer ${COLLECTOR_TOKEN}` };
const seen: string[] = [];

async function livePhase(): Promise<void> {
	const page = await fetch(`http://${base}/`);
	check(
		page.ok && (await page.text()).includes("terrarium-verify-index"),
		"http: serves the frontend index.html",
	);

	check(
		await rejected("/ingest", {
			authorization: "Bearer wrong-token-0000000000",
		}),
		"ingest: rejects an unknown collector token",
	);
	check(
		await rejected("/ingest", { authorization: `Bearer ${VIEW_TOKEN}` }),
		"ingest: rejects the view token",
	);
	check(await rejected("/ingest"), "ingest: rejects a missing token");
	const intruder = await connect("/view?token=not-the-view-token");
	const intruderClose = await within(intruder.closed, "intruder close");
	check(
		intruderClose.code === 4401 && intruder.raw.length === 0,
		"view: closes a bad view token with 4401 before sending anything",
	);

	const observer = (await browserSnapshot()).browser;
	const collector = await connect("/ingest", collectorHeaders);
	await observer.next(
		(message) =>
			isDelta(message) &&
			message.event === null &&
			message.hostsUpserted.some((h) => h.host === VERIFY_HOST && h.online),
		"observer: host online delta",
	);

	const sequence = [
		event("agent.seen", { agentKind: "omp", folder: "terrarium-verify" }),
		event("agent.state", { state: "working" }),
		event("tool.start", {
			tool: "bash",
			toolCallId: "call-1",
			args: { command: SECRET },
		}),
		event("tool.end", { tool: "bash", toolCallId: "call-1", isError: true }),
		USAGE_EVENT,
	];
	collector.ws.send(
		JSON.stringify(
			event(
				"agent.seen",
				{ agentKind: "omp" },
				{ host: OTHER_HOST, agentId: `${OTHER_HOST}:/spoofed.jsonl` },
			),
		),
	);
	collector.ws.send("not json");
	for (const item of sequence) collector.ws.send(JSON.stringify(item));
	await observer.next(
		(message) => isDelta(message) && message.event?.kind === "turn.usage",
		"observer: turn.usage delta",
	);

	const { browser, snapshot } = await browserSnapshot();
	const agent = snapshotAgent(snapshot);
	check(agent !== undefined, "snapshot: contains the synthetic agent");
	check(agent?.agentKind === "omp", "snapshot: agentKind omp");
	check(agent?.folder === "terrarium-verify", "snapshot: folder name");
	check(agent?.state === "working", "snapshot: state working");
	check(
		agent?.currentTool === null && agent.lastToolError === true,
		"snapshot: tool ended, with the error flag",
	);
	check(
		agent !== undefined &&
			agent.usage.tokensIn === 1200 &&
			agent.usage.messages === 1,
		"snapshot: per-agent usage",
	);
	check(dayTokens(snapshot) === USAGE_TOKENS, "snapshot: today's usage rollup");
	check(
		snapshot.usage.find((r) => r.window === "day")?.byProvider.anthropic
			?.cost === 0.25,
		"snapshot: usage by provider",
	);
	check(
		snapshot.hosts[VERIFY_HOST]?.online === true &&
			Object.keys(snapshot.hosts[OTHER_HOST]?.agents ?? {}).length === 0,
		"snapshot: host online; event for another host was dropped",
	);

	collector.ws.send(
		JSON.stringify(event("tool.start", { tool: "read", toolCallId: "call-2" })),
	);
	const delta = (await browser.next(
		(message) => isDelta(message) && message.event?.kind === "tool.start",
		"browser: WorldDelta after the snapshot",
	)) as WorldDelta;
	check(
		delta.seq > snapshot.seq &&
			delta.agentsUpserted.some(
				(a) => a.agentId === AGENT && a.currentTool?.name === "read",
			),
		"delta: subsequent WorldDelta shows the read tool",
	);
	const usageEvent = observer.inbox.find(
		(message) => isDelta(message) && message.event?.kind === "turn.usage",
	) as WorldDelta | undefined;
	check(
		usageEvent?.event !== null &&
			usageEvent?.event.data.prompt === undefined &&
			usageEvent?.event.data.tokensIn === 1200,
		"delta: turn.usage event keeps contract fields and drops the rest",
	);

	collector.ws.close();
	await browser.next(
		(message) =>
			isDelta(message) &&
			message.hostsUpserted.some((h) => h.host === VERIFY_HOST && !h.online),
		"browser: host offline delta",
	);
	check(true, "delta: collector disconnect marks the host offline");
	seen.push(...observer.raw, ...browser.raw);
	observer.ws.close();
	browser.ws.close();
}

async function rebuiltPhase(): Promise<void> {
	const { browser, snapshot } = await browserSnapshot();
	const agent = snapshotAgent(snapshot);
	check(agent !== undefined, "rebuilt: agent restored from storage");
	check(
		agent?.state === "working" && agent.currentTool?.name === "read",
		"rebuilt: activity restored",
	);
	check(dayTokens(snapshot) === USAGE_TOKENS, "rebuilt: usage restored");
	check(
		snapshot.hosts[VERIFY_HOST]?.online === false,
		"rebuilt: host offline until its collector reconnects",
	);

	const collector = await connect("/ingest", collectorHeaders);
	collector.ws.send(JSON.stringify(USAGE_EVENT));
	collector.ws.send(JSON.stringify(event("host.heartbeat", {})));
	await browser.next(
		(message) => isDelta(message) && message.event?.kind === "host.heartbeat",
		"browser: heartbeat delta",
	);
	const after = (await browserSnapshot()).snapshot;
	check(
		dayTokens(after) === USAGE_TOKENS &&
			snapshotAgent(after)?.usage.messages === 1,
		"rebuilt: a replayed turn.usage is not counted twice",
	);
	seen.push(...browser.raw);
	collector.ws.close();
	browser.ws.close();

	const db = new Database(dbPath, { readonly: true });
	const rows = db
		.query<{ n: number }, []>("SELECT count(*) AS n FROM events")
		.get();
	db.close();
	check((rows?.n ?? 0) >= 7, `storage: raw events stored (${rows?.n ?? 0})`);
	const bytes = [dbPath, `${dbPath}-wal`]
		.map((path) => {
			try {
				return readFileSync(path).toString("latin1");
			} catch {
				return "";
			}
		})
		.join("");
	check(!bytes.includes(SECRET), "storage: no prompt text in the database");
}

await waitForHub();
await (phase === "live" ? livePhase() : rebuiltPhase());
check(
	seen.every((message) => !message.includes(SECRET)),
	"privacy: no prompt text reached a browser",
);
if (failures > 0) {
	console.log(`FAIL: ${failures} check(s) failed (${phase})`);
	process.exit(1);
}
console.log(`OK: M3 ${phase} phase passed`);
process.exit(0);
