import type { TerrariumEvent, TerrariumEventKind } from "@terrarium/protocol";
import { isRecord } from "./guards";

type FieldType = "string" | "number" | "boolean" | "strings";

/**
 * The only `data` fields the hub keeps, per kind. Anything else is dropped
 * before storage or broadcast, so a collector bug cannot leak prompt or
 * response text through an unexpected field.
 */
const FIELDS: Record<TerrariumEventKind, Record<string, FieldType>> = {
	"agent.seen": {
		agentKind: "string",
		folder: "string",
		paneId: "string",
		sources: "strings",
		parentAgentId: "string",
	},
	"agent.state": { state: "string", tool: "string" },
	"tool.start": { tool: "string", toolCallId: "string" },
	"tool.end": { tool: "string", toolCallId: "string", isError: "boolean" },
	"turn.usage": {
		provider: "string",
		model: "string",
		api: "string",
		folder: "string",
		agentType: "string",
		parentAgentId: "string",
		tokensIn: "number",
		tokensOut: "number",
		tokensCacheRead: "number",
		tokensCacheWrite: "number",
		tokensTotal: "number",
		cost: "number",
		durationMs: "number",
		ttftMs: "number",
		stopReason: "string",
	},
	"agent.gone": {},
	"host.heartbeat": {},
};

/**
 * Metadata strings are names, ids and paths. Longer values are dropped rather
 * than truncated: they are not metadata.
 */
const MAX_TEXT = 512;
const MAX_LIST = 16;

function keepValue(type: FieldType, value: unknown): boolean {
	switch (type) {
		case "string":
			return typeof value === "string" && value.length <= MAX_TEXT;
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "boolean":
			return typeof value === "boolean";
		case "strings":
			return (
				Array.isArray(value) &&
				value.length <= MAX_LIST &&
				value.every(
					(item) => typeof item === "string" && item.length <= MAX_TEXT,
				)
			);
	}
}

export type Parsed =
	| { ok: true; event: TerrariumEvent }
	| { ok: false; reason: string };

/**
 * Validates one event from the collector authenticated as `host` and returns
 * a copy holding only allowlisted data fields. Reasons never quote the input.
 */
export function parseEvent(raw: unknown, host: string): Parsed {
	if (!isRecord(raw)) return { ok: false, reason: "not an object" };
	if (raw.v !== 1) return { ok: false, reason: "unsupported version" };
	const kind = raw.kind;
	if (typeof kind !== "string" || !Object.hasOwn(FIELDS, kind)) {
		return { ok: false, reason: "unknown kind" };
	}
	if (raw.host !== host) {
		return { ok: false, reason: "host does not match the token" };
	}
	if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts) || raw.ts <= 0) {
		return { ok: false, reason: "invalid ts" };
	}
	const agentId = raw.agentId;
	if (
		typeof agentId !== "string" ||
		agentId.length > MAX_TEXT * 2 ||
		!agentId.startsWith(`${host}:`)
	) {
		return { ok: false, reason: "agentId must start with the host name" };
	}
	if (!isRecord(raw.data))
		return { ok: false, reason: "data is not an object" };

	const fields: Record<string, FieldType> = {
		source: "string",
		...FIELDS[kind as TerrariumEventKind],
	};
	const data: Record<string, unknown> = {};
	for (const [name, type] of Object.entries(fields)) {
		const value = raw.data[name];
		if (value === null) data[name] = null;
		else if (keepValue(type, value)) data[name] = value;
	}
	return {
		ok: true,
		event: {
			v: 1,
			host,
			ts: Math.trunc(raw.ts),
			agentId,
			kind: kind as TerrariumEventKind,
			data,
		},
	};
}
