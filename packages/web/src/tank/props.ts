import type { Graphics } from "pixi.js";
import { darken, lighten } from "./color";

/** Props are drawn in creature units (body radius about 30), creature facing right. */

const INK = 0x2b2118;

export function drawScroll(g: Graphics): void {
	const paper = 0xf3e2b3;
	const edge = { width: 2.5, color: 0x8a6a35 };
	g.roundRect(-16, -20, 32, 40, 3).fill(paper).stroke(edge);
	g.roundRect(-19, -24, 38, 8, 4).fill(0xd9b874).stroke(edge);
	g.roundRect(-19, 16, 38, 8, 4).fill(0xd9b874).stroke(edge);
	for (let line = 0; line < 4; line++) {
		const y = -10 + line * 7;
		g.moveTo(-10, y)
			.lineTo(line % 2 === 0 ? 10 : 4, y)
			.stroke({ width: 2, color: 0x8a6a35, alpha: 0.7 });
	}
}

export function drawBlock(g: Graphics, color: number): void {
	g.roundRect(-9, -9, 18, 18, 3)
		.fill(color)
		.stroke({ width: 2.5, color: darken(color, 0.45) });
	g.roundRect(-5, -6, 8, 4, 2).fill({ color: lighten(color, 0.5), alpha: 0.8 });
}

export function drawAnvil(g: Graphics): void {
	const iron = 0x4a5361;
	const edge = { width: 2.5, color: 0x22272f };
	g.poly([-16, 18, 16, 18, 10, 10, -10, 10]).fill(iron).stroke(edge);
	g.rect(-6, 0, 12, 10).fill(iron).stroke(edge);
	g.poly([-22, -8, 18, -8, 26, -4, 18, 0, -18, 0]).fill(iron).stroke(edge);
	g.rect(-18, -8, 30, 3).fill(lighten(iron, 0.35));
}

/** Pivot at the handle's end, so rotating the graphic swings the head. */
export function drawHammer(g: Graphics): void {
	g.roundRect(-2.5, -34, 5, 34, 2)
		.fill(0x9c6b3c)
		.stroke({ width: 2, color: 0x4d3218 });
	g.roundRect(-11, -42, 22, 11, 3)
		.fill(0x8d97a6)
		.stroke({ width: 2.5, color: 0x343a44 });
}

export function drawTelescope(g: Graphics): void {
	const brass = 0xd4a24c;
	const edge = { width: 2.5, color: 0x6b4e1c };
	g.roundRect(0, -6, 22, 12, 3).fill(brass).stroke(edge);
	g.roundRect(20, -8, 18, 16, 3).fill(lighten(brass, 0.15)).stroke(edge);
	g.roundRect(36, -10, 6, 20, 2).fill(darken(brass, 0.2)).stroke(edge);
	g.circle(42, 0, 5).fill({ color: 0xbfe6ff, alpha: 0.9 });
}

export function drawNotepad(g: Graphics): void {
	g.roundRect(-14, -18, 28, 36, 3)
		.fill(0xfdfbf3)
		.stroke({ width: 2.5, color: 0x6c6a63 });
	g.rect(-14, -18, 28, 6).fill(0xe86a5c);
	for (let ring = 0; ring < 4; ring++) {
		g.circle(-9 + ring * 6, -18, 1.8).fill(0x6c6a63);
	}
}

/** Drawn with its tip on the origin. */
export function drawPencil(g: Graphics): void {
	g.poly([0, 0, 4, -6, -2, -8]).fill(0xf2d0a4);
	g.roundRect(-2, -26, 7, 20, 1.5)
		.fill(0xf6c445)
		.stroke({ width: 1.5, color: 0x8a6a1a });
	g.circle(0, 0, 1.4).fill(INK);
}

export function drawNoteLine(g: Graphics, index: number): void {
	const y = -6 + index * 6;
	g.moveTo(-9, y)
		.lineTo(index % 2 === 0 ? 9 : 4, y)
		.stroke({ width: 2, color: 0x3a5a8c });
}

