class_name OfficeManifest
extends RefCounted

## The parts of assets/office-manifest.json the static office needs: the
## projection, the tile textures and every furniture frame a layout may place.

const SCHEMA_VERSION := 1

var projection: IsoProjection
var void_tile: int
var wall_tile: int
var wall_solid_height: int
var wall_glass_height: int
## Layout floor tile value → texture file.
var floor_files: Dictionary[int, String] = {}
## Carpet variant → marching-squares sheet file.
var carpet_files: Dictionary[int, String] = {}
var carpet_piece_size: Vector2i
var carpet_grid_columns: int
## Corner name (nw, ne, se, sw) → marching-squares bit.
var carpet_corner_bits: Dictionary[String, int] = {}
## Catalog id → FurnitureFrame.
var furniture: Dictionary[String, FurnitureFrame] = {}


class FurnitureFrame:
	var file: String
	var anchor: Vector2i
	var footprint: Vector2i
	var category: String
	var placement: String
	var orientation: String


## Null, with the reason logged, when the text is not a manifest this client reads.
static func parse(text: String) -> OfficeManifest:
	var document: Variant = JSON.parse_string(text)
	if not document is Dictionary:
		push_error("[Godot] office manifest is not a JSON object")
		return null
	var version := int(document.get("schemaVersion", -1))
	if version != SCHEMA_VERSION:
		push_error("[Godot] office manifest schemaVersion %d, this client reads %d" % [version, SCHEMA_VERSION])
		return null
	var manifest := OfficeManifest.new()
	manifest._read(document)
	return manifest


func _read(document: Dictionary) -> void:
	projection = IsoProjection.new(document.projection)
	var tiles: Dictionary = document.tiles
	void_tile = int(tiles.voidTile)
	wall_tile = int(tiles.wall.tile)
	wall_solid_height = int(tiles.wall.solidHeight)
	wall_glass_height = int(tiles.wall.glassHeight)
	for texture: Dictionary in tiles.floor.textures:
		floor_files[int(texture.tile)] = texture.file
	var carpet: Dictionary = tiles.carpet
	carpet_piece_size = Vector2i(int(carpet.pieceSize.width), int(carpet.pieceSize.height))
	carpet_grid_columns = int(carpet.grid.columns)
	for corner: String in carpet.cornerBits:
		carpet_corner_bits[corner] = int(carpet.cornerBits[corner])
	for texture: Dictionary in carpet.textures:
		carpet_files[int(texture.variant)] = texture.file
	for item: Dictionary in document.furniture:
		for variant: Dictionary in item.variants:
			for frame: Dictionary in variant.frames:
				var entry := FurnitureFrame.new()
				entry.file = frame.file
				entry.anchor = Vector2i(int(variant.anchor.x), int(variant.anchor.y))
				entry.footprint = Vector2i(int(variant.footprint.width), int(variant.footprint.depth))
				entry.category = item.category
				entry.placement = item.placement
				entry.orientation = variant.orientation if variant.orientation != null else ""
				furniture[frame.id] = entry
