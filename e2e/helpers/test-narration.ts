import fs from 'fs';
import path from 'path';

/**
 * Test-action narrator: one line per action taken / assertion verified,
 * appended to `<tmpHome>/.claude-mock/test-narration.log` and attached to
 * failing tests next to the external sessions' own stdout log.
 *
 * Two ways to narrate:
 *   - the fixture exposes the handle `setNarrationContext` returns as
 *     `narrator` on the standalone payload, so tests call `narrator.step()` /
 *     `narrator.check()`;
 *   - `narrate` (module-level, same handle) lets shared helpers narrate
 *     universal moments (e.g. spawning an agent) without threading the handle
 *     through every call site. It no-ops until the fixture sets a context.
 *
 * STRICTLY COSMETIC. No assertion may depend on narration: deleting every
 * step()/check() call must leave all tests passing. Every failure here is
 * swallowed. The suite runs with workers:1, so the single module-level context
 * cannot cross-contaminate tests.
 */

export interface TestNarrator {
  /** Narrate an action the test is about to take. */
  step(message: string): void;
  /** Narrate an assertion that has just been verified. */
  check(message: string): void;
}

/** Per-test narration context, set by the fixture and cleared in teardown. */
let context: { logPath: string; startedAt: number } | null = null;

export function getTestNarrationLogPath(tmpHome: string): string {
  return path.join(tmpHome, '.claude-mock', 'test-narration.log');
}

/** Where spawnExternalClaudeScenario appends each external session's stdout. */
export function getExternalNarrationLogPath(tmpHome: string): string {
  return path.join(tmpHome, '.claude-mock', 'external-narration.log');
}

function write(marker: string, message: string): void {
  if (!context) return;
  const elapsedSeconds = ((Date.now() - context.startedAt) / 1000).toFixed(1);
  try {
    fs.appendFileSync(context.logPath, `[+${elapsedSeconds}s] [test] ${marker} ${message}\n`);
  } catch {
    // cosmetic: never fail the test over narration
  }
}

/**
 * Module-level narrator. Shared helpers import this and narrate freely; the
 * fixture also returns this exact handle from setNarrationContext so tests and
 * helpers write to the same per-test log. No-op when no context is set.
 */
export const narrate: TestNarrator = {
  step: (message) => write('▸', message),
  check: (message) => write('✓', message),
};

/**
 * Begin narration for a test and start its relative-timestamp clock. Returns
 * the module-level narrator for the fixture to expose.
 */
export function setNarrationContext(tmpHome: string): TestNarrator {
  const logPath = getTestNarrationLogPath(tmpHome);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    // cosmetic: a missing log just means empty narration
  }
  context = { logPath, startedAt: Date.now() };
  return narrate;
}

/** End narration for a test. Called by the fixture in teardown. */
export function clearNarrationContext(): void {
  context = null;
}
