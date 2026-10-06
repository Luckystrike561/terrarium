import type { AgentView } from "@terrarium/protocol";
import { Container, Graphics, Text } from "pixi.js";
import { type Activity, baseActivity, roams } from "./activity";
import type { Rect } from "./layout";
import type { ParticleKind, Particles } from "./particles";
import {
	drawAnvil,
	drawBird,
	drawBlock,
	drawCracks,
	drawEgg,
	drawExclamation,
	drawHammer,
	drawNoteLine,
	drawNotepad,
	drawPencil,
	drawScroll,
	drawShell,
	drawStar,
	drawTelescope,
	drawThoughtBubble,
	drawZ,
} from "./props";
import {
	drawHat,
	type Hat,
	hatFor,
	type Palette,
	paletteFor,
	STONE_PALETTE,
	type Species,
	speciesFor,
} from "./species";

/** Species are drawn about this many units in radius. */
const UNIT_RADIUS = 30;
const BABY_SCALE = 0.55;
const HATCH_S = 1.4;
const LEAVE_S = 1.1;
const CELEBRATE_S = 2.6;
const TRIP_S = 1.4;

type EyeMode = "open" | "closed" | "happy" | "half" | "stone";
type Look = { x: number; y: number };
type Point = { x: number; y: number };

/** Per-activity animation, called every frame with seconds since the activity began. */
type Animate = (elapsed: number, dt: number) => void;

type Motion = {
	bob: number;
	bobHz: number;
	wagHz: number;
	wag: number;
	eyes: EyeMode;
	look: Look;
};

const MOTION: Record<Activity, Motion> = {
	sleep: { bob: 2, bobHz: 0.25, wagHz: 0.3, wag: 0.05, eyes: "closed", look: { x: 0, y: 0 } },
	think: { bob: 4, bobHz: 0.6, wagHz: 2.2, wag: 0.3, eyes: "open", look: { x: 0.4, y: -0.8 } },
	read: { bob: 2, bobHz: 0.5, wagHz: 1, wag: 0.12, eyes: "open", look: { x: 1, y: 0.5 } },
	sniff: { bob: 1.5, bobHz: 0.8, wagHz: 3, wag: 0.25, eyes: "open", look: { x: 1, y: 1 } },
	build: { bob: 2, bobHz: 0.8, wagHz: 2.5, wag: 0.2, eyes: "open", look: { x: 1, y: 0.4 } },
	hammer: { bob: 1, bobHz: 0.8, wagHz: 3, wag: 0.2, eyes: "open", look: { x: 1, y: 0.6 } },
	telescope: { bob: 2, bobHz: 0.4, wagHz: 1, wag: 0.12, eyes: "open", look: { x: 1, y: -0.8 } },
	notepad: { bob: 2, bobHz: 0.5, wagHz: 1.2, wag: 0.12, eyes: "open", look: { x: 1, y: 0.6 } },
	messenger: { bob: 4, bobHz: 0.7, wagHz: 2.5, wag: 0.3, eyes: "open", look: { x: 0.6, y: -0.6 } },
	hatch: { bob: 2, bobHz: 0.6, wagHz: 1.5, wag: 0.15, eyes: "open", look: { x: 1, y: 0.4 } },
	knock: { bob: 0, bobHz: 1, wagHz: 5, wag: 0.35, eyes: "open", look: { x: 0, y: 0.2 } },
	celebrate: { bob: 0, bobHz: 1, wagHz: 6, wag: 0.4, eyes: "happy", look: { x: 0, y: 0 } },
	rest: { bob: 2.5, bobHz: 0.3, wagHz: 0.6, wag: 0.08, eyes: "half", look: { x: 0, y: 0.3 } },
	trip: { bob: 0, bobHz: 1, wagHz: 0, wag: 0, eyes: "closed", look: { x: 0, y: 0 } },
	stone: { bob: 0, bobHz: 1, wagHz: 0, wag: 0, eyes: "stone", look: { x: 0, y: 0 } },
};

export type Placement = {
	home: Point;
	/** Body radius in screen pixels for a grown creature. */
	radius: number;
	/** Open water this creature may roam in. */
	roam: Rect;
	/** Direction to face when standing still: +1 right, -1 left. */
	face: 1 | -1;
};

