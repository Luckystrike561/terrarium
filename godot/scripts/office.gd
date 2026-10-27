extends Node2D

## Loads the office the server serves the current client, draws it once and
## hands it to the camera.

# Measured by the web export budget check as the first frame with the office on screen.
const FIRST_FRAME_MARK := "terrarium:first-frame"
# Read by the web export check to compare the drawn office with the current client's.
const VIEW_HOOK := "__terrariumGodot"

var _layout_document: Variant = null

@onready var _map: OfficeMap = $OfficeMap
@onready var _camera: OfficeCamera = $Camera
@onready var _feed: OfficeFeed = $Feed
@onready var _assets: OfficeAssets = $Assets


func _ready() -> void:
	_feed.layout_loaded.connect(func(layout: Dictionary) -> void: _layout_document = layout)
	var manifest := await _assets.fetch_manifest()
	if manifest == null:
		return
	if _layout_document == null:
		await _feed.layout_loaded
	var layout := OfficeLayout.parse(_layout_document, manifest)
	if layout == null:
		return
	var images := await _assets.fetch_images(OfficeMap.required_files(layout, manifest))
	_map.build(layout, manifest, images)
	_camera.view_changed.connect(_publish_view)
	_camera.attach(_map)
	if OS.has_feature("web"):
		await RenderingServer.frame_post_draw
		JavaScriptBridge.eval("performance.mark('%s')" % FIRST_FRAME_MARK)


func _publish_view(zoom: int, offset: Vector2i) -> void:
	if not OS.has_feature("web"):
		return
	var view := {"zoom": zoom, "offsetX": offset.x, "offsetY": offset.y}
	JavaScriptBridge.eval("window.%s = %s" % [VIEW_HOOK, JSON.stringify(view)])
