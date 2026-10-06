export type Rect = { x: number; y: number; w: number; h: number };

export type ZoneLayout = Rect & { host: string; deep: boolean };

/** The deep bottom layer of the tank. */
export const DEEP_HOST = "server";
const LEFT_TO_RIGHT = ["laptop-a", "laptop-b"];
/** Shown before the first snapshot says which hosts exist. */
export const DEFAULT_HOSTS = [...LEFT_TO_RIGHT, DEEP_HOST];

const GAP = 6;
const DEEP_SHARE = 0.38;

/** Laptops side by side on top (laptop-a left, laptop-b right, others after), the server along the bottom. */
export function layoutZones(
	hosts: readonly string[],
	width: number,
	height: number,
): ZoneLayout[] {
	const rank = (host: string): number => {
		const index = LEFT_TO_RIGHT.indexOf(host);
		return index < 0 ? LEFT_TO_RIGHT.length : index;
	};
	const top = hosts
		.filter((host) => host !== DEEP_HOST)
		.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
	const hasDeep = hosts.includes(DEEP_HOST);
	const deepHeight = hasDeep
		? top.length === 0
			? height
			: Math.round(height * DEEP_SHARE)
		: 0;
	const topHeight = height - deepHeight - (hasDeep && top.length > 0 ? GAP : 0);
	const zones: ZoneLayout[] = [];
	const columnWidth =
		(width - GAP * (top.length - 1)) / Math.max(1, top.length);
	top.forEach((host, index) => {
		zones.push({
			host,
			deep: false,
			x: Math.round(index * (columnWidth + GAP)),
			y: 0,
			w: Math.round(columnWidth),
			h: topHeight,
		});
	});
	if (hasDeep) {
		zones.push({
			host: DEEP_HOST,
			deep: true,
			x: 0,
			y: height - deepHeight,
			w: width,
			h: deepHeight,
		});
	}
	return zones;
}

export type Slots = { centers: { x: number; y: number }[]; radius: number };

/** Space reserved at the top of a zone for its label, and at the bottom for sand. */
export const ZONE_HEADER = 0.16;
export const ZONE_FLOOR = 0.12;
const MAX_RADIUS = 46;
const MIN_RADIUS = 12;

/** Home positions for a zone's top-level creatures, in a grid filling the open water. */
export function layoutSlots(zone: Rect, count: number): Slots {
	const inner = {
		x: zone.x + zone.w * 0.06,
		y: zone.y + zone.h * ZONE_HEADER,
		w: zone.w * 0.88,
		h: zone.h * (1 - ZONE_HEADER - ZONE_FLOOR),
	};
	if (count === 0) return { centers: [], radius: MAX_RADIUS };
	const columns = Math.max(
		1,
		Math.min(count, Math.round(Math.sqrt((count * inner.w) / inner.h))),
	);
	const rows = Math.ceil(count / columns);
	const cellW = inner.w / columns;
	const cellH = inner.h / rows;
	const radius = Math.max(
		MIN_RADIUS,
		Math.min(MAX_RADIUS, cellW * 0.2, cellH * 0.26, zone.h * 0.11),
	);
	const centers: { x: number; y: number }[] = [];
	for (let index = 0; index < count; index++) {
		const row = Math.floor(index / columns);
		const inRow = row === rows - 1 ? count - row * columns : columns;
		const offset = (columns - inRow) / 2;
		centers.push({
			x: inner.x + (offset + (index % columns) + 0.5) * cellW,
			y: inner.y + (row + 0.5) * cellH,
		});
	}
	return { centers, radius };
}
