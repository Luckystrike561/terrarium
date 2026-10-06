import { deflateSync } from "node:zlib";

const SIZE = 512;
/** Per axis, only for pixels on a shape edge. */
const EDGE_SAMPLES = 4;
const hex = (value) => [
	(value >> 16) & 0xff,
	(value >> 8) & 0xff,
	value & 0xff,
];
const solid = (value) => {
	const rgb = hex(value);
	return () => rgb;
};
function ellipse(cx, cy, rx, ry) {
	return (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}
function ring(cx, cy, r, width) {
	return (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= width / 2;
}
function capsule(ax, ay, bx, by, width) {
	const dx = bx - ax;
	const dy = by - ay;
	const length = dx * dx + dy * dy;
	return (x, y) => {
		const t = Math.max(
			0,
			Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length),
		);
		return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= width / 2;
	};
}
function roundedSquare(radius) {
	return (x, y) => {
		const qx = Math.max(radius - x, x - (SIZE - radius), 0);
		const qy = Math.max(radius - y, y - (SIZE - radius), 0);
		return qx * qx + qy * qy <= radius * radius;
	};
}
function layers(maskable) {
	const top = hex(0x2a86b8);
	const bottom = hex(0x0d3f66);
	const water = (y) => {
		const t = Math.min(1, Math.max(0, y / SIZE));
		return [
			top[0] + (bottom[0] - top[0]) * t,
			top[1] + (bottom[1] - top[1]) * t,
			top[2] + (bottom[2] - top[2]) * t,
		];
	};
	const outline = 0x87566b;
	const pink = 0xf6a8c8;
	const gill = 0xe0457b;
	const ink = 0x14161c;
	return [
		{ inside: maskable ? () => true : roundedSquare(96), color: water },
		{
			inside: (x, y) => y >= 420 + Math.sin((x / SIZE) * Math.PI * 2) * 10,
			color: solid(0xd9c38c),
		},
		{ inside: ellipse(96, 282, 68, 34), color: solid(outline) },
		{ inside: ellipse(96, 282, 60, 26), color: solid(pink) },
		{ inside: capsule(230, 190, 190, 120, 16), color: solid(gill) },
		{ inside: capsule(260, 180, 240, 110, 16), color: solid(gill) },
		{ inside: capsule(290, 182, 290, 112, 16), color: solid(gill) },
		{ inside: ellipse(190, 120, 14, 14), color: solid(gill) },
		{ inside: ellipse(240, 110, 14, 14), color: solid(gill) },
		{ inside: ellipse(290, 112, 14, 14), color: solid(gill) },
		{ inside: ellipse(270, 270, 146, 106), color: solid(outline) },
		{ inside: ellipse(270, 270, 140, 100), color: solid(pink) },
		{ inside: ellipse(285, 310, 95, 38), color: solid(0xfbd3e3) },
		{ inside: ellipse(320, 240, 27, 27), color: solid(ink) },
		{ inside: ellipse(320, 240, 22, 22), color: solid(0xffffff) },
		{ inside: ellipse(326, 246, 13, 13), color: solid(ink) },
		{ inside: ellipse(372, 248, 24, 24), color: solid(ink) },
		{ inside: ellipse(372, 248, 19, 19), color: solid(0xffffff) },
		{ inside: ellipse(377, 253, 11, 11), color: solid(ink) },
		{ inside: capsule(362, 302, 378, 310, 7), color: solid(ink) },
		{ inside: capsule(378, 310, 394, 302, 7), color: solid(ink) },
		{ inside: ring(420, 150, 18, 7), color: solid(0xcdeeff) },
		{ inside: ring(448, 96, 11, 6), color: solid(0xcdeeff) },
	];
}
/**
 * Painter's algorithm over the layers. Pixels whose neighbours share their
 * topmost layer take one sample; only edge pixels are supersampled, which
 * keeps the build fast on a Raspberry Pi.
 */
export function renderIcon(size, maskable) {
	const stack = layers(maskable);
	const scale = SIZE / size;
	/** Maskable icons keep their content inside the central 80% safe zone. */
	const shrink = maskable ? 0.8 : 1;
	const topLayer = (x, y) => {
		if (stack[0]?.inside(x, y) !== true) return -1;
		const cx = (x - SIZE / 2) / shrink + SIZE / 2;
		const cy = (y - SIZE / 2) / shrink + SIZE / 2;
		for (let index = stack.length - 1; index > 0; index--) {
			if (stack[index]?.inside(cx, cy) === true) return index;
		}
		return 0;
	};
	const centers = new Int8Array(size * size);
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			centers[py * size + px] = topLayer(
				(px + 0.5) * scale,
				(py + 0.5) * scale,
			);
		}
	}
	const pixels = new Uint8Array(size * size * 4);
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const at = py * size + px;
			const center = centers[at] ?? -1;
			const edge =
				(px > 0 && centers[at - 1] !== center) ||
				(px < size - 1 && centers[at + 1] !== center) ||
				(py > 0 && centers[at - size] !== center) ||
				(py < size - 1 && centers[at + size] !== center);
			const samples = edge ? EDGE_SAMPLES : 1;
			let r = 0;
			let g = 0;
			let b = 0;
			let covered = 0;
			for (let sy = 0; sy < samples; sy++) {
				for (let sx = 0; sx < samples; sx++) {
					const x = (px + (sx + 0.5) / samples) * scale;
					const y = (py + (sy + 0.5) / samples) * scale;
					const layer = stack[edge ? topLayer(x, y) : center];
					if (layer === undefined) continue;
					const color = layer.color(y);
					r += color[0];
					g += color[1];
					b += color[2];
					covered++;
				}
			}
			const offset = at * 4;
			if (covered > 0) {
				pixels[offset] = Math.round(r / covered);
				pixels[offset + 1] = Math.round(g / covered);
				pixels[offset + 2] = Math.round(b / covered);
			}
			pixels[offset + 3] = Math.round((covered / (samples * samples)) * 255);
		}
	}
	return encodePng(size, size, pixels);
}
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes)
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let index = 0; index < 4; index++)
		out[4 + index] = type.charCodeAt(index);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}
function encodePng(width, height, rgba) {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let row = 0; row < height; row++) {
		raw.set(
			rgba.subarray(row * stride, (row + 1) * stride),
			row * (stride + 1) + 1,
		);
	}
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
		chunk("IEND", new Uint8Array(0)),
	];
	const out = new Uint8Array(
		parts.reduce((total, part) => total + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
const ICONS = {
	"icons/icon-192.png": { size: 192, maskable: false },
	"icons/icon-512.png": { size: 512, maskable: false },
	"icons/icon-maskable-512.png": { size: 512, maskable: true },
	"icons/apple-touch-icon.png": { size: 180, maskable: true },
};
/** Serves the icons in dev and emits them into `dist/icons` on build. */
export function terrariumIcons() {
	const cache = new Map();
	const icon = (name) => {
		const spec = ICONS[name];
		if (spec === undefined) return null;
		let png = cache.get(name);
		if (png === undefined) {
			png = renderIcon(spec.size, spec.maskable);
			cache.set(name, png);
		}
		return png;
	};
	return {
		name: "terrarium-icons",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const png = icon((request.url ?? "").split("?")[0]?.slice(1) ?? "");
				if (png === null) {
					next();
					return;
				}
				response.setHeader("content-type", "image/png");
				response.end(png);
			});
		},
		generateBundle() {
			for (const fileName of Object.keys(ICONS)) {
				const source = icon(fileName);
				if (source !== null) this.emitFile({ type: "asset", fileName, source });
			}
		},
	};
}
