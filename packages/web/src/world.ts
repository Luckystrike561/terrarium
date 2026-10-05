import type { HostView, UsageRollup, WorldMessage } from "@terrarium/protocol";

export type WorldState = {
	seq: number;
	hosts: Record<string, HostView>;
	usage: UsageRollup[];
};

/** Returns the new state, or the old one when a delta arrives before any snapshot. */
export function applyMessage(
	state: WorldState | null,
	message: WorldMessage,
): WorldState | null {
	if (message.type === "snapshot") {
		return { seq: message.seq, hosts: message.hosts, usage: message.usage };
	}
	if (state === null || message.seq <= state.seq) return state;
	const hosts = { ...state.hosts };
	for (const host of message.hostsUpserted) hosts[host.host] = host;
	for (const agent of message.agentsUpserted) {
		const host = hosts[agent.host] ?? {
			host: agent.host,
			online: false,
			lastHeartbeat: 0,
			agents: {},
			usage: [],
		};
		hosts[agent.host] = {
			...host,
			agents: { ...host.agents, [agent.agentId]: agent },
		};
	}
	for (const agentId of message.agentsRemoved) {
		for (const [name, host] of Object.entries(hosts)) {
			if (!Object.hasOwn(host.agents, agentId)) continue;
			const { [agentId]: _removed, ...agents } = host.agents;
			hosts[name] = { ...host, agents };
		}
	}
	return {
		seq: message.seq,
		hosts,
		usage: message.usage ?? state.usage,
	};
}
