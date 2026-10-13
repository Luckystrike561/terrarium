import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import {
  HOOK_API_PREFIX,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
  SERVERS_DIR,
} from '../../../constants.js';
import type { ServerConfig, ServerTarget } from '../../../serverConfig.js';
import { isServerConfig, isServerTarget } from '../../../serverConfig.js';
import type { CommandStatusLine } from '../claudeStatusLine.js';
import { decodeStatusLine } from '../claudeStatusLine.js';
import { statusLineShell } from '../claudeStatusLineShell.js';
import {
  HOOK_DELIVERY_TIMEOUT_MS,
  STATUS_LINE_DELIVERY_TIMEOUT_MS,
  STATUS_LINE_EVENT,
  STATUS_LINE_FLAG,
} from '../constants.js';

const SERVER_JSON = path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);
const SERVERS_REGISTRY_DIR = path.join(os.homedir(), SERVER_JSON_DIR, SERVERS_DIR);

/**
 * CI / e2e diagnostic: when TERRARIUM_DEBUG_LOG is set, record the hook
 * script's outcome at every exit point. The hook delivery chain (spawn
 * claude-hook.js -> read the registry -> POST to every live server) is
 * otherwise 100% silent: every failure path resolves quietly, so a dropped
 * hook is invisible in CI. Logging here lets a failing run show exactly
 * where delivery dies (bad-stdin, no-server-json, per-server POST
 * error/timeout/status). Zero cost when the env var is unset.
 */
// Env var is the primary source, but it doesn't reliably reach this spawned
// process across platforms and terminal configurations (shells with
// inheritEnv:false, etc.). After reading the registry we fall back to a
// live server's `debugLog` field, which the server populated from the same
// env var.
let debugLogPath = process.env['TERRARIUM_DEBUG_LOG'];
function hookDebug(line: string): void {
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, `${new Date().toISOString()} HOOKSCRIPT ${line}\n`);
  } catch {
    /* never let diagnostics break the hook */
  }
}

/** True if a process with this PID is alive. Best-effort: a false positive on
 *  PID reuse just costs one extra, harmless, failed POST -- never a crash. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enumerate every live registry entry under ~/.terrarium/servers/, so the
 * event can fan out to each running server (several `terrarium`
 * instances can run at once). Entries whose owning PID is no longer alive
 * are skipped (the owning server prunes its own stale file on next start;
 * this script only needs to not POST to it). Returns an empty array when
 * the directory is absent/empty/unreadable -- the caller falls back to the
 * legacy single-target server.json (forward-compat with a server that
 * predates the registry).
 */
function readRegistry(): ServerConfig[] {
  let files: string[];
  try {
    files = fs.readdirSync(SERVERS_REGISTRY_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const live: ServerConfig[] = [];
  for (const file of files) {
    const filePath = path.join(SERVERS_REGISTRY_DIR, file);
    try {
      const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
      if (!isServerConfig(entry)) {
        hookDebug(`registry-skip reason=malformed file=${file} err=invalid-server-config`);
        continue;
      }
      if (isProcessAlive(entry.pid)) {
        live.push(entry);
      } else {
        hookDebug(`registry-skip reason=dead-pid file=${file} pid=${entry.pid}`);
      }
    } catch (e) {
      hookDebug(
        `registry-skip reason=malformed file=${file} err=${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return live;
}

/**
 * POST one hook event to one server. Best-effort: every failure path (bad
 * connection, timeout, non-2xx status) resolves quietly -- a dropped delivery
 * to one server must never affect delivery to any other server, nor the
 * script's exit code.
 */
function postToServer(
  server: ServerTarget,
  body: string,
  eventName: string,
  sid: string,
  timeoutMs: number,
): Promise<void> {
  hookDebug(`POST event=${eventName} sid=${sid} port=${server.port}`);
  return new Promise((resolve) => {
    try {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.port,
          path: `${HOOK_API_PREFIX}/claude`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Bearer ${server.token}`,
          },
          timeout: timeoutMs,
        },
        (res) => {
          hookDebug(
            `POST-done event=${eventName} sid=${sid} status=${res.statusCode} port=${server.port}`,
          );
          res.resume();
          resolve();
        },
      );
      req.on('error', (err) => {
        hookDebug(
          `POST-error event=${eventName} sid=${sid} port=${server.port} err=${err.message}`,
        );
        resolve();
      });
      req.on('timeout', () => {
        hookDebug(`POST-timeout event=${eventName} sid=${sid} port=${server.port}`);
        req.destroy();
        resolve();
      });
      req.end(body);
    } catch (err) {
      hookDebug(
        `POST-error event=${eventName} sid=${sid} port=${server.port} err=${err instanceof Error ? err.message : String(err)}`,
      );
      resolve();
    }
  });
}

