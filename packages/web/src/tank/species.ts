import type { Graphics } from "pixi.js";
import { darken, hashString, hsl, lighten, mix } from "./color";

export type Palette = {
	body: number;
	belly: number;
	accent: number;
	outline: number;
	/** Bioluminescent spots and lure, only in the deep zone. */
	glow: number | null;
};

type Point = { x: number; y: number };

export type SpeciesId =
	| "axolotl"
	| "crab"
	| "jelly"
	| "puffer"
	| "octopus"
	| "fish";

/**
 * Drawn facing right, centred on the origin, about 30 units in radius. The
 * tail is a separate graphic so it can wag without redrawing the body.
 */
export type Species = {
	id: SpeciesId;
	eyes: readonly (Point & { r: number })[];
	hat: Point;
	mouth: Point;
	tailPivot: Point;
	tailMotion: "rotate" | "skew";
	/** Where the deep-zone lure sprouts from. */
	lure: Point;
	drawBody(g: Graphics, palette: Palette): void;
	drawTail(g: Graphics, palette: Palette): void;
};

const OUTLINE = 3;

function outline(palette: Palette): { width: number; color: number } {
	return { width: OUTLINE, color: palette.outline };
}

const axolotl: Species = {
	id: "axolotl",
	eyes: [
		{ x: 12, y: -8, r: 5 },
		{ x: 24, y: -6, r: 4.5 },
	],
	hat: { x: 14, y: -20 },
	mouth: { x: 27, y: 5 },
	tailPivot: { x: -24, y: 2 },
	tailMotion: "rotate",
	lure: { x: 16, y: -20 },
	drawBody(g, p) {
		for (const [x, y, angle] of [
			[2, -16, -2.3],
			[6, -18, -2.0],
			[10, -18, -1.7],
		] as const) {
			const tipX = x + Math.cos(angle) * 16;
			const tipY = y + Math.sin(angle) * 16;
			g.moveTo(x, y).lineTo(tipX, tipY).stroke({ width: 4, color: p.accent });
			g.circle(tipX, tipY, 3.5).fill(p.accent);
		}
		g.ellipse(-14, 18, 6, 4).fill(p.body).stroke(outline(p));
		g.ellipse(12, 19, 6, 4).fill(p.body).stroke(outline(p));
		g.ellipse(0, 0, 32, 21).fill(p.body).stroke(outline(p));
		g.ellipse(4, 8, 22, 9).fill(p.belly);
		g.circle(-12, -8, 2.5).fill(lighten(p.body, 0.35));
		g.circle(-4, -12, 2).fill(lighten(p.body, 0.35));
	},
	drawTail(g, p) {
		g.moveTo(-22, -6)
			.quadraticCurveTo(-48, -18, -62, -2)
			.quadraticCurveTo(-46, 12, -22, 10)
			.closePath()
			.fill(p.body)
			.stroke(outline(p));
		g.moveTo(-28, 2).lineTo(-54, -2).stroke({ width: 2, color: p.accent });
	},
};

const crab: Species = {
	id: "crab",
	eyes: [
		{ x: -8, y: -30, r: 5 },
		{ x: 10, y: -30, r: 5 },
	],
	hat: { x: 1, y: -14 },
	mouth: { x: 1, y: 6 },
	tailPivot: { x: 22, y: -2 },
	tailMotion: "rotate",
	lure: { x: 0, y: -14 },
	drawBody(g, p) {
		for (const side of [-1, 1]) {
			for (let leg = 0; leg < 3; leg++) {
				const x = side * (14 + leg * 7);
				g.moveTo(x, 12)
					.lineTo(x + side * 8, 26)
					.stroke({ width: 4, color: darken(p.body, 0.15) });
			}
		}
		g.moveTo(-8, -12).lineTo(-8, -26).stroke({ width: 4, color: p.outline });
		g.moveTo(10, -12).lineTo(10, -26).stroke({ width: 4, color: p.outline });
		g.ellipse(0, 2, 32, 19).fill(p.body).stroke(outline(p));
		g.ellipse(0, 9, 22, 8).fill(p.belly);
		g.circle(-14, -6, 2.5).fill(p.accent);
		g.circle(14, -6, 2.5).fill(p.accent);
	},
	drawTail(g, p) {
		for (const side of [-1, 1]) {
			const x = 26 * side;
			g.moveTo(side * 18, 0)
				.lineTo(x, -10)
				.stroke({ width: 5, color: p.outline });
			g.circle(x + side * 4, -18, 10).fill(p.body).stroke(outline(p));
			g.moveTo(x + side * 4, -18)
				.lineTo(x + side * 14, -26)
				.stroke({ width: 3, color: p.outline });
		}
	},
};

