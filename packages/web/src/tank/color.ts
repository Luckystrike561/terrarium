/** FNV-1a: stable across hosts and reloads, so a folder keeps its colour everywhere. */
export function hashString(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function hsl(hue: number, saturation: number, lightness: number): number {
	const h = (((hue % 360) + 360) % 360) / 60;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs((h % 2) - 1));
	const [r, g, b] =
		h < 1
			? [chroma, x, 0]
			: h < 2
				? [x, chroma, 0]
				: h < 3
					? [0, chroma, x]
					: h < 4
						? [0, x, chroma]
						: h < 5
							? [x, 0, chroma]
							: [chroma, 0, x];
	const m = lightness - chroma / 2;
	const channel = (value: number): number =>
		Math.round(Math.min(1, Math.max(0, value + m)) * 255);
	return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

export function mix(from: number, to: number, amount: number): number {
	const lerp = (shift: number): number => {
		const a = (from >> shift) & 0xff;
		const b = (to >> shift) & 0xff;
		return Math.round(a + (b - a) * amount) & 0xff;
	};
	return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

export function darken(color: number, amount: number): number {
	return mix(color, 0x000000, amount);
}

export function lighten(color: number, amount: number): number {
	return mix(color, 0xffffff, amount);
}
