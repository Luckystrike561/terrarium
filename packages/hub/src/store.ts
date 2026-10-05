import { Database } from "bun:sqlite";
import type {
	TerrariumEvent,
	UsageRollup,
	UsageTotals,
	UsageWindow,
} from "@terrarium/protocol";
import type { AgentRecord } from "./world";

export type UsageTurn = {
	host: string;
	agentId: string;
	ts: number;
	provider: string;
	model: string;
	tokensIn: number;
	tokensOut: number;
	tokensCacheRead: number;
	tokensCacheWrite: number;
	cost: number;
};

export type Rollups = {
	global: UsageRollup[];
	byHost: Map<string, UsageRollup[]>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	received_at INTEGER NOT NULL,
	host TEXT NOT NULL,
	ts INTEGER NOT NULL,
	agent_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_host_ts ON events (host, ts);
CREATE TABLE IF NOT EXISTS usage_turns (
	host TEXT NOT NULL,
	agent_id TEXT NOT NULL,
	ts INTEGER NOT NULL,
	provider TEXT NOT NULL,
	model TEXT NOT NULL,
	tokens_in INTEGER NOT NULL,
	tokens_out INTEGER NOT NULL,
	tokens_cache_read INTEGER NOT NULL,
	tokens_cache_write INTEGER NOT NULL,
	cost REAL NOT NULL,
	UNIQUE (host, agent_id, ts, model, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write)
);
CREATE TABLE IF NOT EXISTS usage_daily (
	day TEXT NOT NULL,
	host TEXT NOT NULL,
	provider TEXT NOT NULL,
	model TEXT NOT NULL,
	tokens_in INTEGER NOT NULL,
	tokens_out INTEGER NOT NULL,
	tokens_cache_read INTEGER NOT NULL,
	tokens_cache_write INTEGER NOT NULL,
	cost REAL NOT NULL,
	messages INTEGER NOT NULL,
	PRIMARY KEY (day, host, provider, model)
);
CREATE TABLE IF NOT EXISTS agents (
	agent_id TEXT PRIMARY KEY,
	host TEXT NOT NULL,
	record TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hosts (
	host TEXT PRIMARY KEY,
	last_heartbeat INTEGER NOT NULL
);
`;

const WINDOW_DAYS: Record<UsageWindow, number> = { day: 1, week: 7, month: 30 };
const WINDOWS = Object.keys(WINDOW_DAYS) as UsageWindow[];

type RollupRow = {
	host: string;
	provider: string;
	model: string;
	tokens_in: number;
	tokens_out: number;
	tokens_cache_read: number;
	tokens_cache_write: number;
	cost: number;
	messages: number;
};

/** Usage days are calendar days in the hub's local time zone. */
export function localDay(ts: number): string {
	const date = new Date(ts);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function windowStart(now: number, days: number): string {
	const date = new Date(now);
	date.setDate(date.getDate() - (days - 1));
	return localDay(date.getTime());
}

export function emptyTotals(): UsageTotals {
	return {
		tokensIn: 0,
		tokensOut: 0,
		tokensCacheRead: 0,
		tokensCacheWrite: 0,
		cost: 0,
		messages: 0,
	};
}

export function addTotals(into: UsageTotals, add: UsageTotals): void {
	into.tokensIn += add.tokensIn;
	into.tokensOut += add.tokensOut;
	into.tokensCacheRead += add.tokensCacheRead;
	into.tokensCacheWrite += add.tokensCacheWrite;
	into.cost += add.cost;
	into.messages += add.messages;
}

export function emptyRollups(): UsageRollup[] {
	return WINDOWS.map((window) => ({
		window,
		byProvider: {},
		byModel: {},
		total: emptyTotals(),
	}));
}

function addToRollup(rollup: UsageRollup, row: RollupRow): void {
	const totals: UsageTotals = {
		tokensIn: row.tokens_in,
		tokensOut: row.tokens_out,
		tokensCacheRead: row.tokens_cache_read,
		tokensCacheWrite: row.tokens_cache_write,
		cost: row.cost,
		messages: row.messages,
	};
	rollup.byProvider[row.provider] ??= emptyTotals();
	addTotals(rollup.byProvider[row.provider] as UsageTotals, totals);
	rollup.byModel[row.model] ??= emptyTotals();
	addTotals(rollup.byModel[row.model] as UsageTotals, totals);
	addTotals(rollup.total, totals);
}

export class Store {
	readonly #db: Database;
	readonly #insertEvent;
	readonly #insertTurn;
	readonly #addDaily;
	readonly #saveAgent;
	readonly #deleteAgent;
	readonly #saveHost;
	readonly #rollupRows;

	constructor(path: string) {
		this.#db = new Database(path, { create: true, strict: true });
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run("PRAGMA synchronous = NORMAL");
		this.#db.run("PRAGMA busy_timeout = 2000");
		this.#db.run(SCHEMA);
		this.#insertEvent = this.#db.prepare<
			never,
			[number, string, number, string, string, string]
		>(
			"INSERT INTO events (received_at, host, ts, agent_id, kind, data) VALUES (?, ?, ?, ?, ?, ?)",
		);
		this.#insertTurn = this.#db.prepare<
			never,
			[
				string,
				string,
				number,
				string,
				string,
				number,
				number,
				number,
				number,
				number,
			]
		>(
			`INSERT OR IGNORE INTO usage_turns (host, agent_id, ts, provider, model,
				tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, cost)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.#addDaily = this.#db.prepare<
			never,
			[string, string, string, string, number, number, number, number, number]
		>(
			`INSERT INTO usage_daily (day, host, provider, model, tokens_in, tokens_out,
				tokens_cache_read, tokens_cache_write, cost, messages)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
				ON CONFLICT (day, host, provider, model) DO UPDATE SET
					tokens_in = tokens_in + excluded.tokens_in,
					tokens_out = tokens_out + excluded.tokens_out,
					tokens_cache_read = tokens_cache_read + excluded.tokens_cache_read,
					tokens_cache_write = tokens_cache_write + excluded.tokens_cache_write,
					cost = cost + excluded.cost,
					messages = messages + 1`,
		);
		this.#saveAgent = this.#db.prepare<never, [string, string, string]>(
			"INSERT OR REPLACE INTO agents (agent_id, host, record) VALUES (?, ?, ?)",
		);
		this.#deleteAgent = this.#db.prepare<never, [string]>(
			"DELETE FROM agents WHERE agent_id = ?",
		);
		this.#saveHost = this.#db.prepare<never, [string, number]>(
			"INSERT OR REPLACE INTO hosts (host, last_heartbeat) VALUES (?, ?)",
		);
		this.#rollupRows = this.#db.prepare<RollupRow, [string]>(
			`SELECT host, provider, model, SUM(tokens_in) AS tokens_in,
				SUM(tokens_out) AS tokens_out, SUM(tokens_cache_read) AS tokens_cache_read,
				SUM(tokens_cache_write) AS tokens_cache_write, SUM(cost) AS cost,
				SUM(messages) AS messages
				FROM usage_daily WHERE day >= ? GROUP BY host, provider, model`,
		);
	}

	transaction(work: () => void): void {
		this.#db.transaction(work)();
	}

	recordEvent(event: TerrariumEvent, receivedAt: number): void {
		this.#insertEvent.run(
			receivedAt,
			event.host,
			event.ts,
			event.agentId,
			event.kind,
			JSON.stringify(event.data),
		);
	}

	/** Returns false when the same turn was recorded before, e.g. on replay. */
	recordUsage(turn: UsageTurn): boolean {
		const inserted = this.#insertTurn.run(
			turn.host,
			turn.agentId,
			turn.ts,
			turn.provider,
			turn.model,
			turn.tokensIn,
			turn.tokensOut,
			turn.tokensCacheRead,
			turn.tokensCacheWrite,
			turn.cost,
		);
		if (inserted.changes === 0) return false;
		this.#addDaily.run(
			localDay(turn.ts),
			turn.host,
			turn.provider,
			turn.model,
			turn.tokensIn,
			turn.tokensOut,
			turn.tokensCacheRead,
			turn.tokensCacheWrite,
			turn.cost,
		);
		return true;
	}

	saveAgent(record: AgentRecord): void {
		this.#saveAgent.run(
			record.view.agentId,
			record.view.host,
			JSON.stringify(record),
		);
	}

	deleteAgent(agentId: string): void {
		this.#deleteAgent.run(agentId);
	}

	saveHost(host: string, lastHeartbeat: number): void {
		this.#saveHost.run(host, lastHeartbeat);
	}

	loadAgents(): AgentRecord[] {
		return this.#db
			.query<{ record: string }, []>(
				"SELECT record FROM agents ORDER BY agent_id",
			)
			.all()
			.map((row) => JSON.parse(row.record) as AgentRecord);
	}

	loadHosts(): { host: string; lastHeartbeat: number }[] {
		return this.#db
			.query<{ host: string; lastHeartbeat: number }, []>(
				"SELECT host, last_heartbeat AS lastHeartbeat FROM hosts ORDER BY host",
			)
			.all();
	}

	rollups(now: number): Rollups {
		const global = emptyRollups();
		const byHost = new Map<string, UsageRollup[]>();
		WINDOWS.forEach((window, index) => {
			const rows = this.#rollupRows.all(windowStart(now, WINDOW_DAYS[window]));
			for (const row of rows) {
				addToRollup(global[index] as UsageRollup, row);
				let hostRollups = byHost.get(row.host);
				if (hostRollups === undefined) {
					hostRollups = emptyRollups();
					byHost.set(row.host, hostRollups);
				}
				addToRollup(hostRollups[index] as UsageRollup, row);
			}
		});
		return { global, byHost };
	}

	close(): void {
		this.#db.close();
	}
}