const jelly: Species = {
	id: "jelly",
	eyes: [
		{ x: -9, y: -8, r: 4.5 },
		{ x: 9, y: -8, r: 4.5 },
	],
	hat: { x: 0, y: -26 },
	mouth: { x: 0, y: 1 },
	tailPivot: { x: 0, y: 6 },
	tailMotion: "skew",
	lure: { x: 0, y: -26 },
	drawBody(g, p) {
		g.moveTo(-30, 6)
			.bezierCurveTo(-32, -36, 32, -36, 30, 6)
			.quadraticCurveTo(22, 12, 15, 6)
			.quadraticCurveTo(7.5, 12, 0, 6)
			.quadraticCurveTo(-7.5, 12, -15, 6)
			.quadraticCurveTo(-22, 12, -30, 6)
			.closePath()
			.fill({ color: p.body, alpha: 0.92 })
			.stroke(outline(p));
		g.ellipse(0, -10, 18, 12).fill({ color: p.belly, alpha: 0.55 });
		g.ellipse(-12, -18, 5, 3).fill({ color: 0xffffff, alpha: 0.5 });
	},
	drawTail(g, p) {
		for (const x of [-18, -6, 6, 18]) {
			g.moveTo(x, 6)
				.quadraticCurveTo(x - 7, 20, x, 30)
				.quadraticCurveTo(x + 7, 40, x - 2, 48)
				.stroke({ width: 3.5, color: p.accent, alpha: 0.9 });
		}
	},
};

const puffer: Species = {
	id: "puffer",
	eyes: [
		{ x: 6, y: -9, r: 6 },
		{ x: 19, y: -7, r: 5.5 },
	],
	hat: { x: 2, y: -26 },
	mouth: { x: 25, y: 6 },
	tailPivot: { x: -24, y: 0 },
	tailMotion: "rotate",
	lure: { x: 6, y: -26 },
	drawBody(g, p) {
		for (let spike = 0; spike < 14; spike++) {
			const angle = (spike / 14) * Math.PI * 2;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			g.poly([
				cos * 24 - sin * 4,
				sin * 24 + cos * 4,
				cos * 34,
				sin * 34,
				cos * 24 + sin * 4,
				sin * 24 - cos * 4,
			]).fill(p.accent);
		}
		g.circle(0, 0, 27).fill(p.body).stroke(outline(p));
		g.ellipse(2, 12, 18, 10).fill(p.belly);
		g.circle(-10, -2, 3).fill(darken(p.body, 0.2));
		g.circle(-4, 6, 2.5).fill(darken(p.body, 0.2));
	},
	drawTail(g, p) {
		g.poly([-24, 0, -42, -14, -38, 0, -42, 14])
			.fill(p.accent)
			.stroke(outline(p));
	},
};

const octopus: Species = {
	id: "octopus",
	eyes: [
		{ x: -9, y: -6, r: 5.5 },
		{ x: 9, y: -6, r: 5.5 },
	],
	hat: { x: 0, y: -30 },
	mouth: { x: 0, y: 6 },
	tailPivot: { x: 0, y: 10 },
	tailMotion: "skew",
	lure: { x: 0, y: -30 },
	drawBody(g, p) {
		g.ellipse(0, -8, 25, 24).fill(p.body).stroke(outline(p));
		g.ellipse(-8, -20, 6, 4).fill(lighten(p.body, 0.3));
		g.circle(12, -16, 2.5).fill(darken(p.body, 0.2));
		g.circle(-14, 0, 2).fill(darken(p.body, 0.2));
	},
	drawTail(g, p) {
		for (const x of [-20, -10, 0, 10, 20]) {
			const curl = x === 0 ? 1 : Math.sign(x);
			g.moveTo(x * 0.8, 10)
				.quadraticCurveTo(x * 1.2, 26, x * 1.3 + curl * 8, 30)
				.stroke({ width: 7, color: p.body, cap: "round" });
			g.circle(x * 1.3 + curl * 8, 30, 3).fill(p.accent);
		}
	},
};

const fish: Species = {
	id: "fish",
	eyes: [{ x: 16, y: -5, r: 5.5 }],
	hat: { x: 8, y: -18 },
	mouth: { x: 28, y: 5 },
	tailPivot: { x: -26, y: 0 },
	tailMotion: "rotate",
	lure: { x: 14, y: -17 },
	drawBody(g, p) {
		g.poly([-12, -14, 4, -30, 14, -14]).fill(p.accent).stroke(outline(p));
		g.ellipse(0, 0, 31, 18).fill(p.body).stroke(outline(p));
		g.ellipse(2, 7, 22, 7).fill(p.belly);
		g.moveTo(-6, -16).lineTo(-6, 16).stroke({ width: 4, color: p.accent });
		g.poly([2, 4, 12, 10, 2, 12]).fill(p.accent);
	},
	drawTail(g, p) {
		g.poly([-24, 0, -48, -18, -42, 0, -48, 18])
			.fill(p.accent)
			.stroke(outline(p));
	},
};

const SPECIES: Record<SpeciesId, Species> = {
	axolotl,
	crab,
	jelly,
	puffer,
	octopus,
	fish,
};

