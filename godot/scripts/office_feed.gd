class_name OfficeFeed
extends Node

## The office layout, read from the server's /ws handshake exactly as the
## current client reads it: send webviewReady, take the layoutLoaded reply.

signal layout_loaded(layout: Dictionary)

const WEBSOCKET_PATH := "/ws"
## The handshake replies with every sprite as hex strings before the layout,
## in messages of several MB, which must fit the peer's inbound buffer.
const INBOUND_BUFFER_BYTES := 32 * 1024 * 1024

var _socket := WebSocketPeer.new()
var _greeted := false


func _ready() -> void:
	_socket.inbound_buffer_size = INBOUND_BUFFER_BYTES
	var url := ServerOrigin.websocket() + WEBSOCKET_PATH
	if _socket.connect_to_url(url) != OK:
		push_error("[Godot] could not open %s" % url)
		set_process(false)


func _process(_delta: float) -> void:
	_socket.poll()
	match _socket.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _greeted:
				_greeted = true
				_socket.send_text(JSON.stringify({"type": "webviewReady"}))
			while _socket.get_available_packet_count() > 0:
				_receive(_socket.get_packet().get_string_from_utf8())
		WebSocketPeer.STATE_CLOSED:
			push_error("[Godot] /ws closed before the layout arrived: %d %s" % [_socket.get_close_code(), _socket.get_close_reason()])
			set_process(false)


func _receive(text: String) -> void:
	var message: Variant = JSON.parse_string(text)
	if not message is Dictionary or message.get("type") != "layoutLoaded":
		return
	set_process(false)
	_socket.close()
	if message.layout is Dictionary:
		layout_loaded.emit(message.layout)
	else:
		push_error("[Godot] the server has no office layout")
