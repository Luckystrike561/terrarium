class_name OfficeCamera
extends Node

## Places the office map in the viewport the way the current client places
## its world layer: the grid centred, then panned, both in whole pixels, at a
## whole-number zoom. Fits the office on load, zooms one step per wheel notch
## or trackpad swipe around the cursor, pans by dragging, and never pans past
## the office edge.

signal view_changed(zoom: int, offset: Vector2i)

const ZOOM_MIN := 1
const ZOOM_MAX := 4
## The current client's pan button. The left button stays free for selection.
const PAN_BUTTONS := MOUSE_BUTTON_MASK_MIDDLE
## Wheel events closer together than this are one gesture and zoom one step:
## the web export turns every DOM wheel event into a wheel press, and a
## trackpad swipe sends dozens of them.
const WHEEL_GESTURE_GAP_MS := 150

var zoom := ZOOM_MIN
var _map: OfficeMap
## Viewport px the map is moved off its centred position, kept clamped.
var _pan := Vector2.ZERO
var _last_wheel_ms := -WHEEL_GESTURE_GAP_MS


func attach(map: OfficeMap) -> void:
	_map = map
	fit()


## The largest whole zoom at which the whole office shows, centred.
func fit() -> void:
	var canvas := _canvas_size()
	var size := _map.view_rect.size
	zoom = clampi(floori(minf(canvas.x / size.x, canvas.y / size.y)), ZOOM_MIN, ZOOM_MAX)
	var center := _map.view_rect.get_center()
	_pan = _clamped(canvas / 2 - center * zoom - _base(zoom))
	_apply()


func _unhandled_input(event: InputEvent) -> void:
	if _map == null:
		return
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_wheel_at(1, event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_wheel_at(-1, event.position)
	elif event is InputEventMouseMotion and event.button_mask & PAN_BUTTONS:
		_pan = _clamped(_pan + event.relative)
		_apply()


## Zooms one step on the first wheel event of a gesture.
func _wheel_at(step: int, anchor: Vector2) -> void:
	var now := Time.get_ticks_msec()
	var starts_gesture := now - _last_wheel_ms >= WHEEL_GESTURE_GAP_MS
	_last_wheel_ms = now
	if starts_gesture:
		_zoom_at(zoom + step, anchor)


## Changes the zoom keeping the office point under `anchor` where it is.
func _zoom_at(next_zoom: int, anchor: Vector2) -> void:
	next_zoom = clampi(next_zoom, ZOOM_MIN, ZOOM_MAX)
	if next_zoom == zoom:
		return
	var point := (anchor - Vector2(_offset())) / zoom
	zoom = next_zoom
	_pan = _clamped(anchor - point * zoom - _base(zoom))
	_apply()


func _apply() -> void:
	var offset := _offset()
	_map.position = Vector2(offset)
	_map.scale = Vector2(zoom, zoom)
	view_changed.emit(zoom, offset)


func _canvas_size() -> Vector2:
	return get_viewport().get_visible_rect().size


## Where the map's origin lands at this zoom with the grid centred.
func _base(at_zoom: int) -> Vector2:
	var canvas := _canvas_size()
	var center := _map.grid_rect.get_center()
	return Vector2(floorf(canvas.x / 2 - center.x * at_zoom), floorf(canvas.y / 2 - center.y * at_zoom))


func _offset() -> Vector2i:
	var base := _base(zoom)
	# Rounded half up, as JavaScript's Math.round does, so a pan lands on the same pixel as in the current client.
	return Vector2i(int(base.x + floorf(_pan.x + 0.5)), int(base.y + floorf(_pan.y + 0.5)))


## A pan that keeps the office inside the viewport: an axis larger than the
## viewport scrolls up to the office edge, a smaller one is centred.
func _clamped(pan: Vector2) -> Vector2:
	var canvas := _canvas_size()
	var base := _base(zoom)
	var view := _map.view_rect
	return Vector2(
		_clamp_axis(pan.x, canvas.x, base.x, view.position.x, view.end.x),
		_clamp_axis(pan.y, canvas.y, base.y, view.position.y, view.end.y))


func _clamp_axis(pan: float, canvas: float, base: float, view_start: float, view_end: float) -> float:
	var lowest := canvas - view_end * zoom - base
	var highest := -view_start * zoom - base
	if lowest > highest:
		return (lowest + highest) / 2
	return clampf(pan, lowest, highest)
