/**
 * Provider module registry: the one list the standalone CLI iterates. Nothing outside a module's
 * own directory knows any module by name.
 *
 * Adding a module:
 *   1. Create `server/src/providers/<id>/<id>.ts` exporting an AgentModule, a MultiplexerModule or a
 *      QuotaSourceModule.
 *   2. Add it to `agentModules`, `multiplexerModules` or `quotaSourceModules` below.
 */

import type { ProviderCapabilities } from '../../../core/src/messages.js';
import type {
  AgentModule,
  HookInstaller,
  MultiplexerModule,
  ProviderModule,
  QuotaSourceModule,
} from '../../../core/src/provider.js';
import { getEnabledModuleIds, getHooksEnabled } from '../configPersistence.js';
import { agyModule } from './agy/agy.js';
import { claudeModule } from './claude/claude.js';
import { clineModule } from './cline/cline.js';
import { codexModule } from './codex/codex.js';
import { copilotModule } from './copilot/copilot.js';
import { cursorModule } from './cursor/cursor.js';
import { devinModule } from './devin/devin.js';
import { droidModule } from './droid/droid.js';
import { geminiModule } from './gemini/gemini.js';
import { grokModule } from './grok/grok.js';
import { herdrModule } from './herdr/herdr.js';
import { hermesModule } from './hermes/hermes.js';
import { kiloModule } from './kilo/kilo.js';
import { kimiModule } from './kimi/kimi.js';
import { kiroModule } from './kiro/kiro.js';
import { lettaModule } from './letta/letta.js';
import { makiModule } from './maki/maki.js';
import { mastracodeModule } from './mastracode/mastracode.js';
import { ompModule } from './omp/omp.js';
import { opencodeModule } from './opencode/opencode.js';
import { piModule } from './pi/pi.js';
import { qodercliModule } from './qodercli/qodercli.js';
import { qwenModule } from './qwen/qwen.js';

export const agentModules: readonly AgentModule[] = [
  claudeModule,
  ompModule,
  agyModule,
  clineModule,
  codexModule,
  copilotModule,
  cursorModule,
  devinModule,
  droidModule,
  geminiModule,
  grokModule,
  hermesModule,
  kiloModule,
  kimiModule,
  kiroModule,
  lettaModule,
  makiModule,
  mastracodeModule,
  opencodeModule,
  piModule,
  qodercliModule,
  qwenModule,
];
export const multiplexerModules: readonly MultiplexerModule[] = [herdrModule];
/** Quota sources for providers that run no agent CLI here. Claude reports its quota through its agent module. */
export const quotaSourceModules: readonly QuotaSourceModule[] = [];

const allModules: readonly ProviderModule[] = [
  ...agentModules,
  ...multiplexerModules,
  ...quotaSourceModules,
];

/** What runs when no set was ever chosen: today's office, Claude Code alone. */
const DEFAULT_MODULE_IDS: readonly string[] = [claudeModule.id];

/** The modules one process runs. */
export interface ModuleSet {
  readonly agents: readonly AgentModule[];
  readonly multiplexers: readonly MultiplexerModule[];
  /** Absent means none. */
  readonly quotaSources?: readonly QuotaSourceModule[];
}

/** An agent module that writes hooks into its CLI's settings, and so goes through the consent gate. At least one
 *  subject: an empty array is never registered as a HookModule, since nothing would ever be asked. */
export type HookModule = AgentModule & { readonly hooks: readonly HookInstaller[] };

/** The subject id `AgentRuntime.setHooksEnabled` reads, by convention — module-scoped, never subject-scoped (it
 *  gates a running module's heuristic fallback timers, which know nothing about the status line or any other
 *  non-detection subject). Not a module id, and not branched on anywhere else: every module registered today names
 *  its hook-entries subject 'hooks' (Claude's HOOKS_SUBJECT_ID; the implicit single subject every other module had
 *  before consent became per-subject — configPersistence.ts's LEGACY_SUBJECT_ID is the same value). This is the one
 *  place cli.ts and clientMessageHandler.ts read a subject id by VALUE rather than pass it through opaquely. */
export const HEURISTIC_TIMER_SUBJECT_ID = 'hooks';

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
    quotaSources: selected.filter((m): m is QuotaSourceModule => m.kind === 'quota'),
  };
}

/** The modules this machine is configured to run. An unknown id in the config (hand-edited, or a module this build
 *  no longer ships) is reported and skipped, never swapped for a default. */
export function loadEnabledModules(): ModuleSet {
  const ids = getEnabledModuleIds() ?? DEFAULT_MODULE_IDS;
  for (const id of unknownModuleIds(ids)) {
    console.warn(
      `[Terrarium] Ignoring unknown provider module "${id}" in ~/.terrarium/config.json. Available: ${registeredModuleIds.join(', ')}.`,
    );
  }
  return selectModules(ids);
}

export function hookModules(modules: ModuleSet): HookModule[] {
  return modules.agents.filter((m): m is HookModule => (m.hooks?.length ?? 0) > 0);
}

/** Every REGISTERED agent module that writes hooks, regardless of which modules this machine runs. Used by
 *  `--uninstall-hooks`, which must be able to remove hooks a module installed before it was disabled or dropped. */
export const allHookModules: readonly HookModule[] = agentModules.filter(
  (m): m is HookModule => (m.hooks?.length ?? 0) > 0,
);

/** Resolve a wire-supplied module id to one of `modules` that installs hooks, or undefined (the caller then writes
 *  nothing: fail-closed, like a junk consent choice). */
export function findHookModule(modules: ModuleSet, id: unknown): HookModule | undefined {
  return typeof id === 'string' ? hookModules(modules).find((m) => m.id === id) : undefined;
}

/** Resolve a wire-supplied (providerId, subjectId) pair to the one subject that writes it, or undefined for an
 *  unknown module or an id naming no subject of it — fail-closed, like a junk consent choice. */
export function findHookSubject(
  modules: ModuleSet,
  providerId: unknown,
  subjectId: unknown,
): HookInstaller | undefined {
  const module = findHookModule(modules, providerId);
  return typeof subjectId === 'string' ? module?.hooks.find((s) => s.id === subjectId) : undefined;
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
  return hookModules(modules).some((m) => m.hooks.some((s) => getHooksEnabled(m.id, s.id)));
}
