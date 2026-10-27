class_name TileGrid
extends RefCounted

## The layout's tile values on its cols × rows grid.

var cols: int
var rows: int
var _tiles: PackedInt32Array
var _wall_tile: int
var _void_tile: int


func _init(layout: OfficeLayout, manifest: OfficeManifest) -> void:
	cols = layout.cols
	rows = layout.rows
	_tiles = layout.tiles
	_wall_tile = manifest.wall_tile
	_void_tile = manifest.void_tile


func at(col: int, row: int) -> int:
	return _tiles[row * cols + col]


func contains(col: int, row: int) -> bool:
	return col >= 0 and row >= 0 and col < cols and row < rows


func is_wall(col: int, row: int) -> bool:
	return contains(col, row) and at(col, row) == _wall_tile


func is_void(col: int, row: int) -> bool:
	return contains(col, row) and at(col, row) == _void_tile


## Void or off the grid: where the office floor ends.
func is_open(col: int, row: int) -> bool:
	return not contains(col, row) or at(col, row) == _void_tile


func is_back_wall(col: int, row: int) -> bool:
	return is_open(col, row - 1) or is_open(col - 1, row)


## Tile rectangle of the non-void tiles, the whole grid when every tile is
## void. The end corner is exclusive.
func content_bounds() -> Rect2i:
	var start := Vector2i(cols, rows)
	var end := Vector2i.ZERO
	for row in rows:
		for col in cols:
			if at(col, row) == _void_tile:
				continue
			start = start.min(Vector2i(col, row))
			end = end.max(Vector2i(col + 1, row + 1))
	if end == Vector2i.ZERO:
		return Rect2i(0, 0, cols, rows)
	return Rect2i(start, end - start)
