import type { AgentView, TerrariumEvent } from "@terrarium/protocol";
import { Application, Container, Graphics, type Ticker } from "pixi.js";
import type { WorldState } from "../world";
import { Creature } from "./creature";
import { FALLBACK_FPS, FrameGovernor, FULL_FPS } from "./frame-rate";
import {
	DEEP_HOST,
	DEFAULT_HOSTS,
	layoutSlots,
	layoutZones,
	ZONE_FLOOR,
	ZONE_HEADER,
	type ZoneLayout,
} from "./layout";
import { Particles } from "./particles";
import { Zone } from "./zone";

/** Hard cap on live particles; halved while running at the 30 fps fallback. */
export const MAX_PARTICLES = 160;
/** Longest frame step animations see, so a stalled tab does not teleport creatures. */
const MAX_STEP_S = 0.1;

/** Renders a `WorldState` as the tank. Read-only: it never sends anything. */
export class Tank {
	#app: Application;
	#host: HTMLElement;
	#zonesBack = new Container();
	#creaturesLayer = new Container();
	#particlesLayer = new Container();
	#labelsLayer = new Container();
	#zonesFront = new Container();
	#particles: Particles;
	#governor = new FrameGovernor();
	#zones = new Map<string, Zone>();
	#creatures = new Map<string, Creature>();
	#leaving: Creature[] = [];
	#world: WorldState | null = null;
	#time = 0;
	#size = { w: 0, h: 0 };
	#layoutDirty = true;

	static async create(host: HTMLElement): Promise<Tank> {
		const app = new Application();
		await app.init({
			resizeTo: host,
			antialias: true,
			autoDensity: true,
			resolution: Math.min(window.devicePixelRatio || 1, 2),
			background: 0x02060f,
			preference: "webgl",
		});
		host.appendChild(app.canvas);
		return new Tank(app, host);
	}

	private constructor(app: Application, host: HTMLElement) {
		this.#app = app;
		this.#host = host;
		this.#creaturesLayer.sortableChildren = true;
		app.stage.addChild(
			this.#zonesBack,
			this.#creaturesLayer,
			this.#particlesLayer,
			this.#labelsLayer,
			this.#zonesFront,
		);
		const dot = new Graphics().circle(16, 16, 16).fill(0xffffff);
		const texture = app.renderer.generateTexture(dot);
		dot.destroy();
		this.#particles = new Particles(
			this.#particlesLayer,
			texture,
			MAX_PARTICLES,
		);
		app.ticker.maxFPS = FULL_FPS;
		app.ticker.add((ticker) => this.#tick(ticker));
		this.#host.dataset.fps = String(FULL_FPS);
	}

	sync(world: WorldState): void {
		this.#world = world;
		const seen = new Set<string>();
		for (const host of Object.values(world.hosts)) {
			const deep = host.host === DEEP_HOST;
			for (const agent of Object.values(host.agents)) {
				seen.add(agent.agentId);
				let creature = this.#creatures.get(agent.agentId);
				if (creature === undefined) {
					creature = new Creature(
						agent.agentId,
						this.#labelsLayer,
						this.#particles,
						this.#time,
					);
					this.#creaturesLayer.addChild(creature.root);
					this.#creatures.set(agent.agentId, creature);
				}
				creature.baby = isBaby(agent, host.agents);
				creature.setAgent(agent, host.online, deep);
			}
		}
		for (const [agentId, creature] of this.#creatures) {
			if (seen.has(agentId)) continue;
			creature.leave();
			this.#creatures.delete(agentId);
			this.#leaving.push(creature);
		}
		this.#layoutDirty = true;
	}

	/** Moments that the world state alone does not show, like a tool failing. */
	notify(event: TerrariumEvent): void {
		if (event.kind === "tool.end" && event.data.isError === true) {
			this.#creatures.get(event.agentId)?.trip();
		}
	}

	#hosts(): string[] {
		return this.#world === null
			? DEFAULT_HOSTS
			: Object.keys(this.#world.hosts);
	}

