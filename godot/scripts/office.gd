extends Node2D

# Measured by the web export budget check as the first frame on screen.
const FIRST_FRAME_MARK := "terrarium:first-frame"

@onready var _grid: IsoGrid = $IsoGrid
@onready var _camera: Camera2D = $Camera


func _ready() -> void:
	_camera.position = _grid.center()
	if OS.has_feature("web"):
		await RenderingServer.frame_post_draw
		JavaScriptBridge.eval("performance.mark('%s')" % FIRST_FRAME_MARK)
