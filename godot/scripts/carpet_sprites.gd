class_name CarpetSprites
extends RefCounted

## Marching-squares carpets coloured in two tones, as the current client
## draws them. Each sheet's darkest colour takes the carpet's main colour and
## its brightest the accent colour.

const DEFAULT_COLOR := {"h": 0, "s": 71, "b": -32, "c": 0, "colorize": true}
const DEFAULT_ACCENT_COLOR := {"h": 34, "s": 64, "b": 21, "c": 0, "colorize": true}

var _manifest: OfficeManifest
## Variant → its 16 pieces, indexed by marching-squares case.
var _pieces: Dictionary[int, Array] = {}
## Variant → [main RGB, accent RGB] of its sheet.
var _palettes: Dictionary[int, Array] = {}
var _cache: Dictionary[String, Image] = {}


## One carpet piece to draw, centred on the tile corner (col, row).
class Junction:
	var col: int
	var row: int
	## Draw order among the pieces at one corner.
	var stack: int
	var image: Image


func _init(manifest: OfficeManifest, sheets: Dictionary[int, Image]) -> void:
	_manifest = manifest
	var size := manifest.carpet_piece_size
	for variant in sheets:
		var sheet := sheets[variant]
		var pieces: Array[Image] = []
		var piece_count := manifest.carpet_grid_columns * (sheet.get_height() / size.y)
		for piece in piece_count:
			var origin := Vector2i(piece % manifest.carpet_grid_columns, piece / manifest.carpet_grid_columns) * size
			pieces.append(sheet.get_region(Rect2i(origin, size)))
		_pieces[variant] = pieces
		_palettes[variant] = _classify(pieces)


## Every carpet piece of the layout, corner by corner, lowest order first at each corner.
func junctions(layout: OfficeLayout) -> Array[Junction]:
	var result: Array[Junction] = []
	if layout.carpet_tiles.is_empty():
		return result
	for row in layout.rows + 1:
		for col in layout.cols + 1:
			var stack := 0
			for group in _groups_at(layout, col, row):
				var image := _piece(layout, col, row, group)
				if image == null:
					continue
				var junction := Junction.new()
				junction.col = col
				junction.row = row
				junction.stack = stack
				junction.image = image
				result.append(junction)
				stack += 1
	return result


## The carpets around one corner, one per (variant, palette), the highest
## order of each, sorted by order.
func _groups_at(layout: OfficeLayout, col: int, row: int) -> Array[Dictionary]:
	var groups: Dictionary[String, Dictionary] = {}
	for offset: Vector2i in [Vector2i(-1, -1), Vector2i(0, -1), Vector2i(0, 0), Vector2i(-1, 0)]:
		var tile := Vector2i(col, row) + offset
		if tile.x < 0 or tile.y < 0 or tile.x >= layout.cols or tile.y >= layout.rows:
			continue
		var carpet: Variant = layout.carpet(tile.x, tile.y)
		if not carpet is Dictionary:
			continue
		var group := _group(carpet)
		var key := _group_key(group)
		if not groups.has(key) or group.order > groups[key].order:
			groups[key] = group
	var ordered: Array[Dictionary] = []
	ordered.assign(groups.values())
	var first_seen := groups.keys()
	# Godot's sort is not stable, and equal orders keep the order their keys were first seen in.
	ordered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a.order != b.order:
			return a.order < b.order
		return first_seen.find(_group_key(a)) < first_seen.find(_group_key(b)))
	return ordered


static func _group_key(group: Dictionary) -> String:
	return "%d:%s" % [group.variant, group.palette]


static func _group(carpet: Dictionary) -> Dictionary:
	var color: Dictionary = carpet.color if carpet.get("color") is Dictionary else DEFAULT_COLOR
	var accent: Dictionary = carpet.accentColor if carpet.get("accentColor") is Dictionary else DEFAULT_ACCENT_COLOR
	return {
		"variant": int(carpet.variant),
		"color": color,
		"accent": accent,
		"palette": _palette_key(color, accent),
		"order": 0.0 if carpet.get("order") == null else float(carpet.order),
	}


func _piece(layout: OfficeLayout, col: int, row: int, group: Dictionary) -> Image:
	var variant: int = group.variant
	if not _pieces.has(variant):
		return null
	var bits := _manifest.carpet_corner_bits
	var piece := 0
	if _has_carpet(layout, col - 1, row - 1, group):
		piece |= bits.nw
	if _has_carpet(layout, col, row - 1, group):
		piece |= bits.ne
	if _has_carpet(layout, col, row, group):
		piece |= bits.se
	if _has_carpet(layout, col - 1, row, group):
		piece |= bits.sw
	var pieces: Array = _pieces[variant]
	var palette: Array = _palettes[variant]
	if piece == 0 or piece >= pieces.size() or palette[0] == null:
		return null
	var key := "%d:%d:%s" % [variant, piece, group.palette]
	if not _cache.has(key):
		var main := Colorize.flat_colorize(_mask(pieces[piece], palette[0]), group.color)
		var accent := Colorize.flat_colorize(_mask(pieces[piece], palette[1]), group.accent)
		_cache[key] = IsoProjection.project_to_diamond(_merge(main, accent))
	return _cache[key]


static func _has_carpet(layout: OfficeLayout, col: int, row: int, group: Dictionary) -> bool:
	if col < 0 or row < 0 or col >= layout.cols or row >= layout.rows:
		return false
	var carpet: Variant = layout.carpet(col, row)
	if not carpet is Dictionary or int(carpet.variant) != group.variant:
		return false
	return _group(carpet).palette == group.palette


static func _palette_key(color: Dictionary, accent: Dictionary) -> String:
	return "%s#%s" % [_color_key(color), _color_key(accent)]


static func _color_key(color: Dictionary) -> String:
	return "%s|%s|%s|%s|%d" % [color.h, color.s, color.b, color.c, 1 if color.get("colorize", false) else 0]


## [darkest, brightest] distinct RGB of a sheet by Rec. 601 luminance. Of
## equal luminances the first seen is darkest and the last first seen brightest.
static func _classify(pieces: Array[Image]) -> Array:
	var luminances: Dictionary[Color, float] = {}
	for piece in pieces:
		for y in piece.get_height():
			for x in piece.get_width():
				var pixel := piece.get_pixel(x, y)
				var rgb := Color8(pixel.r8, pixel.g8, pixel.b8)
				if pixel.a8 != 0 and not luminances.has(rgb):
					luminances[rgb] = 0.299 * pixel.r8 + 0.587 * pixel.g8 + 0.114 * pixel.b8
	var darkest: Variant = null
	var brightest: Variant = null
	for rgb in luminances:
		if darkest == null or luminances[rgb] < luminances[darkest]:
			darkest = rgb
		if brightest == null or luminances[rgb] >= luminances[brightest]:
			brightest = rgb
	return [darkest, brightest]


static func _mask(piece: Image, rgb: Color) -> Image:
	var masked := Image.create_empty(piece.get_width(), piece.get_height(), false, Image.FORMAT_RGBA8)
	for y in piece.get_height():
		for x in piece.get_width():
			var pixel := piece.get_pixel(x, y)
			if pixel.a8 != 0 and Color8(pixel.r8, pixel.g8, pixel.b8) == rgb:
				masked.set_pixel(x, y, pixel)
	return masked


static func _merge(base: Image, accent: Image) -> Image:
	var merged := base.duplicate() as Image
	for y in accent.get_height():
		for x in accent.get_width():
			var pixel := accent.get_pixel(x, y)
			if pixel.a8 != 0:
				merged.set_pixel(x, y, pixel)
	return merged
