import * as fs from 'fs';
import * as path from 'path';

/**
 * Canonical key for a filesystem path used as a Map/Set key or compared for identity.
 *
 * The same JSONL transcript reaches the runtime through two producers that can
 * spell it differently on Windows:
 *
 *  - hooks carry `transcript_path` derived from Claude's own `process.cwd()`
 *    (`...\projects\C--Users-me-project\<id>.jsonl`)
 *  - the scanners build paths from Node's own `process.cwd()`, resolved and
 *    case-folded independently
 *    (`...\projects\c--Users-me-project\<id>.jsonl`)
 *
 * Windows resolves both to the same file, so `readdirSync` happily returns entries
 * under either spelling — but `Map`/`Set` lookups are exact-string and miss, which
 * previously let dismissed files be re-adopted and let one session spawn two agents.
 */
export function toPathKey(p: string): string {
  if (!p) return p;
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when both paths point at the same file/directory (case-insensitive on Windows). */
export function pathsMatch(left: string, right: string): boolean {
  return toPathKey(left) === toPathKey(right);
}

/**
 * The session-file identity two modules compare: the file's real path when it exists. A multiplexer reports the path
 * the agent CLI resolved from its own HOME, while an agent module scans its store under this process's HOME. Through
 * a symlinked home or store the two spell one file differently, and only the real path makes them one agent.
 */
export function canonicalSessionFile(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file); // not written yet
  }
}

/**
 * Set of filesystem paths that normalizes every entry through {@link toPathKey}, so
 * membership survives the spelling differences described above. Drop-in for
 * `Set<string>`: callers keep passing raw paths to `add`/`has`/`delete`.
 *
 * Iteration yields canonical keys, not the original spellings — nothing reads entries
 * back out today, so keep it that way rather than reintroducing a raw-path round-trip.
 */
export class PathSet extends Set<string> {
  override add(value: string): this {
    return super.add(toPathKey(value));
  }

  override has(value: string): boolean {
    return super.has(toPathKey(value));
  }

  override delete(value: string): boolean {
    return super.delete(toPathKey(value));
  }
}
