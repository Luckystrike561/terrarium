#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  buildAssetCache,
  loadAllCharacters,
  loadAllFurniture,
  loadAllPets,
} from './assetReload.js';
import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import {
  getHooksConsent,
  getHooksEnabled,
  grantHooksConsent,
  readConfig,
  setEnabledModuleIds,
} from './configPersistence.js';
import { MAX_PORT, MIN_PORT } from './constants.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import type { HookModule } from './providers/index.js';
import {
  findHookModule,
  hookModules,
  loadEnabledModules,
  registeredModuleIds,
  unknownModuleIds,
} from './providers/index.js';
import { PixelAgentsServer } from './server.js';

// ── Argument parsing ──────────────────────────────────────────

export interface CliArgs {
  /** Unset -> ephemeral (OS-assigned) port, so multiple standalone instances
   *  can run at once without a collision. --port picks a fixed one. */
  port?: number;
  host: string;
  /** Provider modules chosen with --provider. Unset -> the set saved by the last --provider, else the default. */
  moduleIds?: string[];
}

/** Thrown by parseArgs on an invalid argument. Kept separate from process.exit so
 *  the parsing logic stays a pure, unit-testable function -- main() is the only
 *  place that turns a bad argument into an exit code. */
export class CliArgsError extends Error {}

function parseModuleIds(raw: string): string[] {
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new CliArgsError(
      `Empty --provider: name at least one of ${registeredModuleIds.join(', ')}.`,
    );
  }
  const unknown = unknownModuleIds(ids);
  if (unknown.length > 0) {
    throw new CliArgsError(
      `Unknown provider ${unknown.map((id) => `"${id}"`).join(', ')} in --provider. Available: ${registeredModuleIds.join(', ')}.`,
    );
  }
  return [...new Set(ids)];
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new CliArgsError(
          `Missing value for ${argv[i]}: expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
        throw new CliArgsError(
          `Invalid --port "${raw}": must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      args.port = parsed;
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--provider') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new CliArgsError(
          `Missing value for --provider: expected a comma-separated list of ${registeredModuleIds.join(', ')}.`,
        );
      }
      args.moduleIds = parseModuleIds(raw);
      i++;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: OS-assigned ephemeral port)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --provider <ids>      Provider modules to run, comma-separated: ${registeredModuleIds.join(', ')}.
                        Saved for later runs (default: the last saved set, else "claude")
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// ── Hooks consent ─────────────────────────────────────────────
// First-run consent is asked IN THE APP, not here: the server sends a
// hooksConsentRequest to privileged (tokened) connections during the
// webviewReady handshake (clientMessageHandler.ts), and the browser renders
// the dialog. The CLI itself never
// prompts; a headless run just starts without hooks until consent is granted
// through the UI. The one exception that needs no dialog is the silent-grant
// migration below (our hooks already installed by a pre-consent version).

/**
 * Stage the files a module's hook entries run, reporting failure.
 *
 * Callers run this BEFORE installing the entries and abort when it returns
 * false: an entry whose command points at a missing script makes the CLI
 * spawn a dead process for every event, which is strictly worse than no hooks
 * at all.
 */
function stageHookFilesOrReport(module: HookModule, packageRoot: string, context = ''): boolean {
  if (module.hooks.stageHookFiles?.(packageRoot) ?? true) return true;
  console.error(`[Pixel Agents] Hooks NOT installed${context}: hook script missing.`);
  return false;
}

