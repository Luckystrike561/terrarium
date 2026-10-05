import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, type Harness } from "../extensions/omp/harness";
import { createMerger } from "../packages/collector/src/merge";
import { startOmpSource } from "../packages/collector/src/sources/omp";
import type { TerrariumEvent } from "../packages/protocol/src/index";

const SESSION_FILE = "/nonexistent/terrarium-verify/session.jsonl";
const SECRET = "PROMPT-TEXT-MUST-NOT-LEAK";
const TOOLS = ["read", "edit", "bash"];
const KINDS = new Set([
	"agent.seen",
	"agent.state",
	"tool.start",
	"tool.end",
	"turn.usage",
	"agent.gone",
	"host.heartbeat",
]);

const dir = mkdtempSync(join(tmpdir(), "terrarium-m2-"));
let failures = 0;

function check(condition: boolean, message: string): void {
	console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
	if (!condition) failures++;
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	const { promise: timeout, reject } = Promise.withResolvers<T>();
	const timer = setTimeout(() => reject(new Error(`timed out: ${what}`)), ms);
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A prompt that runs read, then edit, then bash, then ends. */
function runPrompt(harness: Harness): void {
	harness.fire("session_start");
	harness.fire("agent_start", {
		messages: [{ role: "user", content: SECRET }],
	});
	TOOLS.forEach((tool, index) => {
		const toolCallId = `call-${index}`;
		harness.fire("tool_execution_start", {
			toolCallId,
			toolName: tool,
			args: { command: SECRET },
		});
		harness.fire("tool_execution_end", {
			toolCallId,
			toolName: tool,
			result: { content: [{ type: "text", text: SECRET }] },
			isError: tool === "bash",
		});
	});
	harness.fire("agent_end", {
		messages: [{ role: "assistant", content: SECRET }],
	});
	harness.fire("session_shutdown");
}

function checkToolPairs(events: TerrariumEvent[], label: string): void {
	const tools = events.filter(
		(e) => e.kind === "tool.start" || e.kind === "tool.end",
	);
	const expected = TOOLS.flatMap((tool) => [
		`tool.start ${tool}`,
		`tool.end ${tool}`,
	]);
	const actual = tools.map((e) => `${e.kind} ${String(e.data.tool)}`);
	check(
		JSON.stringify(actual) === JSON.stringify(expected),
		`${label}: exactly 3 tool.start/tool.end pairs in order read -> edit -> bash (got ${JSON.stringify(actual)})`,
	);
	check(
		tools.every((e, i) => e.data.toolCallId === `call-${Math.floor(i / 2)}`),
		`${label}: each pair shares its toolCallId`,
	);
	check(
		tools
			.filter((e) => e.kind === "tool.end")
			.map((e) => e.data.isError)
			.join() === "false,false,true",
		`${label}: tool.end carries isError (bash failed)`,
	);
	const lastState = events.filter((e) => e.kind === "agent.state").at(-1);
	const doneIndex = events.findIndex(
		(e) => e.kind === "agent.state" && e.data.state === "done",
	);
	check(
		doneIndex > events.lastIndexOf(tools.at(-1) as TerrariumEvent) &&
			lastState?.data.state === "done",
		`${label}: agent_end produced agent.state done after the last tool`,
	);
}

async function rawSocket(): Promise<void> {
	const socketPath = join(dir, "raw.sock");
	const lines: string[] = [];
	const received = Promise.withResolvers<void>();
	const server = createServer((connection) => {
		let buffer = "";
		connection.setEncoding("utf8");
		connection.on("data", (chunk: string) => {
			buffer += chunk;
		});
		connection.on("end", () => {
			lines.push(...buffer.split("\n").filter((l) => l.length > 0));
			received.resolve();
		});
	});
	const listening = Promise.withResolvers<void>();
	server.listen(socketPath, listening.resolve);
	await listening.promise;

	const harness = createHarness(
		{ socketPath, host: "verify-host" },
		{ sessionFile: SESSION_FILE, cwd: "/nonexistent/terrarium-verify/project" },
	);
	runPrompt(harness);
	await harness.close();
	await within(received.promise, 2_000, "raw socket lines");
	server.close();

	const events = lines.map((l) => JSON.parse(l) as TerrariumEvent);
	check(
		events.every(
			(e) =>
				e.v === 1 &&
				e.host === "verify-host" &&
				typeof e.ts === "number" &&
				e.agentId === `verify-host:${SESSION_FILE}` &&
				KINDS.has(e.kind) &&
				typeof e.data === "object" &&
				e.data !== null,
		),
		`raw: ${events.length} lines are TerrariumEvent v1 with agentId "<host>:<session_file>"`,
	);
	check(
		JSON.stringify(events.map((e) => e.kind)) ===
			JSON.stringify([
				"agent.seen",
				"agent.state",
				"agent.state",
				...TOOLS.flatMap(() => ["tool.start", "tool.end"]),
				"agent.state",
				"agent.gone",
			]),
		"raw: hook order preserved end to end",
	);
	check(
		events.find((e) => e.kind === "agent.seen")?.data.folder === "project",
		"raw: agent.seen carries the folder name only",
	);
	check(
		!events.some((e) => e.kind === "turn.usage"),
		"raw: extension sends no turn.usage",
	);
	check(
		!lines.some((l) => l.includes(SECRET)),
		"raw: no prompt, args or result text on the wire",
	);
	checkToolPairs(events, "raw");
}

async function collectorMerge(): Promise<void> {
	const socketPath = join(dir, "collector.sock");
	const merged: TerrariumEvent[] = [];
	const gone = Promise.withResolvers<void>();
	const emit = createMerger((event) => {
		merged.push(event);
		if (event.kind === "agent.gone") gone.resolve();
	});
	const host = "laptop-a";
	const agentId = `${host}:${SESSION_FILE}`;
	const source = startOmpSource({ socketPath, host, emit, log: () => {} });
	await Bun.sleep(50);

	const herdr = (kind: TerrariumEvent["kind"], data: Record<string, unknown>) =>
		emit({
			v: 1,
			host,
			ts: Date.now(),
			agentId,
			kind,
			data: { source: "herdr", ...data },
		});
	herdr("agent.seen", { agentKind: "omp", folder: "project", paneId: "p1" });
	herdr("agent.state", { state: "idle" });

	const harness = createHarness(
		{ socketPath, host: "extension-guess" },
		{ sessionFile: SESSION_FILE, cwd: "/nonexistent/terrarium-verify/project" },
	);
	harness.fire("session_start");
	harness.fire("agent_start");
	await Bun.sleep(50);
	herdr("agent.state", { state: "working" });
	emit({
		v: 1,
		host,
		ts: Date.now(),
		agentId,
		kind: "turn.usage",
		data: { source: "omp", tokensIn: 999 },
	});
	emit({
		v: 1,
		host,
		ts: Date.now(),
		agentId,
		kind: "turn.usage",
		data: { source: "stats", tokensIn: 1 },
	});
	TOOLS.forEach((tool, index) => {
		harness.fire("tool_execution_start", {
			toolCallId: `call-${index}`,
			toolName: tool,
		});
		harness.fire("tool_execution_end", {
			toolCallId: `call-${index}`,
			toolName: tool,
			isError: tool === "bash",
		});
	});
	harness.fire("agent_end");
	harness.fire("session_shutdown");
	await harness.close();
	await within(gone.promise, 2_000, "merged agent.gone");
	source.stop();

	check(
		merged.every((e) => e.agentId === agentId),
		`merge: extension events rekeyed to the collector host (${agentId})`,
	);
	const usage = merged.filter((e) => e.kind === "turn.usage");
	check(
		usage.length === 1 && usage[0]?.data.source === "stats",
		"merge: turn.usage only from stats.db",
	);
	const states = merged
		.filter((e) => e.kind === "agent.state")
		.map((e) => `${String(e.data.source)}:${String(e.data.state)}`);
	check(
		JSON.stringify(states) ===
			JSON.stringify(["herdr:idle", "omp:working", "omp:done"]),
		`merge: one state stream, extension authoritative once it reports (got ${JSON.stringify(states)})`,
	);
	const seen = merged.filter((e) => e.kind === "agent.seen");
	check(
		seen.length === 2 &&
			JSON.stringify(seen.at(-1)?.data.sources) ===
				JSON.stringify(["herdr", "omp"]) &&
			seen.at(-1)?.data.paneId === "p1",
		"merge: agent.seen merges herdr and omp for one agentId",
	);
	checkToolPairs(merged, "merge");
}

async function missingSocket(): Promise<void> {
	const written: string[] = [];
	const stdoutWrite = process.stdout.write.bind(process.stdout);
	const stderrWrite = process.stderr.write.bind(process.stderr);
	const capture = (chunk: unknown): boolean => {
		written.push(String(chunk));
		return true;
	};
	process.stdout.write = capture as typeof process.stdout.write;
	process.stderr.write = capture as typeof process.stderr.write;
	let threw = false;
	try {
		const harness = createHarness(
			{ socketPath: join(dir, "absent.sock"), host: "verify-host" },
			{ sessionFile: SESSION_FILE, cwd: "/nonexistent" },
		);
		runPrompt(harness);
		await Bun.sleep(100);
		await harness.close();
	} catch {
		threw = true;
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
	}
	check(
		!threw && written.length === 0,
		"missing socket: events dropped silently",
	);
}

try {
	await rawSocket();
	await collectorMerge();
	await missingSocket();
} catch (error) {
	check(false, error instanceof Error ? error.message : String(error));
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
	console.log(`FAIL: ${failures} check(s) failed`);
	process.exit(1);
}
console.log("OK: M2 verified");
