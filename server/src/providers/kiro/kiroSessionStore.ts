import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import type {
  ListedSession,
  SessionCursor,
  SessionStore,
} from '../sessionStore/sessionStoreTracker.js';
import {
  KIRO_HOME_ENV_VAR,
  KIRO_V2_SESSIONS_DIR_SEGMENTS,
  KIRO_V2_SIDECAR_SUFFIX,
  KIRO_V2_TRANSCRIPT_SUFFIX,
  KIRO_V3_MESSAGES_FILE_NAME,
  KIRO_V3_SESSION_ID_PREFIX,
  KIRO_V3_SESSION_SIDECAR_FILE_NAME,
  KIRO_V3_SESSIONS_DIR_SEGMENTS,
  KIRO_V3_TRANSCRIPT_DEPTH,
} from './constants.js';
import { kiroV2TranscriptFormat } from './kiroV2Transcript.js';
import { kiroV3TranscriptFormat } from './kiroV3Transcript.js';

/** `~/.kiro`, or `KIRO_HOME` when the environment overrides it. V3 interactive mode has a known bug where it
 *  ignores `KIRO_HOME`. Trying it anyway costs nothing when it is unset or correct. */
function kiroHome(): string {
  return process.env[KIRO_HOME_ENV_VAR] || path.join(os.homedir(), '.kiro');
}

function readJsonString(file: string, field: string): string {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const value = doc[field];
    return typeof value === 'string' ? value : '';
  } catch {
    return ''; // sidecar not written yet, or caught mid-rewrite: try again on the next read
  }
}

function v3CwdOf(file: string): string {
  const sidecar = path.join(path.dirname(file), KIRO_V3_SESSION_SIDECAR_FILE_NAME);
  try {
    const doc = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as Record<string, unknown>;
    const workspacePaths = doc['workspacePaths'];
    return Array.isArray(workspacePaths) && typeof workspacePaths[0] === 'string'
      ? workspacePaths[0]
      : '';
  } catch {
    return '';
  }
}

/**
 * Kiro's session store: V2's `sessions/cli/<uuid>.jsonl` (keyed by its real path, the best-evidenced format, with
 * no multiplexer hand-over at all) and V3's `sessions/<hash>/sess_<uuid>/messages.jsonl` (keyed by the `sess_<uuid>`
 * id, the only form herdr ever hands over for Kiro). The two key spaces never collide: every V3 key starts with
 * `sess_`, every V2 key is an absolute file path.
 */
export function kiroSessionStore(): SessionStore {
  const home = kiroHome();

  const v2 = jsonlSessionStore({
    root: path.join(home, ...KIRO_V2_SESSIONS_DIR_SEGMENTS),
    depth: 0,
    isTranscript: (name) => name.endsWith(KIRO_V2_TRANSCRIPT_SUFFIX),
    format: kiroV2TranscriptFormat,
    // cwd lives in the sibling `.json` sidecar, never inside the transcript itself.
    cwdOf: (file) =>
      readJsonString(
        file.slice(0, -KIRO_V2_TRANSCRIPT_SUFFIX.length) + KIRO_V2_SIDECAR_SUFFIX,
        'cwd',
      ),
  });

  const v3 = jsonlSessionStore({
    root: path.join(home, ...KIRO_V3_SESSIONS_DIR_SEGMENTS),
    depth: KIRO_V3_TRANSCRIPT_DEPTH,
    isTranscript: (name) => name === KIRO_V3_MESSAGES_FILE_NAME,
    format: kiroV3TranscriptFormat,
    // The directory holding `messages.jsonl` is named `sess_<uuid>`: the id Kiro 3 (`--v3`) self-reports to herdr.
    sessionIdOf: (file) => path.basename(path.dirname(file)),
    cwdOf: v3CwdOf,
  });

  return {
    listSessions: (): ListedSession[] => [...v2.listSessions(), ...v3.listSessions()],
    open: (key: string): SessionCursor | null =>
      key.startsWith(KIRO_V3_SESSION_ID_PREFIX) ? v3.open(key) : v2.open(key),
    canonicalKey: (sessionRef: string): string => sessionRef,
  };
}
