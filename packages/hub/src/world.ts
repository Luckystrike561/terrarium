import type {
	AgentState,
	AgentView,
	CurrentTool,
	TerrariumEvent,
	UsageTotals,
} from "@terrarium/protocol";
import { addTotals, emptyTotals } from "./store";

export type RunningTool = CurrentTool & {
	/** toolCallId when the source has one, so parallel calls end separately. */
	key: string;
};

export type AgentRecord = {
	view: AgentView;
	running: RunningTool[];
};

export type HostRecord = {
	host: string;
	connections: number;
	lastHeartbeat: number;
	/** Connected and heard from within the heartbeat timeout. */
	online: boolean;
	agents: Map<string, AgentRecord>;
};

export type Change = {
	hosts: Set<string>;
	agents: Set<string>;
	removed: string[];
	usage: boolean;
};

export type UsageDelta = {
	provider: string;
	model: string;
	totals: UsageTotals;
};

const STATES: Record<AgentState, true> = {
	idle: true,
	working: true,
	blocked: true,
	done: true,
	unknown: true,
	offline: true,
};

const APPROVAL_PREFIX = "approval:";

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 0;
}

export function usageOf(event: TerrariumEvent): UsageDelta {
	return {
		provider: text(event.data.provider) ?? "unknown",
		model: text(event.data.model) ?? "unknown",
		totals: {
			tokensIn: count(event.data.tokensIn),
			tokensOut: count(event.data.tokensOut),
			tokensCacheRead: count(event.data.tokensCacheRead),
			tokensCacheWrite: count(event.data.tokensCacheWrite),
			cost: count(event.data.cost),
			messages: 1,
		},
	};
}

export function emptyChange(): Change {
	return { hosts: new Set(), agents: new Set(), removed: [], usage: false };
}

/** Hosts -> agents -> current activity. Persistence is the caller's job. */
export class World {
	readonly hosts = new Map<string, HostRecord>();
	readonly heartbeatTimeoutMs: number;

	constructor(knownHosts: readonly string[], heartbeatTimeoutMs: number) {
		this.heartbeatTimeoutMs = heartbeatTimeoutMs;
		for (const host of knownHosts) this.#host(host);
	}

