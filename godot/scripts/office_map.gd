class_name OfficeMap
extends Node2D

## One floor of the office in iso pixels, the top vertex of tile (0, 0) at
## the origin: the floor slab, floor tiles, carpets, then walls and furniture
## in iso draw order.

const FLOOR_SLAB_PX := 5
## Exposed slab faces: left is the +row face, right the +col face.
const FLOOR_SLAB_LEFT_COLOR := Color8(0x4a, 0x3f, 0x5c)
const FLOOR_SLAB_RIGHT_COLOR := Color8(0x36, 0x2d, 0x45)
## A floor tile value the manifest has no texture for.
const ERROR_TILE_COLOR := Color8(0xff, 0x00, 0xff)

## The rectangle the camera fits: the non-void tiles, raised by a back wall's height.
var view_rect: Rect2
## The whole grid, raised the same way. The camera centres this at zero pan.
var grid_rect: Rect2

var _manifest: OfficeManifest
var _projection: IsoProjection
var _textures: Dictionary[Image, ImageTexture] = {}


## Every sheet the layout draws, for OfficeAssets to fetch.
static func required_files(layout: OfficeLayout, manifest: OfficeManifest) -> PackedStringArray:
	var files := {}
	for tile in layout.tiles:
		if manifest.floor_files.has(tile):
			files[manifest.floor_files[tile]] = true
	for carpet: Variant in layout.carpet_tiles:
		if carpet is Dictionary and manifest.carpet_files.has(int(carpet.variant)):
			files[manifest.carpet_files[int(carpet.variant)]] = true
	for item in layout.furniture:
		if manifest.furniture.has(item.type):
			files[manifest.furniture[item.type].file] = true
	return PackedStringArray(files.keys())


func build(layout: OfficeLayout, manifest: OfficeManifest, images: Dictionary[String, Image]) -> void:
	_manifest = manifest
	_projection = manifest.projection
	var tiles := TileGrid.new(layout, manifest)
	grid_rect = _bounds_rect(Rect2i(0, 0, tiles.cols, tiles.rows))
	view_rect = _bounds_rect(tiles.content_bounds())
	_add_slab(tiles)
	_add_floor(layout, tiles, images)
	_add_carpets(layout, images)
	_add_walls_and_furniture(layout, tiles, images)


## Screen box of a tile rectangle: its diamond, raised by a back wall's height.
func _bounds_rect(tiles: Rect2i) -> Rect2:
	var top := _projection.tile_corner(tiles.position.x, tiles.position.y)
	var right := _projection.tile_corner(tiles.end.x, tiles.position.y)
	var bottom := _projection.tile_corner(tiles.end.x, tiles.end.y)
	var left := _projection.tile_corner(tiles.position.x, tiles.end.y)
	var start := Vector2(left.x, top.y - _manifest.wall_solid_height)
	return Rect2(start, Vector2(right.x, bottom.y) - start)


func _add_slab(tiles: TileGrid) -> void:
	var slab := Node2D.new()
	slab.name = "Slab"
	var depth := Vector2(0, FLOOR_SLAB_PX)
	slab.draw.connect(func() -> void:
		for row in tiles.rows:
			for col in tiles.cols:
				if tiles.is_void(col, row):
					continue
				var left := _projection.tile_corner(col, row + 1)
				var bottom := _projection.tile_corner(col + 1, row + 1)
				var right := _projection.tile_corner(col + 1, row)
				if tiles.is_open(col, row + 1):
					slab.draw_colored_polygon([left, bottom, bottom + depth, left + depth], FLOOR_SLAB_LEFT_COLOR)
				if tiles.is_open(col + 1, row):
					slab.draw_colored_polygon([bottom, right, right + depth, bottom + depth], FLOOR_SLAB_RIGHT_COLOR))
	add_child(slab)


func _add_floor(layout: OfficeLayout, tiles: TileGrid, images: Dictionary[String, Image]) -> void:
	var cells: Dictionary[Vector2i, Image] = {}
	var diamonds: Dictionary[String, Image] = {}
	for row in tiles.rows:
		for col in tiles.cols:
			var tile := tiles.at(col, row)
			if tile == _manifest.void_tile or tile == _manifest.wall_tile:
				continue
			var color: Variant = layout.tile_color(col, row)
			if not color is Dictionary:
				color = OfficeLayout.NEUTRAL_COLOR
			var key := "%d:%s:%s:%s:%s" % [tile, color.h, color.s, color.b, color.c]
			if not diamonds.has(key):
				diamonds[key] = _floor_diamond(tile, color, images)
			cells[Vector2i(col, row)] = diamonds[key]
	add_child(_tile_layer("Floor", cells, Vector2.ZERO))


func _floor_diamond(tile: int, color: Dictionary, images: Dictionary[String, Image]) -> Image:
	var file: String = _manifest.floor_files.get(tile, "")
	var square: Image = images.get(file)
	if square == null:
		square = Image.create_empty(_projection.tile_size, _projection.tile_size, false, Image.FORMAT_RGBA8)
		square.fill(ERROR_TILE_COLOR)
	else:
		square = Colorize.colorize(square, color)
	return IsoProjection.project_to_diamond(square)


func _add_carpets(layout: OfficeLayout, images: Dictionary[String, Image]) -> void:
	var sheets: Dictionary[int, Image] = {}
	for variant in _manifest.carpet_files:
		if images.has(_manifest.carpet_files[variant]):
			sheets[variant] = images[_manifest.carpet_files[variant]]
	var stacks: Array[Dictionary] = []
	for junction in CarpetSprites.new(_manifest, sheets).junctions(layout):
		while stacks.size() <= junction.stack:
			stacks.append({})
		stacks[junction.stack][Vector2i(junction.col, junction.row)] = junction.image
	# A carpet piece is centred on its tile corner, half a tile above a floor tile's diamond.
	var corner_offset := Vector2(0, -_projection.iso_tile_size.y / 2.0)
	for stack in stacks.size():
		var cells: Dictionary[Vector2i, Image] = {}
		cells.assign(stacks[stack])
		add_child(_tile_layer("Carpet%d" % stack, cells, corner_offset))


