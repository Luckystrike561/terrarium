import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeModule } from '../src/providers/claude/claude.js';
import { ompModule } from '../src/providers/omp/omp.js';

// The Claude module scans ~/.claude/projects: keep it in a temp home.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

/**
 * Multi-server hook fan-out: the hook script broadcasts every event to every
 * live server (server/src/providers/claude/hooks/claude-hook.ts), so every
 * session on the machine -- tracked project dir or not -- is adopted. These
 * tests drive the running Claude module end to end through the runtime's
 * hook route, not a mock.
 */
describe('AgentRuntime -- external session adoption', () => {
  let runtime: AgentRuntime | undefined;
  let store: AgentStateStore;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-runtime-home-'));
    store = new AgentStateStore();
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function untrackedDir(): string {
    return path.join(os.tmpdir(), `pxl-session-test-${crypto.randomUUID()}`);
  }

  function fireSessionStartThenStop(providerId: string, sessionId: string, cwd: string): void {
    runtime!.handleHookEvent(providerId, {
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      source: 'startup',
      cwd,
    });
    runtime!.handleHookEvent(providerId, {
      hook_event_name: 'Stop',
      session_id: sessionId,
    });
  }

  it('adopts a session in a directory this instance never scanned', () => {
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [] });
    runtime.startModules();
    fireSessionStartThenStop('claude', 'untracked-dir-session', untrackedDir());
    expect([...store.values()].map((a) => a.providerId)).toEqual(['claude']);
  });

  it('adopts a session under the workspace this instance scans', () => {
    const workspace = untrackedDir();
    vi.spyOn(process, 'cwd').mockReturnValue(workspace);
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [] });
    runtime.startModules();
    fireSessionStartThenStop('claude', 'tracked-dir-session', workspace);
    expect(store.size).toBe(1);
  });

  it('drops a hook POSTed to a module that is not enabled, or that takes no hooks', () => {
    runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
    runtime.startModules();
    fireSessionStartThenStop('claude', 'disabled-module-session', untrackedDir());
    fireSessionStartThenStop('omp', 'hookless-module-session', untrackedDir());
    expect(store.size).toBe(0);
  });
});
