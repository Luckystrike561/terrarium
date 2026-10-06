import type {
	HostView,
	TerrariumEvent,
	WorldDelta,
	WorldSnapshot,
} from "@terrarium/protocol";
import { emptyRollups, type Rollups, type Store } from "./store";
import {
	type Change,
	emptyChange,
	type HostRecord,
	usageOf,
	type World,
} from "./world";

export type Publish = (message: string) => void;

/** Ties storage, world state and the browser broadcast together. */
export class Hub {
	readonly #store: Store;
	readonly #world: World;
	readonly #publish: Publish;
	#rollups: Rollups;
	#seq = 0;
	#rolloverTimer: Timer | undefined;
	readonly #sweepTimer: Timer;

	constructor(store: Store, world: World, publish: Publish) {
		this.#store = store;
		this.#world = world;
		this.#publish = publish;
		this.#world.restore(store.loadHosts(), store.loadAgents());
		this.#rollups = store.rollups(Date.now());
		this.#scheduleRollover();
		this.#sweepTimer = setInterval(
			() => this.#sweep(),
			Math.min(1_000, Math.max(50, world.heartbeatTimeoutMs / 4)),
		);
	}

	ingest(event: TerrariumEvent): void {
		const now = Date.now();
		let change = emptyChange();
		this.#store.transaction(() => {
			// Heartbeats only refresh liveness; storing one every 10 s per host adds nothing.
			if (event.kind !== "host.heartbeat") {
				this.#store.recordEvent(event, now);
			}
			if (event.kind === "turn.usage") {
				const usage = usageOf(event);
				const fresh = this.#store.recordUsage({
					host: event.host,
					agentId: event.agentId,
					ts: event.ts,
					provider: usage.provider,
					model: usage.model,
					...usage.totals,
				});
				if (!fresh) return;
			}
			change = this.#world.apply(event, now);
			this.#persist(change);
		});
		if (change.usage) this.#rollups = this.#store.rollups(now);
		this.#broadcast(event, change);
	}

	connect(host: string): void {
		this.#hostEvent(host, this.#world.connect(host, Date.now()));
	}

	disconnect(host: string): void {
		this.#hostEvent(host, this.#world.disconnect(host, Date.now()));
	}

	snapshot(): WorldSnapshot {
		const hosts: Record<string, HostView> = {};
		for (const record of this.#world.hosts.values()) {
			hosts[record.host] = this.#hostView(record);
		}
		return {
			v: 1,
			type: "snapshot",
			ts: Date.now(),
			seq: this.#seq,
			hosts,
			usage: this.#rollups.global,
		};
	}

	stop(): void {
		clearTimeout(this.#rolloverTimer);
		clearInterval(this.#sweepTimer);
	}

	#sweep(): void {
		const flipped = this.#world.sweep(Date.now());
		if (flipped.length === 0) return;
		const change = emptyChange();
		for (const host of flipped) change.hosts.add(host);
		this.#broadcast(null, change);
	}

	#hostEvent(host: string, flipped: boolean): void {
		const record = this.#world.hosts.get(host);
		if (record === undefined) return;
		this.#store.saveHost(host, record.lastHeartbeat);
		if (!flipped) return;
		const change = emptyChange();
		change.hosts.add(host);
		this.#broadcast(null, change);
	}

	#persist(change: Change): void {
		for (const agentId of change.agents) {
			const agent = this.#world.agent(agentId);
			if (agent !== undefined) this.#store.saveAgent(agent);
		}
		for (const agentId of change.removed) this.#store.deleteAgent(agentId);
		for (const host of change.hosts) {
			const record = this.#world.hosts.get(host);
			if (record !== undefined) {
				this.#store.saveHost(host, record.lastHeartbeat);
			}
		}
	}

	#hostView(record: HostRecord): HostView {
		const agents: HostView["agents"] = {};
		for (const [agentId, agent] of record.agents) agents[agentId] = agent.view;
		return {
			host: record.host,
			online: record.online,
			lastHeartbeat: record.lastHeartbeat,
			agents,
			usage: this.#rollups.byHost.get(record.host) ?? emptyRollups(),
		};
	}

	#broadcast(event: TerrariumEvent | null, change: Change): void {
		if (
			change.hosts.size === 0 &&
			change.agents.size === 0 &&
			change.removed.length === 0 &&
			!change.usage
		) {
			return;
		}
		const hostsUpserted: HostView[] = [];
		for (const host of change.hosts) {
			const record = this.#world.hosts.get(host);
			if (record !== undefined) hostsUpserted.push(this.#hostView(record));
		}
		const delta: WorldDelta = {
			v: 1,
			type: "delta",
			ts: Date.now(),
			seq: ++this.#seq,
			event,
			hostsUpserted,
			agentsUpserted: [...change.agents].flatMap((agentId) => {
				const agent = this.#world.agent(agentId);
				return agent === undefined || change.hosts.has(agent.view.host)
					? []
					: [agent.view];
			}),
			agentsRemoved: change.removed,
			usage: change.usage ? this.#rollups.global : null,
		};
		this.#publish(JSON.stringify(delta));
	}

	/** "today" and the 7/30-day windows move at local midnight without any event. */
	#scheduleRollover(): void {
		const next = new Date();
		next.setHours(24, 0, 1, 0);
		this.#rolloverTimer = setTimeout(() => {
			this.#rollups = this.#store.rollups(Date.now());
			const change = emptyChange();
			for (const host of this.#world.hosts.keys()) change.hosts.add(host);
			change.usage = true;
			this.#broadcast(null, change);
			this.#scheduleRollover();
		}, next.getTime() - Date.now());
	}
}
