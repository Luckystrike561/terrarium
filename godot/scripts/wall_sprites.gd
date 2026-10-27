class_name WallSprites
extends RefCounted

## Wall tiles, traced the way the current client traces them. A wall whose
## -row or -col neighbour is void or off the grid is a solid back wall in its
## tile colour. Every other wall is a glass partition along its run, so the
## room behind it stays visible.

const DEFAULT_WALL_COLOR := Color8(0xd9, 0xc4, 0xa0)
const GLASS_FRAME_COLOR := Color8(0x1a, 0x14, 0x26)
const GLASS_PANE_COLOR := Color8(0xbf, 0xe3, 0xf0, 0x4d)
const GLASS_SHEEN_COLOR := Color8(0xff, 0xff, 0xff, 0x8c)

const CAP_SHADE := 1.18
const RIM_SHADE := 1.34
## Rim light band at the top face's front edges, in world px.
const RIM_WIDTH := 1.0
const LEFT_FACE_SHADE := 0.95
const RIGHT_FACE_SHADE := 0.78
## Plaster texture: quiet value noise, at most one light band either way.
const PLASTER_NOISE_AMOUNT := 0.05
const BASEBOARD_SHADE := 0.55
const BASEBOARD_PX := 3.0
const GLASS_FRAME_LEFT_SHADE := 1.25
## Glass pane half thickness and frame sizes, in world px.
const PANE_HALF := 1.0
const FRAME_BASE := 3.0
const FRAME_TOP := 2.0
const MULLION := 1.0
## The diagonal sheen stripe across a pane: its period, slant and width.
const SHEEN_PERIOD := 14.0
const SHEEN_SLANT := 0.6
const SHEEN_WIDTH := 2.0

enum Face { TOP, LEFT, RIGHT }

var _iso_tile_size: Vector2i
var _tile: float
var _solid_height: int
var _glass_height: int
var _cache: Dictionary[String, Image] = {}


class Box:
	var low: PackedFloat64Array
	var high: PackedFloat64Array
	var paint: Callable

	func _init(box_low: PackedFloat64Array, box_high: PackedFloat64Array, box_paint: Callable) -> void:
		low = box_low
		high = box_high
		paint = box_paint


func _init(manifest: OfficeManifest) -> void:
	_iso_tile_size = manifest.projection.iso_tile_size
	_tile = manifest.projection.tile_size
	_solid_height = manifest.wall_solid_height
	_glass_height = manifest.wall_glass_height


## The wall tile's sprite, drawn with its top-left at the tile's top vertex
## minus (half a tile, the sprite's height above the floor).
func sprite(tiles: TileGrid, col: int, row: int, base_color: Color) -> Image:
	if tiles.is_back_wall(col, row):
		var solid_key := "solid:" + base_color.to_html(false)
		if not _cache.has(solid_key):
			_cache[solid_key] = _solid(base_color)
		return _cache[solid_key]
	var along_cols := tiles.is_wall(col - 1, row) or tiles.is_wall(col + 1, row)
	var along_rows := tiles.is_wall(col, row - 1) or tiles.is_wall(col, row + 1)
	var glass_key := "glass:%s%s" % [along_cols, along_rows]
	if not _cache.has(glass_key):
		_cache[glass_key] = _glass(along_cols, along_rows)
	return _cache[glass_key]


func height(tiles: TileGrid, col: int, row: int) -> int:
	return _solid_height if tiles.is_back_wall(col, row) else _glass_height


func _solid(base: Color) -> Image:
	var cap := _shade(base, CAP_SHADE)
	var rim := _shade(base, RIM_SHADE)
	var left := _shade(base, LEFT_FACE_SHADE)
	var right := _shade(base, RIGHT_FACE_SHADE)
	var left_base := _shade(base, BASEBOARD_SHADE)
	var right_base := _shade(base, BASEBOARD_SHADE * RIGHT_FACE_SHADE)
	var paint := func(face: Face, along: float, z: float) -> Color:
		if face == Face.TOP:
			return rim if along < RIM_WIDTH else cap
		if z < BASEBOARD_PX:
			return right_base if face == Face.RIGHT else left_base
		var plaster := (_hash3(along, z, 2 if face == Face.RIGHT else 1) - 0.5) * 2 * PLASTER_NOISE_AMOUNT
		return _shade(right if face == Face.RIGHT else left, 1 + plaster)
	return _trace([Box.new([0, 0, 0], [_tile, _tile, _solid_height], paint)], _solid_height)


