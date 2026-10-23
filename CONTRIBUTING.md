# Contributing to Terrarium

Thanks for your interest in contributing to Terrarium! All contributions are welcome: features, bug fixes, documentation improvements, refactors, and more.

This project is licensed under the [MIT License](LICENSE), so your contributions will be too. No CLA or DCO is required.

## Naming

The product is **Terrarium**, a fork of Pixel Agents v1.4.1 (the [README](README.md) credits the upstream project). Code, paths and commands use the Terrarium name too: the npm package and CLI are `terrarium`, state lives in `~/.terrarium/`, environment variables are `TERRARIUM_*`, and the server logs with a `[Terrarium]` prefix. Say Pixel Agents only for the upstream project.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (use the version in [`.nvmrc`](.nvmrc), currently v22)
- Optionally [devbox](https://www.jetify.com/devbox): `devbox shell` provides Node and gitleaks, which the pre-commit hook needs.

### Setup

```bash
git clone https://github.com/Luckystrike561/terrarium.git
cd terrarium
npm install
npm run build
```

Run `node dist/cli.js` to start the standalone server and open the URL it prints. Nothing from this fork is published to npm, and `npx terrarium` would install an unrelated package of the same name.

### Verify the npm package locally

The npm artifact has its own gate, because source-level tests cannot detect a missing tarball file or a package-relative path bug:

```bash
npm run test:package-contract
npm run verify:npm-package
```

The verifier runs the production `prepack` build, creates a tarball outside the repository, installs that exact tarball into a temporary project, and exercises CLI help, the health endpoint, the standalone SPA, bundled assets, and default Hook ON setup. Temporary files and the child server are removed automatically. It never publishes to npm.

## Development Workflow

For development with live rebuilds, run:

```bash
npm run watch
```

This starts parallel watchers for the server bundle (esbuild) and TypeScript type-checking.

> **Note:** The webview (Vite) is not included in `watch`. After changing webview code, run `npm run build:webview` or the full `npm run build`. `npm run dev` watches both and runs the server with the herdr and omp modules on port 8790.

## Running the Mocked Office

From the repository root:

```bash
npm run dev -w webview-ui
```

Vite will print a local URL (typically `http://localhost:5173`) where the office runs against a browser mock instead of a server.

### Project Structure

Terrarium uses a layered codebase. `core/` depends on nothing. `server/` and `webview-ui/` depend only on `core/`.

| Directory            | Description                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`              | Protocol and interface definitions (AsyncAPI 3.0 contract, AgentModule and MultiplexerModule, MessageTransport, StateAdapter) and the shared asset decoders.                                                                                                     |
| `server/`            | Lifecycle runtime: `AgentRuntime`, `AgentEventHandler`, `AgentStateStore`, `SessionRouter`, Fastify HTTP/WS server, provider modules (Claude's transcripts, hooks, teams and hook installer included), Vitest test suite. Also ships the `terrarium` CLI.        |
| `webview-ui/`        | React 19 HUD and a PixiJS (WebGL) isometric office. Transport abstraction (`WebSocketTransport`). Depends only on `core/`.                                                                                                                                       |
| `webview-ui/public/` | Bundled sprites, furniture manifests, default layout (`assets/`) and the pixel font (`fonts/`).                                                                                                                                                                  |
| `scripts/`           | Build tooling: `generate-messages.ts` (AsyncAPI → TS), `validate-asyncapi.mjs`, `run-e2e.mjs`, `generate-e2e-inventory.mjs`, the npm package contract and verifier, `record-demo.mjs`, Allure report scripts, and the `iso-art/` generators for the bundled art. |
| `e2e/`               | Playwright suite: fixtures, helpers, specs for `claude/hooks-on/`, `claude/hooks-off/` and `standalone/`.                                                                                                                                                        |
| `eslint-rules/`      | Custom rules (`no-inline-colors`, `pixel-shadow`, `pixel-font`) enforced project-wide.                                                                                                                                                                           |
| `docs/`              | Architecture deep dives (`docs/architecture/`), the ADR, the art direction.                                                                                                                                                                                      |

The repo uses **npm workspaces** (`server` and `webview-ui`, declared in the root `package.json`). `core/` is not a package: both import its sources directly. A single `npm install` at the root installs dependencies for all workspaces. No nested `cd ... && npm install` is needed.

[CLAUDE.md](CLAUDE.md) is the compressed reference for the whole codebase, and [`docs/architecture/`](docs/architecture/) holds the subsystem deep dives it links to.

## Manual Hook Testing

The repo includes [server/manual-hook-events.http](server/manual-hook-events.http) for manually driving the local hook server while the server is running.

It covers the basic external-session lifecycle:

- `SessionStart` to stage a pending external session
- `PreToolUse` to confirm it and mark the agent active
- `PermissionRequest`, `Notification`, and `Stop` to drive permission and waiting states
- `SessionEnd` to despawn the agent

Before using it, copy `port` and `token` from `~/.terrarium/server.json` into the file variables and set `cwd` to a workspace directory. Every session on the machine is watched, so any directory works.

## Code Guidelines

### Constants

**No unused locals or parameters** (`noUnusedLocals` and `noUnusedParameters` are enabled). All magic numbers and strings are centralized. Don't add inline constants to source files:

- **Shared backend timing and scanning constants:** `server/src/constants.ts`
- **One provider module's own constants:** `server/src/providers/<id>/constants.ts`
- **Protocol-level constants:** `core/src/constants.ts`
- **Webview:** `webview-ui/src/constants.ts` (grid, animation, rendering, camera, zoom, colour strings)
- **CSS variables:** `webview-ui/src/index.css` `:root` block

### UI Styling

The project uses a pixel art aesthetic. All overlays should use:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds and `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur): use `var(--pixel-shadow)`
- The FS Pixel Sans font (loaded in `index.css`)

