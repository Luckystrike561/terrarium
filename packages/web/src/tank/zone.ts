import { Container, FillGradient, Graphics, Text } from "pixi.js";
import { darken, hashString, lighten } from "./color";
import { ZONE_FLOOR, type ZoneLayout } from "./layout";
import type { Particles } from "./particles";

type Theme = {
	waterTop: number;
	waterBottom: number;
	sand: number;
	rock: number;
	weed: number;
	weedTip: number | null;
	rays: boolean;
	ambient: "bubble" | "mote";
};

const SHALLOW: Theme = {
	waterTop: 0x2a86b8,
	waterBottom: 0x0d3f66,
	sand: 0xd9c38c,
	rock: 0x6f7c86,
	weed: 0x2f9e5b,
	weedTip: null,
	rays: true,
	ambient: "bubble",
};

const DEEP: Theme = {
	waterTop: 0x0b2142,
	waterBottom: 0x02060f,
	sand: 0x262b38,
	rock: 0x1b2130,
	weed: 0x1d4a52,
	weedTip: 0x6ff7d6,
	rays: false,
	ambient: "mote",
};

const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Deterministic per host, so the scenery does not reshuffle on every resize. */
function seeded(seed: number): () => number {
	let state = seed || 1;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

export type ZoneStatus = {
	online: boolean;
	connected: boolean;
	agents: number;
	busy: number;
	blocked: number;
};

/** One host's part of the tank: water, sand, weeds, glass, and a name plate. */
export class Zone {
	readonly host: string;
	/** Drawn behind the creatures. */
	readonly back = new Container();
	/** Drawn in front of the creatures. */
	readonly front = new Container();
	layout: ZoneLayout;

	#theme: Theme;
	#water = new Graphics();
	#rays = new Graphics();
	#floor = new Graphics();
	#weeds: { g: Graphics; phase: number }[] = [];
	#glass = new Graphics();
	#dim = new Graphics();
	#dot = new Graphics();
	#title: Text;
	#meta: Text;
	#online = true;
	#dimAlpha = 0;
	#nextAmbient = 0;
	#random: () => number;

	constructor(layout: ZoneLayout) {
		this.host = layout.host;
		this.layout = layout;
		this.#theme = layout.deep ? DEEP : SHALLOW;
		this.#random = seeded(hashString(layout.host));
		const style = {
			fontFamily: FONT,
			fill: 0xf0f6ff,
			stroke: { color: 0x02101e, width: 5 },
		};
		this.#title = new Text({
			text: layout.host,
			style: { ...style, fontWeight: "700" },
		});
		this.#meta = new Text({
			text: "",
			style: { ...style, fontWeight: "500", fill: 0xbcd3e8 },
		});
		this.back.addChild(this.#water, this.#rays, this.#floor);
		this.front.addChild(
			this.#dim,
			this.#glass,
			this.#dot,
			this.#title,
			this.#meta,
		);
		this.#draw();
	}

	setLayout(layout: ZoneLayout): void {
		const same =
			layout.x === this.layout.x &&
			layout.y === this.layout.y &&
			layout.w === this.layout.w &&
			layout.h === this.layout.h &&
			layout.deep === this.layout.deep;
		this.layout = layout;
		if (same) return;
		this.#theme = layout.deep ? DEEP : SHALLOW;
		this.#draw();
	}

	setStatus(status: ZoneStatus): void {
		this.#online = status.online || !status.connected;
		const parts = !status.connected
			? ["connecting"]
			: [
					status.online ? "online" : "offline",
					`${status.agents} ${status.agents === 1 ? "agent" : "agents"}`,
					...(status.busy > 0 ? [`${status.busy} working`] : []),
					...(status.blocked > 0 ? [`${status.blocked} waiting`] : []),
				];
		const text = parts.join("  |  ");
		if (this.#meta.text !== text) this.#meta.text = text;
		this.#dot
			.clear()
			.circle(0, 0, 1)
			.fill(!status.connected ? 0xd29922 : status.online ? 0x3fb950 : 0xf85149);
	}

	update(time: number, dt: number, particles: Particles): void {
		const target = this.#online ? 0 : 0.55;
		this.#dimAlpha += (target - this.#dimAlpha) * Math.min(1, dt * 3);
		this.#dim.alpha = this.#dimAlpha;
		this.#rays.alpha = 0.7 + Math.sin(time * 0.4) * 0.3;
		for (const weed of this.#weeds) {
			weed.g.skew.x = Math.sin(time * 0.7 + weed.phase) * 0.14;
		}
		if (time < this.#nextAmbient || !this.#online) return;
		const { x, y, w, h } = this.layout;
		const scale = Math.max(0.6, h / 360);
		if (this.#theme.ambient === "bubble") {
			this.#nextAmbient = time + 0.5 + Math.random() * 0.9;
			particles.emit(
				"bubble",
				x + Math.random() * w,
				y + h * (1 - ZONE_FLOOR),
				scale,
			);
		} else {
			this.#nextAmbient = time + 0.35 + Math.random() * 0.5;
			particles.emit(
				"mote",
				x + Math.random() * w,
				y + h * (0.3 + Math.random() * 0.6),
				scale,
			);
		}
	}

	#draw(): void {
		const { x, y, w, h } = this.layout;
		const theme = this.#theme;
		this.#random = seeded(hashString(this.host));
		const random = this.#random;

		const gradient = new FillGradient({
			type: "linear",
			start: { x: 0, y: 0 },
			end: { x: 0, y: 1 },
			colorStops: [
				{ offset: 0, color: theme.waterTop },
				{ offset: 1, color: theme.waterBottom },
			],
		});
		this.#water.clear().rect(x, y, w, h).fill(gradient);

		this.#rays.clear();
		if (theme.rays) {
			for (let ray = 0; ray < 4; ray++) {
				const start = x + w * (0.1 + ray * 0.24 + random() * 0.08);
				const spread = w * 0.08;
				this.#rays
					.poly([
						start,
						y,
						start + spread,
						y,
						start + spread * 2.6,
						y + h * 0.85,
						start + spread * 0.9,
						y + h * 0.85,
					])
					.fill({ color: 0xffffff, alpha: 0.05 });
			}
		}

		const floorTop = y + h * (1 - ZONE_FLOOR);
		const floor = this.#floor.clear();
		floor.moveTo(x, floorTop + h * 0.03);
		const bumps = 8;
		for (let bump = 1; bump <= bumps; bump++) {
			const bx = x + (w * bump) / bumps;
			floor.quadraticCurveTo(
				bx - w / bumps / 2,
				floorTop - h * 0.02 * random(),
				bx,
				floorTop + h * 0.025 * random(),
			);
		}
		floor
			.lineTo(x + w, y + h)
			.lineTo(x, y + h)
			.closePath()
			.fill(theme.sand);
		for (let speck = 0; speck < Math.round(w / 18); speck++) {
			floor
				.circle(
					x + random() * w,
					floorTop + h * 0.04 + random() * h * 0.07,
					1 + random() * 2,
				)
				.fill({ color: darken(theme.sand, 0.25), alpha: 0.6 });
		}
		const unit = Math.max(8, Math.min(w, h) * 0.04);
		for (let rock = 0; rock < 3; rock++) {
			const rx = x + w * (0.12 + random() * 0.76);
			floor
				.ellipse(
					rx,
					floorTop + unit * 0.4,
					unit * (1.2 + random()),
					unit * (0.7 + random() * 0.4),
				)
				.fill(theme.rock)
				.stroke({ width: 2, color: darken(theme.rock, 0.35) });
			floor
				.ellipse(rx - unit * 0.4, floorTop, unit * 0.4, unit * 0.2)
				.fill(lighten(theme.rock, 0.2));
		}

		for (const weed of this.#weeds) weed.g.destroy();
		this.#weeds = [];
		const weedCount = Math.max(3, Math.round(w / 140));
		for (let index = 0; index < weedCount; index++) {
			const g = new Graphics();
			const height = h * (0.18 + random() * 0.22);
			const blades = 2 + Math.floor(random() * 2);
			for (let blade = 0; blade < blades; blade++) {
				const offset = (blade - (blades - 1) / 2) * unit * 0.5;
				const sway = (random() - 0.5) * unit * 2;
				g.moveTo(offset, 0)
					.bezierCurveTo(
						offset + sway,
						-height * 0.35,
						offset - sway,
						-height * 0.7,
						offset + sway * 0.5,
						-height * (0.8 + blade * 0.08),
					)
					.stroke({
						width: Math.max(3, unit * 0.35),
						color: theme.weed,
						cap: "round",
					});
				if (theme.weedTip !== null) {
					g.circle(
						offset + sway * 0.5,
						-height * (0.8 + blade * 0.08),
						unit * 0.25,
					).fill(theme.weedTip);
				}
			}
			g.position.set(
				x + w * ((index + 0.3 + random() * 0.4) / weedCount),
				floorTop + unit * 0.3,
			);
			this.back.addChild(g);
			this.#weeds.push({ g, phase: random() * Math.PI * 2 });
		}

		this.#dim.clear().rect(x, y, w, h).fill(0x0a0d12);
		this.#dim.alpha = this.#dimAlpha;
		this.#glass
			.clear()
			.roundRect(x + 2, y + 2, w - 4, h - 4, 10)
			.stroke({ width: 4, color: 0xbfe6ff, alpha: 0.28 });
		this.#glass
			.moveTo(x + w * 0.03, y + h * 0.75)
			.lineTo(x + w * 0.03, y + h * 0.08)
			.stroke({ width: 6, color: 0xffffff, alpha: 0.07, cap: "round" });

		const titleSize = Math.round(
			Math.min(34, Math.max(16, Math.min(w * 0.05, h * 0.075))),
		);
		this.#title.style.fontSize = titleSize;
		this.#meta.style.fontSize = Math.round(titleSize * 0.6);
		const pad = titleSize * 0.6;
		this.#dot.position.set(
			x + pad + titleSize * 0.3,
			y + pad + titleSize * 0.62,
		);
		this.#dot.scale.set(titleSize * 0.3);
		this.#title.position.set(x + pad + titleSize * 0.8, y + pad);
		this.#meta.position.set(
			x + pad + titleSize * 0.8,
			y + pad + titleSize * 1.15,
		);
	}
}
