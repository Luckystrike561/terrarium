#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bun run typecheck

work="$(mktemp -d)"

cleanup() {
	status=$?
	# Fallback for children verify-M5.ts could not stop itself (e.g. it was killed).
	if [[ -f "$work/pids" ]]; then
		while read -r pid; do
			kill -CONT "$pid" 2>/dev/null || true
			kill -KILL "$pid" 2>/dev/null || true
		done <"$work/pids"
	fi
	if [[ $status -ne 0 ]]; then
		for log in "$work"/hub.log "$work"/collector.log; do
			[[ -f "$log" ]] || continue
			echo "--- $(basename "$log")"
			cat "$log"
		done
	fi
	rm -rf "$work"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

bun scripts/verify-M5.ts --work "$work"
echo "OK: M5 verified"
