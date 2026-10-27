class_name IsoSort
extends RefCounted

## Back-to-front order of footprint boxes, the current client's rule: of two
## boxes whose screen columns overlap, the one entirely at lower col or lower
## row is behind. Overlapping footprints fall back to their layer, then depth.

enum Layer { FLOOR, ACTOR, ATTACHED }

const EPSILON := 1e-6


## A footprint on the tile grid, the end corner exclusive.
class SortBox:
	var start: Vector2
	var end: Vector2
	var layer: Layer

	func _init(box_start: Vector2, box_end: Vector2, box_layer: Layer) -> void:
		start = box_start
		end = box_end
		layer = box_layer

	func depth() -> float:
		return start.x + end.x + start.y + end.y


## Indices of boxes, back to front.
static func draw_order(boxes: Array[SortBox]) -> PackedInt32Array:
	var count := boxes.size()
	var after: Array[PackedInt32Array] = []
	after.resize(count)
	var pending := PackedInt32Array()
	pending.resize(count)
	for i in count:
		for j in range(i + 1, count):
			var a := boxes[i]
			var b := boxes[j]
			# Screen x ranges that do not overlap never occlude each other.
			if a.start.x - a.end.y >= b.end.x - b.start.y or b.start.x - b.end.y >= a.end.x - a.start.y:
				continue
			var comparison := _compare(a, b)
			if comparison < 0:
				after[i].append(j)
				pending[j] += 1
			elif comparison > 0:
				after[j].append(i)
				pending[i] += 1

	# Kahn's algorithm, always releasing the shallowest ready box so unordered
	# pairs still come out in a stable back-to-front order.
	var ready: Array[int] = []
	for i in count:
		if pending[i] == 0:
			ready.append(i)
	var order := PackedInt32Array()
	var done: Array[bool] = []
	done.resize(count)
	done.fill(false)
	while order.size() < count:
		if ready.is_empty():
			ready.append(_shallowest_remaining(boxes, done))
		var best := 0
		for k in range(1, ready.size()):
			if boxes[ready[k]].depth() < boxes[ready[best]].depth():
				best = k
		var i := ready[best]
		ready.remove_at(best)
		if done[i]:
			continue
		done[i] = true
		order.append(i)
		for j in after[i]:
			pending[j] -= 1
			if pending[j] == 0 and not done[j]:
				ready.append(j)
	return order


## A cycle of inconsistently ordered overlaps breaks at its shallowest box.
static func _shallowest_remaining(boxes: Array[SortBox], done: Array[bool]) -> int:
	var pick := -1
	for i in boxes.size():
		if not done[i] and (pick == -1 or boxes[i].depth() < boxes[pick].depth()):
			pick = i
	return pick


static func _compare(a: SortBox, b: SortBox) -> int:
	if a.end.x <= b.start.x + EPSILON or a.end.y <= b.start.y + EPSILON:
		return -1
	if b.end.x <= a.start.x + EPSILON or b.end.y <= a.start.y + EPSILON:
		return 1
	if a.layer != b.layer:
		return -1 if a.layer < b.layer else 1
	var depth_a := a.depth()
	var depth_b := b.depth()
	if depth_a == depth_b:
		return 0
	return -1 if depth_a < depth_b else 1
