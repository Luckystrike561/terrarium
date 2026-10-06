# Terrarium

A full-screen tank showing every AI agent on my machines as a creature. See PLAN.md.

## Usage

```sh
bun install
bun run typecheck
bun run lint
bun run format
bun run test
```

## Collector (local)

```sh
bun packages/collector/src/main.ts --stdout
```

Prints one `TerrariumEvent` JSON line per event; logs go to stderr. Flags: `--host`, `--herdr-socket`, `--omp-socket`, `--stats-db`, `--poll-ms`, `--stats-sync-ms`, `--heartbeat-ms`, `--buffer-size`. omp writes `stats.db` only when `omp stats` runs, so the collector runs `omp stats --json` every `--stats-sync-ms` (default 30000) while an agent is working and once when a turn ends; `0` disables it. The collector itself opens `stats.db` read-only.

## omp extension

`extensions/omp/terrarium.ts` hooks `session_start`, `agent_start`, `agent_end`, `tool_execution_start`, `tool_execution_end`, `tool_approval_requested` and `session_shutdown`, and writes one `TerrariumEvent` line per hook to `$XDG_RUNTIME_DIR/terrarium.sock` (fallback `/tmp/terrarium.sock`). It carries tool names, the error flag, state and the folder name only; when the socket is missing it drops events silently. `TERRARIUM_HOST` overrides the host name; the collector restamps host and agentId with its own `--host` anyway. `install.sh` copies it to `~/.omp/agent/extensions/terrarium.ts`.

The collector listens on that socket (mode 0600) and merges the stream with herdr by agentId: once the extension reports an agent, its states and tool events win over herdr's; `turn.usage` is only taken from `stats.db`. `extensions/omp/harness.ts` loads the extension against a stand-in API so hooks can be fired without omp; `scripts/verify-M2.sh` uses it.

## Hub and web page

```sh
bun run build:web   # builds packages/web/dist, which the hub serves
bun run dev:hub     # hub on http://127.0.0.1:8787 with the dev config and packages/hub/data/dev.db
bun run dev:web     # optional: Vite dev server on 127.0.0.1:5173, proxies /view to the hub
```

Open `http://127.0.0.1:8787/?token=dev-only-view-token`. The page moves the token into local storage and drops it from the URL; without one it shows a token form.

`bun run start:hub` runs the hub with its defaults; flags: `--bind` (default `127.0.0.1`), `--port` (default `8787`, `0` picks a free one), `--config` (default `~/.config/terrarium/hub.json`), `--db` (default `~/.local/share/terrarium/hub.db`), `--web-dist` (default `packages/web/dist`), `--heartbeat-timeout-ms` (default `30000`). `dev:web` reads `TERRARIUM_HUB_URL` (proxy target) and `TERRARIUM_WEB_HOST`.

Endpoints:

- `/ingest`: collector WebSocket, `Authorization: Bearer <host token>`. The token decides the host; events stamped with another host are dropped.
- `/view`: browser WebSocket, `?token=<view token>`. Sends a `WorldSnapshot`, then `WorldDelta`s. A bad token is closed with code 4401. Read-only.
- `/healthz`, and every other GET serves the built frontend.

Config (`packages/hub/config.example.json`) maps each host to its collector token and lists the view tokens:

```json
{
	"collectorTokens": { "laptop-a": "<token>", "laptop-b": "<token>", "server": "<token>" },
	"viewTokens": ["<token>"]
}
```

The tokens in `config.example.json` (`dev-only-collector-token-<host>`, `dev-only-view-token`) are public dev defaults for 127.0.0.1 only. For a real deployment copy it to `~/.config/terrarium/hub.json` outside the repo and replace every token, e.g. with `openssl rand -hex 32`.

Connect a collector:

```sh
TERRARIUM_HUB_TOKEN=dev-only-collector-token-laptop-a \
  bun packages/collector/src/main.ts --host laptop-a --hub ws://127.0.0.1:8787/ingest
```

Collector settings also come from the environment, which is how the systemd unit configures it: `TERRARIUM_INGEST_URL` (`--hub`), `TERRARIUM_HOST` (`--host`), and the token from `--hub-token-file`, else `TERRARIUM_HUB_TOKEN_FILE`, else `TERRARIUM_HUB_TOKEN`, else `~/.config/terrarium/collector.token`. The collector warns when the token file is readable by group or others.

The hub stores raw events and usage rollups in SQLite and rebuilds its world state from them on start. Only contract fields are kept; anything else in `data`, including any prompt or response text, is dropped before storage and broadcast.

`scripts/verify-M3.sh` starts a hub on a free port with a temp DB and config, drives a synthetic collector and a browser client, restarts the hub on the same DB, and checks the rebuilt state.

## The tank

The page is a full-screen PixiJS tank fed by the same `/view` snapshot and delta stream. laptop-a is the left zone, laptop-b the right, and `server` the deep bottom layer (darker water, glowing motes, creatures with dimmer bodies and bioluminescent lures). Other host names get extra top zones.