/** Install a module's hooks at startup when its persisted preference is on, gated on its one-time consent. */
async function installHooksOnStartup(
  module: HookModule,
  packageRoot: string,
  serverUrl: string,
  token: string,
): Promise<void> {
  if (!getHooksEnabled(module.id)) {
    // Without this line, a persisted hooks-off makes startup skip the entire
    // consent/install flow with zero output: indistinguishable from a bug.
    console.log(
      `[Pixel Agents] Hooks disabled for ${module.displayName} — enable "Instant Detection (Hooks)" in the UI settings to install them.`,
    );
    return;
  }
  let consent = getHooksConsent(module.id) === 'granted';
  if (!consent && (await module.hooks.areHooksInstalled())) {
    // Our hooks are already installed and already firing (a pre-consent
    // version put them there). Grant and continue with NO prompt: the install
    // below only ever REDUCES scope (Claude's 14 -> 12 migration drops the two
    // events that forwarded prompt text and were consumed by nothing). Asking
    // would buy this user no protection they do not already have. A fresh
    // install still is asked, in full, in the browser UI, when a tokened
    // client connects (clientMessageHandler's webviewReady).
    grantHooksConsent(module.id);
    consent = true;
  }
  if (!consent) {
    console.log(
      `[Pixel Agents] Hooks not installed: writing ${module.displayName}'s settings needs one-time approval — open the URL below to review and approve it.`,
    );
    return;
  }
  if (!stageHookFilesOrReport(module, packageRoot)) return;
  try {
    await module.hooks.installHooks(serverUrl, token);
    console.log('[Pixel Agents] Hooks installed');
  } catch (err) {
    console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const packageRoot = path.dirname(distRoot);
  const staticDir = path.join(distRoot, 'webview');

  // ── Load assets on startup ──
  // External asset directories are merged at startup too, so directories added
  // in a previous session survive a restart.
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = await buildAssetCache(
    distRoot,
    readConfig().externalAssetDirectories,
  );
  const charCount = assetCache.characters?.characters.length ?? 0;
  const petCount = assetCache.pets?.pets.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${petCount} pets, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter();
  store.setAdapter(adapter);

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    if (args.moduleIds) setEnabledModuleIds(args.moduleIds);
    const modules = loadEnabledModules();
    const moduleIds = [...modules.agents, ...modules.multiplexers].map((m) => m.id);
    console.log(`[Pixel Agents] Provider modules: ${moduleIds.join(', ') || 'none'}`);

    // Create runtime first (before server.start, so we can pass it in)
    const runtime = new AgentRuntime(store, modules);

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // onSetHooksEnabled side effect: install/uninstall the named module's
    // hooks when the user toggles in the UI (or answers the consent ask).
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (providerId: string, enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      const module = findHookModule(modules, providerId);
      if (!module) return; // unknown id: nothing to install into
      if (enabled) {
        // An explicit toggle in the UI IS the consent to modify the module's
        // settings file.
        grantHooksConsent(module.id);
        if (!stageHookFilesOrReport(module, packageRoot, ' (user toggle)')) return;
        try {
          await module.hooks.installHooks(
            `http://127.0.0.1:${currentConfig.port}`,
            currentConfig.token,
          );
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        console.log('[Pixel Agents] Hooks installed (user toggle)');
      } else {
        try {
          await module.hooks.uninstallHooks();
          console.log('[Pixel Agents] Hooks uninstalled (user toggle)');
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    // onReloadAssets side effect: re-run the shared loaders (bundled + external
    // dirs) after an external-asset-directory change, then re-broadcast the
    // updated sprites to the requesting client. Mutates the assetCache object in
    // place so already-open sockets (which captured the same reference) and
    // future webviewReady handshakes both observe the new assets. Only
    // characters/pets/furniture can come from external dirs, so only those three
    // are reloaded and re-sent.
    const onReloadAssets: ReloadAssetsSideEffect = async (send): Promise<void> => {
      const externalDirs = readConfig().externalAssetDirectories;
      const [characters, pets, furniture] = await Promise.all([
        loadAllCharacters(distRoot, externalDirs),
        loadAllPets(distRoot, externalDirs),
        loadAllFurniture(distRoot, externalDirs),
      ]);
      assetCache.characters = characters;
      assetCache.pets = pets;
      assetCache.furniture = furniture;
      if (characters) {
        send({ type: 'characterSpritesLoaded', characters: characters.characters });
      }
      if (pets) {
        send({
          type: 'petSpritesLoaded',
          pets: pets.pets,
          petNames: pets.manifests.map((m) => m.name),
        });
      }
      if (furniture) {
        send({
          type: 'furnitureAssetsLoaded',
          catalog: furniture.catalog,
          sprites: Object.fromEntries(furniture.sprites),
        });
      }
      console.log('[Pixel Agents] Assets reloaded (external directory change)');
    };

    const config = await server.start({
      store,
      runtime,
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onSetHooksEnabled,
      onReloadAssets,
    });
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE the first scan tick.
    for (const module of hookModules(modules)) {
      runtime.setHooksEnabled(module.id, getHooksEnabled(module.id));
    }
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    runtime.startModules();

    for (const module of hookModules(modules)) {
      await installHooksOnStartup(
        module,
        packageRoot,
        `http://127.0.0.1:${config.port}`,
        config.token,
      );
    }

    const projectDir = runtime.transcriptModule?.getSessionDirs?.(process.cwd())[0];
    if (projectDir) {
      console.log(`[Pixel Agents] Scanning project dir: ${projectDir}`);
      runtime.startProjectScan(projectDir);
      runtime.startExternalScanning(projectDir);
      runtime.startStaleCheck();
    }

    // The URL the operator opens has to be REACHABLE (a wildcard bind address
    // is a bind target, not an address you can browse to — `--host 0.0.0.0`
    // used to print a dead `http://0.0.0.0:PORT`) and has to carry the token,
    // which is what makes the session it loads privileged enough to approve a
    // hook install (see standaloneTokenValid in httpServer.ts). Under `--host
    // 0.0.0.0` the office stays readable from the LAN at this machine's own
    // address; only the consent-bearing toggle needs the token.
    const displayHost =
      args.host === '0.0.0.0' || args.host === '::' || args.host === '' ? '127.0.0.1' : args.host;
    console.log(
      `\n  Pixel Agents server running at http://${displayHost}:${config.port}/?token=${config.token}\n`,
    );

    // ── Graceful shutdown ──
    function shutdown(): void {
      console.log('\nShutting down...');
      runtime.dispose();
      server.stop();
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only auto-run when this file is executed directly (`node dist/cli.js`), not
// when it's imported for its exports (e.g. `parseArgs` in tests) -- importing
// it unconditionally used to start a real server and install real Claude
// hooks as a side effect of module load.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
