/**
 * The shell the chained status line runs in. Claude Code runs a status line through `/bin/sh` on macOS and Linux,
 * and on Windows through Git Bash when it finds one, else PowerShell. Ours must pick the same, or a Windows user's
 * `~/.claude/statusline.sh` or jq one-liner, written for that shell, prints nothing once it runs under cmd.exe (what
 * Node's `shell: true` means there).
 */

import * as path from 'path';

import {
  CLAUDE_CODE_GIT_BASH_PATH_ENV,
  GIT_BASH_DEFAULT_SEGMENTS,
  GIT_BASH_FROM_GIT_DIR,
  GIT_EXECUTABLE,
  WINDOWS_STATUS_LINE_FALLBACK_SHELL,
} from './constants.js';

/** `spawn`'s `shell` option for the chained status line. `fileExists` is the file system probe, taken as a parameter
 *  so the Windows search runs under test on any platform. */
export function statusLineShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
): string | true {
  if (platform !== 'win32') return true;
  return findGitBash(env, fileExists) ?? WINDOWS_STATUS_LINE_FALLBACK_SHELL;
}

/** Git Bash's `bash.exe`: the configured one, else the one beside the first `git.exe` on PATH, else the default
 *  install. Undefined when none exists. */
function findGitBash(
  env: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
): string | undefined {
  const configured = env[CLAUDE_CODE_GIT_BASH_PATH_ENV];
  if (configured && fileExists(configured)) return configured;
  for (const dir of (env.PATH ?? '').split(path.win32.delimiter)) {
    if (!dir || !fileExists(path.win32.join(dir, GIT_EXECUTABLE))) continue;
    const bash = path.win32.join(dir, ...GIT_BASH_FROM_GIT_DIR);
    if (fileExists(bash)) return bash;
  }
  const programFiles = env.ProgramFiles;
  if (!programFiles) return undefined;
  const defaultBash = path.win32.join(programFiles, ...GIT_BASH_DEFAULT_SEGMENTS);
  return fileExists(defaultBash) ? defaultBash : undefined;
}