function wave(time: number, hz: number): number {
	return Math.sin(time * hz * Math.PI * 2);
}

/**
 * One agent on screen. Its steady activity comes from the agent's state and
 * tool; celebrate (after done) and trip (after a failed tool) play on top for
 * a moment. Lifecycle: hatching, alive, leaving, finished.
 */
export class Creature {
	readonly agentId: string;
	readonly root = new Container();
	readonly label: Text;
	baby = false;

	#particles: Particles;
	#facing = new Container();
	#rig = new Container();
	#back = new Container();
	#tail = new Graphics();
	#body = new Graphics();
	#lure = new Graphics();
	#face = new Graphics();
	#hat = new Graphics();
	#front = new Container();
	#overlay = new Container();

	#species: Species;
	#kind = "";
	#folder: string | null = null;
	#deep = false;
	#hatStyle: Hat | null = null;
	#palette: Palette = STONE_PALETTE;
	#appearanceKey = "";
	#faceKey = "";

	#base: Activity = "rest";
	#transient: { activity: Activity; until: number } | null = null;
	#shown: Activity | null = null;
	#shownSince = 0;
	#animate: Animate = () => {};

	#placement: Placement | null = null;
	#target: Point = { x: 0, y: 0 };
	#roamUntil = 0;
	#direction: 1 | -1 = 1;
	#blinkAt = 0;
	#bornAt: number;
	#leftAt: number | null = null;
	#time = 0;
	#shells: Graphics[] = [];