## A tile layer drawing each cell's diamond with its top-left on the tile's
## top vertex minus half a tile, plus `offset`, as the current client places
## floor tiles.
func _tile_layer(layer_name: String, cells: Dictionary[Vector2i, Image], offset: Vector2) -> TileMapLayer:
	var atlas_index: Dictionary[Image, int] = {}
	for image in cells.values():
		if not atlas_index.has(image):
			atlas_index[image] = atlas_index.size()
	var size := _projection.iso_tile_size
	var count := maxi(1, atlas_index.size())
	var columns := ceili(sqrt(count))
	var atlas := Image.create_empty(columns * size.x, ceili(float(count) / columns) * size.y, false, Image.FORMAT_RGBA8)
	var atlas_coords: Dictionary[Image, Vector2i] = {}
	for image in atlas_index:
		var index := atlas_index[image]
		atlas_coords[image] = Vector2i(index % columns, index / columns)
		atlas.blit_rect(image, Rect2i(Vector2i.ZERO, size), atlas_coords[image] * size)
	var source := TileSetAtlasSource.new()
	source.texture = ImageTexture.create_from_image(atlas)
	source.texture_region_size = size
	# Padding reads the atlas back from the GPU (a ReadPixels stall in the browser), and
	# nearest sampling at whole zooms never samples a neighbouring tile anyway.
	source.use_texture_padding = false
	for coords in atlas_coords.values():
		source.create_tile(coords)
	var tile_set := TileSet.new()
	tile_set.tile_shape = TileSet.TILE_SHAPE_ISOMETRIC
	tile_set.tile_layout = TileSet.TILE_LAYOUT_DIAMOND_DOWN
	tile_set.tile_size = size
	var source_id := tile_set.add_source(source)
	var layer := TileMapLayer.new()
	layer.name = layer_name
	layer.tile_set = tile_set
	for cell in cells:
		layer.set_cell(cell, source_id, atlas_coords[cells[cell]])
	# Godot centres a tile's texture on map_to_local, which sits half a tile
	# right of and below the diamond's top-left here.
	var top_left := _projection.tile_corner(0, 0) - Vector2(size.x / 2.0, 0) + offset
	layer.position = top_left - (layer.map_to_local(Vector2i.ZERO) - Vector2(size) / 2)
	return layer


func _add_walls_and_furniture(layout: OfficeLayout, tiles: TileGrid, images: Dictionary[String, Image]) -> void:
	var sprites: Array[Sprite2D] = []
	var boxes: Array[IsoSort.SortBox] = []
	var walls := WallSprites.new(_manifest)
	var recoloured: Dictionary[String, Image] = {}
	for row in tiles.rows:
		for col in tiles.cols:
			if not tiles.is_wall(col, row):
				continue
			var color: Variant = layout.tile_color(col, row)
			var base := Colorize.flat_color(color) if color is Dictionary else WallSprites.DEFAULT_WALL_COLOR
			var top := _projection.tile_corner(col, row)
			var offset := Vector2(_projection.iso_tile_size.x / 2.0, walls.height(tiles, col, row))
			sprites.append(_sprite("Wall%d_%d" % [col, row], walls.sprite(tiles, col, row, base), top - offset))
			boxes.append(IsoSort.SortBox.new(Vector2(col, row), Vector2(col + 1, row + 1), IsoSort.Layer.FLOOR))
	for item in layout.furniture:
		var frame: OfficeManifest.FurnitureFrame = _manifest.furniture.get(item.type)
		if frame == null:
			push_warning("[Godot] the office manifest has no furniture %s" % item.type)
			continue
		var image: Image = images.get(frame.file)
		if image == null:
			continue
		if not item.color.is_empty():
			var color := item.color
			var key := "%s:%s:%s:%s:%s:%s" % [item.type, color.h, color.s, color.b, color.c, color.get("colorize", false)]
			if not recoloured.has(key):
				recoloured[key] = Colorize.apply(image, color)
			image = recoloured[key]
		var origin := _projection.tile_corner(item.col, item.row) - Vector2(frame.anchor)
		sprites.append(_sprite(item.type, image, origin))
		var start := Vector2(item.col, item.row)
		boxes.append(IsoSort.SortBox.new(start, start + Vector2(frame.footprint), _furniture_layer(frame)))
	var entities := Node2D.new()
	entities.name = "Entities"
	for index in IsoSort.draw_order(boxes):
		entities.add_child(sprites[index], true)
	add_child(entities)


## Surface and wall items draw over what they stand on. A chair whose sitter
## faces away covers that sitter with its backrest. Other chairs draw under.
static func _furniture_layer(frame: OfficeManifest.FurnitureFrame) -> IsoSort.Layer:
	if frame.category == "chairs":
		var faces_away := frame.orientation == "back" or frame.orientation == "left"
		return IsoSort.Layer.ATTACHED if faces_away else IsoSort.Layer.FLOOR
	if frame.placement == "surface" or frame.placement == "wall":
		return IsoSort.Layer.ATTACHED
	return IsoSort.Layer.FLOOR


func _sprite(sprite_name: String, image: Image, top_left: Vector2) -> Sprite2D:
	if not _textures.has(image):
		_textures[image] = ImageTexture.create_from_image(image)
	var sprite := Sprite2D.new()
	sprite.name = sprite_name
	sprite.texture = _textures[image]
	sprite.centered = false
	sprite.position = top_left
	return sprite