/** Every live server to deliver to: the registry, or the single legacy server.json when the registry has no live
 *  entries (a server on disk that predates the registry). Empty when neither names one. */
function liveServers(eventName: string, sid: string): ServerTarget[] {
  const registered: ServerTarget[] = readRegistry();
  if (registered.length > 0) return registered;
  try {
    const legacy = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8')) as unknown;
    if (!isServerTarget(legacy)) {
      throw new Error('invalid legacy server config');
    }
    return [legacy];
  } catch (e) {
    hookDebug(
      `exit reason=no-server-json event=${eventName} sid=${sid} path=${SERVER_JSON} err=${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

/** POST `data` to every live server (several `terrarium` instances can run at once), giving each `timeoutMs`. */
async function deliver(data: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const eventName = (data.hook_event_name as string | undefined) ?? '?';
  const sid = (data.session_id as string | undefined)?.slice(0, 8) ?? '?';
  const servers = liveServers(eventName, sid);

  // Adopt the first live server's debug-log path if the env var didn't reach
  // us (diagnostic-only; harmless if more than one server has it set).
  if (!debugLogPath) {
    const withDebugLog = servers.find((s) => s.debugLog);
    if (withDebugLog?.debugLog) debugLogPath = withDebugLog.debugLog;
  }

  const body = JSON.stringify(data);
  await Promise.all(servers.map((server) => postToServer(server, body, eventName, sid, timeoutMs)));
}

/** Forward the `rate_limits` Claude Code gave the status line, and nothing else it gave: Pro and Max sessions carry
 *  them once the session's first API response arrived, every other session sends nothing. */
async function deliverRateLimits(statusLineInput: string): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(statusLineInput);
  } catch {
    hookDebug('status-line reason=bad-stdin');
    return;
  }
  const rateLimits = data.rate_limits;
  if (rateLimits === null || typeof rateLimits !== 'object') return;
  if (typeof data.session_id !== 'string') return;
  await deliver(
    { hook_event_name: STATUS_LINE_EVENT, session_id: data.session_id, rate_limits: rateLimits },
    STATUS_LINE_DELIVERY_TIMEOUT_MS,
  );
}

/** Run the user's own status line on the same stdin, in the shell Claude Code would run it in, its output going
 *  straight to Claude Code untouched. Resolves with its exit code. */
function runChainedStatusLine(statusLine: CommandStatusLine, input: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(statusLine.command, {
      shell: statusLineShell(process.platform, process.env, fs.existsSync),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
    // A status line that never reads its stdin closes the pipe early: that is its business, not a failure.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Claude Code's status line: print what the user's status line prints, if they had one, and forward the quota. */
async function runStatusLine(input: string, encodedOriginal: string | undefined): Promise<number> {
  const delivery = deliverRateLimits(input);
  const exitCode =
    encodedOriginal === undefined
      ? 0
      : await runChainedStatusLine(decodeStatusLine(encodedOriginal), input);
  await delivery;
  return exitCode;
}

async function main(): Promise<number> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const statusLineFlagIndex = process.argv.indexOf(STATUS_LINE_FLAG);
  if (statusLineFlagIndex !== -1) {
    return runStatusLine(input, process.argv[statusLineFlagIndex + 1]);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    hookDebug('exit reason=bad-stdin');
    return 0;
  }
  await deliver(data, HOOK_DELIVERY_TIMEOUT_MS);
  return 0;
}

main()
  .catch(() => 0)
  .then((exitCode) => process.exit(exitCode));
