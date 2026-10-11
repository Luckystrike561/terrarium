/**
 * herdr has no network listener, so a herdr on another machine is reached the way herdr reaches it itself: over
 * OpenSSH. One `ssh -N -L <local socket>:<remote herdr socket>` per connection forwards the remote socket to a local
 * one, and the ordinary HerdrBridge talks to that. Every request the bridge makes is a new channel over the one SSH
 * connection, so herdr's one-shot request semantics carry over unchanged.
 *
 * Authentication stays with OpenSSH (agent, keys, `~/.ssh/config`). Nothing here stores or prompts for a credential.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type {
  ModuleHandle,
  MultiplexerLinkState,
  MultiplexerWatcher,
} from '../../../../core/src/provider.js';
import {
  HERDR_RPC_TIMEOUT_MS,
  SSH_BASE_OPTIONS,
  SSH_COMMAND,
  SSH_FORWARD_DIR_MODE,
  SSH_FORWARD_READY_POLL_MS,
  SSH_FORWARD_READY_TIMEOUT_MS,
  SSH_RESOLVE_TIMEOUT_MS,
  SSH_RESTART_DELAY_MS,
  SSH_STDERR_LINES_KEPT,
} from './constants.js';
import { HerdrBridge, herdrRequest } from './herdrBridge.js';
import { herdrSocketPath } from './herdrSocket.js';

/** Prints what herdr's socket resolution needs from the remote side. Wrapped in `sh -c` because the remote login shell
 *  may not be POSIX (fish), and kept free of single quotes so every shell passes it through verbatim. */
const REMOTE_SOCKET_ENV_COMMAND = String.raw`sh -c 'printf "%s\n" "$HOME" "$HERDR_SOCKET_PATH" "$HERDR_SESSION"'`;

const execFileAsync = promisify(execFile);

/** What a promisified execFile rejects with. */
interface SshExecError extends Error {
  readonly code?: string | number;
  readonly killed?: boolean;
  readonly stderr?: string;
}

export interface SshTransportOptions {
  /** SSH destination, validated by the caller: never empty, never starting with `-`. */
  readonly target: string;
  readonly session?: string;
  /** Where the local end of the forward is bound. Its directory is created owner-only. */
  readonly localSocketPath: string;
  /** Test seam: the `ssh` executable to run. */
  readonly sshCommand?: string;
}

/** Ask the remote side where its herdr socket is, resolved the way herdr resolves it there. */
export async function resolveRemoteSocketPath(
  options: SshTransportOptions,
): Promise<{ socketPath: string } | { error: string }> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      options.sshCommand ?? SSH_COMMAND,
      [...SSH_BASE_OPTIONS, '--', options.target, REMOTE_SOCKET_ENV_COMMAND],
      { timeout: SSH_RESOLVE_TIMEOUT_MS, encoding: 'utf8' },
    ));
  } catch (err) {
    return { error: describeSshFailure(err as SshExecError, options.target) };
  }
  const [home = '', socketOverride, sessionOverride] = stdout.split('\n');
  if (!home) return { error: `${options.target} reported no home directory` };
  return {
    socketPath: herdrSocketPath({
      session: options.session,
      home,
      env: { HERDR_SOCKET_PATH: socketOverride, HERDR_SESSION: sessionOverride },
      paths: path.posix,
    }),
  };
}

/** One running `ssh -L`. Closing it kills `ssh`. */
export class SshForward {
  private child: ChildProcess | null = null;
  private stderrLines: string[] = [];
  private closed = false;
  private exitListener: ((message: string) => void) | null = null;

  constructor(private readonly options: SshTransportOptions) {}

  /** Resolve the remote socket and bind the local end. Resolves with the error text, or undefined once the local
   *  socket accepts connections. */
  async open(): Promise<string | undefined> {
    const resolved = await resolveRemoteSocketPath(this.options);
    if ('error' in resolved) return resolved.error;
    if (this.closed) return 'the forward was closed while it was being set up';
    const { localSocketPath } = this.options;
    fs.mkdirSync(path.dirname(localSocketPath), { recursive: true, mode: SSH_FORWARD_DIR_MODE });
    // The readiness check below is the socket file appearing, so a stale one must not answer for it.
    fs.rmSync(localSocketPath, { force: true });

    const child = spawn(
      this.options.sshCommand ?? SSH_COMMAND,
      [
        ...SSH_BASE_OPTIONS,
        '-N',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'StreamLocalBindUnlink=yes',
        '-L',
        `${localSocketPath}:${resolved.socketPath}`,
        '--',
        this.options.target,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    this.child = child;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.recordStderr(chunk));

    return await new Promise<string | undefined>((resolve) => {
      let settled = false;
      const settle = (error: string | undefined): void => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(error);
      };
      const poll = setInterval(() => {
        if (fs.existsSync(localSocketPath)) settle(undefined);
      }, SSH_FORWARD_READY_POLL_MS);
      const deadline = setTimeout(() => {
        this.close();
        settle(
          this.recentError() ??
            `ssh to ${this.options.target} did not open the forward within ${SSH_FORWARD_READY_TIMEOUT_MS} ms`,
        );
      }, SSH_FORWARD_READY_TIMEOUT_MS);
      child.on('error', (err: NodeJS.ErrnoException) => {
        this.recordStderr(describeSpawnError(err.code));
      });
      child.on('close', (code) => {
        this.child = null;
        const message =
          this.recentError() ?? `ssh to ${this.options.target} exited with code ${code}`;
        settle(message);
        if (!this.closed) this.exitListener?.(message);
      });
    });
  }

