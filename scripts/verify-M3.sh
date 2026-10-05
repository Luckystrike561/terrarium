#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bun run typecheck

work="$(mktemp -d)"
hub_pid=""

stop_hub() {
	if [[ -n "$hub_pid" ]] && kill -0 "$hub_pid" 2>/dev/null; then
		kill -TERM "$hub_pid" 2>/dev/null || true
		for _ in $(seq 50); do
			kill -0 "$hub_pid" 2>/dev/null || break
			sleep 0.1
		done
		kill -KILL "$hub_pid" 2>/dev/null || true
		wait "$hub_pid" 2>/dev/null || true
	fi
	hub_pid=""
}

cleanup() {
	status=$?
	stop_hub
	if [[ $status -ne 0 && -f "$work/hub.log" ]]; then
		echo "--- hub log"
		cat "$work/hub.log"
	fi
	rm -rf "$work"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

port="$(bun -e 'const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); console.log(s.port); s.stop(true);')"

# Tokens here must match the constants in verify-M3.ts.
cat >"$work/config.json" <<'EOF'
{
	"collectorTokens": {
		"verify-host": "verify-collector-token-host",
		"verify-other": "verify-collector-token-other"
	},
	"viewTokens": ["verify-view-token-0000"]
}
EOF
mkdir "$work/web"
echo '<!doctype html><title>terrarium-verify-index</title>' >"$work/web/index.html"

start_hub() {
	bun packages/hub/src/main.ts --bind 127.0.0.1 --port "$port" \
		--config "$work/config.json" --db "$work/hub.db" --web-dist "$work/web" \
		>>"$work/hub.log" 2>&1 &
	hub_pid=$!
}

usage_ts="$(bun -e 'console.log(Date.now())')"
verify() {
	bun scripts/verify-M3.ts --phase "$1" --port "$port" --db "$work/hub.db" --usage-ts "$usage_ts"
}

echo "--- hub on 127.0.0.1:$port, live phase"
start_hub
verify live
stop_hub

echo "--- hub restarted on the same database, rebuilt phase"
start_hub
verify rebuilt
stop_hub

echo "--- hub log"
cat "$work/hub.log"
echo "OK: M3 verified"
