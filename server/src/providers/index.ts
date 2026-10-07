/**
 * Provider module registry: the one list both surfaces (VS Code, standalone CLI) iterate. Nothing outside a module's
 * own directory knows any module by name.
 *
 * Adding a module (see "Adding a provider module" in CLAUDE.md):
 *   1. Create `server/src/providers/<id>/<id>.ts` exporting an AgentModule or a MultiplexerModule.
 *   2. Add it to `agentModules` or `multiplexerModules` below.
 */

import type { ProviderCapabilities } from '../../../core/src/messages.js';
import type {
  AgentModule,
  HookInstaller,
  MultiplexerModule,
  ProviderModule,
} from '../../../core/src/provider.js';
import { getEnabledModuleIds, getHooksEnabled } from '../configPersistence.js';
import { claudeModule } from './claude/claude.js';
import { herdrModule } from './herdr/herdr.js';
import { ompModule } from './omp/omp.js';

export const agentModules: readonly AgentModule[] = [claudeModule, ompModule];
export const multiplexerModules: readonly MultiplexerModule[] = [herdrModule];

const allModules: readonly ProviderModule[] = [...agentModules, ...multiplexerModules];

/** What runs when no set was ever chosen: today's office, Claude Code alone. */
const DEFAULT_MODULE_IDS: readonly string[] = [claudeModule.id];

/** The modules one process runs. */
export interface ModuleSet {
  readonly agents: readonly AgentModule[];
  readonly multiplexers: readonly MultiplexerModule[];
}

/** An agent module that writes hooks into its CLI's settings, and so goes through the consent gate. */
export type HookModule = AgentModule & { readonly hooks: HookInstaller };

export const registeredModuleIds: readonly string[] = allModules.map((m) => m.id);

/** The ids in `ids` that name no registered module. */
export function unknownModuleIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !registeredModuleIds.includes(id));
}

/** The registered modules named by `ids`. Unknown ids are skipped: callers report them with unknownModuleIds. */
export function selectModules(ids: readonly string[]): ModuleSet {
  const selected = allModules.filter((m) => ids.includes(m.id));
  return {
    agents: selected.filter((m): m is AgentModule => m.kind === 'agent'),
    multiplexers: selected.filter((m): m is MultiplexerModule => m.kind === 'multiplexer'),
  };
}

/** The modules this machine is configured to run. An unknown id in the config (hand-edited, or a module this build
 *  no longer ships) is reported and skipped, never swapped for a default. */
export function loadEnabledModules(): ModuleSet {
  const ids = getEnabledModuleIds() ?? DEFAULT_MODULE_IDS;
  for (const id of unknownModuleIds(ids)) {
    console.warn(
      `[Pixel Agents] Ignoring unknown provider module "${id}" in ~/.pixel-agents/config.json. Available: ${registeredModuleIds.join(', ')}.`,
    );
  }
  return selectModules(ids);
}

export function hookModules(modules: ModuleSet): HookModule[] {
  return modules.agents.filter((m): m is HookModule => m.hooks !== undefined);
}

/** Resolve a wire-supplied module id to one of `modules` that installs hooks, or undefined — the caller then writes
 *  nothing (fail-closed, like a junk consent choice). */
export function findHookModule(modules: ModuleSet, id: unknown): HookModule | undefined {
  return typeof id === 'string' ? hookModules(modules).find((m) => m.id === id) : undefined;
}

/** The handshake's `providerCapabilities`: every enabled agent module's tool taxonomy. */
export function providerCapabilitiesMessage(modules: ModuleSet): ProviderCapabilities {
  return {
    type: 'providerCapabilities',
    providers: modules.agents.map((m) => ({
      providerId: m.id,
      readingTools: [...m.readingTools],
      subagentToolNames: [...m.subagentToolNames],
    })),
  };
}

/** The single `settingsLoaded.hooksEnabled` flag (its one reader is the hooks tooltip): on when any enabled module's
 *  hooks preference is. */
export function anyHooksEnabled(modules: ModuleSet): boolean {
  return hookModules(modules).some((m) => getHooksEnabled(m.id));
}
