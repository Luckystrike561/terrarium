# Terrarium user guide

Everything the [README](../README.md) leaves out: a quick start for each provider, Docker, options, connections and troubleshooting.

## Install

Node.js 22.13 or later. Nothing from this fork is published to npm (`npx terrarium` installs an unrelated package), so run it from source or [Docker](#docker).

```bash
git clone https://github.com/Luckystrike561/terrarium.git
cd terrarium
npm install
npm run build
node dist/cli.js --provider <ids>
```

The server picks a free port and prints `http://127.0.0.1:<port>/?token=…`. Open it in a browser. `--provider` takes module ids, comma-separated, and is saved in `~/.terrarium/config.json` for later runs. Without it, the first run uses `claude`.

With [devbox](https://www.jetify.com/devbox), `devbox run install` builds everything and `devbox run start` runs herdr and omp on `127.0.0.1:8790`.

## Quick start per provider

Each agent module reads its CLI's own session store. Nothing in the agent needs configuring: start the CLI, start Terrarium with its id, and its sessions appear. The store column is the default location. Every CLI's own override variable (`CODEX_HOME`, `XDG_DATA_HOME`, …) is honored.

| Provider            | Run                     | Reads                                                                            |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| herdr (multiplexer) | `--provider herdr,omp`  | `~/.config/herdr/herdr.sock`, plus [connections](#connections)                   |
| Claude Code         | `--provider claude`     | hooks in `~/.claude/settings.json` once approved, `~/.claude/projects` otherwise |
| omp                 | `--provider omp`        | `~/.omp/agent/sessions`                                                          |
| Antigravity CLI     | `--provider agy`        | `~/.gemini/antigravity-cli`                                                      |
| Cline               | `--provider cline`      | `~/.cline/data/sessions`                                                         |
| Codex               | `--provider codex`      | `~/.codex/sessions`                                                              |
| GitHub Copilot CLI  | `--provider copilot`    | `~/.copilot/session-state`                                                       |
| Cursor              | `--provider cursor`     | `~/.cursor/projects`                                                             |
| Devin               | `--provider devin`      | `~/.local/share/devin/cli/sessions.db`                                           |
| Droid               | `--provider droid`      | `~/.factory/sessions`                                                            |
| Gemini CLI          | `--provider gemini`     | `~/.gemini/tmp`                                                                  |
| Grok CLI            | `--provider grok`       | `~/.grok/sessions`                                                               |
| Hermes Agent        | `--provider hermes`     | `~/.hermes/state.db`                                                             |
| Kilo Code           | `--provider kilo`       | `~/.local/share/kilo/kilo.db`                                                    |
| Kimi Code           | `--provider kimi`       | `~/.kimi-code/sessions`                                                          |
| Kiro CLI            | `--provider kiro`       | `~/.kiro/sessions`                                                               |
| Letta Code          | `--provider letta`      | `~/.letta/lc-local-backend/conversations`                                        |
| Maki                | `--provider maki`       | `~/.local/state/maki/sessions`                                                   |
| MastraCode          | `--provider mastracode` | `~/.local/share/mastracode/mastra.db`                                            |
| OpenCode            | `--provider opencode`   | `~/.local/share/opencode/opencode.db`                                            |
| Pi                  | `--provider pi`         | `~/.pi/agent/sessions`                                                           |
| Qoder CLI           | `--provider qodercli`   | `~/.qoder/projects`                                                              |
| Qwen Code           | `--provider qwen`       | `~/.qwen/projects`                                                               |

What each module shows (tool activity, approvals, clean exit) is in the [supported agents table](https://luckystrike561.github.io/terrarium/#agents).

**Claude Code.** On first start the office asks before installing hooks into `~/.claude/settings.json`. Decline and the module falls back to reading transcripts. `node dist/cli.js --uninstall-hooks` removes only Terrarium's entries and keeps hooks off. To reinstall them, delete `hooksEnabled.claude.hooks` from `~/.terrarium/config.json` and restart.

**Claude quotas.** Reading Claude Code's status line, the only place it reports a Pro or Max plan's 5-hour and weekly limits, is a SEPARATE grant from the hooks above: declining or enabling one leaves the other exactly as it was. A status line you already have keeps running and prints exactly what it printed: Terrarium's runs it unchanged and, alongside it, forwards only the limits. The office shows each limit as a jar of coffee beans on the break-room coffee machine, one bean per tenth left. Hover a jar for the exact usage, the time to reset and how fresh the reading is. To reinstall the status line specifically, delete `hooksEnabled.claude.statusLine` from `~/.terrarium/config.json` and restart.

**herdr.** Every agent in a herdr pane shows its status, name and task. Add the id of each CLI you run in panes to get tool activity: with `herdr,omp`, an omp session in a pane is one character, with omp's activity and herdr's name and approvals. Panes whose CLI has no running module show status only, which is always the case for Amp.

## Docker

The image `ghcr.io/luckystrike561/terrarium` (`linux/amd64`, `linux/arm64`) runs herdr and omp on port 8790. `latest` follows `master`, and each release `vX.Y.Z` is also tagged `X.Y.Z`. `docker build -t terrarium .` builds it from a checkout.

```bash
docker run -d --name terrarium \
  -p 127.0.0.1:8790:8790 \
  -v "$HOME/.config/herdr:/home/node/.config/herdr:ro" \
  -v "$HOME/.omp/agent/sessions:$HOME/.omp/agent/sessions:ro" \
  -v terrarium-data:/home/node/.terrarium \
  ghcr.io/luckystrike561/terrarium:latest
docker logs terrarium
```

The log prints `http://127.0.0.1:8790/?token=…`. Open it on the host.

- **`~/.config/herdr`**: herdr's socket. Mount the directory, not the socket, so the connection survives a herdr restart.
- **`~/.omp/agent/sessions`, at the same absolute path**: herdr reports each omp session by its host path, and the omp module reads it there. Without it, omp agents show status but no tool activity.
- **`terrarium-data`**: `~/.terrarium/` survives `docker rm` and upgrades.

**Other providers.** Mount the store from the [table above](#quick-start-per-provider) under `/home/node`, and pass the full argument list after the image name, since it replaces the default:

```bash
docker run -d --name terrarium \
  -p 127.0.0.1:8790:8790 \
  -v "$HOME/.codex/sessions:/home/node/.codex/sessions:ro" \
  -v "$HOME/.local/share/opencode:/home/node/.local/share/opencode" \
  -v terrarium-data:/home/node/.terrarium \
  ghcr.io/luckystrike561/terrarium:latest \
  --provider codex,opencode --host 0.0.0.0 --port 8790
```

Mount SQLite stores (devin, hermes, kilo, mastracode, opencode) read-write: SQLite creates its WAL index beside the database even for readers. Claude Code does not work in a container, because its hooks would point at container paths.

Keep the host port equal to the container port: the printed URL carries the container's port. `-p 8790:8790` without `127.0.0.1` publishes the office on every interface. The image runs as UID 1000 and herdr's socket is owner-only: if `id -u` differs, add `--user "$(id -u):$(id -g)"` and keep state in a directory you own (`-v "$HOME/.local/share/terrarium:/home/node/.terrarium"`).

**The token ends up in the container log.** Anyone who can run `docker logs` can read the URL.

## Options

```bash
node dist/cli.js --provider herdr,omp  # module ids, saved for later runs
node dist/cli.js --port 3100           # fixed port instead of a free one
node dist/cli.js --host 127.0.0.1      # bind address (default 127.0.0.1)
node dist/cli.js --uninstall-hooks     # remove Claude hooks and exit
node dist/cli.js --help
```

Binding to `0.0.0.0` exposes the office and its WebSocket to your network. Do it only on a trusted network.

### The token in the URL

Anyone who can reach the server can watch the office. Changing hook installation and adding, editing or removing connections is allowed only for a browser that opened the URL with its `?token=`. Treat that URL as a secret: it works from anywhere the server is reachable, and it lands in browser history and the server's request log.

## Connections

With the herdr module, **Connections** on the bottom plank lists every herdr server the office listens to, with its live state. A character from any connection but the default carries its label (`api @Build box`).

- **This machine**: herdr's socket from `HERDR_SOCKET_PATH`, then `HERDR_SESSION`, then `~/.config/herdr/herdr.sock`.
- **Local session**: another herdr session on this machine (`~/.config/herdr/sessions/<name>/herdr.sock`). Left empty, it reaches the default herdr.
- **SSH**: herdr on another machine. The target is `host`, `user@host`, a bare IPv6 address, `ssh://user@host:2222` or a `~/.ssh/config` alias, plus an optional session name. Shell metacharacters are refused.

A connection is saved only after herdr answers a `ping`. Connections live in `~/.terrarium/config.json` and reconnect on their own.

SSH connections run `ssh -N -L` to forward the remote socket to an owner-only socket under `~/.terrarium/herdr/`. They need `ssh` on `PATH`, herdr on the remote, Unix-socket forwarding allowed by sshd (OpenSSH's default) and a POSIX `sh` there. The session runs in batch mode, so authentication must already work through your agent, keys and `~/.ssh/config`, and the host key must be in `known_hosts` (run `ssh <target>` once). No credentials are stored. Remote agents show status only: their transcripts are on the other machine.

### Floors

The office is a building with one floor per machine, stacked bottom to top and all on screen at once. The first floor is the machine Terrarium runs on, named after its host name: every local agent, whatever reports it (Claude, omp, herdr, …), works there. In Docker that is the container, so give it a name with `--hostname`. Each other host reached through a connection gets the next floor, named after the first connection to it.

- Two connections to one host share its floor. The host is the SSH target's host part: `pi`, `luc@pi` and `ssh://pi:2222` are one machine, while a `~/.ssh/config` alias and the address it stands for are two.
- A floor appears when its host's first connection is added, and goes with its last one, characters included. A floor whose connections are all turned off stays, empty.
- Each floor is a whole office, furnished with the bundled default layout (`layout.json` furnishes only the first floor): its own desks, lounge, CTO office and CTO queue. An agent never takes a seat or a queue spot on another machine's floor, even when its own is full.
- A building too tall for the window scrolls rather than shrinking sprites below 1x.

## Customizing the office

There is no in-app layout editor. If `~/.terrarium/layout.json` exists, the server loads it instead of the default for the first floor (other floors keep the default), including carpets, pets and named areas. Map workspace folders to areas under `standalone.areaMappings` in `~/.terrarium/config.json` (`{ "folder-name": ["Area label"] }`). Click a character, then a free seat on its floor, to move it.

The bundled art is generated: `npx tsx scripts/pixellab/furniture.ts`, `scripts/pixellab/generate.ts` and `scripts/pixellab/floors.ts` regenerate the furniture, characters and floor materials, and `npx tsx scripts/iso-art/layout.ts` rewrites the default layout.

## Upgrading from pixel-agents

The first start moves `~/.pixel-agents/` to `~/.terrarium/` and repoints the Claude hooks. Environment variables are now `TERRARIUM_*`. Docker users mount the old volume at `/home/node/.terrarium`.

## Troubleshooting

- **Empty office with `--provider herdr`.** Check herdr is running and its socket exists. **Connections**, opened with the token URL, shows each server's error, and so does the server log.
- **A herdr pane shows status but never a tool.** Add its CLI's id to `--provider`. Panes join a module's session through the id herdr reports, or, for CLIs herdr reports none for (Gemini CLI, Cline, Maki, Kiro 2), through the one live session in the pane's directory.
- **A Claude session is missing.** With hooks, the server logs `Hooks installed` at startup. Without them, `~/.claude/projects/` is scanned every few seconds, so a new session can take a moment.
- **No coffee-bean jars.** They appear after a Claude Pro or Max session's first reply, and only once the status line's own consent is granted, separately from the hooks consent above. API-key sessions report no limits. Check that `statusLine.command` in `~/.claude/settings.json` ends with `--status-line` (followed by your own status line, encoded).
- **An agent never appears.** Its CLI may keep sessions elsewhere: check the store in the [table](#quick-start-per-provider) and the CLI's override variable.
