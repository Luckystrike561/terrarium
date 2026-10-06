#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

dist="packages/web/dist"
work="$(mktemp -d)"
hub_pid=""

cleanup() {
	status=$?
	if [[ -n "$hub_pid" ]] && kill -0 "$hub_pid" 2>/dev/null; then
		kill -TERM "$hub_pid" 2>/dev/null || true
		for _ in $(seq 50); do
			kill -0 "$hub_pid" 2>/dev/null || break
			sleep 0.1
		done
		kill -KILL "$hub_pid" 2>/dev/null || true
		wait "$hub_pid" 2>/dev/null || true
	fi
	if [[ $status -ne 0 && -f "$work/hub.log" ]]; then
		echo "--- hub log"
		cat "$work/hub.log"
	fi
	rm -rf "$work"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

echo "--- build"
rm -rf "$dist"
bun run build:web

[[ -f "$dist/index.html" ]] || fail "$dist/index.html missing"
[[ -f "$dist/manifest.webmanifest" ]] || fail "manifest missing"
for icon in icon.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png; do
	[[ -s "$dist/icons/$icon" ]] || fail "icon $icon missing"
done
for png in "$dist"/icons/*.png; do
	[[ "$(head -c 8 "$png" | od -An -tx1 | tr -d ' \n')" == "89504e470d0a1a0a" ]] || fail "$png is not a PNG"
done

shopt -s nullglob
bundles=("$dist"/assets/*.js)
shopt -u nullglob
(( ${#bundles[@]} > 0 )) || fail "no JS bundle in $dist/assets"
bundle_bytes="$(cat "${bundles[@]}" | wc -c)"
# PixiJS alone is several hundred KB minified; less means the tank was not bundled.
(( bundle_bytes > 300000 )) || fail "JS bundle is only $bundle_bytes bytes"
grep -q "terrarium.viewToken" "${bundles[@]}" || fail "bundle lacks the app entry"
echo "dist: ${#bundles[@]} JS file(s), $bundle_bytes bytes"

echo "--- hub serves the build"
port="$(bun -e 'const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); console.log(s.port); s.stop(true);')"
cat >"$work/config.json" <<'EOF'
{
	"collectorTokens": { "verify-host": "verify-collector-token-host" },
	"viewTokens": ["verify-view-token-0000"]
}
EOF
bun packages/hub/src/main.ts --bind 127.0.0.1 --port "$port" \
	--config "$work/config.json" --db "$work/hub.db" --web-dist "$dist" \
	>>"$work/hub.log" 2>&1 &
hub_pid=$!

base="http://127.0.0.1:$port"
for _ in $(seq 100); do
	curl -fsS "$base/healthz" >/dev/null 2>&1 && break
	kill -0 "$hub_pid" 2>/dev/null || fail "hub exited early"
	sleep 0.1
done
curl -fsS "$base/healthz" >/dev/null || fail "hub did not become ready"

curl -fsS "$base/" -o "$work/index.html"
cmp -s "$work/index.html" "$dist/index.html" || fail "served / differs from dist/index.html"
grep -q 'id="tank"' "$work/index.html" || fail "served index.html has no tank container"
grep -q 'rel="manifest"' "$work/index.html" || fail "served index.html does not link the manifest"
echo "served / matches $dist/index.html ($(wc -c <"$work/index.html") bytes)"

script="$(grep -o '/assets/[^"]*\.js' "$work/index.html" | head -n 1)"
[[ -n "$script" ]] || fail "index.html references no script"
served_bytes="$(curl -fsS "$base$script" | wc -c)"
(( served_bytes > 0 )) || fail "hub served an empty $script"
echo "served $script ($served_bytes bytes)"

curl -fsS "$base/manifest.webmanifest" | bun -e '
const manifest = JSON.parse(await Bun.stdin.text());
if (manifest.display !== "fullscreen" || !Array.isArray(manifest.icons) || manifest.icons.length === 0) {
	throw new Error("manifest is missing display or icons");
}
console.log(`served manifest: display ${manifest.display}, ${manifest.icons.length} icons`);
'
curl -fsS "$base/icons/icon-192.png" -o "$work/icon.png"
cmp -s "$work/icon.png" "$dist/icons/icon-192.png" || fail "served icon differs"
echo "served /icons/icon-192.png"

echo "OK: M4 verified"