	#layout(): void {
		this.#layoutDirty = false;
		const { width, height } = this.#app.screen;
		this.#size = { w: width, h: height };
		const layouts = layoutZones(this.#hosts(), width, height);
		const wanted = new Set(layouts.map((layout) => layout.host));
		for (const [host, zone] of this.#zones) {
			if (wanted.has(host)) continue;
			zone.back.destroy({ children: true });
			zone.front.destroy({ children: true });
			this.#zones.delete(host);
		}
		for (const layout of layouts) {
			let zone = this.#zones.get(layout.host);
			if (zone === undefined) {
				zone = new Zone(layout);
				this.#zones.set(layout.host, zone);
				this.#zonesBack.addChild(zone.back);
				this.#zonesFront.addChild(zone.front);
			} else {
				zone.setLayout(layout);
			}
			this.#placeZone(zone.layout);
		}
		for (const zone of this.#zones.values()) {
			const host = this.#world?.hosts[zone.host];
			const agents = host === undefined ? [] : Object.values(host.agents);
			zone.setStatus({
				online: host?.online ?? false,
				connected: this.#world !== null,
				agents: agents.length,
				busy: agents.filter((agent) => agent.state === "working").length,
				blocked: agents.filter((agent) => agent.state === "blocked").length,
			});
		}
	}

	#placeZone(layout: ZoneLayout): void {
		const host = this.#world?.hosts[layout.host];
		if (host === undefined) return;
		const roots = Object.values(host.agents)
			.filter((agent) => !isBaby(agent, host.agents))
			.sort((a, b) => a.agentId.localeCompare(b.agentId));
		const slots = layoutSlots(layout, roots.length);
		const roam = {
			x: layout.x,
			y: layout.y + layout.h * ZONE_HEADER,
			w: layout.w,
			h: layout.h * (1 - ZONE_HEADER - ZONE_FLOOR),
		};
		const middle = layout.x + layout.w / 2;
		roots.forEach((agent, index) => {
			const center = slots.centers[index];
			const creature = this.#creatures.get(agent.agentId);
			if (center === undefined || creature === undefined) return;
			creature.place({
				home: center,
				radius: slots.radius,
				roam,
				face: center.x <= middle ? 1 : -1,
			});
		});
	}

	/** Babies trail their parent, alternating sides, so they are re-placed every frame. */
	#placeBabies(): void {
		if (this.#world === null) return;
		for (const host of Object.values(this.#world.hosts)) {
			const counts = new Map<string, number>();
			const babies = Object.values(host.agents)
				.filter((agent) => isBaby(agent, host.agents))
				.sort((a, b) => a.agentId.localeCompare(b.agentId));
			for (const agent of babies) {
				const parent = this.#creatures.get(agent.parentAgentId ?? "");
				const creature = this.#creatures.get(agent.agentId);
				const placement = parent?.placement;
				if (parent === undefined || creature === undefined || placement == null)
					continue;
				const index = counts.get(parent.agentId) ?? 0;
				counts.set(parent.agentId, index + 1);
				const side = index % 2 === 0 ? -parent.direction : parent.direction;
				const reach = 1.35 + Math.floor(index / 2) * 0.75;
				creature.place({
					...placement,
					home: {
						x: parent.x + side * reach * placement.radius,
						y: parent.y + placement.radius * (0.7 + (index % 2) * 0.2),
					},
					face: parent.direction,
				});
			}
		}
	}

	#tick(ticker: Ticker): void {
		const now = performance.now();
		const limit = this.#governor.sample(ticker.elapsedMS, now);
		if (limit !== null) {
			ticker.maxFPS = limit;
			this.#particles.cap =
				limit === FALLBACK_FPS ? MAX_PARTICLES / 2 : MAX_PARTICLES;
			this.#host.dataset.fps = String(limit);
		}
		const dt = Math.min(MAX_STEP_S, ticker.deltaMS / 1000);
		this.#time += dt;
		const { width, height } = this.#app.screen;
		if (
			this.#layoutDirty ||
			width !== this.#size.w ||
			height !== this.#size.h
		) {
			this.#layout();
		}
		this.#placeBabies();
		for (const zone of this.#zones.values())
			zone.update(this.#time, dt, this.#particles);
		for (const creature of this.#creatures.values())
			creature.update(this.#time, dt);
		for (let index = this.#leaving.length - 1; index >= 0; index--) {
			const creature = this.#leaving[index];
			if (creature === undefined) continue;
			creature.update(this.#time, dt);
			if (creature.finished) {
				creature.destroy();
				this.#leaving.splice(index, 1);
			}
		}
		this.#particles.update(dt);
	}
}

function isBaby(
	agent: AgentView,
	siblings: Record<string, AgentView>,
): boolean {
	return (
		agent.parentAgentId !== null && Object.hasOwn(siblings, agent.parentAgentId)
	);
}
