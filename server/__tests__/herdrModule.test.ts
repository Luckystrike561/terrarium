import * as fs from 'fs';
import type * as net from 'net';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MultiplexedAgent,
  MultiplexerLinkState,
  MultiplexerWatcher,
} from '../../core/src/provider.js';
import { defaultState, startFakeHerdr } from './fakeHerdr.js';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

const { herdrModule } = await import('../src/providers/herdr/herdr.js');

const FAKE_SSH = path.join(__dirname, '../../e2e/fixtures/fake-ssh.cjs');
const WAIT_TIMEOUT_MS = 5000;
const WAIT_POLL_MS = 20;

/** Polls on the real clock: the module runs real sockets and, for SSH, a real `ssh` stand-in subprocess. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was never met');
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

function watch(): {
  watcher: MultiplexerWatcher;
  states: MultiplexerLinkState[];
  snapshots: (readonly MultiplexedAgent[])[];
} {
  const states: MultiplexerLinkState[] = [];
  const snapshots: (readonly MultiplexedAgent[])[] = [];
  return {
    watcher: {
      onSnapshot: (agents) => snapshots.push(agents),
      onState: (state) => states.push(state),
      log: () => {},
    },
    states,
    snapshots,
  };
}

describe('herdr module endpoints', () => {
  const savedEnv = { ...process.env };
  let herdr: net.Server | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-herdr-mod-'));
    delete process.env.HERDR_SOCKET_PATH;
    delete process.env.HERDR_SESSION;
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    await new Promise<void>((resolve) => (herdr ? herdr.close(() => resolve()) : resolve()));
    herdr = undefined;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("probes this machine's default socket, then a named session's", async () => {
    const defaultSocket = path.join(tmpHome, '.config', 'herdr', 'herdr.sock');
    expect(await herdrModule.probe({ id: 'local', kind: 'local' })).toBe(
      `no herdr socket at ${defaultSocket} (is herdr running?)`,
    );

    ({ server: herdr } = await startFakeHerdr(
      path.join(tmpHome, '.config', 'herdr', 'sessions', 'night', 'herdr.sock'),
      defaultState(),
    ));
    expect(await herdrModule.probe({ id: 'n', kind: 'local', session: 'night' })).toBeUndefined();
  });

  it('follows HERDR_SOCKET_PATH for the default local connection', async () => {
    const override = path.join(tmpHome, 'elsewhere.sock');
    process.env.HERDR_SOCKET_PATH = override;
    ({ server: herdr } = await startFakeHerdr(override, defaultState()));

    expect(await herdrModule.probe({ id: 'local', kind: 'local' })).toBeUndefined();
  });

  it('watches a local herdr until stopped', async () => {
    const state = defaultState();
    state.agents = [{ pane_id: 'w1:p1', agent: 'omp', agent_status: 'idle' }];
    ({ server: herdr } = await startFakeHerdr(
      path.join(tmpHome, '.config', 'herdr', 'herdr.sock'),
      state,
    ));
    const { watcher, states, snapshots } = watch();

    const link = herdrModule.connect({ id: 'local', kind: 'local' }, watcher);
    await waitFor(() => snapshots.length > 0);
    link.stop();

    expect(states).toEqual(['connecting', 'connected']);
    expect(snapshots[0].map((agent) => agent.paneId)).toEqual(['w1:p1']);
  });

  describe.skipIf(process.platform === 'win32')('over SSH', () => {
    beforeEach(() => {
      const binDir = path.join(tmpHome, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(FAKE_SSH, path.join(binDir, 'ssh'));
      fs.chmodSync(path.join(binDir, 'ssh'), 0o755);
      fs.writeFileSync(
        path.join(binDir, 'fake-ssh-hosts.json'),
        JSON.stringify({ buildbox: { home: path.join(tmpHome, 'remote') } }),
      );
      process.env.PATH = `${binDir}${path.delimiter}${savedEnv.PATH ?? ''}`;
    });

    it('forwards the remote socket to an owner-only directory, and probes through it', async () => {
      ({ server: herdr } = await startFakeHerdr(
        path.join(tmpHome, 'remote', '.config', 'herdr', 'herdr.sock'),
        defaultState(),
      ));
      const { watcher, states } = watch();

      expect(
        await herdrModule.probe({ id: 'c0ffee', kind: 'ssh', target: 'buildbox' }),
      ).toBeUndefined();
      const link = herdrModule.connect({ id: 'c0ffee', kind: 'ssh', target: 'buildbox' }, watcher);
      await waitFor(() => states.includes('connected'));

      const forwardDir = path.join(tmpHome, '.pixel-agents', 'herdr');
      expect(fs.existsSync(path.join(forwardDir, 'c0ffee.sock'))).toBe(true);
      expect(fs.statSync(forwardDir).mode & 0o777).toBe(0o700);

      link.stop();
      expect(fs.existsSync(path.join(forwardDir, 'c0ffee.sock'))).toBe(false);
    });

    it('refuses an ssh endpoint without a target', () => {
      expect(() => herdrModule.connect({ id: 'x', kind: 'ssh' }, watch().watcher)).toThrow(
        'ssh endpoint x has no target',
      );
    });
  });
});
