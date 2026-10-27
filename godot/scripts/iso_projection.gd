class_name IsoProjection
extends RefCounted

## The office manifest's 2:1 projection. The layout stays on the top-down tile
## grid, and only drawing goes through iso pixels: isoX = x - y,
## isoY = (x + y) / 2, with x and y in world px along +col and +row.

var tile_size: int
var iso_tile_size: Vector2i


func _init(projection: Dictionary) -> void:
	tile_size = int(projection.tileSize)
	iso_tile_size = Vector2i(int(projection.isoTileWidth), int(projection.isoTileHeight))


## Iso position of the top vertex of tile (col, row).
func tile_corner(col: float, row: float) -> Vector2:
	return Vector2((col - row) * tile_size, (col + row) * tile_size / 2.0)


## Square top-down texture → the iso diamond of a tile, nearest sampled,
## twice as wide as the texture is tall.
static func project_to_diamond(square: Image) -> Image:
	var size := square.get_height()
	var width := size * 2
	var diamond := Image.create_empty(width, size, false, Image.FORMAT_RGBA8)
	for y in size:
		for x in width:
			var u := x + 0.5 - size
			var v := y + 0.5
			var source_x := floori(v + u / 2)
			var source_y := floori(v - u / 2)
			if source_x >= 0 and source_y >= 0 and source_x < size and source_y < size:
				diamond.set_pixel(x, y, square.get_pixel(source_x, source_y))
	return diamond