export function drawBird(g: Graphics, flap: number): void {
	const wing = -10 + flap * 14;
	g.moveTo(-12, wing)
		.quadraticCurveTo(-6, -2, 0, 0)
		.quadraticCurveTo(6, -2, 12, wing)
		.stroke({ width: 3, color: 0xf7f4ea, cap: "round", join: "round" });
	g.ellipse(0, 1, 5, 3.5).fill(0xf7f4ea);
	g.poly([5, 0, 9, 1, 5, 2.5]).fill(0xf2a541);
	g.roundRect(-4, 4, 8, 6, 1)
		.fill(0xe8d7a8)
		.stroke({ width: 1.2, color: 0x8a6a35 });
}

export function drawEgg(g: Graphics, cracks: number): void {
	g.ellipse(0, 0, 13, 17)
		.fill(0xfff4dc)
		.stroke({ width: 2.5, color: 0xb59a6a });
	g.circle(-4, -6, 2.5).fill(0xe8c98f);
	g.circle(5, 4, 2).fill(0xe8c98f);
	if (cracks > 0) {
		g.moveTo(-10, -2)
			.lineTo(-4, 2)
			.lineTo(0, -3)
			.lineTo(4, 2)
			.lineTo(10, -2)
			.stroke({ width: 2, color: 0x7a5f33 });
	}
}

export function drawShell(g: Graphics, top: boolean): void {
	const sign = top ? -1 : 1;
	g.moveTo(-13, 0)
		.lineTo(-7, 4 * sign)
		.lineTo(0, -1 * sign)
		.lineTo(7, 4 * sign)
		.lineTo(13, 0)
		.bezierCurveTo(13, 22 * sign, -13, 22 * sign, -13, 0)
		.fill(0xfff4dc)
		.stroke({ width: 2.5, color: 0xb59a6a });
}

export function drawThoughtBubble(g: Graphics): void {
	const fill = { color: 0xffffff, alpha: 0.92 };
	const edge = { width: 2, color: 0x9fb3c8 };
	g.circle(-14, 18, 3).fill(fill).stroke(edge);
	g.circle(-8, 10, 4.5).fill(fill).stroke(edge);
	g.circle(-10, -8, 11).fill(fill);
	g.circle(4, -14, 13).fill(fill);
	g.circle(18, -7, 11).fill(fill);
	g.circle(4, -2, 12).fill(fill);
}

export function drawExclamation(g: Graphics): void {
	g.circle(0, 0, 13).fill(0xffb02e).stroke({ width: 3, color: 0x8a4b00 });
	g.roundRect(-2.5, -8, 5, 10, 2.5).fill(0x3a1d00);
	g.circle(0, 6, 2.6).fill(0x3a1d00);
}

/** A single "Z" stroke, so sleeping creatures need no text rendering. */
export function drawZ(g: Graphics, size: number): void {
	const half = size / 2;
	g.moveTo(-half, -half)
		.lineTo(half, -half)
		.lineTo(-half, half)
		.lineTo(half, half)
		.stroke({
			width: Math.max(2, size / 4),
			color: 0xe9f4ff,
			cap: "round",
			join: "round",
		});
}

export function drawStar(g: Graphics): void {
	const points: number[] = [];
	for (let index = 0; index < 10; index++) {
		const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
		const radius = index % 2 === 0 ? 6 : 2.6;
		points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
	}
	g.poly(points).fill(0xffe066).stroke({ width: 1.5, color: 0xb8860b });
}

export function drawCracks(g: Graphics): void {
	const line = { width: 2, color: 0x3d4248, alpha: 0.8 };
	g.moveTo(-6, -18).lineTo(-2, -8).lineTo(-8, 0).lineTo(-3, 10).stroke(line);
	g.moveTo(14, -10).lineTo(10, -2).lineTo(16, 6).stroke(line);
}
