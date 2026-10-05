#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bun run typecheck

socket="$HOME/.config/herdr/herdr.sock"
if [[ ! -S "$socket" ]]; then
	echo "SKIP: herdr socket not found at $socket"
	exit 0
fi

out="$(mktemp)"
err="$(mktemp)"
pid=""
cleanup() {
	if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
		kill -KILL "$pid" 2>/dev/null || true
	fi
	rm -f "$out" "$err"
}
trap cleanup EXIT

# --stats-sync-ms 0: never spawn `omp stats`, so the run only reads.
bun packages/collector/src/main.ts --stdout --herdr-socket "$socket" --stats-sync-ms 0 >"$out" 2>"$err" &
pid=$!
sleep 12

if ! kill -0 "$pid" 2>/dev/null; then
	status=0
	wait "$pid" || status=$?
	echo "FAIL: collector exited early with status $status"
	cat "$err"
	exit 1
fi
kill -TERM "$pid"
wait "$pid" || true
pid=""

echo "--- collector stderr"
cat "$err"
echo "--- collector stdout (first 5 lines)"
sed -n '1,5p' "$out"

bun -e '
const kinds = new Set(["agent.seen", "agent.state", "tool.start", "tool.end", "turn.usage", "agent.gone", "host.heartbeat"]);
const lines = (await Bun.file(process.argv[1]).text()).split("\n").filter((l) => l.length > 0);
let valid = 0;
for (const line of lines) {
	const e = JSON.parse(line);
	const ok = e.v === 1 && typeof e.host === "string" && typeof e.ts === "number" &&
		typeof e.agentId === "string" && kinds.has(e.kind) &&
		typeof e.data === "object" && e.data !== null && !Array.isArray(e.data);
	if (!ok) throw new Error(`invalid TerrariumEvent: ${line}`);
	valid++;
}
if (valid === 0) throw new Error("collector printed no events");
console.log(`OK: ${valid} valid TerrariumEvent line(s)`);
' "$out"
