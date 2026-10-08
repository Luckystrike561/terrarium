/**
 * Cline's session store composes two files per session directory:
 *
 *   <sessionId>/<sessionId>.messages.json   the transcript (jsonDocumentSessionStore handles this one)
 *   <sessionId>/<sessionId>.json            the manifest: cwd and the authoritative `status`
 *
 * The transcript carries no cwd and no exit record, so both come from the manifest, read beside the transcript
 * file. A session directory can also hold sub-agent/team-task transcripts (`<agentId>.messages.json`), which share
 * the suffix but have no manifest of their own; `isTranscript` excludes them by their full path before they ever
 * reach the store.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AgentEvent } from '../../../../core/src/provider.js';
import { jsonDocumentSessionStore } from '../sessionStore/jsonDocumentSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import type {
  SessionCursor,
  SessionState,
  SessionStore,
} from '../sessionStore/sessionStoreTracker.js';
import { clineTranscriptFormat } from './clineTranscript.js';
import {
  CLINE_MANIFEST_FILE_SUFFIX,
  CLINE_MESSAGES_FILE_SUFFIX,
  CLINE_TERMINAL_STATUSES,
} from './constants.js';

interface ManifestInfo {
  readonly cwd: string;
  readonly terminal: boolean;
}

function manifestFile(messagesFile: string): string {
  const sessionId = path.basename(messagesFile, CLINE_MESSAGES_FILE_SUFFIX);
  return path.join(path.dirname(messagesFile), `${sessionId}${CLINE_MANIFEST_FILE_SUFFIX}`);
}

function readManifest(messagesFile: string): ManifestInfo {
  try {
    const manifest = obj(JSON.parse(fs.readFileSync(manifestFile(messagesFile), 'utf8')));
    return {
      cwd: str(manifest['cwd']) ?? '',
      terminal: CLINE_TERMINAL_STATUSES[str(manifest['status']) ?? ''] === true,
    };
  } catch {
    return { cwd: '', terminal: false }; // mid-write, or no manifest: not our root session
  }
}

/** Wraps the transcript cursor with the manifest's terminal status: a session whose manifest has gone terminal
 *  reports 'exited' and emits a synthetic `sessionEnd`, since the transcript itself never records one. */
class ClineCursor implements SessionCursor {
  readonly cwd: string;
  readonly state: SessionState;
  private ended = false;

  constructor(
    private readonly file: string,
    private readonly inner: SessionCursor,
  ) {
    this.cwd = inner.cwd;
    this.state = readManifest(file).terminal ? 'exited' : inner.state;
  }

  get size(): number {
    return this.inner.size;
  }

  read(): AgentEvent[] {
    const events = this.inner.read();
    if (this.ended) return events;
    if (!readManifest(this.file).terminal) return events;
    this.ended = true;
    return [...events, { kind: 'sessionEnd', reason: 'exit' }];
  }
}

export function clineSessionStore(root: string): SessionStore {
  const store = jsonDocumentSessionStore({
    root,
    depth: 1,
    isTranscript: (name, filePath) =>
      name.endsWith(CLINE_MESSAGES_FILE_SUFFIX) &&
      path.basename(filePath, CLINE_MESSAGES_FILE_SUFFIX) === path.basename(path.dirname(filePath)),
    format: clineTranscriptFormat,
    cwdOf: (file) => readManifest(file).cwd,
  });

  return {
    listSessions: () => store.listSessions(),
    open(key) {
      const cursor = store.open(key);
      return cursor ? new ClineCursor(key, cursor) : null;
    },
  };
}