	constructor(agentId: string, labels: Container, particles: Particles, now: number) {
		this.agentId = agentId;
		this.#particles = particles;
		this.#bornAt = now;
		this.#time = now;
		this.#blinkAt = now + 1 + Math.random() * 3;
		this.#species = speciesFor("unknown");
		this.label = new Text({
			text: "",
			style: {
				fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
				fontSize: 14,
				fontWeight: "600",
				fill: 0xe6f1ff,
				stroke: { color: 0x061423, width: 4 },
				align: "center",
			},
		});
		this.label.anchor.set(0.5, 0);
		labels.addChild(this.label);
		this.#rig.addChild(this.#tail, this.#body, this.#lure, this.#face, this.#hat);
		this.#facing.addChild(this.#back, this.#rig, this.#front);
		this.root.addChild(this.#facing, this.#overlay);
		this.#facing.alpha = 0;
		for (const top of [true, false]) {
			const shell = new Graphics();
			drawShell(shell, top);
			this.#shells.push(shell);
			this.root.addChild(shell);
		}
	}

	get x(): number {
		return this.root.x;
	}

	get y(): number {
		return this.root.y;
	}

	get direction(): 1 | -1 {
		return this.#direction;
	}

	get placement(): Placement | null {
		return this.#placement;
	}

	get leaving(): boolean {
		return this.#leftAt !== null;
	}

	get finished(): boolean {
		return this.#leftAt !== null && this.#time - this.#leftAt >= LEAVE_S;
	}

	setAgent(agent: AgentView, hostOnline: boolean, deep: boolean): void {
		this.#kind = agent.agentKind;
		this.#folder = agent.folder;
		this.#deep = deep;
		this.#species = speciesFor(agent.agentKind);
		this.label.text = agent.folder ?? agent.agentKind;
		const base = baseActivity(agent, hostOnline);
		if (base === this.#base) return;
		const celebrates =
			base === "rest" &&
			agent.state === "done" &&
			this.#shown !== null &&
			this.#base !== "stone";
		this.#base = base;
		if (celebrates) {
			this.#transient = { activity: "celebrate", until: this.#time + CELEBRATE_S };
		} else if (this.#transient?.activity === "celebrate" || base === "stone") {
			this.#transient = null;
		}
	}

	place(placement: Placement): void {
		if (this.#placement === null) {
			this.root.position.set(placement.home.x, placement.home.y);
			this.#direction = placement.face;
		}
		this.#placement = placement;
	}

	trip(): void {
		if (this.#base === "stone" || this.#leftAt !== null) return;
		this.#transient = { activity: "trip", until: this.#time + TRIP_S };
	}

	leave(): void {
		if (this.#leftAt !== null) return;
		this.#leftAt = this.#time;
		const scale = this.#scale();
		this.#particles.emit("bubble", this.root.x, this.root.y, scale * 2, 6);
	}

	destroy(): void {
		this.label.destroy();
		this.root.destroy({ children: true });
	}

	update(now: number, dt: number): void {
		this.#time = now;
		if (this.#transient !== null && now >= this.#transient.until) {
			this.#transient = null;
		}
		const activity = this.#transient?.activity ?? this.#base;
		this.#redrawAppearance(activity === "stone");
		if (activity !== this.#shown) this.#enter(activity);
		const motion = MOTION[activity];
		const placement = this.#placement;
		if (placement === null) return;

		this.#move(activity, placement, dt);

		const scale = this.#scale();
		const age = now - this.#bornAt;
		const hatch = Math.min(1, age / HATCH_S);
		const pop = hatch < 1 ? 0.4 + 0.6 * easeOutBack(hatch) : 1;
		const leave = this.#leftAt === null ? 0 : Math.min(1, (now - this.#leftAt) / LEAVE_S);
		this.root.scale.set(scale * pop * (1 - leave * 0.4));
		this.root.alpha = 1 - leave;
		this.#facing.alpha = this.#overlay.alpha = Math.min(1, hatch * 1.6);
		this.root.zIndex = this.root.y + (this.baby ? 1 : 0);
		this.#updateShells(hatch);

		this.#facing.scale.x = this.#direction;
		this.#rig.position.set(0, wave(now, motion.bobHz) * motion.bob);
		this.#rig.rotation = 0;
		this.#rig.scale.set(1);
		const wag = wave(now, motion.wagHz) * motion.wag;
		if (this.#species.tailMotion === "rotate") {
			this.#tail.rotation = wag;
			this.#tail.skew.x = 0;
		} else {
			this.#tail.rotation = 0;
			this.#tail.skew.x = wag * 0.8;
		}
		this.#lure.alpha = 0.65 + 0.35 * wave(now, 0.7);

		let eyes = motion.eyes;
		if (eyes === "open" && now >= this.#blinkAt) {
			eyes = "closed";
			if (now >= this.#blinkAt + 0.13) this.#blinkAt = now + 2 + Math.random() * 4;
		}
		this.#drawFace(eyes, motion.look, activity);
		this.#animate(now - this.#shownSince, dt);

		const radius = (placement.radius * (this.baby ? BABY_SCALE : 1)) | 0;
		this.label.visible = !this.baby;
		this.label.alpha = this.root.alpha * this.#facing.alpha * (activity === "stone" ? 0.6 : 0.95);
		this.label.position.set(this.root.x, this.root.y + radius * 1.3);
		const fontSize = Math.round(Math.min(22, Math.max(12, radius * 0.45)));
		if (this.label.style.fontSize !== fontSize) this.label.style.fontSize = fontSize;
	}

	#scale(): number {
		const radius = this.#placement?.radius ?? UNIT_RADIUS;
		return (radius / UNIT_RADIUS) * (this.baby ? BABY_SCALE : 1);
	}

	#move(activity: Activity, placement: Placement, dt: number): void {
		const { home, roam, radius } = placement;
		const now = this.#time;
		if (activity === "stone" || activity === "trip") {
			this.#target = { x: this.root.x, y: this.root.y };
		} else if (roams(activity) && !this.baby) {
			const reached =
				Math.hypot(this.#target.x - this.root.x, this.#target.y - this.root.y) <
				radius * 0.3;
			if (now >= this.#roamUntil || reached) {
				this.#target = {
					x: roam.x + radius + Math.random() * Math.max(1, roam.w - radius * 2),
					y: roam.y + radius + Math.random() * Math.max(1, roam.h - radius * 2),
				};
				this.#roamUntil = now + 3 + Math.random() * 4;
			}
		} else if (activity === "sniff" && !this.baby) {
			const side = Math.floor((now - this.#shownSince) / 2.4) % 2 === 0 ? 1 : -1;
			this.#target = { x: home.x + side * radius * 1.4, y: home.y + radius * 0.4 };
		} else {
			this.#target = { x: home.x, y: home.y };
		}
		const dx = this.#target.x - this.root.x;
		const dy = this.#target.y - this.root.y;
		const distance = Math.hypot(dx, dy);
		const speed = radius * (this.baby ? 4 : activity === "sniff" ? 0.9 : 1.8);
		if (distance > 0.5) {
			const step = Math.min(distance, speed * dt, distance * Math.min(1, dt * 4));
			this.root.x += (dx / distance) * step;
			this.root.y += (dy / distance) * step;
		}
		if (Math.abs(dx) > radius * 0.2 && activity !== "stone") {
			this.#direction = dx > 0 ? 1 : -1;
		} else if (!roams(activity) && distance < radius * 0.2) {
			this.#direction = placement.face;
		}
	}

	#updateShells(hatch: number): void {
		if (this.#shells.length === 0) return;
		if (hatch >= 1) {
			for (const shell of this.#shells) shell.destroy();
			this.#shells = [];
			return;
		}
		const split = Math.max(0, (hatch - 0.15) / 0.85);
		const [top, bottom] = this.#shells;
		if (top === undefined || bottom === undefined) return;
		top.position.set(-split * 10, -split * 40);
		top.rotation = -split * 1.2;
		bottom.position.set(split * 8, split * 30);
		bottom.rotation = split * 0.6;
		const alpha = hatch < 0.15 ? 1 : 1 - split;
		top.alpha = bottom.alpha = alpha;
		top.scale.set(1.6);
		bottom.scale.set(1.6);
	}

	#redrawAppearance(stone: boolean): void {
		const hat = hatFor(this.#folder);
		const key = `${this.#species.id}|${this.#kind}|${this.#deep}|${stone}|${hat?.style}|${hat?.color}`;
		if (key === this.#appearanceKey) return;
		this.#appearanceKey = key;
		this.#faceKey = "";
		const palette: Palette = stone
			? STONE_PALETTE
			: paletteFor(this.#species, this.#kind, this.#deep);
		this.#palette = palette;
		const species = this.#species;
		this.#body.clear();
		species.drawBody(this.#body, palette);
		if (palette.glow !== null) {
			for (const [x, y] of [
				[-14, 2],
				[-4, 10],
				[10, 8],
			] as const) {
				this.#body.circle(x, y, 4).fill({ color: palette.glow, alpha: 0.3 });
				this.#body.circle(x, y, 2).fill(palette.glow);
			}
		}
		this.#tail.clear();
		this.#tail.pivot.set(species.tailPivot.x, species.tailPivot.y);
		this.#tail.position.set(species.tailPivot.x, species.tailPivot.y);
		species.drawTail(this.#tail, palette);

		this.#lure.clear();
		if (palette.glow !== null) {
			const { x, y } = species.lure;
			this.#lure
				.moveTo(x, y)
				.quadraticCurveTo(x + 4, y - 22, x + 18, y - 18)
				.stroke({ width: 2.5, color: palette.outline });
			this.#lure.circle(x + 18, y - 16, 8).fill({ color: palette.glow, alpha: 0.25 });
			this.#lure.circle(x + 18, y - 16, 4).fill(palette.glow);
		}

		this.#hat.clear();
		this.#hatStyle = hat;
		if (hat !== null) {
			drawHat(this.#hat, hat);
			this.#hat.position.set(species.hat.x, species.hat.y);
			this.#hat.tint = stone ? 0x8a8f96 : 0xffffff;
		}
	}

	#drawFace(mode: EyeMode, look: Look, activity: Activity): void {
		const key = `${mode}|${look.x}|${look.y}|${activity}`;
		if (key === this.#faceKey) return;
		this.#faceKey = key;
		const g = this.#face;
		g.clear();
		const ink = mode === "stone" ? 0x4b5057 : 0x14161c;
		for (const eye of this.#species.eyes) {
			const { x, y, r } = eye;
			switch (mode) {
				case "open":
					g.circle(x, y, r).fill(0xffffff).stroke({ width: 1.5, color: ink });
					g.circle(x + look.x * r * 0.35, y + look.y * r * 0.35, r * 0.55).fill(ink);
					g.circle(x + look.x * r * 0.35 - r * 0.2, y + look.y * r * 0.35 - r * 0.25, r * 0.18).fill(0xffffff);
					break;
				case "half":
					g.circle(x, y, r).fill(0xffffff).stroke({ width: 1.5, color: ink });
					g.circle(x, y + r * 0.25, r * 0.5).fill(ink);
					g.moveTo(x - r, y)
						.bezierCurveTo(x - r, y - r * 1.4, x + r, y - r * 1.4, x + r, y)
						.closePath()
						.fill(this.#palette.body);
					g.moveTo(x - r, y).lineTo(x + r, y).stroke({ width: 2, color: ink });
					break;
				case "closed":
					g.moveTo(x - r, y)
						.quadraticCurveTo(x, y + r * 0.9, x + r, y)
						.stroke({ width: 2.5, color: ink, cap: "round" });
					break;
				case "happy":
					g.moveTo(x - r, y + r * 0.3)
						.quadraticCurveTo(x, y - r, x + r, y + r * 0.3)
						.stroke({ width: 2.5, color: ink, cap: "round" });
					break;
				case "stone":
					g.circle(x, y, r * 0.7).fill(ink);
					break;
			}
		}
		const { x, y } = this.#species.mouth;
		if (activity === "knock" || activity === "trip") {
			g.ellipse(x, y, 3, 3.5).fill(ink);
		} else if (mode !== "stone") {
			g.moveTo(x - 4, y - 1)
				.quadraticCurveTo(x, y + (activity === "celebrate" ? 6 : 3), x + 4, y - 1)
				.stroke({ width: 2, color: ink, cap: "round" });
		}
	}

	#emit(kind: ParticleKind, local: Point, count: number): void {
		const scale = this.root.scale.x;
		this.#particles.emit(
			kind,
			this.root.x + local.x * scale * this.#direction,
			this.root.y + local.y * scale,
			this.#scale(),
			count,
		);
	}

	#enter(activity: Activity): void {
		for (const layer of [this.#back, this.#front, this.#overlay]) {
			for (const child of layer.removeChildren()) child.destroy();
		}
		this.#shown = activity;
		this.#shownSince = this.#time;
		this.#animate = this.#setup(activity);
	}

	#setup(activity: Activity): Animate {
		const rig = this.#rig;
		const front = this.#front;
		const overlay = this.#overlay;
		const add = <T extends Container>(layer: Container, child: T, x = 0, y = 0): T => {
			child.position.set(x, y);
			layer.addChild(child);
			return child;
		};
		const accent = this.#hatStyle?.color ?? this.#palette.accent;

		switch (activity) {
			case "sleep": {
				const zs = [0, 1, 2].map(() => {
					const z = new Graphics();
					drawZ(z, 12);
					return add(overlay, z);
				});
				return (elapsed) => {
					rig.rotation = -0.12 + wave(elapsed, 0.25) * 0.03;
					rig.scale.set(1 + wave(elapsed, 0.25) * 0.03);
					zs.forEach((z, index) => {
						const phase = (elapsed / 2.4 + index / 3) % 1;
						z.position.set(this.#direction * (22 + phase * 20), -30 - phase * 42);
						z.alpha = Math.sin(phase * Math.PI);
						z.scale.set(0.6 + phase * 0.9);
					});
				};
			}
			case "think": {
				const bubble = add(overlay, new Graphics(), 0, -66);
				drawThoughtBubble(bubble);
				const dots = [-8, 4, 16].map((x) => {
					const dot = new Graphics();
					dot.circle(0, 0, 3.2).fill(0x51657d);
					return add(bubble, dot, x, -6);
				});
				return (elapsed) => {
					bubble.x = this.#direction * 18;
					bubble.scale.x = this.#direction;
					dots.forEach((dot, index) => {
						dot.alpha = 0.25 + 0.75 * Math.max(0, wave(elapsed - index * 0.22, 0.9));
					});
				};
			}
			case "read": {
				const scroll = add(front, new Graphics(), 46, 6);
				drawScroll(scroll);
				return (elapsed) => {
					scroll.rotation = -0.12 + wave(elapsed, 0.3) * 0.04;
					const turn = (elapsed % 2.2) / 2.2;
					scroll.scale.set(1, turn > 0.9 ? 1 - Math.sin(((turn - 0.9) / 0.1) * Math.PI) * 0.25 : 1);
					rig.rotation = 0.06 + wave(elapsed, 0.45) * 0.06;
				};
			}
			case "sniff": {
				const lines = add(front, new Graphics(), 36, 14);
				lines.arc(0, 0, 6, -0.8, 0.8).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
				lines.arc(0, 0, 11, -0.8, 0.8).stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
				let next = 0;
				return (elapsed) => {
					rig.rotation = 0.32 + wave(elapsed, 3) * 0.05;
					lines.alpha = Math.max(0, wave(elapsed, 1.6));
					if (elapsed >= next) {
						next = elapsed + 0.4;
						this.#emit("dust", { x: 34, y: 22 }, 1);
					}
				};
			}
			case "build": {
				const blocks = [0, 1, 2, 3].map((index) => {
					const block = new Graphics();
					drawBlock(block, index % 2 === 0 ? accent : 0xf3e2b3);
					return add(front, block);
				});
				const layout: readonly Point[] = [
					{ x: 46, y: 24 },
					{ x: 64, y: 24 },
					{ x: 55, y: 7 },
					{ x: 55, y: -10 },
				];
				let placed = -1;
				return (elapsed) => {
					const cycle = elapsed % 3.6;
					const shown = Math.min(blocks.length, Math.floor(cycle / 0.7) + 1);
					if (shown !== placed) {
						placed = shown;
						const spot = layout[shown - 1];
						if (spot !== undefined) this.#emit("dust", { x: spot.x, y: spot.y + 8 }, 3);
					}
					blocks.forEach((block, index) => {
						const spot = layout[index] ?? { x: 0, y: 0 };
						const since = cycle - index * 0.7;
						block.visible = index < shown;
						const drop = Math.max(0, 1 - since / 0.25);
						block.position.set(spot.x, spot.y - drop * 20);
						block.scale.set(since < 0.25 ? 0.7 + 0.3 * (since / 0.25) : 1);
					});
					rig.y -= Math.abs(Math.sin((cycle / 0.7) * Math.PI)) * 5;
					rig.rotation = 0.08;
				};
			}
			case "hammer": {
				const anvil = add(front, new Graphics(), 66, 22);
				drawAnvil(anvil);
				const hammer = add(front, new Graphics(), 38, 12);
				drawHammer(hammer);
				let swing = -1;
				return (elapsed) => {
					const period = 0.75;
					const cycle = Math.floor(elapsed / period);
					const phase = (elapsed % period) / period;
					hammer.rotation =
						phase < 0.6
							? 1.45 - easeOut(phase / 0.6) * 2.35
							: -0.9 + ((phase - 0.6) / 0.4) ** 2 * 2.35;
					if (cycle !== swing) {
						swing = cycle;
						if (cycle > 0) this.#emit("spark", { x: 76, y: 10 }, 7);
					}
					const squash = phase < 0.08 && cycle > 0 ? 1 - phase / 0.08 : 0;
					rig.scale.set(1 + squash * 0.06, 1 - squash * 0.08);
					rig.rotation = 0.1 - (phase < 0.6 ? phase * 0.15 : 0);
				};
			}
			case "telescope": {
				const scope = add(front, new Graphics(), 22, -10);
				drawTelescope(scope);
				return (elapsed) => {
					scope.rotation = -0.55 + wave(elapsed, 0.15) * 0.3;
					rig.rotation = -0.12;
				};
			}
			case "notepad": {
				const pad = add(front, new Graphics(), 50, 6);
				drawNotepad(pad);
				const lines = add(pad, new Graphics());
				const pencil = add(pad, new Graphics());
				drawPencil(pencil);
				let written = -1;
				return (elapsed) => {
					const count = Math.floor((elapsed % 7.2) / 1.2);
					if (count !== written) {
						written = count;
						lines.clear();
						for (let line = 0; line < count; line++) drawNoteLine(lines, line);
					}
					const along = (elapsed % 1.2) / 1.2;
					pencil.position.set(-9 + along * 18, -6 + count * 6 + wave(elapsed, 6) * 1.5);
					rig.rotation = 0.08;
				};
			}
			case "messenger": {
				const bird = add(overlay, new Graphics());
				return (elapsed) => {
					bird.clear();
					drawBird(bird, (wave(elapsed, 4) + 1) / 2);
					bird.position.set(Math.cos(elapsed * 1.8) * 52, -46 + Math.sin(elapsed * 1.8) * 16);
					bird.scale.x = Math.sin(elapsed * 1.8) > 0 ? -1 : 1;
				};
			}
			case "hatch": {
				const egg = add(front, new Graphics(), 52, 14);
				let cracked = -1;
				return (elapsed) => {
					const cycle = elapsed % 3;
					const cracks = cycle > 1.6 ? 1 : 0;
					if (cracks !== cracked) {
						cracked = cracks;
						egg.clear();
						drawEgg(egg, cracks);
					}
					const shaking = cycle > 1 ? Math.sin(elapsed * 30) * 0.18 * Math.min(1, (cycle - 1) * 2) : 0;
					egg.rotation = shaking;
					rig.rotation = 0.06;
				};
			}
			case "knock": {
				const fin = add(front, new Graphics(), 34, 4);
				fin.ellipse(0, 0, 7, 5).fill(this.#palette.body).stroke({ width: 2.5, color: this.#palette.outline });
				const ripples = add(overlay, new Graphics());
				const mark = add(overlay, new Graphics(), 0, -60);
				drawExclamation(mark);
				return (elapsed) => {
					const tap = Math.abs(Math.sin(elapsed * Math.PI * 3));
					fin.position.set(36 + tap * 8, -2);
					rig.y -= Math.abs(Math.sin(elapsed * Math.PI * 4)) * 3;
					const pulse = (wave(elapsed, 1.5) + 1) / 2;
					rig.scale.set(1 + pulse * 0.08);
					mark.scale.set(0.9 + pulse * 0.3);
					mark.rotation = wave(elapsed, 2) * 0.15;
					ripples.clear();
					for (let ring = 0; ring < 2; ring++) {
						const phase = (elapsed * 1.5 + ring / 2) % 1;
						ripples
							.circle(this.#direction * 46, 0, 6 + phase * 34)
							.stroke({ width: 3, color: 0xffb02e, alpha: (1 - phase) * 0.9 });
					}
				};
			}
			case "celebrate": {
				let burst = -1;
				return (elapsed) => {
					const hop = Math.abs(Math.sin(elapsed * Math.PI * 1.6));
					rig.y -= hop * 20;
					rig.rotation = wave(elapsed, 1.6) * 0.25;
					const cycle = Math.floor(elapsed / 0.8);
					if (cycle !== burst) {
						burst = cycle;
						this.#emit("confetti", { x: 0, y: -30 }, 10);
					}
				};
			}
			case "rest":
				return (elapsed) => {
					rig.scale.set(1 + wave(elapsed, 0.3) * 0.025, 1 - wave(elapsed, 0.3) * 0.02);
				};
			case "trip": {
				const stars = [0, 1, 2].map(() => {
					const star = new Graphics();
					drawStar(star);
					return add(overlay, star);
				});
				return (elapsed) => {
					const fall = Math.min(1, elapsed / 0.25);
					const recover = Math.max(0, (elapsed - (TRIP_S - 0.4)) / 0.4);
					rig.rotation = (1.35 * fall - 1.35 * recover) * -1;
					rig.y += 10 * fall * (1 - recover);
					stars.forEach((star, index) => {
						const angle = elapsed * 5 + (index / 3) * Math.PI * 2;
						star.position.set(Math.cos(angle) * 22, -34 + Math.sin(angle) * 7);
					});
				};
			}
			case "stone": {
				const cracks = add(front, new Graphics());
				drawCracks(cracks);
				return () => {};
			}
		}
	}
}

function easeOut(value: number): number {
	return 1 - (1 - value) ** 3;
}

function easeOutBack(value: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (value - 1) ** 3 + c1 * (value - 1) ** 2;
}
