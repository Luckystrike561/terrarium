class_name IsoGrid
extends Node2D

# The office manifest's projection: a tile is a 32 x 16 diamond (2:1 dimetric).
const ISO_TILE_SIZE := Vector2(32, 16)
const COLUMNS := 20
const ROWS := 20
const LINE_COLOR := Color(0.329412, 0.364706, 0.443137, 1)


func _draw() -> void:
	for col in COLUMNS + 1:
		draw_line(project(col, 0), project(col, ROWS), LINE_COLOR)
	for row in ROWS + 1:
		draw_line(project(0, row), project(COLUMNS, row), LINE_COLOR)


func project(col: float, row: float) -> Vector2:
	return Vector2((col - row) * ISO_TILE_SIZE.x / 2, (col + row) * ISO_TILE_SIZE.y / 2)


func center() -> Vector2:
	return project(COLUMNS / 2.0, ROWS / 2.0)
