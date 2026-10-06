#!/usr/bin/env bash
# Installs the Terrarium collector for the current user: builds it, copies the
# omp extension, writes the per-host config once, and runs it as a systemd
# user unit. Needs no root. Safe to re-run: unchanged files are left alone and
# existing config and token files are never overwritten.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
unit_name="terrarium-collector.service"

usage() {
	cat <<EOF
Usage: ./install.sh [--host <name>] [--hub-url <ws-url>] [--dry-run]

  --host <name>      This machine's host name; must match its key in the hub's
                     collectorTokens (e.g. laptop-a, laptop-b, server)
  --hub-url <url>    The hub's collector endpoint, e.g. ws://server:8787/ingest
  --dry-run          Print what would be done; change nothing
  --help             Show this help

--host and --hub-url are required on the first run, when
\${XDG_CONFIG_HOME:-~/.config}/terrarium/collector.env does not exist yet.
EOF
}

dry_run=0
host=""
hub_url=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--dry-run) dry_run=1 ;;
	--host)
		host="${2:?--host needs a value}"
		shift
		;;
	--hub-url)
		hub_url="${2:?--hub-url needs a value}"
		shift
		;;
	--help | -h)
		usage
		exit 0
		;;
	*)
		echo "install.sh: unknown argument: $1" >&2
		usage >&2
		exit 2
		;;
	esac
	shift
done

if [[ $EUID -eq 0 ]]; then
	echo "install.sh: run as your normal user, not root; the collector is a user unit" >&2
	exit 1
fi
if [[ -n "$host" && ! "$host" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
	echo "install.sh: --host may only contain letters, digits, '.', '_' and '-'" >&2
	exit 2
fi
if [[ -n "$hub_url" && ! "$hub_url" =~ ^wss?://[^[:space:]|\\]+$ ]]; then
	echo "install.sh: --hub-url must be a ws:// or wss:// URL" >&2
	exit 2
fi

config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
config_dir="$config_home/terrarium"
env_file="$config_dir/collector.env"
token_file="$config_dir/collector.token"
lib_dir="$data_home/terrarium"
collector_js="$lib_dir/terrarium-collector.js"
unit_dir="$config_home/systemd/user"
unit_file="$unit_dir/$unit_name"
ext_dir="$HOME/.omp/agent/extensions"
ext_file="$ext_dir/terrarium.ts"
bundle="$repo/packages/collector/dist/bundle/terrarium-collector.js"

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

run() {
	if [[ $dry_run -eq 1 ]]; then
		say "would run: $*"
	else
		"$@"
	fi
}

changed=0

put_file() {
	local src="$1" dest="$2" mode="$3"
	if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
		say "unchanged: $dest"
		return
	fi
	changed=1
	if [[ $dry_run -eq 1 ]]; then
		say "would install: $dest"
		return
	fi
	install -D -m "$mode" "$src" "$dest"
	say "installed: $dest"
}

bun_bin="$(command -v bun || true)"
if [[ -z "$bun_bin" ]]; then
	echo "install.sh: bun not found on PATH; install it first: https://bun.sh" >&2
	exit 1
fi
if ! command -v systemctl >/dev/null; then
	echo "install.sh: systemctl not found; this installer needs systemd" >&2
	exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

step "build the collector"
run bun install --cwd "$repo" --frozen-lockfile
run bun run --cwd "$repo/packages/collector" build
if [[ $dry_run -eq 1 && ! -f "$bundle" ]]; then
	say "would install: $collector_js (from the build above)"
	changed=1
else
	put_file "$bundle" "$collector_js" 644
fi

step "omp extension"
if [[ -f "$ext_file" ]] && cmp -s "$repo/extensions/omp/terrarium.ts" "$ext_file"; then
	say "unchanged: $ext_file"
else
	if [[ -e "$ext_file" ]]; then
		backup="$ext_file.bak-$(date +%Y%m%d-%H%M%S)"
		if [[ $dry_run -eq 1 ]]; then
			say "would back up: $ext_file -> $backup"
		else
			cp -p "$ext_file" "$backup"
			say "backed up: $ext_file -> $backup"
		fi
	fi
	put_file "$repo/extensions/omp/terrarium.ts" "$ext_file" 644
fi

step "host config"
if [[ -f "$env_file" ]]; then
	say "kept: $env_file (edit it by hand to change host or hub URL)"
	if [[ -n "$host$hub_url" ]]; then
		say "note: --host / --hub-url only apply when $env_file is first created"
	fi
else
	if [[ $dry_run -eq 0 && (-z "$host" || -z "$hub_url") ]]; then
		echo "install.sh: first install needs --host and --hub-url (see --help)" >&2
		exit 2
	fi
	sed -e "s|^TERRARIUM_HOST=.*|TERRARIUM_HOST=${host:-<host>}|" \
		-e "s|^TERRARIUM_INGEST_URL=.*|TERRARIUM_INGEST_URL=${hub_url:-<hub-url>}|" \
		-e "s|^TERRARIUM_HUB_TOKEN_FILE=.*|TERRARIUM_HUB_TOKEN_FILE=$token_file|" \
		"$repo/deployments/collector.env.example" >"$tmp/collector.env"
	put_file "$tmp/collector.env" "$env_file" 600
fi

if [[ -f "$token_file" ]]; then
	say "kept: $token_file"
elif [[ $dry_run -eq 1 ]]; then
	say "would create: $token_file (random 32-byte hex token, mode 600)"
	changed=1
else
	(
		umask 077
		mkdir -p "$config_dir"
		bun -e 'process.stdout.write(`${require("node:crypto").randomBytes(32).toString("hex")}\n`)' >"$token_file"
	)
	say "created: $token_file (mode 600; never printed)"
	changed=1
fi

step "systemd user unit"
path_dirs="$(dirname "$bun_bin")"
if omp_bin="$(command -v omp)"; then
	path_dirs="$path_dirs:$(dirname "$omp_bin")"
fi
sed -e "s|@REPO@|$repo|g" \
	-e "s|@ENV_FILE@|$env_file|g" \
	-e "s|@PATH@|$path_dirs:/usr/local/bin:/usr/bin:/bin|g" \
	-e "s|@BUN@|$bun_bin|g" \
	-e "s|@COLLECTOR_JS@|$collector_js|g" \
	"$repo/deployments/$unit_name" >"$tmp/$unit_name"
put_file "$tmp/$unit_name" "$unit_file" 644

run systemctl --user daemon-reload
run systemctl --user enable --now "$unit_name"
if [[ $changed -eq 1 ]]; then
	# enable --now leaves an already running collector on its old files.
	run systemctl --user restart "$unit_name"
fi

step "next steps"
cat <<EOF
1. On the hub machine, add this host's token to the hub config
   (~/.config/terrarium/hub.json) under "collectorTokens", keyed by the
   TERRARIUM_HOST in $env_file:
     "<host>": "<contents of $token_file>"
   Show it with: cat $token_file
   Then restart the hub so it reloads the config.
2. Restart omp sessions so they load $ext_file.
3. Follow the collector log:
     journalctl --user -u $unit_name -f
   Expect "hub: connected to ...". Status:
     systemctl --user status $unit_name
4. Optional, to keep the collector running while logged out:
     loginctl enable-linger "\$USER"
EOF
if [[ $dry_run -eq 1 ]]; then
	say ""
	say "dry run: nothing was changed"
fi
