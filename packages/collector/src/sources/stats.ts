import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import type { Subprocess } from "bun";
import { errorMessage } from "../guards";
import type { Emit, Log, Source } from "../types";

const BATCH_SIZE = 500;

export type StatsSourceOptions = {
	dbPath: string;
	host: string;
	pollMs: number;
	/**
	 * omp fills stats.db from its session files only when `omp stats` runs.
	 * While `shouldSync()` holds, the source runs it this often so usage
	 * appears during a turn; 0 disables syncing.
	 */
	syncMs: number;
	shouldSync: () => boolean;
	emit: Emit;
	log: Log;
};

export type StatsSource = Source & {
	/** Runs one `omp stats` sync soon, even if `shouldSync()` is false. */
	requestSync(): void;
};

type MessageRow = {
	id: number;
	session_file: string;
	folder: string;
	model: string;
	provider: string;
	api: string;
	timestamp: number;
	duration: number | null;
	ttft: number | null;
	stop_reason: string;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	total_tokens: number;
	cost_total: number;
	agent_type: string;
};

/**
 * The watermark is the AUTOINCREMENT `id`, not `timestamp`: one `omp stats`
 * sync inserts rows from several session files, so a later insert can carry
 * an older timestamp than rows already read.
 */
const SELECT_NEW = `SELECT id, session_file, folder, model, provider, api, timestamp,
	duration, ttft, stop_reason, input_tokens, output_tokens, cache_read_tokens,
	cache_write_tokens, total_tokens, cost_total, agent_type
	FROM messages WHERE id > ? ORDER BY id LIMIT ${BATCH_SIZE}`;

export function startStatsSource(options: StatsSourceOptions): StatsSource {
	const { dbPath, host, pollMs, syncMs, shouldSync, emit, log } = options;
	let db: Database | null = null;
	let watermark = 0;
	let lastOpenError = "";
	let stopped = false;
	let syncRunning = false;
	let syncRequested = false;
	let syncDisabled = syncMs <= 0;
	let syncChild: Subprocess | null = null;
	let lastSyncAt = 0;

	const open = (): Database | null => {
		if (db !== null) return db;
		try {
			const handle = new Database(dbPath, { readonly: true });
			handle.run("PRAGMA query_only = ON");
			handle.run("PRAGMA busy_timeout = 2000");
			const row = handle
				.query<{ max: number | null }, []>(
					"SELECT max(id) AS max FROM messages",
				)
				.get();
			watermark = row?.max ?? 0;
			db = handle;
			lastOpenError = "";
			log(`stats: reading ${dbPath} read-only from message id > ${watermark}`);
			return db;
		} catch (error) {
			const message = errorMessage(error);
			if (message !== lastOpenError) {
				log(`stats: cannot open ${dbPath}: ${message}; retrying`);
				lastOpenError = message;
			}
			return null;
		}
	};

	const poll = (): void => {
		const handle = open();
		if (handle === null) return;
		try {
			const select = handle.query<MessageRow, [number]>(SELECT_NEW);
			let rows = select.all(watermark);
			while (rows.length > 0) {
				for (const row of rows) {
					watermark = row.id;
					const isSubagent = row.agent_type !== "main";
					emit({
						v: 1,
						host,
						ts: row.timestamp,
						agentId: `${host}:${row.session_file}`,
						kind: "turn.usage",
						data: {
							source: "stats",
							provider: row.provider,
							model: row.model,
							api: row.api,
							folder: row.folder,
							agentType: row.agent_type,
							parentAgentId: isSubagent
								? `${host}:${dirname(row.session_file)}.jsonl`
								: null,
							tokensIn: row.input_tokens,
							tokensOut: row.output_tokens,
							tokensCacheRead: row.cache_read_tokens,
							tokensCacheWrite: row.cache_write_tokens,
							tokensTotal: row.total_tokens,
							cost: row.cost_total,
							durationMs: row.duration,
							ttftMs: row.ttft,
							stopReason: row.stop_reason,
						},
					});
				}
				if (rows.length < BATCH_SIZE) break;
				rows = select.all(watermark);
			}
		} catch (error) {
			log(`stats: poll failed: ${errorMessage(error)}; reopening`);
			db?.close();
			db = null;
		}
	};

	const sync = async (): Promise<void> => {
		syncRunning = true;
		syncRequested = false;
		lastSyncAt = Date.now();
		try {
			const child = Bun.spawn(["omp", "stats", "--json"], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			});
			syncChild = child;
			const code = await child.exited;
			if (code !== 0 && !stopped) {
				log(`stats: \`omp stats\` exited with ${code}`);
			}
		} catch (error) {
			log(
				`stats: cannot run \`omp stats\` (${errorMessage(error)}); usage only appears when stats.db is synced by other means`,
			);
			syncDisabled = true;
		} finally {
			syncRunning = false;
			syncChild = null;
		}
		if (!stopped) poll();
	};

	const tick = (): void => {
		poll();
		if (syncDisabled || syncRunning) return;
		const due = shouldSync() && Date.now() - lastSyncAt >= syncMs;
		if (syncRequested || due) void sync();
	};

	tick();
	const timer = setInterval(tick, pollMs);

	return {
		requestSync() {
			syncRequested = true;
		},
		stop() {
			stopped = true;
			clearInterval(timer);
			syncChild?.kill();
			db?.close();
			db = null;
		},
	};
}
