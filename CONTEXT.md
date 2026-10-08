# Pixel Agents

Pixel Agents turns AI coding sessions into animated characters in a pixel-art office. This glossary is the canonical language for contributors and integrators; end-user docs may simplify it but must never contradict it.

## Host

**Host**:
The machine Pixel Agents runs on — a laptop, a phone, a VPS, a Raspberry Pi. The office is the same on every host, and can be reached from another device.
_Avoid_: platform, environment, server (that's the runtime process)

**Standalone**:
The local server that serves the office to a browser, independent of any editor.
_Avoid_: CLI (that's the entry command, not the server)

## Agents & Teams

**Agent**:
An AI coding session tracked by Pixel Agents, adopted from wherever it runs.
_Avoid_: bot, terminal (as a synonym), session (as a synonym)

**Character**:
The animated pixel-art figure representing an agent in the office. An agent has a status and a session; its character has a position and an animation state.
_Avoid_: avatar, sprite (a sprite is the image asset, not the figure)

**Sub-agent**:
An unnamed piece of delegated work spawned by an agent, visualized with its own character near its parent — around it, not in a seat. Not an Agent (no session of its own) and not a Teammate (no name). It exists only for the duration of its task, which may outlive the parent's turn. Having no name is what makes it a sub-agent.
_Avoid_: subtask (UI label prefix only)

**Team**:
A Lead plus the Teammates it spawned. A team exists because a teammate was spawned — whether or not the CLI recorded one. A CLI's team registry is evidence of a team, never its definition.

**Lead**:
The agent that spawned a Team's teammates. An agent becomes a lead the moment it spawns its first teammate.
_Avoid_: parent (that's the sub-agent relationship), orchestrator

**Teammate**:
A named agent spawned by another agent — the name is what makes it a teammate. Its spawner is its Lead, and together they form a Team. Every teammate has its own transcript and sits in a seat; it may or may not have its own session or terminal — how it runs never changes what it is.
_Avoid_: inline teammate, tmux teammate, session teammate (former run-style distinctions; a teammate's run style is a property, not an identity)

## Agent Lifecycle

**Adopt**:
Begin tracking a session that was started outside the office. Every agent enters the office this way.
_Avoid_: import, attach, launch

**Spawn / Despawn**:
The character-level visual event: a character materializing into or dissolving out of the office. An agent is adopted; its character spawns.

**Dismiss**:
Remove an agent from the office by user choice, without judging its session. A dismissed session is not re-adopted.
_Avoid_: close, delete

**Orphaned**:
An agent whose transcript has been deleted, so the session it represents no longer exists. The office removes orphaned agents automatically.
_Avoid_: stale (implies inactivity or age, which never removes an agent), dead, ended

## Interaction

**Select**:
Mark a character as the current subject in the office (the white outline). Selection is what seat reassignment operates on.
_Avoid_: highlight

**Follow**:
The camera tracking the selected character. Ends on manual pan or deselection.
_Avoid_: track

## First Run

**Intro**:
The four-step first-run tour the Greeter speaks: welcome, Claude Code, hooks consent, all set. The hooks consent ask is one step of it, not a separate dialog.
_Avoid_: onboarding, tutorial, wizard, consent modal

**Greeter**:
The character that speaks the Intro. Not an agent and not a Pet: it has no session, takes no seat, never wanders, and exists exactly as long as the Intro is open.
_Avoid_: mascot, tutorial character

## Agent Status

**Active**:
An agent that is executing its turn.
_Avoid_: busy, working, running

**Inactive**:
An agent that is not executing. Comes in exactly three forms: done, waiting for input, or permission request.
_Avoid_: waiting (the wire protocol's historical umbrella term), idle

**Done**:
The inactive form where the agent finished its turn and nothing is pending.

**Waiting for input**:
The inactive form where the agent asked the user something and is blocked on a reply.

**Permission request**:
The inactive form where the agent is blocked until the user approves a tool use. Unlike the other two forms, it can occur mid-turn.

**Activity label**:
The human-readable line describing what an agent is doing right now (e.g. "Reading foo.ts"), shown above its character.
_Avoid_: status text, tool status

**Speech bubble**:
The indicator above a character announcing a form of inactivity: "…" for a permission request (stays until resolved), a checkmark for a finished turn (fades on its own).
_Avoid_: bubble alone when ambiguous, notification

**Context gauge**:
The small bar under an agent's activity label showing how full its context window is. Every agent has one once it has taken a turn; sub-agents never do, having no session of their own. It reads the newest turn, so it falls when a session compacts or clears — it is a level, not a total.
_Avoid_: fuel gauge, health bar, token gauge (tokens are the unit, context is the thing)

## Office & Layout

**Office**:
The whole simulated world: the layout plus its inhabitants — characters and pets — and their live state.
_Avoid_: map, scene, room, level

**Layout**:
The office's spatial arrangement: the tile grid, floors, walls, carpets, areas, and furniture. It is the static part of the office, generated in code or read from a saved layout file, while characters and pets move through it.
_Avoid_: floor plan, blueprint, map

**Tile**:
One cell of the office grid.

**Floor**:
The walkable surface of a tile, painted with a pattern and color.

**Wall**:
A blocking tile that visually connects to adjacent walls.

**Carpet**:
A decorative layer painted over floor tiles.

**Area**:
A named region of tiles. Areas exist so workspace folders can be mapped to them.
_Avoid_: zone, region

**Area mapping**:
The assignment of a workspace folder to one or more areas. Many folders may share an area. Agents adopted from a folder prefer seats inside any of its areas.

**Furniture**:
A placeable item in the layout — desks, chairs, storage, electronics, decor.
_Avoid_: object, prop, item

**Desk**:
Furniture that seats face and that hosts surface items. An agent's character sitting at its desk is the visual expression of being active.

**Seat**:
A sittable spot the office derives from chair furniture, assignable to exactly one agent.
_Avoid_: chair (that's the furniture), workstation

**Chair**:
The furniture category whose items create seats. Every footprint tile of a chair yields one seat.

**Seat assignment**:
Which agent owns which seat. Persisted, and changeable by selecting a character and clicking a free seat.

**Pet**:
An animated creature that lives in the office and belongs to no agent. Purely decorative; wanders like a character.
_Avoid_: mascot, animal

**Wander**:
The stroll a character takes away from its seat while its agent is done. Characters whose agents are waiting for input or awaiting a permission stay seated.
_Avoid_: roam, patrol

## Activity Detection

**Hook**:
A push notification an AI tool sends about its own session activity, delivered to Pixel Agents as it happens.

**Transcript**:
The append-only record of a session. Read in both detection modes for tool content.
_Avoid_: JSONL (Claude's file format, not the concept), log

**Hooks mode**:
The preferred detection mode, in which agent status is driven by hooks.

**Heuristic mode**:
The fallback detection mode, in which agent status is inferred from transcript activity, timers, and silence.
_Avoid_: file fallback, transcript mode, polling mode

## Integration Boundary

**Provider**:
Any module that feeds the runtime: an agent module or a multiplexer module. Several run side by side in one process, and each event is routed by the module it came from. Adding a CLI or a multiplexer is one more module, never a new mode.
_Avoid_: plugin, connector

**Agent module**:
The provider for one coding-agent CLI — Claude Code, omp, Codex, Pi, and the like. It knows that CLI's vocabulary and how to read what the CLI reports (installed hooks, transcripts, or both), so it can find the CLI's sessions with no multiplexer around it. Claude Code is the reference implementation.

**Multiplexer module**:
The provider for one terminal multiplexer — herdr, and the like — that hosts agents in panes. It knows which agents are alive, their kind, status, name and task, never what they are doing: for that it hands each agent to the agent module for its kind, and reports status alone when none is running.

**Session ref**:
A session's identity as two modules report it: its transcript path, or the CLI's own session id when that is what the CLI's multiplexer integration reports. A multiplexer and an agent module that report the same session ref are reporting the same agent, which stays one character.

**Agent event**:
The canonical, CLI-agnostic description of something happening in a session: a tool started, a turn ended, a teammate went idle. Providers produce agent events; everything downstream consumes only these, never CLI-specific names.
_Avoid_: hook event (the raw, CLI-specific payload before a provider normalizes it)

**Runtime**:
The core that tracks agents and drives the office. It is a separate thing from the providers that feed it and the office UI it serves.
_Avoid_: server, backend

**Transport**:
The channel carrying protocol messages between the office UI and the runtime.
_Avoid_: connection, socket

**Protocol**:
The message contract between the office UI and the runtime, defined in a single source of truth.
_Avoid_: API