These conventions are enforced by custom ESLint rules (`eslint-rules/terrarium-rules.mjs`):

| Rule               | Scope            | What it checks                                              |
| ------------------ | ---------------- | ----------------------------------------------------------- |
| `no-inline-colors` | Server + Webview | No hex/rgb/rgba/hsl/hsla literals outside `constants.ts`    |
| `pixel-shadow`     | Webview only     | Box shadows must use `var(--pixel-shadow)` or `2px 2px 0px` |
| `pixel-font`       | Webview only     | Font family must reference FS Pixel Sans                    |

These rules are set to `error`, so `npm run lint` fails on a violation.

## Unit & Integration Tests

```bash
# Run all tests (webview + server + package contract)
npm test

# Run only server tests (Vitest)
npm run test:server

# Run only webview tests
npm run test:webview
```

Server tests cover `AgentStateStore` (typed mutations and events), `AgentEventHandler` (applying module events), `SessionRouter`, `FileStateAdapter` (persistence), the Claude module (hook routing, transcripts, teams, restore, `DismissalTracker`, inline-teammate helpers), the other agent modules and herdr, the hook installer, the HTTP server (lifecycle, auth, `/ws`, broadcast), and the hook script via a spawned-process integration test.

Adding an agent CLI or a terminal multiplexer is one provider module: see "Adding a provider module" in [docs/architecture/providers.md](docs/architecture/providers.md#adding-a-provider-module) for the files to create, the interface to implement, the registry entry, and how hooks consent applies.

`claude-hook.test.ts` requires the bundled hook at `dist/hooks/claude-hook.js`, so run `npm run build` before running it.

## End-to-End Tests

The `e2e/` directory contains Playwright tests that run against a real standalone server, Chromium only.

### Running e2e tests locally

```bash
# Build the server first (tests load the compiled output)
npm run build

# Runs the e2e tests
npm run e2e

# Step-by-step debug mode
npm run e2e:debug

# Keep and attach videos even for successful tests
npm run e2e -- --attach-videos-on-success

# Combine debugger + success-case videos
npm run e2e:debug -- --attach-videos-on-success
```

### Artifacts

All test artifacts are written to `test-results/e2e/`:

| Path                                   | Contents                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `test-results/e2e/videos/<test-name>/` | `.webm` screen recording for failed tests, or all tests with the debug flag |
| `playwright-report/e2e/`               | Playwright HTML report (`npx playwright show-report playwright-report/e2e`) |
| `test-results/e2e/*.png`               | Final screenshots saved on failure                                          |

By default, successful tests discard their videos after teardown. Pass `--attach-videos-on-success` when you need success-case recordings attached to the report for debugging.

### Mock claude

Tests never invoke the real `claude` CLI. A wrapper script (`e2e/fixtures/mock-claude` on POSIX, `mock-claude.cmd` on Windows) is copied into an isolated `bin/` directory and prepended to `PATH` before the server starts. The wrapper delegates to `e2e/fixtures/mock-claude-runner.cjs`, which claims the next scenario from the queue the test writes to `$HOME/.claude-mock/scenario-queue.json`.

Tests build scenarios with the fluent `claudeScenario(...)` helper in `e2e/helpers/mock-claude.ts`:

```typescript
claudeScenario('my-scenario')
  .at(2_000)
  .appendJsonl(buildAssistantToolUseRecord('toolu-1', 'Read', { file_path: '/x' }))
  .at(3_000)
  .emitHook(preToolUseRead('sessionId', '/x'))
  .holdOpenFor(10_000)
  .build();
```

`appendJsonl` writes a record to `$HOME/.claude/projects/<project-hash>/<session-id>.jsonl` at the given offset. `emitHook` POSTs a hook event to the running server's `/api/hooks/:providerId`. `holdOpenFor` keeps the wrapper process alive (and the terminal "busy") for that many ms after the last action, then exits.

Each test runs with an isolated `HOME`, workspace directory, and mock log file, so no state leaks between runs or into your real environment.

For the normative model behind this (the process-boundary principle, append-only transcript rule, assertion philosophy, and the one standalone-server exception), see [`e2e/README.md` → "Mocking model & rules"](e2e/README.md#mocking-model--rules).

### E2E test naming

Tests use behavioral sentences with `@area:<tag>` suffixes for grouping. Example:

```typescript
test('rapid /clear then new tool within 500ms lands on the reassigned agent @area:lifecycle', ...);
```

The auto-generated test inventory in `e2e/README.md` groups tests by `@area:` tag. After adding or removing tests, run `npm run e2e:inventory` to regenerate it. The pre-push hook fails if it drifts.

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Verify everything passes locally:
   ```bash
   npm run lint                         # core + server + webview + e2e lint
   npm run check-types                  # TypeScript strict check across all packages
   npm run asyncapi:validate            # AsyncAPI spec validation
   npm run asyncapi:generate            # Regen core/src/messages.ts (must produce no git diff)
   npm run assets:generate              # Regen the art and office manifest (must produce no git diff)
   npm run e2e:inventory                # Regen e2e/README.md (must produce no git diff)
   npm run build                        # esbuild (CLI + hooks) + Vite (webview)
   npm test                             # Server vitest + webview vitest + package contract
   npm run e2e                          # Full Playwright suite; inventory lives in e2e/README.md
   ```
   Only the art drift check also runs in CI (the `Assets` workflow), so these local runs are the gate. The husky `pre-push` hook runs `check-types` and the three drift checks (AsyncAPI bindings, the generated art with its office manifest, and the e2e inventory) for you. Always regenerate and commit the result.
4. Open a pull request against `master` with:
   - A **conventional commit PR title** (e.g. `feat: add zoom controls`, `fix: character freezing on terminal close`, `refactor: extract pathfinding module`). See [Conventional Commits](https://www.conventionalcommits.org/).
   - A link to the issue it closes (`Closes #123`)
   - A clear description of what changed and why
   - How you tested the changes (steps to reproduce or verify)
   - **Screenshots or GIFs for any UI changes**

> **Note:** PRs are merged using **squash and merge**: all commits in your PR are combined into a single commit on `main`. Your PR title becomes the commit message, which is why the conventional commit format matters.

## Reporting Bugs

[Open a bug report](https://github.com/Luckystrike561/terrarium/issues/new?template=bug_report.yml). The form will guide you through providing the details we need.

## Feature Requests

Have an idea? [Open a feature request](https://github.com/Luckystrike561/terrarium/issues/new?template=feature_request.yml). The form will guide you through describing the problem and your proposed solution.

## Security Issues

Please report security vulnerabilities privately. See [SECURITY.md](SECURITY.md) for details.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