const KIND_SPECIES: Readonly<Record<string, SpeciesId>> = {
	omp: "axolotl",
	claude: "crab",
	codex: "jelly",
	opencode: "puffer",
	gemini: "octopus",
};

const BASE_PALETTE: Record<SpeciesId, { body: number; accent: number }> = {
	axolotl: { body: 0xf6a8c8, accent: 0xe0457b },
	crab: { body: 0xf08a4b, accent: 0xffd29a },
	jelly: { body: 0xa694ff, accent: 0xd8ccff },
	puffer: { body: 0xf2c94c, accent: 0xc98a1b },
	octopus: { body: 0xe76f8a, accent: 0xffc2cf },
	fish: { body: 0x4cc9b0, accent: 0x1f7f8c },
};

const DEEP_WATER = 0x07142c;
const DEEP_GLOW = 0x6ff7d6;

export function speciesFor(kind: string): Species {
	return SPECIES[KIND_SPECIES[kind] ?? "fish"];
}

/** Kinds without their own species are fish, tinted per kind so two such kinds still differ. */
export function paletteFor(species: Species, kind: string, deep: boolean): Palette {
	let { body, accent } = BASE_PALETTE[species.id];
	if (species.id === "fish" && Object.hasOwn(KIND_SPECIES, kind) === false) {
		const hue = kind === "unknown" ? 205 : hashString(kind) % 360;
		const saturation = kind === "unknown" ? 0.25 : 0.6;
		body = hsl(hue, saturation, 0.6);
		accent = hsl(hue + 30, saturation, 0.38);
	}
	if (deep) {
		body = mix(body, DEEP_WATER, 0.45);
		accent = mix(accent, DEEP_GLOW, 0.5);
	}
	return {
		body,
		belly: lighten(body, deep ? 0.15 : 0.35),
		accent,
		outline: darken(body, 0.45),
		glow: deep ? DEEP_GLOW : null,
	};
}

export const STONE_PALETTE: Palette = {
	body: 0x8d939b,
	belly: 0xa5abb2,
	accent: 0x6e747c,
	outline: 0x4b5057,
	glow: null,
};

export type HatStyle = "beanie" | "tophat" | "cap" | "crown" | "bow" | "party";

export type Hat = { style: HatStyle; color: number };

const HAT_STYLES: readonly HatStyle[] = [
	"beanie",
	"tophat",
	"cap",
	"crown",
	"bow",
	"party",
];

/**
 * 12 hues by 6 styles: the same folder gets the same hat on every host, and
 * folders that collide on one still differ on the other.
 */
export function hatFor(folder: string | null): Hat | null {
	if (folder === null || folder.length === 0) return null;
	const hash = hashString(folder);
	return {
		style: HAT_STYLES[(hash >>> 8) % HAT_STYLES.length] ?? "beanie",
		color: hsl((hash % 12) * 30 + 8, 0.75, 0.55),
	};
}

/** Drawn with its brim centred on the origin. */
export function drawHat(g: Graphics, hat: Hat): void {
	const edge = { width: 2.5, color: darken(hat.color, 0.45) };
	const trim = lighten(hat.color, 0.55);
	switch (hat.style) {
		case "beanie":
			g.moveTo(-14, 0)
				.bezierCurveTo(-14, -20, 14, -20, 14, 0)
				.closePath()
				.fill(hat.color)
				.stroke(edge);
			g.roundRect(-15, -3, 30, 6, 3).fill(trim).stroke(edge);
			g.circle(0, -16, 4.5).fill(trim).stroke(edge);
			break;
		case "tophat":
			g.roundRect(-18, -3, 36, 6, 3).fill(hat.color).stroke(edge);
			g.rect(-11, -24, 22, 22).fill(hat.color).stroke(edge);
			g.rect(-11, -8, 22, 5).fill(trim);
			break;
		case "cap":
			g.moveTo(-13, 0)
				.bezierCurveTo(-13, -18, 13, -18, 13, 0)
				.closePath()
				.fill(hat.color)
				.stroke(edge);
			g.roundRect(8, -4, 16, 5, 2.5).fill(hat.color).stroke(edge);
			g.circle(0, -13, 2.5).fill(trim);
			break;
		case "crown":
			g.poly([-14, 0, -14, -16, -7, -8, 0, -20, 7, -8, 14, -16, 14, 0])
				.fill(hat.color)
				.stroke(edge);
			g.circle(0, -6, 2.5).fill(trim);
			break;
		case "bow":
			g.poly([0, -4, -14, -12, -14, 4]).fill(hat.color).stroke(edge);
			g.poly([0, -4, 14, -12, 14, 4]).fill(hat.color).stroke(edge);
			g.circle(0, -4, 4).fill(trim).stroke(edge);
			break;
		case "party":
			g.poly([-11, 0, 0, -26, 11, 0]).fill(hat.color).stroke(edge);
			g.moveTo(-6, -10).lineTo(6, -6).stroke({ width: 2.5, color: trim });
			g.circle(0, -27, 3.5).fill(trim);
			break;
	}
}
