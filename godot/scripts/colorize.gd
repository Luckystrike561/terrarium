class_name Colorize
extends RefCounted

## The current client's sprite colouring, on Images. A colour value is the
## layout's {h, s, b, c, colorize?} object. Every rounding step matches the
## current client's, so the same layout colours the same bytes.


## Photoshop-style Colorize: each pixel's luminance, contrast and brightness
## applied, then the colour's hue and saturation. Alpha is kept.
static func colorize(image: Image, color: Dictionary) -> Image:
	var result := image.duplicate() as Image
	for y in image.get_height():
		for x in image.get_width():
			var pixel := image.get_pixel(x, y)
			if pixel.a8 == 0:
				continue
			var lightness := (0.299 * pixel.r8 + 0.587 * pixel.g8 + 0.114 * pixel.b8) / 255.0
			lightness = _contrast_and_brightness(lightness, color)
			result.set_pixel(x, y, _hsl(float(color.h), float(color.s) / 100.0, lightness, pixel.a8))
	return result


## One flat colour from the colour value alone, keeping each pixel's alpha.
static func flat_colorize(image: Image, color: Dictionary) -> Image:
	var flat := flat_color(color)
	var result := image.duplicate() as Image
	for y in image.get_height():
		for x in image.get_width():
			var alpha := image.get_pixel(x, y).a8
			if alpha != 0:
				result.set_pixel(x, y, Color8(flat.r8, flat.g8, flat.b8, alpha))
	return result


## The colour a 50% grey takes under the colour value: a flat carpet layer,
## and the base colour of a solid wall.
static func flat_color(color: Dictionary) -> Color:
	var lightness := _contrast_and_brightness(0.5, color)
	return _hsl(float(color.h), float(color.s) / 100.0, lightness, 255)


## Shifts each pixel's hue, saturation and lightness by the colour value
## (furniture without the colorize flag).
static func adjust(image: Image, color: Dictionary) -> Image:
	var result := image.duplicate() as Image
	for y in image.get_height():
		for x in image.get_width():
			var pixel := image.get_pixel(x, y)
			if pixel.a8 == 0:
				continue
			var hsl := _rgb_to_hsl(pixel.r8, pixel.g8, pixel.b8)
			var hue := fmod(fmod(hsl[0] + float(color.h), 360.0) + 360.0, 360.0)
			var saturation := clampf(hsl[1] + float(color.s) / 100.0, 0.0, 1.0)
			var lightness := _contrast_and_brightness(hsl[2], color)
			result.set_pixel(x, y, _hsl(hue, saturation, lightness, pixel.a8))
	return result


## Colorize or adjust, as the colour value's flag says.
static func apply(image: Image, color: Dictionary) -> Image:
	return colorize(image, color) if color.get("colorize", false) else adjust(image, color)


static func _contrast_and_brightness(lightness: float, color: Dictionary) -> float:
	var contrast := float(color.c)
	var brightness := float(color.b)
	if contrast != 0:
		lightness = 0.5 + (lightness - 0.5) * ((100.0 + contrast) / 100.0)
	if brightness != 0:
		lightness = lightness + brightness / 200.0
	return clampf(lightness, 0.0, 1.0)


## Doubles throughout: Vector3 holds 32-bit floats, which round some channels
## one step away from the current client's.
static func _hsl(hue: float, saturation: float, lightness: float, alpha: int) -> Color:
	var chroma := (1 - absf(2 * lightness - 1)) * saturation
	var sector := hue / 60
	var second := chroma * (1 - absf(fmod(sector, 2) - 1))
	var rgb: PackedFloat64Array
	if sector < 1:
		rgb = [chroma, second, 0]
	elif sector < 2:
		rgb = [second, chroma, 0]
	elif sector < 3:
		rgb = [0, chroma, second]
	elif sector < 4:
		rgb = [0, second, chroma]
	elif sector < 5:
		rgb = [second, 0, chroma]
	else:
		rgb = [chroma, 0, second]
	var m := lightness - chroma / 2
	return Color8(_channel(rgb[0] + m), _channel(rgb[1] + m), _channel(rgb[2] + m), alpha)


## JavaScript's Math.round, then clamped to a byte.
static func _channel(value: float) -> int:
	return clampi(floori(value * 255 + 0.5), 0, 255)


static func _rgb_to_hsl(red: int, green: int, blue: int) -> PackedFloat64Array:
	var r := red / 255.0
	var g := green / 255.0
	var b := blue / 255.0
	var high := maxf(r, maxf(g, b))
	var low := minf(r, minf(g, b))
	var lightness := (high + low) / 2
	if high == low:
		return [0, 0, lightness]
	var delta := high - low
	var saturation := delta / (2 - high - low) if lightness > 0.5 else delta / (high + low)
	var hue: float
	if high == r:
		hue = ((g - b) / delta + (6 if g < b else 0)) * 60
	elif high == g:
		hue = ((b - r) / delta + 2) * 60
	else:
		hue = ((r - g) / delta + 4) * 60
	return [hue, saturation, lightness]
