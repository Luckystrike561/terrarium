import { type Container, Sprite, type Texture } from "pixi.js";

export type ParticleKind = "bubble" | "spark" | "confetti" | "dust" | "mote";

type Particle = {
	sprite: Sprite;
	vx: number;
	vy: number;
	gravity: number;
	life: number;
	maxLife: number;
	size: number;
	wobble: number;
	alpha: number;
};

const CONFETTI = [0xff5d8f, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb388ff];

/**
 * A fixed pool of sprites sharing one texture. `emit` drops particles once
 * `cap` are alive, so a burst of events can never grow the scene.
 */
export class Particles {
	#layer: Container;
	#texture: Texture;
	#live: Particle[] = [];
	#free: Particle[] = [];
	#cap: number;

	constructor(layer: Container, texture: Texture, cap: number) {
		this.#layer = layer;
		this.#texture = texture;
		this.#cap = cap;
	}

	get count(): number {
		return this.#live.length;
	}

	set cap(value: number) {
		this.#cap = value;
		while (this.#live.length > value) {
			const particle = this.#live.pop();
			if (particle !== undefined) this.#release(particle);
		}
	}

	emit(kind: ParticleKind, x: number, y: number, scale: number, count = 1): void {
		for (let index = 0; index < count; index++) {
			if (this.#live.length >= this.#cap) return;
			const particle = this.#free.pop() ?? this.#create();
			this.#init(particle, kind, x, y, scale);
			particle.sprite.visible = true;
			this.#live.push(particle);
		}
	}

	update(dt: number): void {
		for (let index = this.#live.length - 1; index >= 0; index--) {
			const particle = this.#live[index];
			if (particle === undefined) continue;
			particle.life += dt;
			if (particle.life >= particle.maxLife) {
				this.#live[index] = this.#live[this.#live.length - 1] as Particle;
				this.#live.pop();
				this.#release(particle);
				continue;
			}
			const { sprite } = particle;
			particle.vy += particle.gravity * dt;
			sprite.x +=
				(particle.vx + Math.sin(particle.life * 5 + particle.wobble) * 12) * dt;
			sprite.y += particle.vy * dt;
			const progress = particle.life / particle.maxLife;
			sprite.alpha = particle.alpha * Math.min(1, (1 - progress) * 3);
		}
	}

	#create(): Particle {
		const sprite = new Sprite(this.#texture);
		sprite.anchor.set(0.5);
		this.#layer.addChild(sprite);
		return {
			sprite,
			vx: 0,
			vy: 0,
			gravity: 0,
			life: 0,
			maxLife: 1,
			size: 1,
			wobble: 0,
			alpha: 1,
		};
	}

	#release(particle: Particle): void {
		particle.sprite.visible = false;
		this.#free.push(particle);
	}

	#init(
		particle: Particle,
		kind: ParticleKind,
		x: number,
		y: number,
		scale: number,
	): void {
		const random = Math.random;
		const angle = random() * Math.PI * 2;
		particle.life = 0;
		particle.wobble = random() * Math.PI * 2;
		particle.sprite.x = x;
		particle.sprite.y = y;
		switch (kind) {
			case "bubble":
				particle.vx = (random() - 0.5) * 10;
				particle.vy = -(30 + random() * 40) * scale;
				particle.gravity = -8 * scale;
				particle.maxLife = 2.5 + random() * 2;
				particle.size = (3 + random() * 5) * scale;
				particle.alpha = 0.55;
				particle.sprite.tint = 0xcdeeff;
				break;
			case "spark":
				particle.vx = Math.cos(angle) * 120 * scale;
				particle.vy = (-80 - random() * 120) * scale;
				particle.gravity = 400 * scale;
				particle.maxLife = 0.45 + random() * 0.3;
				particle.size = (2 + random() * 2.5) * scale;
				particle.alpha = 1;
				particle.sprite.tint = random() < 0.5 ? 0xffd166 : 0xff8c42;
				break;
			case "confetti":
				particle.vx = Math.cos(angle) * 90 * scale;
				particle.vy = (-140 - random() * 80) * scale;
				particle.gravity = 260 * scale;
				particle.maxLife = 1.1 + random() * 0.6;
				particle.size = (3 + random() * 3) * scale;
				particle.alpha = 1;
				particle.sprite.tint =
					CONFETTI[Math.floor(random() * CONFETTI.length)] ?? 0xffffff;
				break;
			case "dust":
				particle.vx = (random() - 0.5) * 50 * scale;
				particle.vy = (-10 - random() * 25) * scale;
				particle.gravity = 20 * scale;
				particle.maxLife = 0.8 + random() * 0.5;
				particle.size = (2.5 + random() * 3) * scale;
				particle.alpha = 0.6;
				particle.sprite.tint = 0xd9c48f;
				break;
			case "mote":
				particle.vx = (random() - 0.5) * 8;
				particle.vy = -(4 + random() * 8) * scale;
				particle.gravity = 0;
				particle.maxLife = 4 + random() * 4;
				particle.size = (1.5 + random() * 2.5) * scale;
				particle.alpha = 0.8;
				particle.sprite.tint = random() < 0.6 ? 0x6ff7d6 : 0x8fb8ff;
				break;
		}
		particle.sprite.width = particle.size * 2;
		particle.sprite.height = particle.size * 2;
		particle.sprite.alpha = particle.alpha;
	}
}
