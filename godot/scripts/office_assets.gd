class_name OfficeAssets
extends Node

## Fetches the office manifest and sprite sheets the server already serves
## to the current client under /assets/.

signal _batch_finished

const ASSETS_PATH := "/assets/"
const MANIFEST_FILE := "office-manifest.json"
## Pixels below this alpha are transparent, as the server's PNG decoder reads them.
const ALPHA_THRESHOLD := 2

var _pending := 0
var _images: Dictionary[String, Image] = {}


func fetch_manifest() -> OfficeManifest:
	var body := await _fetch(MANIFEST_FILE)
	if body.is_empty():
		return null
	return OfficeManifest.parse(body.get_string_from_utf8())


## File → decoded image, for every file that loaded. Missing files are logged.
func fetch_images(files: PackedStringArray) -> Dictionary[String, Image]:
	_images = {}
	_pending = files.size()
	for file in files:
		_fetch_image(file)
	if _pending > 0:
		await _batch_finished
	return _images


func _fetch_image(file: String) -> void:
	var body := await _fetch(file)
	if not body.is_empty():
		var image := Image.new()
		if image.load_png_from_buffer(body) == OK:
			_images[file] = _thresholded(image)
		else:
			push_error("[Godot] %s is not a PNG" % file)
	_pending -= 1
	if _pending == 0:
		_batch_finished.emit()


func _fetch(file: String) -> PackedByteArray:
	var request := HTTPRequest.new()
	add_child(request)
	var url := ServerOrigin.http() + ASSETS_PATH + file
	if request.request(url) != OK:
		push_error("[Godot] could not request %s" % url)
		request.queue_free()
		return PackedByteArray()
	var response: Array = await request.request_completed
	request.queue_free()
	var status: int = response[1]
	if response[0] != HTTPRequest.RESULT_SUCCESS or status != 200:
		push_error("[Godot] %s: HTTP %d" % [url, status])
		return PackedByteArray()
	return response[3]


static func _thresholded(image: Image) -> Image:
	image.convert(Image.FORMAT_RGBA8)
	for y in image.get_height():
		for x in image.get_width():
			if image.get_pixel(x, y).a8 < ALPHA_THRESHOLD:
				image.set_pixel(x, y, Color(0, 0, 0, 0))
	return image