  /** Called once if `ssh` exits on its own after open() succeeded. */
  onExit(listener: (message: string) => void): void {
    this.exitListener = listener;
  }

  /** The last line `ssh` wrote to stderr since the last clearErrors(), if any. */
  recentError(): string | undefined {
    return this.stderrLines.at(-1);
  }

  clearErrors(): void {
    this.stderrLines = [];
  }

  close(): void {
    this.closed = true;
    this.child?.kill();
    this.child = null;
    fs.rmSync(this.options.localSocketPath, { force: true });
  }

  private recordStderr(chunk: string): void {
    for (const line of chunk.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      this.stderrLines.push(text);
    }
    this.stderrLines = this.stderrLines.slice(-SSH_STDERR_LINES_KEPT);
  }
}

/** One `ping` round-trip through a fresh forward, closed afterwards. Resolves with the error text, or undefined. */
export async function probeOverSsh(options: SshTransportOptions): Promise<string | undefined> {
  const forward = new SshForward(options);
  try {
    const error = await forward.open();
    if (error) return error;
    const reply = await herdrRequest(options.localSocketPath, 'ping', HERDR_RPC_TIMEOUT_MS);
    if (!('error' in reply)) return undefined;
    return explainOverSsh(reply.error, options.target, forward.recentError());
  } finally {
    forward.close();
  }
}

/**
 * A herdr on another machine, watched until stop(): the forward is set up, the bridge runs over it, and when `ssh`
 * exits both are torn down and set up again after a delay. The bridge's own reconnect loop covers herdr restarting
 * behind a live forward.
 */
export class HerdrSshLink implements ModuleHandle {
  private forward: SshForward | null = null;
  private bridge: HerdrBridge | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private hasConnected = false;
  private stopped = false;

  constructor(
    private readonly options: SshTransportOptions,
    private readonly watcher: MultiplexerWatcher,
  ) {}

  start(): void {
    this.watcher.onState('connecting');
    void this.setUp();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.restartTimer ?? undefined);
    this.tearDown();
  }

  private async setUp(): Promise<void> {
    const forward = new SshForward(this.options);
    this.forward = forward;
    const error = await forward.open();
    if (this.stopped) {
      forward.close();
      return;
    }
    if (error) {
      this.fail(error);
      return;
    }
    forward.onExit((message) => this.fail(message));
    this.bridge = new HerdrBridge({
      socketPath: this.options.localSocketPath,
      watcher: {
        onSnapshot: (agents) => this.watcher.onSnapshot(agents),
        log: (message) => this.watcher.log(message),
        onState: (state, message) => this.onBridgeState(forward, state, message),
      },
    });
    this.bridge.start();
  }

  private onBridgeState(
    forward: SshForward,
    state: MultiplexerLinkState,
    message: string | undefined,
  ): void {
    // This link reported its own `connecting` already, and a bridge restarted after a lost forward must keep reading
    // as reconnecting.
    if (state === 'connecting') return;
    if (state === 'connected') {
      this.hasConnected = true;
      forward.clearErrors();
      this.watcher.onState('connected');
      return;
    }
    this.watcher.onState(
      state,
      explainOverSsh(message ?? 'herdr did not answer', this.options.target, forward.recentError()),
    );
  }

  private fail(message: string): void {
    this.tearDown();
    if (this.stopped) return;
    this.watcher.onState(this.hasConnected ? 'reconnecting' : 'error', message);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.setUp();
    }, SSH_RESTART_DELAY_MS);
  }

  private tearDown(): void {
    this.bridge?.stop();
    this.bridge = null;
    this.forward?.close();
    this.forward = null;
  }
}

/** A herdr error seen through a forward. The local end is our own forward, so when `ssh` said why the channel failed,
 *  that is the cause, and the socket-level symptom (a reset, an early close) is noise. */
function explainOverSsh(error: string, target: string, sshError: string | undefined): string {
  return sshError ? `herdr did not answer on ${target}: ${sshError}` : `${error} on ${target}`;
}

function describeSshFailure(err: SshExecError, target: string): string {
  if (err.code === 'ENOENT') return describeSpawnError(err.code);
  if (err.killed) return `ssh to ${target} did not answer within ${SSH_RESOLVE_TIMEOUT_MS} ms`;
  const lastLine = (err.stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return lastLine ?? `ssh to ${target} failed: ${err.message}`;
}

function describeSpawnError(code: string | number | undefined): string {
  return code === 'ENOENT'
    ? 'ssh is not installed or not on PATH'
    : `ssh failed to start (${code})`;
}
