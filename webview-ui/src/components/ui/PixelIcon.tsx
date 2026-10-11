interface PixelIconProps {
  /** Bitmap rows, `#` = filled pixel. All rows share one width. */
  rows: readonly string[];
  /** CSS pixels per bitmap pixel. */
  scale?: number;
}

export function PixelIcon({ rows, scale = 2 }: PixelIconProps) {
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  return (
    <svg
      aria-hidden
      width={width * scale}
      height={height * scale}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      className="shrink-0"
    >
      {rows.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === '#' ? <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  );
}
