import fs from 'fs';
import path from 'path';

import { expect, test } from '../../../fixtures/standalone';
import {
  idlePrompt,
  permissionRequest,
  preToolUseBash,
  sendHookEvent,
  sessionEndExit,
  sessionStartStartup,
} from '../../../helpers/hooks';
import {
  claudeScenario,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../../helpers/mock-claude';
import { expectNoOverlay, expectOverlayCount, expectOverlayVisible } from '../../../helpers/office';
import { getClaudeProjectDir } from '../../../helpers/team';

test.describe('Hooks ON / lifecycle', () => {
  // verify playDoneSound() fires on agentStatus: 'waiting'.
  // The webview's notificationSound.ts records every invocation into
  // window.__terrariumTestHooks.playedSounds (a test-only marker). We
  // trigger waiting state by sending an idle_prompt notification hook (the
  // same hook path the spawn-paths test uses to surface "Might be waiting for
  // input") and assert the sound was dispatched.
  test('done sound chime fires on agentStatus waiting @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, hookServerConfig, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'done-chime-session';

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      scenario: claudeScenario('done sound chime smoke').holdOpenFor(3_000).build(),
      sessionId,
    });

    const projectDir = getClaudeProjectDir(tmpHome, workspaceDir);
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);

    // SessionStart registers the session with the hook server so that the next
    // event (PreToolUseBash) drives the agent visible rather than landing in the
    // pre-registration buffer.
    await sendHookEvent(
      hookServerConfig,
      sessionStartStartup(sessionId, workspaceDir, transcriptPath),
    );

    // Drive the agent active first (so the waiting transition is a real state
    // change rather than a no-op on a never-active agent).
    await sendHookEvent(hookServerConfig, preToolUseBash(sessionId, 'npm test'));
    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('external agent active — "Running: npm test"');

    // Reset the marker AFTER active-state dispatch so we only capture sounds
    // triggered by the idle_prompt under test.
    await page.evaluate(() => {
      const w = window as Window & {
        __terrariumTestHooks?: { playedSounds?: unknown[] };
      };
      if (w.__terrariumTestHooks) w.__terrariumTestHooks.playedSounds = [];
    });

    narrator.step('sending an idle_prompt to flip the agent to waiting');
    await sendHookEvent(hookServerConfig, idlePrompt(sessionId));
    await expectOverlayVisible(page, 'Waiting for input');
    narrator.check('overlay shows "Waiting for input"');

    narrator.step(
      'checking a "done" chime was dispatched (test hook — the chime is not audible in the video)',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const w = window as Window & {
              __terrariumTestHooks?: { playedSounds?: Array<{ kind: string }> };
            };
            return (w.__terrariumTestHooks?.playedSounds ?? []).map((s) => s.kind);
          }),
        { timeout: 5_000 },
      )
      .toContain('done');
    narrator.check('playedSounds contains a "done" entry');
  });

  // verify restored agents skip the matrix-rain spawn animation.
  //
  // Invariant: characters created from the existingAgents payload pass
  // skipSpawnEffect=true. If someone drops that arg, restored agents would
  // briefly show matrixEffect='spawn' for ~300ms (the matrix rain animation),
  // regressing the "instant restore" UX.
  //
  // Trigger: reload the page while the server (and its registered agent) keeps
  // running. The reload re-mounts the SPA, sends a fresh webviewReady, and the
  // server unconditionally resends existingAgents on every webviewReady.
  //
  // Observable: window.__terrariumTestHooks.getCharacters() (exposed from
  // App.tsx) returns a snapshot of character.matrixEffect. The addAgentLog
  // captures matrixEffect AT addAgent time (synchronous inside the wrapper),
  // immune to the ~300ms matrix-effect lifetime race a snapshot read would hit.
  test('restored agents skip the matrix spawn animation @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'restore-skip-spawn-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step('spawning an agent, then reloading the page to force a fresh restore');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('restored agents skip spawn effect')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(preToolUseBash(sessionId, 'npm test') as Record<string, unknown>)
        .holdOpenFor(20_000)
        .build(),
    });

    await expectOverlayCount(page, 1);
    narrator.check('one agent after the initial spawn');

    // Let the original spawn animation finish so we don't confuse it with
    // the post-restore observation (matrix effect lives ~300ms; 800ms cushion).
    await page.waitForTimeout(800);

    narrator.step('reloading the page to restore existingAgents against the still-running server');
    await standalone.reloadPage();

    // The fresh page has an empty addAgentLog. Wait until restoreAgents has
    // run (existingAgents → layoutLoaded → addAgent), then read the log.
    narrator.step(
      'the whole signal is a test-hook read: every restored agent must skip the spawn effect',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const w = window as Window & {
              __terrariumTestHooks?: { addAgentLog?: unknown[] };
            };
            return w.__terrariumTestHooks?.addAgentLog?.length ?? 0;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const log = await page.evaluate(() => {
      const w = window as Window & {
        __terrariumTestHooks?: {
          addAgentLog?: Array<{
            id: number;
            skipSpawnEffect: boolean | undefined;
            matrixEffectAtCreation: string | null;
          }>;
        };
      };
      return w.__terrariumTestHooks?.addAgentLog ?? [];
    });

    // Every addAgent call against this fresh page comes from the restore path
    // (there's no agentCreated message between page load and our read).
    // Each must have skipSpawnEffect=true and matrixEffect=null at creation.
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(entry.skipSpawnEffect).toBe(true);
      expect(entry.matrixEffectAtCreation).toBeNull();
    }
    narrator.check('every restored agent created with skipSpawnEffect=true and no matrix effect');
  });

  // verify formatToolStatus produces the right overlay text for every
  // PreToolUse'd tool, not just Bash. Every other e2e test fires Bash and
  // asserts "Running: npm test"; the 9 other tool-name branches in
  // claudeModule.formatToolStatus had zero direct coverage prior to this.
  //
  // Each entry below maps a hook payload (tool_name + tool_input) to the
  // expected overlay text. If formatToolStatus regresses, this test catches
  // it. The agent stays the same throughout; each PreToolUse swaps the
  // active tool text, and PostToolUse clears it before the next.
  test('tool status text matches every PreToolUse tool name @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'tool-status-matrix-session';

    // Task / Agent tools follow the sub-character code path (covered by the basic-spawn test)
    // and don't change the parent overlay text — they're excluded here.
    // WebSearch returns "Searching the web" but is covered implicitly by
    // the same code branch as Glob/Grep; one Search variant is enough.
    type ToolCase = { toolName: string; toolInput: Record<string, unknown>; expectedText: string };
    const cases: ToolCase[] = [
      { toolName: 'Read', toolInput: { file_path: '/x/foo.ts' }, expectedText: 'Reading foo.ts' },
      { toolName: 'Edit', toolInput: { file_path: '/x/bar.ts' }, expectedText: 'Editing bar.ts' },
      { toolName: 'Write', toolInput: { file_path: '/x/baz.ts' }, expectedText: 'Writing baz.ts' },
      { toolName: 'Glob', toolInput: { pattern: '**/*.ts' }, expectedText: 'Searching files' },
      { toolName: 'Grep', toolInput: { pattern: 'foo' }, expectedText: 'Searching code' },
      {
        toolName: 'WebFetch',
        toolInput: { url: 'https://x' },
        expectedText: 'Fetching web content',
      },
    ];

    // Scenario-driven with 3s per tool phase: each PostToolUse clears the prior
    // tool, the paired PreToolUse 150ms later swaps in the next one, and the 3s
    // phase keeps every label on screen long enough for the run video AND gives
    // the polling assertions seconds of slack. The first Bash phase runs
    // t+0.7s→5s because the external session needs a moment to be adopted
    // before assertions start.
    const scenarioBuilder = claudeScenario('tool status text matrix')
      .at(200)
      .emitHook(
        sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<string, unknown>,
      )
      .at(700)
      .emitHook(preToolUseBash(sessionId, 'npm test') as Record<string, unknown>);
    const CASE_BASE_MS = 5_000;
    const CASE_PHASE_MS = 3_000;
    cases.forEach((c, index) => {
      const atMs = CASE_BASE_MS + index * CASE_PHASE_MS;
      scenarioBuilder
        .at(atMs)
        .emitHook({ session_id: sessionId, hook_event_name: 'PostToolUse' })
        .at(atMs + 150)
        .emitHook({
          session_id: sessionId,
          hook_event_name: 'PreToolUse',
          tool_name: c.toolName,
          tool_input: c.toolInput,
        });
    });
    const sessionEndAtMs = CASE_BASE_MS + cases.length * CASE_PHASE_MS + 500;
    scenarioBuilder
      .at(sessionEndAtMs)
      .emitHook(sessionEndExit(sessionId) as Record<string, unknown>)
      .holdOpenFor(sessionEndAtMs + 2_000);

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      scenario: scenarioBuilder.build(),
      sessionId,
    });

    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('agent active — "Running: npm test"');

    narrator.step('cycling through Read, Edit, Write, Glob, Grep, WebFetch — one tool every 3s');
    for (const c of cases) {
      await expectOverlayVisible(page, c.expectedText);
    }
    narrator.check(
      'each tool shows its exact status: Reading foo.ts, Editing bar.ts, Writing baz.ts, Searching files/code, Fetching web content',
    );

    narrator.step('waiting for SessionEnd to remove the character');
    await expectOverlayCount(page, 0);
    narrator.check('SessionEnd removes the character (count → 0)');
  });

  // verify playPermissionSound fires on agentToolPermission.
  // Companion to the done-sound test (which fires on agentStatus: waiting) — same
  // playedSounds instrumentation, just the other sound function.
  test('permission sound chime fires on agentToolPermission @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, hookServerConfig, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'permission-chime-session';

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      scenario: claudeScenario('permission sound chime smoke').holdOpenFor(3_000).build(),
      sessionId,
    });

    const projectDir = getClaudeProjectDir(tmpHome, workspaceDir);
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
    await sendHookEvent(
      hookServerConfig,
      sessionStartStartup(sessionId, workspaceDir, transcriptPath),
    );
    await sendHookEvent(hookServerConfig, preToolUseBash(sessionId, 'npm test'));
    await expectOverlayCount(page, 1);
    narrator.check('external agent active');

    // Reset the marker right before the action under test, so any earlier
    // sounds (none expected from the spawn, but defensive) are ignored.
    await page.evaluate(() => {
      const w = window as Window & {
        __terrariumTestHooks?: { playedSounds?: unknown[] };
      };
      if (w.__terrariumTestHooks) w.__terrariumTestHooks.playedSounds = [];
    });

    narrator.step('sending a permissionRequest hook to raise the approval bubble');
    await sendHookEvent(hookServerConfig, permissionRequest(sessionId));
    await expectOverlayVisible(page, 'Needs approval');
    narrator.check('"Needs approval" bubble is visible');

    narrator.step(
      'checking a "permission" chime was dispatched (test hook — not audible in the video)',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const w = window as Window & {
              __terrariumTestHooks?: { playedSounds?: Array<{ kind: string }> };
            };
            return (w.__terrariumTestHooks?.playedSounds ?? []).map((s) => s.kind);
          }),
        { timeout: 5_000 },
      )
      .toContain('permission');
    narrator.check('playedSounds contains a "permission" entry');
  });

  // The server installs the terrarium hook into ~/.claude/settings.json on
  // startup. Historical bugs around clobbering pre-existing third-party hook
  // entries make this a real bug surface; unit tests cover the installer with
  // mocked fs, this e2e covers the actual install landing on disk.
  //
  // These helpers match our hook entries on the script name alone
  // ('claude-hook.js' or the legacy 'pixel-agents-hook.js'), which is fine
  // here: every command the installer writes contains the full path.

  interface ClaudeHookSettings {
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  }

  function readClaudeSettings(tmpHome: string): ClaudeHookSettings {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  }

  function terrariumHookPresent(settings: ClaudeHookSettings, eventName: string): boolean {
    const entries = settings.hooks?.[eventName] ?? [];
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        if (h.command?.includes('claude-hook.js') || h.command?.includes('pixel-agents-hook.js')) {
          return true;
        }
      }
    }
    return false;
  }

  // the server installs the terrarium hook on startup with the default
  // hooksEnabled=true. Sanity check — if this fails, claudeHookInstaller never
  // ran, and every other hooks-on test is operating against an empty
  // settings.json (i.e., hooks are silently no-op'd).
  test('terrarium hook is installed in settings.json on server startup @area:cross-cutting', async ({
    standalone,
  }) => {
    const { tmpHome, narrator } = standalone;

    narrator.step('reading ~/.claude/settings.json after startup — the hook must be installed');
    await waitForClaudeHookSetup(tmpHome);
    const settings = readClaudeSettings(tmpHome);

    // installHooks writes entries for every hook event the provider supports.
    // SessionStart and PreToolUse are the load-bearing ones; if those are present,
    // installation succeeded.
    expect(terrariumHookPresent(settings, 'SessionStart')).toBe(true);
    expect(terrariumHookPresent(settings, 'PreToolUse')).toBe(true);
    narrator.check(
      '~/.claude/settings.json has the terrarium hook under both SessionStart and PreToolUse',
    );
  });

  // A fresh PreToolUse clears any stale "Needs approval" bubble unless the new
  // tool itself requests permission — otherwise the bubble would linger across
  // tool transitions inside the same session.
  test('permission bubble auto-clears when a fresh PreToolUse arrives @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'permission-bubble-clear-session';

    // Scenario-driven with ~4s phases: every state is visible in the run video.
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('permission bubble auto-clear')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(preToolUseBash(sessionId, 'npm test') as Record<string, unknown>)
        .at(4_500)
        .emitHook(permissionRequest(sessionId) as Record<string, unknown>)
        // Fresh PreToolUse without permissionActive must clear the bubble and
        // swap the overlay text to the new tool's status string.
        .at(8_500)
        .emitHook({ session_id: sessionId, hook_event_name: 'PostToolUse' })
        .at(8_650)
        .emitHook({
          session_id: sessionId,
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: '/x/foo.ts' },
        })
        .holdOpenFor(13_000)
        .build(),
    });

    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('agent active — "Running: npm test"');

    await expectOverlayVisible(page, 'Needs approval');
    narrator.check('"Needs approval" bubble is up');

    narrator.step('a fresh PreToolUse(Read) arrives, as if the user approved in the terminal');
    await expectOverlayVisible(page, 'Reading foo.ts');
    await expectNoOverlay(page, 'Needs approval', 2_000);
    narrator.check('overlay swaps to "Reading foo.ts"; the stale approval bubble is gone');
  });
});