func _glass(along_cols: bool, along_rows: bool) -> Image:
	var low := _tile / 2 - PANE_HALF
	var high := _tile / 2 + PANE_HALF
	var boxes: Array[Box] = []
	if along_cols or not along_rows:
		boxes.append(Box.new([0, low, 0], [_tile, high, _glass_height], _glass_paint(_tile)))
	if along_rows:
		boxes.append(Box.new([low, 0, 0], [high, _tile, _glass_height], _glass_paint(_tile)))
	return _trace(boxes, _glass_height)


func _glass_paint(length: float) -> Callable:
	var frame_left := _shade(GLASS_FRAME_COLOR, GLASS_FRAME_LEFT_SHADE)
	var glass_height := float(_glass_height)
	return func(face: Face, along: float, z: float) -> Color:
		if face == Face.TOP:
			return frame_left
		var frame := frame_left if face == Face.LEFT else GLASS_FRAME_COLOR
		if z < FRAME_BASE or z > glass_height - FRAME_TOP:
			return frame
		if along < MULLION or along > length - MULLION:
			return frame
		var stripe := fmod(along + z * SHEEN_SLANT, SHEEN_PERIOD)
		return GLASS_SHEEN_COLOR if stripe < SHEEN_WIDTH else GLASS_PANE_COLOR


## Traces each pixel along the view ray (1, 1, 1) against tile-local boxes
## and keeps the hit nearest the viewer.
func _trace(boxes: Array[Box], wall_height: int) -> Image:
	var width := _iso_tile_size.x
	var image := Image.create_empty(width, _iso_tile_size.y + wall_height, false, Image.FORMAT_RGBA8)
	for y in image.get_height():
		for x in width:
			var u := x + 0.5 - _tile
			var v := y + 0.5 - wall_height
			var ground_x := v + u / 2
			var ground_y := v - u / 2
			var best := -INF
			var color := Color(0, 0, 0, 0)
			for box in boxes:
				var exit_x := box.high[0] - ground_x
				var exit_y := box.high[1] - ground_y
				var exit := minf(minf(exit_x, exit_y), box.high[2])
				var enter := maxf(maxf(box.low[0] - ground_x, box.low[1] - ground_y), box.low[2])
				if enter > exit or exit <= best:
					continue
				best = exit
				if exit == box.high[2]:
					color = box.paint.call(Face.TOP, minf(exit_x, exit_y) - exit, exit)
				elif exit_x <= exit_y:
					color = box.paint.call(Face.RIGHT, ground_y + exit - box.low[1], exit)
				else:
					color = box.paint.call(Face.LEFT, ground_x + exit - box.low[0], exit)
			image.set_pixel(x, y, color)
	return image


## Scales a colour toward black (amount < 1) or toward white (> 1), keeping alpha.
static func _shade(color: Color, amount: float) -> Color:
	return Color8(_shade_channel(color.r8, amount), _shade_channel(color.g8, amount), _shade_channel(color.b8, amount), color.a8)


static func _shade_channel(value: int, amount: float) -> int:
	var shaded := value * amount if amount <= 1 else value + (255 - value) * (amount - 1)
	return clampi(floori(shaded + 0.5), 0, 255)


## Deterministic hash in [0, 1) with 32-bit integer arithmetic, the formula
## the current client and the art generator share.
static func _hash3(x: float, y: float, z: float) -> float:
	var h := _imul(floori(x), 374761393) ^ _imul(floori(y), 668265263)
	h = _imul(h ^ _imul(floori(z), 2147483647), 1274126177)
	h = _int32(h ^ ((h & 0xFFFFFFFF) >> 16))
	return (h & 0xFFFFFFFF) / 4294967296.0


static func _imul(a: int, b: int) -> int:
	return _int32(a * b)


static func _int32(value: int) -> int:
	var low := value & 0xFFFFFFFF
	return low - 0x100000000 if low >= 0x80000000 else low
