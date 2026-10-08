import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearHooksAnswer,
  getHooksConsent,
  getHooksEnabled,
  grantHooksConsent,
  recordHooksDecline,
  setHooksEnabled as persistHooksEnabled,
} from '../src/configPersistence.js';
import type { ConsentEffects } from '../src/providers/consentExecutor.js';
import { applyConsentChoice } from '../src/providers/consentExecutor.js';

/**
 * consentExecutor is the half of the gate that performs an answer: which effects fire, in what order, and which of
 * configPersistence's own writes it makes directly. consentGate.test.ts already pins `consentActionFor`'s table, so
 * these never re-derive install/disable/revert/revertDecline/persistOff/none from a choice — they start from the
 * action each case is known to produce and pin the ORDER of effect calls and durable writes, the failure-path
 * degradation, revision chains, and the one-answer-at-a-time queue the ADR singles out as the point of this file.
 */

type EffectCall = { tag: string; method: keyof ConsentEffects; args: unknown[] };

interface FakeEffectsOptions {
  tag: string;
  log: EffectCall[];
  /** Consumed in order by successive `areHooksInstalled` calls; an `Error` makes that call reject. Exhausted calls
   *  fall back to `false`, so a case only needs to list as many entries as it actually reads. */
  installedSequence: Array<boolean | Error>;
  setHooksEnabled?: () => void | Promise<void>;
  uninstallHooks?: () => void | Promise<void>;
}

function makeEffects(opts: FakeEffectsOptions): ConsentEffects {
  const installedQueue = [...opts.installedSequence];
  return {
    async setHooksEnabled(enabled) {
      opts.log.push({ tag: opts.tag, method: 'setHooksEnabled', args: [enabled] });
      await opts.setHooksEnabled?.();
    },
    async uninstallHooks() {
      opts.log.push({ tag: opts.tag, method: 'uninstallHooks', args: [] });
      await opts.uninstallHooks?.();
    },
    async areHooksInstalled() {
      const next = installedQueue.length > 0 ? installedQueue.shift() : false;
      opts.log.push({ tag: opts.tag, method: 'areHooksInstalled', args: [] });
      if (next instanceof Error) throw next;
      return next as boolean;
    },
    syncHooksPreferenceOff() {
      opts.log.push({ tag: opts.tag, method: 'syncHooksPreferenceOff', args: [] });
    },
    async reportHooksStatus() {
      opts.log.push({ tag: opts.tag, method: 'reportHooksStatus', args: [] });
    },
  };
}

