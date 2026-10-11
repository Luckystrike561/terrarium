import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeModule } from '../src/providers/claude/claude.js';

/**
 * Multi-server hook fan-out: the hook script broadcasts every event to every
 * live server (server/src/providers/claude/hooks/claude-hook.ts), so every
 * session on the machine -- tracked project dir or not -- is adopted. These
 * tests exercise AgentRuntime's onExternalSessionDetected callback end-to-end
 * via handleHookEvent, not a mock.
 */
describe('AgentRuntime -- external session adoption', () => {
  let runtime: AgentRuntime;
  let store: AgentStateStore;

  afterEach(() => {
    // Clears the project-scan interval and any polling timer from adoption.
    runtime?.dispose();
  });

  /** A directory guaranteed untracked by any other test in this file or
   *  process (isTrackedProjectDir's backing Set is module-level and only
   *  ever grows -- see fileWatcher.ts -- so uniqueness keeps tests
   *  from leaking into each other). */
  function untrackedDir(): string {
    return path.join(os.tmpdir(), `pxl-session-test-${crypto.randomUUID()}`);
  }

  function fireSessionStartThenStop(sessionId: string, cwd: string): void {
    runtime.handleHookEvent('claude', {
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      source: 'startup',
      cwd,
    });
    runtime.handleHookEvent('claude', {
      hook_event_name: 'Stop',
      session_id: sessionId,
    });
  }

  it('adopts a session in a directory this instance never scanned', () => {
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [] });
    fireSessionStartThenStop('untracked-dir-session', untrackedDir());
    expect(store.size).toBe(1);
  });

  it('adopts a session under a project dir this instance has scanned', () => {
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [] });
    const dir = untrackedDir();
    runtime.startProjectScan(dir);
    fireSessionStartThenStop('tracked-dir-session', dir);
    expect(store.size).toBe(1);
  });
});
