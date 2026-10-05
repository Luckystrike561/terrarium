import type { AgentState, TerrariumEvent } from "@terrarium/protocol";
import type { Emit } from "./types";

type Agent = {
	agentKind: string;
	folder: string | null;
	paneId: string | null;
	sources: Set<string>;
	state: AgentState | null;
	/** Set once the omp extension reported this agent; its activity then wins over herdr's. */
	ompFed: boolean;
};

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Merges herdr, omp-extension and stats.db events into one stream keyed by
 * agentId. The extension is authoritative for the activity of the agents it
 * reports; stats.db is the only source of `turn.usage`.
 */
export function createMerger(emit: Emit): Emit {
	const agents = new Map<string, Agent>();

	/** Applies an `agent.seen`-shaped update and emits the merged view when it changed. */
	const see = (
		event: TerrariumEvent,
		source: string,
		update: {
			agentKind: string | null;
			folder: string | null;
			paneId: string | null;
		},
	): Agent => {
		let agent = agents.get(event.agentId);
		let changed = agent === undefined;
		if (agent === undefined) {
			agent = {
				agentKind: "unknown",
				folder: null,
				paneId: null,
				sources: new Set(),
				state: null,
				ompFed: false,
			};
			agents.set(event.agentId, agent);
		}
		if (
			update.agentKind !== null &&
			update.agentKind !== "unknown" &&
			update.agentKind !== agent.agentKind
		) {
			agent.agentKind = update.agentKind;
			changed = true;
		}
		if (update.folder !== null && update.folder !== agent.folder) {
			agent.folder = update.folder;
			changed = true;
		}
		if (update.paneId !== null && update.paneId !== agent.paneId) {
			agent.paneId = update.paneId;
			changed = true;
		}
		if (!agent.sources.has(source)) {
			agent.sources.add(source);
			changed = true;
		}
		if (source === "omp") agent.ompFed = true;
		if (changed) {
			emit({
				...event,
				kind: "agent.seen",
				data: {
					source,
					agentKind: agent.agentKind,
					folder: agent.folder,
					paneId: agent.paneId,
					sources: [...agent.sources].sort(),
				},
			});
		}
		return agent;
	};

	const known = (event: TerrariumEvent, source: string): Agent =>
		agents.get(event.agentId) ??
		see(event, source, {
			agentKind: source === "omp" ? "omp" : null,
			folder: null,
			paneId: null,
		});

	return (event) => {
		const source = text(event.data.source) ?? "unknown";
		switch (event.kind) {
			case "host.heartbeat":
				emit(event);
				return;
			case "turn.usage":
				if (source === "stats") emit(event);
				return;
			case "agent.seen":
				see(event, source, {
					agentKind: text(event.data.agentKind),
					folder: text(event.data.folder),
					paneId: text(event.data.paneId),
				});
				return;
			case "agent.state": {
				const agent = known(event, source);
				if (source === "omp") agent.ompFed = true;
				else if (agent.ompFed) return;
				if (event.data.state === agent.state) return;
				agent.state = event.data.state as AgentState;
				emit(event);
				return;
			}
			case "tool.start":
			case "tool.end":
				if (source !== "omp") return;
				known(event, source).ompFed = true;
				emit(event);
				return;
			case "agent.gone":
				if (agents.delete(event.agentId)) emit(event);
				return;
		}
	};
}