/** Used by three or more cases below that need the same call-sequence shape asserted without the `args` noise. */
function methods(log: EffectCall[]): Array<EffectCall['method']> {
  return log.map((call) => call.method);
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** `Promise.withResolvers` is unavailable under this project's configured TS lib target, and the serialization tests
 *  below need resolvers decoupled from the executor to signal readiness without a real timer. Used by all three
 *  queue tests, which is why it earns its own name rather than being inlined three times. */
function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('consentExecutor', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-consent-executor-'));
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

  describe('effect order per action', () => {
    it('install reads the fresh disk state once, then delegates the whole grant+install+persist path to one effect', async () => {
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'install',
        makeEffects({ tag: 'A', log, installedSequence: [false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'setHooksEnabled', args: [true] },
      ]);
    });

    it('never with nothing installed persists the decline without ever touching the settings file', async () => {
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'never',
        makeEffects({ tag: 'A', log, installedSequence: [false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'syncHooksPreferenceOff', args: [] },
        { tag: 'A', method: 'reportHooksStatus', args: [] },
      ]);
      expect(getHooksConsent('claude')).toBe('declined');
      expect(getHooksEnabled('claude')).toBe(false);
    });

    it('never over live hooks takes the full toggle-off path and persists the decline only once the disk agrees', async () => {
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'never',
        makeEffects({ tag: 'A', log, installedSequence: [true, false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'setHooksEnabled', args: [false] },
        { tag: 'A', method: 'areHooksInstalled', args: [] },
      ]);
      expect(getHooksConsent('claude')).toBe('declined');
    });

    it('notNow over a grant with live hooks uninstalls, then clears the grant only once removal is verified', async () => {
      grantHooksConsent('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [true, false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'uninstallHooks', args: [] },
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'reportHooksStatus', args: [] },
      ]);
      expect(getHooksConsent('claude')).toBe('unanswered');
    });

    it('notNow over a grant with nothing on disk clears it unconditionally, without ever calling uninstall', async () => {
      grantHooksConsent('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'reportHooksStatus', args: [] },
      ]);
      expect(getHooksConsent('claude')).toBe('unanswered');
    });

    it('notNow over a decline with nothing installed restores the default unconditionally', async () => {
      recordHooksDecline('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'reportHooksStatus', args: [] },
      ]);
      expect(getHooksConsent('claude')).toBe('unanswered');
      expect(getHooksEnabled('claude')).toBe(true);
    });

    it('notNow over a decline with stray entries on disk uninstalls first, then restores the default', async () => {
      recordHooksDecline('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [true, false] }),
      );

      expect(log).toEqual([
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'uninstallHooks', args: [] },
        { tag: 'A', method: 'areHooksInstalled', args: [] },
        { tag: 'A', method: 'reportHooksStatus', args: [] },
      ]);
      expect(getHooksConsent('claude')).toBe('unanswered');
      expect(getHooksEnabled('claude')).toBe(true);
    });

    it('an unrecognized choice reads the disk once and writes nothing at all', async () => {
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        { weird: true },
        makeEffects({ tag: 'A', log, installedSequence: [false] }),
      );

      expect(log).toEqual([{ tag: 'A', method: 'areHooksInstalled', args: [] }]);
      expect(getHooksConsent('claude')).toBe('unanswered');
    });
  });

  describe('on-disk disagreement withholds the durable write', () => {
    it('a disable whose post-uninstall read still shows hooks installed never persists the decline', async () => {
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'never',
        makeEffects({ tag: 'A', log, installedSequence: [true, true] }),
      );

      expect(getHooksConsent('claude')).toBe('unanswered');
    });

    it('a revert that cannot verify its uninstall keeps the grant and still reports the true (installed) status', async () => {
      grantHooksConsent('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [true, true] }),
      );

      expect(getHooksConsent('claude')).toBe('granted');
      expect(methods(log)).toEqual([
        'areHooksInstalled',
        'uninstallHooks',
        'areHooksInstalled',
        'reportHooksStatus',
      ]);
    });

    it('a revertDecline that cannot verify its uninstall keeps the decline and its hooks-off preference', async () => {
      recordHooksDecline('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [true, true] }),
      );

      expect(getHooksConsent('claude')).toBe('declined');
      expect(getHooksEnabled('claude')).toBe(false);
      expect(methods(log)).toEqual([
        'areHooksInstalled',
        'uninstallHooks',
        'areHooksInstalled',
        'reportHooksStatus',
      ]);
    });

    it('fail-closed: an unreadable settings file degrades to installed:false and a grant-only revert never attempts an uninstall', async () => {
      grantHooksConsent('claude');
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'A', log, installedSequence: [new Error('EACCES')] }),
      );

      expect(methods(log)).toEqual(['areHooksInstalled', 'reportHooksStatus']);
      expect(getHooksConsent('claude')).toBe('unanswered');
    });
  });

  describe('an effect that violates the never-reject contract is backstopped', () => {
    let consoleErrorSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('a throwing setHooksEnabled is swallowed, logged, and does not block the queue', async () => {
      const log: EffectCall[] = [];
      const throwing = makeEffects({
        tag: 'A',
        log,
        installedSequence: [false],
        setHooksEnabled: () => {
          throw new Error('install exploded');
        },
      });

      await applyConsentChoice('claude', 'install', throwing);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Pixel Agents] Consent action failed:',
        expect.any(Error),
      );
      // Nothing downstream of the throw ran, and the throw itself happens
      // before any config write in the 'install' arm.
      expect(getHooksConsent('claude')).toBe('unanswered');
    });

    it('a throwing uninstallHooks mid-revert is caught, leaving the grant exactly as the last good state left it', async () => {
      grantHooksConsent('claude');
      const log: EffectCall[] = [];
      const throwing = makeEffects({
        tag: 'A',
        log,
        installedSequence: [true],
        uninstallHooks: () => {
          throw new Error('fs blew up');
        },
      });

      await applyConsentChoice('claude', 'notNow', throwing);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(getHooksConsent('claude')).toBe('granted');
    });

    it('a failure in one answer never blocks the next answer queued behind it', async () => {
      const log: EffectCall[] = [];
      const throwing = makeEffects({
        tag: 'A',
        log,
        installedSequence: [false],
        setHooksEnabled: () => {
          throw new Error('install exploded');
        },
      });
      const healthy = makeEffects({ tag: 'B', log, installedSequence: [false] });

      const first = applyConsentChoice('claude', 'install', throwing);
      const second = applyConsentChoice('claude', 'never', healthy);
      await Promise.all([first, second]);

      expect(log.filter((call) => call.tag === 'B').map((call) => call.method)).toEqual([
        'areHooksInstalled',
        'syncHooksPreferenceOff',
        'reportHooksStatus',
      ]);
      expect(getHooksConsent('claude')).toBe('declined');
    });
  });

  describe('revisions undo exactly what the earlier answer left', () => {
    it('install (granted, nothing landed) then notNow clears the orphaned grant through a real answer', async () => {
      const log: EffectCall[] = [];
      // The install's own write failed, so the grant is recorded with
      // nothing on disk — the population the ADR's failed-install case names.
      grantHooksConsent('claude');

      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'revert', log, installedSequence: [false] }),
      );

      expect(getHooksConsent('claude')).toBe('unanswered');
    });

    it('a decline, then a revised notNow, restores the world to exactly unanswered', async () => {
      const log: EffectCall[] = [];
      await applyConsentChoice(
        'claude',
        'never',
        makeEffects({ tag: 'decline', log, installedSequence: [false] }),
      );
      expect(getHooksConsent('claude')).toBe('declined');
      expect(getHooksEnabled('claude')).toBe(false);

      await applyConsentChoice(
        'claude',
        'notNow',
        makeEffects({ tag: 'revert', log, installedSequence: [false] }),
      );

      expect(getHooksConsent('claude')).toBe('unanswered');
      expect(getHooksEnabled('claude')).toBe(true);
    });

    it('install, then never, then notNow ends unanswered — not at the decline the middle answer wrote', async () => {
      const log: EffectCall[] = [];
      const disk = { installed: false };
      const providerId = 'claude';

      function makeChainEffects(tag: string): ConsentEffects {
        return {
          async setHooksEnabled(enabled) {
            log.push({ tag, method: 'setHooksEnabled', args: [enabled] });
            disk.installed = enabled;
            if (enabled) grantHooksConsent(providerId);
            persistHooksEnabled(providerId, enabled);
          },
          async uninstallHooks() {
            log.push({ tag, method: 'uninstallHooks', args: [] });
            disk.installed = false;
          },
          async areHooksInstalled() {
            log.push({ tag, method: 'areHooksInstalled', args: [] });
            return disk.installed;
          },
          syncHooksPreferenceOff() {
            log.push({ tag, method: 'syncHooksPreferenceOff', args: [] });
          },
          async reportHooksStatus() {
            log.push({ tag, method: 'reportHooksStatus', args: [] });
          },
        };
      }

      await applyConsentChoice(providerId, 'install', makeChainEffects('install'));
      expect(getHooksConsent(providerId)).toBe('granted');
      expect(getHooksEnabled(providerId)).toBe(true);

      await applyConsentChoice(providerId, 'never', makeChainEffects('never'));
      expect(getHooksConsent(providerId)).toBe('declined');
      expect(getHooksEnabled(providerId)).toBe(false);
      expect(disk.installed).toBe(false);

      await applyConsentChoice(providerId, 'notNow', makeChainEffects('notNow'));
      expect(getHooksConsent(providerId)).toBe('unanswered');
      expect(getHooksEnabled(providerId)).toBe(true);
    });

    it('clearHooksAnswer leaves a never-answered provider indistinguishable from one untouched', () => {
      // Pin the "no leftovers at all" baseline the revision tests above
      // converge on, using the real function the revertDecline arm calls.
      clearHooksAnswer('claude');
      expect(getHooksConsent('claude')).toBe('unanswered');
      expect(getHooksEnabled('claude')).toBe(true);
    });
  });

  describe('one process-wide queue serializes every answer', () => {
    it('two answers for the SAME provider never interleave: the second waits for the first to fully settle', async () => {
      const log: EffectCall[] = [];
      const gate = createDeferred<void>();
      const firstEffectStarted = createDeferred<void>();

      const first = applyConsentChoice(
        'claude',
        'install',
        makeEffects({
          tag: 'A',
          log,
          installedSequence: [false],
          setHooksEnabled: async () => {
            firstEffectStarted.resolve();
            await gate.promise;
          },
        }),
      );

      await firstEffectStarted.promise;

      const second = applyConsentChoice(
        'claude',
        'never',
        makeEffects({ tag: 'B', log, installedSequence: [false] }),
      );
      // Structural, not timing-based: the queue chains on the FIRST answer's
      // still-pending promise, so the second's runner cannot have been
      // scheduled yet, let alone have read a single effect.
      expect(log.every((call) => call.tag === 'A')).toBe(true);

      gate.resolve();
      await Promise.all([first, second]);

      expect(log.map((call) => call.tag)).toEqual(['A', 'A', 'B', 'B', 'B']);
    });

    it('answers for DIFFERENT providers still serialize: they share one config.json and one queue', async () => {
      const log: EffectCall[] = [];
      const gate = createDeferred<void>();
      const firstEffectStarted = createDeferred<void>();

      const first = applyConsentChoice(
        'claude',
        'never',
        makeEffects({
          tag: 'claude',
          log,
          installedSequence: [true, false],
          setHooksEnabled: async () => {
            firstEffectStarted.resolve();
            await gate.promise;
          },
        }),
      );

      await firstEffectStarted.promise;

      const second = applyConsentChoice(
        'other-provider',
        'never',
        makeEffects({ tag: 'other-provider', log, installedSequence: [false] }),
      );
      expect(log.every((call) => call.tag === 'claude')).toBe(true);

      gate.resolve();
      await Promise.all([first, second]);

      expect(log.map((call) => call.tag)).toEqual([
        'claude',
        'claude',
        'claude',
        'other-provider',
        'other-provider',
        'other-provider',
      ]);
      expect(getHooksConsent('claude')).toBe('declined');
      expect(getHooksConsent('other-provider')).toBe('declined');
    });

    it('a rejecting first answer still releases the queue before the second answer starts', async () => {
      const log: EffectCall[] = [];
      const gate = createDeferred<void>();
      const firstEffectStarted = createDeferred<void>();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const first = applyConsentChoice(
        'claude',
        'install',
        makeEffects({
          tag: 'A',
          log,
          installedSequence: [false],
          setHooksEnabled: async () => {
            firstEffectStarted.resolve();
            await gate.promise;
          },
        }),
      );

      await firstEffectStarted.promise;

      const second = applyConsentChoice(
        'claude',
        'never',
        makeEffects({ tag: 'B', log, installedSequence: [false] }),
      );
      expect(log.every((call) => call.tag === 'A')).toBe(true);

      gate.reject(new Error('install exploded after the fact'));
      await Promise.all([first, second]);

      expect(log.map((call) => call.tag)).toEqual(['A', 'A', 'B', 'B', 'B']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Pixel Agents] Consent action failed:',
        expect.any(Error),
      );
      expect(getHooksConsent('claude')).toBe('declined');
      consoleErrorSpy.mockRestore();
    });
  });
});