	#host(host: string): HostRecord {
		let record = this.hosts.get(host);
		if (record === undefined) {
			record = {
				host,
				connections: 0,
				lastHeartbeat: 0,
				online: false,
				agents: new Map(),
			};
			this.hosts.set(host, record);
		}
		return record;
	}

	/**
	 * A connected socket alone does not prove liveness: a laptop that sleeps
	 * leaves its TCP connection open on the hub without sending anything.
	 * Returns true when the online flag flipped.
	 */
	#refresh(record: HostRecord, now: number): boolean {
		const online =
			record.connections > 0 &&
			now - record.lastHeartbeat <= this.heartbeatTimeoutMs;
		if (online === record.online) return false;
		record.online = online;
		return true;
	}

	restore(
		hosts: readonly { host: string; lastHeartbeat: number }[],
		agents: readonly AgentRecord[],
	): void {
		for (const { host, lastHeartbeat } of hosts) {
			this.#host(host).lastHeartbeat = lastHeartbeat;
		}
		for (const agent of agents) {
			this.#host(agent.view.host).agents.set(agent.view.agentId, agent);
		}
	}

	agent(agentId: string): AgentRecord | undefined {
		for (const host of this.hosts.values()) {
			const agent = host.agents.get(agentId);
			if (agent !== undefined) return agent;
		}
		return undefined;
	}

	/** Returns true when the host's online flag flipped. */
	connect(host: string, now: number): boolean {
		const record = this.#host(host);
		record.connections++;
		record.lastHeartbeat = now;
		return this.#refresh(record, now);
	}

	disconnect(host: string, now: number): boolean {
		const record = this.#host(host);
		record.connections = Math.max(0, record.connections - 1);
		if (record.connections === 0) record.lastHeartbeat = now;
		return this.#refresh(record, now);
	}

	/** Hosts whose heartbeat timed out or came back since the last call. */
	sweep(now: number): string[] {
		const flipped: string[] = [];
		for (const record of this.hosts.values()) {
			if (this.#refresh(record, now)) flipped.push(record.host);
		}
		return flipped;
	}

	apply(event: TerrariumEvent, now: number): Change {
		const change = emptyChange();
		const host = this.#host(event.host);
		if (event.kind === "host.heartbeat") {
			host.lastHeartbeat = now;
			this.#refresh(host, now);
			change.hosts.add(host.host);
			return change;
		}
		if (event.kind === "agent.gone") {
			if (host.agents.delete(event.agentId)) change.removed.push(event.agentId);
			return change;
		}
		if (event.kind === "turn.usage") {
			change.usage = true;
			change.hosts.add(host.host);
			const agent =
				host.agents.get(event.agentId) ??
				host.agents.get(text(event.data.parentAgentId) ?? "");
			if (agent !== undefined) {
				addTotals(agent.view.usage, usageOf(event).totals);
				agent.view.lastSeen = Math.max(agent.view.lastSeen, event.ts);
				change.agents.add(agent.view.agentId);
			}
			return change;
		}

		const agent = this.#ensureAgent(host, event);
		const view = agent.view;
		view.lastSeen = Math.max(view.lastSeen, event.ts);
		change.agents.add(view.agentId);
		switch (event.kind) {
			case "agent.seen": {
				const kind = text(event.data.agentKind);
				if (kind !== null && kind !== "unknown") view.agentKind = kind;
				view.folder = text(event.data.folder) ?? view.folder;
				view.parentAgentId =
					text(event.data.parentAgentId) ?? view.parentAgentId;
				break;
			}
			case "agent.state": {
				const state = event.data.state;
				if (typeof state !== "string" || !Object.hasOwn(STATES, state)) break;
				this.#setState(view, state as AgentState, event.ts);
				const tool = text(event.data.tool);
				if (state === "blocked" && tool !== null) {
					agent.running.push({
						key: `${APPROVAL_PREFIX}${tool}`,
						name: tool,
						startedAt: event.ts,
					});
				} else if (state !== "working" && state !== "blocked") {
					agent.running = [];
				}
				break;
			}
			case "tool.start": {
				const name = text(event.data.tool) ?? "unknown";
				agent.running = agent.running.filter(
					(tool) => tool.key !== `${APPROVAL_PREFIX}${name}`,
				);
				agent.running.push({
					key: text(event.data.toolCallId) ?? name,
					name,
					startedAt: event.ts,
				});
				view.lastToolError = false;
				this.#setState(view, "working", event.ts);
				break;
			}
			case "tool.end": {
				const name = text(event.data.tool) ?? "unknown";
				const key = text(event.data.toolCallId) ?? name;
				let index = agent.running.findIndex((tool) => tool.key === key);
				if (index < 0) {
					index = agent.running.map((tool) => tool.name).lastIndexOf(name);
				}
				if (index >= 0) agent.running.splice(index, 1);
				view.lastToolError = event.data.isError === true;
				break;
			}
		}
		const current = agent.running.at(-1);
		view.currentTool =
			current === undefined
				? null
				: { name: current.name, startedAt: current.startedAt };
		return change;
	}

	#ensureAgent(host: HostRecord, event: TerrariumEvent): AgentRecord {
		let agent = host.agents.get(event.agentId);
		if (agent === undefined) {
			agent = {
				view: {
					agentId: event.agentId,
					host: host.host,
					agentKind: "unknown",
					folder: null,
					parentAgentId: null,
					state: "unknown",
					stateSince: event.ts,
					currentTool: null,
					lastToolError: false,
					lastSeen: event.ts,
					usage: emptyTotals(),
				},
				running: [],
			};
			host.agents.set(event.agentId, agent);
		}
		return agent;
	}

	#setState(view: AgentView, state: AgentState, ts: number): void {
		if (view.state === state) return;
		view.state = state;
		view.stateSince = ts;
	}
}
