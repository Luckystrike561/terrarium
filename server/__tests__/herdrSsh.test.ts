import * as fs from 'fs';
import type * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  MultiplexedAgent,
  MultiplexerLinkState,
  MultiplexerWatcher,
} from '../../core/src/provider.js';
import { herdrSocketPath } from '../src/providers/herdr/herdrSocket.js';
import {
  HerdrSshLink,
  probeOverSsh,
  resolveRemoteSocketPath,
  type SshTransportOptions,
} from '../src/providers/herdr/herdrSsh.js';
import { defaultState, startFakeHerdr } from './fakeHerdr.js';

const FAKE_SSH = path.join(__dirname, '../../e2e/fixtures/fake-ssh.cjs');
const WAIT_TIMEOUT_MS = 5000;
const WAIT_POLL_MS = 20;
/** OpenSSH writes why the channel failed and resets the local connection. Which reaches the server first varies, so
 *  either the SSH reason or the reset names the host. */
const HERDR_DOWN_ON_BUILDBOX =
  /^(herdr did not answer on buildbox: channel \d+: open failed|herdr dropped the connection on buildbox)/;

/** Polls a condition on the real clock: these tests drive a real `ssh` stand-in subprocess and real sockets, whose
 *  I/O fake timers cannot advance. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was never met');
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('herdrSocketPath', () => {
  const home = '/home/luc';
  const lookup = (session: string | undefined, env: Record<string, string | undefined>) =>
    herdrSocketPath({ session, home, env, paths: path.posix });

  it("resolves in herdr's order: explicit session, HERDR_SOCKET_PATH, HERDR_SESSION, default", () => {
    const env = { HERDR_SOCKET_PATH: '/run/herdr.sock', HERDR_SESSION: 'night' };
    expect(lookup('blue', env)).toBe('/home/luc/.config/herdr/sessions/blue/herdr.sock');
    expect(lookup(undefined, env)).toBe('/run/herdr.sock');
    expect(lookup(undefined, { HERDR_SESSION: 'night' })).toBe(
      '/home/luc/.config/herdr/sessions/night/herdr.sock',
    );
    expect(lookup(undefined, {})).toBe('/home/luc/.config/herdr/herdr.sock');
  });

  it('treats empty overrides as unset, as a remote shell prints them', () => {
    expect(lookup(undefined, { HERDR_SOCKET_PATH: '', HERDR_SESSION: '' })).toBe(
      '/home/luc/.config/herdr/herdr.sock',
    );
  });
});

describe.skipIf(process.platform === 'win32')('herdr over SSH (fake OpenSSH client)', () => {
  let tmpDir: string;
  let binDir: string;
  let remoteHome: string;
  let remoteSocket: string;
  let herdr: net.Server | undefined;

  function options(
    target: string,
    overrides: Partial<SshTransportOptions> = {},
  ): SshTransportOptions {
    return {
      target,
      localSocketPath: path.join(tmpDir, 'local', `${target}.sock`),
      sshCommand: path.join(binDir, 'ssh'),
      ...overrides,
    };
  }

  function sshPids(): number[] {
    const log = path.join(binDir, 'fake-ssh-pids.log');
    if (!fs.existsSync(log)) return [];
    return fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => Number(line.split(' ')[0]));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-ssh-'));
    binDir = path.join(tmpDir, 'bin');
    remoteHome = path.join(tmpDir, 'remote');
    remoteSocket = path.join(remoteHome, '.config', 'herdr', 'herdr.sock');
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(FAKE_SSH, path.join(binDir, 'ssh'));
    fs.chmodSync(path.join(binDir, 'ssh'), 0o755);
    fs.writeFileSync(
      path.join(binDir, 'fake-ssh-hosts.json'),
      JSON.stringify({
        buildbox: { home: remoteHome },
        nightly: { home: remoteHome, env: { HERDR_SESSION: 'night' } },
        locked: { home: remoteHome, refuse: 'luc@locked: Permission denied (publickey).' },
      }),
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (herdr ? herdr.close(() => resolve()) : resolve()));
    herdr = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveRemoteSocketPath', () => {
    it("finds the default socket under the remote home, or the session's", async () => {
      expect(await resolveRemoteSocketPath(options('buildbox'))).toEqual({
        socketPath: remoteSocket,
      });
      expect(await resolveRemoteSocketPath(options('buildbox', { session: 'blue' }))).toEqual({
        socketPath: path.join(remoteHome, '.config', 'herdr', 'sessions', 'blue', 'herdr.sock'),
      });
    });

    it('honours the remote HERDR_SESSION unless a session was named', async () => {
      const night = path.join(remoteHome, '.config', 'herdr', 'sessions', 'night', 'herdr.sock');
      expect(await resolveRemoteSocketPath(options('nightly'))).toEqual({ socketPath: night });
      expect(await resolveRemoteSocketPath(options('nightly', { session: 'blue' }))).not.toEqual({
        socketPath: night,
      });
    });

    it("reports OpenSSH's own error text", async () => {
      expect(await resolveRemoteSocketPath(options('nowhere'))).toEqual({
        error: 'ssh: Could not resolve hostname nowhere: Name or service not known',
      });
      expect(await resolveRemoteSocketPath(options('locked'))).toEqual({
        error: 'luc@locked: Permission denied (publickey).',
      });
    });

    it('says so when there is no ssh to run', async () => {
      expect(
        await resolveRemoteSocketPath(
          options('buildbox', { sshCommand: path.join(tmpDir, 'none') }),
        ),
      ).toEqual({ error: 'ssh is not installed or not on PATH' });
    });
  });

  describe('probeOverSsh', () => {
    it('answers through a forward and leaves no ssh process behind', async () => {
      ({ server: herdr } = await startFakeHerdr(remoteSocket, defaultState()));

      expect(await probeOverSsh(options('buildbox'))).toBeUndefined();
      await waitFor(() => sshPids().every((pid) => !isAlive(pid)));
      expect(fs.existsSync(options('buildbox').localSocketPath)).toBe(false);
    });

    it('reports a remote host without herdr, and still cleans up', async () => {
      const error = await probeOverSsh(options('buildbox'));

      expect(error).toMatch(HERDR_DOWN_ON_BUILDBOX);
      await waitFor(() => sshPids().every((pid) => !isAlive(pid)));
    });

    it('reports an unreachable host with the SSH error text', async () => {
      expect(await probeOverSsh(options('nowhere'))).toBe(
        'ssh: Could not resolve hostname nowhere: Name or service not known',
      );
    });
  });

  describe('HerdrSshLink', () => {
    function watch(): {
      watcher: MultiplexerWatcher;
      states: { state: MultiplexerLinkState; message?: string }[];
      snapshots: (readonly MultiplexedAgent[])[];
    } {
      const states: { state: MultiplexerLinkState; message?: string }[] = [];
      const snapshots: (readonly MultiplexedAgent[])[] = [];
      return {
        watcher: {
          onSnapshot: (agents) => snapshots.push(agents),
          onState: (state, message) => states.push({ state, message }),
          log: () => {},
        },
        states,
        snapshots,
      };
    }

    it("reports the remote herdr's agents, and stop kills its ssh", async () => {
      const state = defaultState();
      state.agents = [{ pane_id: 'w1:p1', agent: 'omp', agent_status: 'blocked', cwd: '/srv/api' }];
      ({ server: herdr } = await startFakeHerdr(remoteSocket, state));
      const { watcher, states, snapshots } = watch();
      const link = new HerdrSshLink(options('buildbox'), watcher);

      link.start();
      await waitFor(() => snapshots.length > 0);

      expect(states.map((s) => s.state)).toEqual(['connecting', 'connected']);
      expect(snapshots[0]).toMatchObject([{ paneId: 'w1:p1', status: 'blocked', cwd: '/srv/api' }]);
      expect(sshPids().some(isAlive)).toBe(true);

      link.stop();
      await waitFor(() => sshPids().every((pid) => !isAlive(pid)));
    });

    it('reads as an error with the SSH text while the host is unreachable', async () => {
      const { watcher, states } = watch();
      const link = new HerdrSshLink(options('nowhere'), watcher);

      link.start();
      await waitFor(() => states.length > 1);
      link.stop();

      expect(states).toEqual([
        { state: 'connecting', message: undefined },
        {
          state: 'error',
          message: 'ssh: Could not resolve hostname nowhere: Name or service not known',
        },
      ]);
    });

    it('reads as an error naming the host while its herdr is down', async () => {
      const { watcher, states } = watch();
      const link = new HerdrSshLink(options('buildbox'), watcher);

      link.start();
      await waitFor(() => states.length > 1);
      link.stop();

      expect(states[1]?.state).toBe('error');
      expect(states[1]?.message).toMatch(HERDR_DOWN_ON_BUILDBOX);
    });
  });
});
