import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setEnabledModuleIds } from '../src/configPersistence.js';
import { claudeModule } from '../src/providers/claude/claude.js';
import { herdrModule } from '../src/providers/herdr/herdr.js';
import {
  agentModules,
  findHookModule,
  hookModules,
  loadEnabledModules,
  multiplexerModules,
  providerCapabilitiesMessage,
  registeredModuleIds,
  selectModules,
  unknownModuleIds,
} from '../src/providers/index.js';
import { ompModule } from '../src/providers/omp/omp.js';

describe('provider module registry invariants', () => {
  // Routing keys agents by module id (AgentRuntime.registerAgent, SessionRouter, the hooks HTTP route). A
  // duplicate id would make two modules answer to the same route.
  it('gives every agent module a unique id', () => {
    const ids = agentModules.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A multiplexer module reports an "agentKind" per pane that is looked up against agentModules by id
  // (MultiplexerFeed). Sharing an id with an agent module would make a pane silently claim that module's identity.
  it('keeps every multiplexer id distinct from every agent id', () => {
    const agentIds = new Set(agentModules.map((m) => m.id));
    for (const multiplexer of multiplexerModules) {
      expect(agentIds.has(multiplexer.id)).toBe(false);
    }
  });

  it('lists every agent and multiplexer id in registeredModuleIds', () => {
    for (const module of [...agentModules, ...multiplexerModules]) {
      expect(registeredModuleIds).toContain(module.id);
    }
    expect(registeredModuleIds.length).toBe(agentModules.length + multiplexerModules.length);
  });
});

describe('selectModules / unknownModuleIds', () => {
  it('splits selected ids into agent and multiplexer kinds regardless of the order they were named in', () => {
    const modules = selectModules(['herdr', 'omp']);
    expect(modules.agents).toEqual([ompModule]);
    expect(modules.multiplexers).toEqual([herdrModule]);
  });

  it('silently skips an id naming no registered module, leaving the known ones', () => {
    const modules = selectModules(['omp', 'not-a-real-module']);
    expect(modules.agents).toEqual([ompModule]);
    expect(modules.multiplexers).toEqual([]);
  });

  it('reports exactly the ids that name no registered module', () => {
    expect(unknownModuleIds(['claude', 'bogus', 'herdr', 'also-bogus'])).toEqual([
      'bogus',
      'also-bogus',
    ]);
    expect(unknownModuleIds(['claude', 'herdr'])).toEqual([]);
  });
});

describe('loadEnabledModules', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-module-registry-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('runs Claude Code alone when this machine has never chosen a set', () => {
    const modules = loadEnabledModules();
    expect(modules.agents).toEqual([claudeModule]);
    expect(modules.multiplexers).toEqual([]);
  });

  it('loads exactly the configured ids, split into agent and multiplexer kinds', () => {
    setEnabledModuleIds(['omp', 'herdr']);
    const modules = loadEnabledModules();
    expect(modules.agents).toEqual([ompModule]);
    expect(modules.multiplexers).toEqual([herdrModule]);
  });

  it('warns about an unknown configured id and skips it, without falling back to the default set', () => {
    setEnabledModuleIds(['omp', 'not-a-real-module']);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const modules = loadEnabledModules();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('not-a-real-module');
      // Not the default (claude): the valid configured id is what actually loads.
      expect(modules.agents).toEqual([ompModule]);
      expect(modules.multiplexers).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('transcript module selection', () => {
  // AgentRuntime picks its transcriptModule as the first selected agent module declaring getSessionDirs. Of the
  // shipped agent modules, only Claude's reads transcripts this way; omp discovers its own sessions via a session
  // store instead.
  it('is the selected agent module that declares getSessionDirs', () => {
    const modules = selectModules(['omp', 'claude']);
    const transcriptModule = modules.agents.find((m) => m.getSessionDirs !== undefined);
    expect(transcriptModule).toBe(claudeModule);
  });

  it('is undefined when no selected agent module declares getSessionDirs', () => {
    const modules = selectModules(['omp']);
    const transcriptModule = modules.agents.find((m) => m.getSessionDirs !== undefined);
    expect(transcriptModule).toBeUndefined();
  });
});

describe('hookModules / findHookModule', () => {
  it('includes only agent modules that install hooks, excluding read-only ones', () => {
    const modules = selectModules(['claude', 'omp']);
    expect(hookModules(modules)).toEqual([claudeModule]);
  });

  it('resolves a wire-supplied id to the matching hook module in the set', () => {
    const modules = selectModules(['claude', 'omp']);
    expect(findHookModule(modules, 'claude')).toBe(claudeModule);
  });

  it('refuses an id naming a module that has no hooks, even if it is enabled', () => {
    const modules = selectModules(['claude', 'omp']);
    expect(findHookModule(modules, 'omp')).toBeUndefined();
  });

  it('refuses an id that names no enabled module at all', () => {
    const modules = selectModules(['claude']);
    expect(findHookModule(modules, 'herdr')).toBeUndefined();
  });

  it('refuses a non-string id rather than coercing it', () => {
    const modules = selectModules(['claude']);
    expect(findHookModule(modules, 42)).toBeUndefined();
    expect(findHookModule(modules, undefined)).toBeUndefined();
    expect(findHookModule(modules, null)).toBeUndefined();
  });
});

describe('providerCapabilitiesMessage', () => {
  it('reports capabilities for enabled agent modules only, never for multiplexers', () => {
    const modules = selectModules(['claude', 'herdr']);
    const message = providerCapabilitiesMessage(modules);
    expect(message.providers.map((p) => p.providerId)).toEqual(['claude']);
  });

  it('is empty when no agent module is enabled', () => {
    const modules = selectModules(['herdr']);
    const message = providerCapabilitiesMessage(modules);
    expect(message.providers).toEqual([]);
  });
});
