#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun install
bun run typecheck