- Species per agent kind: omp axolotl, claude crab, codex jellyfish, opencode pufferfish, gemini octopus; any other kind is a fish tinted by its kind name. Each project folder gets a hat style and colour hashed from its name, so the same project looks the same on every host. Subagents (`parentAgentId` set) are smaller babies that trail their parent.
- Animations come from one table in `packages/web/src/tank/activity.ts`: idle sleeps with Zzz; working without a tool roams with a thought bubble; `read`/`lsp` read a scroll; `grep`/`glob`/`find` sniff the ground; `edit`/`write`/`ast_edit` stack blocks; `bash`/`shell`/`exec`/`eval` hammer on an anvil; `web_search`/fetch use a telescope; `todo` writes on a notepad; `hub` sends a messenger bird; `task` shakes an egg; `blocked` knocks on the glass with a pulsing "!"; `done` celebrates, then rests; a failed `tool.end` trips; offline agents or hosts turn to stone and the zone dims. Tool names are normalized (`WebFetch` -> `web_fetch`); unknown tools animate as working.
- New agents hatch out of an egg; `agent.gone` fades them out.
- All art is drawn with Pixi Graphics; there are no image assets. The PNG app icons are rasterized at build time by `packages/web/build/icons.ts`.
- Particles share one pool capped at 160. When frames stay slower than about 45 fps for 2 s, the ticker drops to 30 fps and the cap halves; it retries 60 fps after 20 s, backing off up to 5 min.
- The top-right HUD has the connection status, a wake-lock dot (filled: screen kept on), a `List` button that opens the M3 tables, and `Fullscreen`.
- Install on a tablet with "Add to Home Screen" / "Install app"; the manifest asks for fullscreen landscape. The Screen Wake Lock API only works in a secure context (HTTPS or localhost); over plain HTTP on the tailnet the dot stays hollow and the tablet's own sleep setting applies.

`scripts/verify-M4.sh` builds the web package, checks the bundle, manifest and icons in `dist`, then starts a hub on a free port and checks it serves that `index.html`, the entry script, the manifest and an icon.

## All three machines

- Each collector sends `host.heartbeat` every 10 s (`--heartbeat-ms`). The hub shows a host online only while its collector is connected and the last heartbeat is younger than `--heartbeat-timeout-ms` (default 30000). A closed laptop lid leaves its TCP connection open on the hub, so the timeout, not the disconnect, turns the zone to stone. Agent states are kept as they were, so the zone comes back exactly as it was when heartbeats resume. Heartbeats are not stored as events.
- While the hub is unreachable the collector keeps events in a ring of `--buffer-size` (default 5000); when it is full the oldest go first and the count is logged. On reconnect it replays them in order. Heartbeats are never buffered. When its timers fire more than three heartbeats late (the machine slept), the collector replaces its socket instead of trusting it. Usage comes from `stats.db` by watermark, and the hub ignores duplicate usage rows, so a replay never double counts.
- `deployments/terrarium-collector.service` is the systemd user unit template; `deployments/collector.env.example` and `deployments/collector.token.example` show the per-host config. Real tokens live only in `~/.config/terrarium/`, never in the repo.

### Install on a second machine

`install.sh` needs no root and is safe to re-run: it rebuilds the collector, copies files only when they changed, backs up an existing, different `~/.omp/agent/extensions/terrarium.ts` to `terrarium.ts.bak-<date>`, never overwrites the host config or token, and restarts the unit only when something changed. `--dry-run` prints every step and changes nothing.

On the new machine (here laptop-b, hub on the tailnet host `server`):

```sh
# 1. Prerequisites: git, bun (https://bun.sh), systemd, and the machine on the tailnet.
git clone <repo-url> ~/src/terrarium
cd ~/src/terrarium

# 2. See what would happen.
./install.sh --host laptop-b --hub-url ws://server:8787/ingest --dry-run

# 3. Install: builds to packages/collector/dist/bundle, installs it to
#    ~/.local/share/terrarium/, copies the omp extension, writes
#    ~/.config/terrarium/collector.env and a random collector.token (mode 600),
#    installs ~/.config/systemd/user/terrarium-collector.service and runs
#    systemctl --user daemon-reload && systemctl --user enable --now.
./install.sh --host laptop-b --hub-url ws://server:8787/ingest

# 4. Show this host's token, to copy into the hub config.
cat ~/.config/terrarium/collector.token
```

On the hub machine, add the token under `collectorTokens` in `~/.config/terrarium/hub.json` with the same host name, then restart the hub:

```json
{ "collectorTokens": { "laptop-b": "<token from step 4>" } }
```

Back on the new machine:

```sh
# 5. Restart running omp sessions so they load the extension, then watch the log.
journalctl --user -u terrarium-collector.service -f   # expect "hub: connected to ws://server:8787/ingest"
systemctl --user status terrarium-collector.service

# 6. Optional, on the server: keep the collector running while logged out.
loginctl enable-linger "$USER"
```

To update later: `git pull && ./install.sh`.

`scripts/verify-M5.sh` starts a hub and a collector with a temp HOME, config, token file, socket and `stats.db`; kills the hub; pushes 62 extension events and 2 usage rows into the collector; checks it keeps running; restarts the hub; and checks that the newest 40 events (the ring size it is given) arrive in emission order, the dropped count is logged, and the usage is in the totals. It then freezes the collector with SIGSTOP (heartbeats stop, socket stays open), checks the host goes offline after the 1.5 s timeout with its agent kept, resumes it, and checks the host comes back online and usage recorded while frozen reaches the totals. Everything lives in one `mktemp -d` directory that is removed at the end.

## Decision log

- Network option: Tailscale on all machines, hub listening on the tailnet IP only. NOT installed in this milestone.
- Host names: laptop-a, laptop-b, server.
- agentId scheme: omp agents -> "<host>:<session_file>"; non-omp agents -> "<host>:herdr:<pane_id>".
- stats.db is the ONLY source of usage numbers; the omp extension carries activity only.
