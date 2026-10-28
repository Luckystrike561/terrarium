class_name OfficeLayout
extends RefCounted

## The layout object the server sends in layoutLoaded, read as the current
## client reads it, legacy migrations included.

const LAYOUT_VERSION := 1
## A layout without a revision used 8 for void before floor pattern 8 existed.
const LEGACY_VOID_TILE := 8
## Old furniture ids → manifest ids, or "" for an item with no equivalent.
const LEGACY_FURNITURE: Dictionary[String, String] = {
	"desk": "DESK_FRONT",
	"chair": "WOODEN_CHAIR_FRONT",
	"bookshelf": "BOOKSHELF",
	"plant": "PLANT",
	"cooler": "",
	"whiteboard": "WHITEBOARD",
	"pc": "PC_FRONT_OFF",
	"lamp": "",
}
## Colours for a layout saved before tileColors existed, by old tile value.
const LEGACY_TILE_COLORS: Dictionary[int, Dictionary] = {
	1: {"h": 35, "s": 30, "b": 15, "c": 0},
	2: {"h": 25, "s": 45, "b": 5, "c": 10},
	3: {"h": 280, "s": 40, "b": -5, "c": 0},
	4: {"h": 35, "s": 25, "b": 10, "c": 0},
}
const NEUTRAL_COLOR := {"h": 0, "s": 0, "b": 0, "c": 0}

var cols: int
var rows: int
var tiles: PackedInt32Array
## Per tile: a colour value, or null.
var tile_colors: Array = []
## Per tile: a carpet {variant, color?, accentColor?, order?}, or null.
var carpet_tiles: Array = []
var furniture: Array[PlacedFurniture] = []


class PlacedFurniture:
	var type: String
	var col: int
	var row: int
	## A colour value, or empty for the sprite as drawn.
	var color: Dictionary


## Null, with the reason logged, for anything but a well-formed version 1 layout.
static func parse(document: Dictionary, manifest: OfficeManifest) -> OfficeLayout:
	if int(document.get("version", 0)) != LAYOUT_VERSION:
		push_error("[Godot] layout version %s, this client reads %d" % [document.get("version"), LAYOUT_VERSION])
		return null
	var cols: Variant = document.get("cols")
	var rows: Variant = document.get("rows")
	if not (cols is float and rows is float):
		push_error("[Godot] layout cols %s and rows %s, both must be numbers" % [cols, rows])
		return null
	var tiles: Variant = document.get("tiles")
	if not tiles is Array:
		push_error("[Godot] layout tiles %s, must be an array" % [tiles])
		return null
	var furniture: Variant = document.get("furniture")
	if not furniture is Array:
		push_error("[Godot] layout furniture %s, must be an array" % [furniture])
		return null
	if tiles.size() != int(cols) * int(rows):
		push_error("[Godot] layout has %d tiles for %d × %d" % [tiles.size(), cols, rows])
		return null
	for index in furniture.size():
		var item: Variant = furniture[index]
		if not (item is Dictionary and item.get("type") is String and item.get("col") is float and item.get("row") is float):
			push_error("[Godot] layout furniture[%d] %s needs a string type and numeric col and row" % [index, item])
			return null
	var layout := OfficeLayout.new()
	layout._read(document, manifest)
	return layout


func _read(document: Dictionary, manifest: OfficeManifest) -> void:
	cols = int(document.cols)
	rows = int(document.rows)
	var is_legacy: bool = document.get("layoutRevision") == null or document.layoutRevision == 0
	for value: Variant in document.tiles:
		var tile := int(value)
		tiles.append(manifest.void_tile if is_legacy and tile == LEGACY_VOID_TILE else tile)
	var colors: Variant = document.get("tileColors")
	if colors is Array and colors.size() == tiles.size():
		tile_colors = colors
	else:
		tile_colors = _legacy_tile_colors(manifest)
	var carpets: Variant = document.get("carpetTiles")
	if carpets is Array:
		carpet_tiles = carpets
	for item: Dictionary in document.furniture:
		var type: String = LEGACY_FURNITURE.get(item.type, item.type)
		if type.is_empty():
			continue
		var placed := PlacedFurniture.new()
		placed.type = type
		placed.col = int(item.col)
		placed.row = int(item.row)
		placed.color = item.color if item.get("color") is Dictionary else {}
		furniture.append(placed)


func _legacy_tile_colors(manifest: OfficeManifest) -> Array:
	var colors := []
	for tile in tiles:
		if tile == manifest.wall_tile:
			colors.append(null)
		elif LEGACY_TILE_COLORS.has(tile):
			colors.append(LEGACY_TILE_COLORS[tile])
		elif tile > 0 and tile != manifest.void_tile:
			colors.append(NEUTRAL_COLOR)
		else:
			colors.append(null)
	return colors


func tile_color(col: int, row: int) -> Variant:
	return tile_colors[row * cols + col]


func carpet(col: int, row: int) -> Variant:
	var index := row * cols + col
	return carpet_tiles[index] if index < carpet_tiles.size() else null
