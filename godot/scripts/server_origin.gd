class_name ServerOrigin
extends RefCounted

## Where the Terrarium server is: the page's own origin in the web export,
## which the server serves, and `npm run dev`'s server when run from the editor.

const EDITOR_ORIGIN := "http://127.0.0.1:8790"


static func http() -> String:
	if OS.has_feature("web"):
		return str(JavaScriptBridge.eval("location.origin"))
	return EDITOR_ORIGIN


static func websocket() -> String:
	var origin := http()
	if origin.begins_with("https:"):
		return "wss:" + origin.trim_prefix("https:")
	return "ws:" + origin.trim_prefix("http:")
