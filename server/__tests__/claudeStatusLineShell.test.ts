import { describe, expect, it } from 'vitest';

import { statusLineShell } from '../src/providers/claude/claudeStatusLineShell.js';

const GIT_CMD = 'C:\\Program Files\\Git\\cmd';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

function filesAt(...existing: string[]): (filePath: string) => boolean {
  const files = new Set(existing);
  return (filePath) => files.has(filePath);
}

describe('statusLineShell', () => {
  it("leaves macOS and Linux on Node's /bin/sh", () => {
    expect(statusLineShell('darwin', {}, filesAt())).toBe(true);
    expect(statusLineShell('linux', {}, filesAt())).toBe(true);
  });

  it('runs the bash.exe CLAUDE_CODE_GIT_BASH_PATH names, ahead of Git on PATH', () => {
    const configured = 'D:\\tools\\git\\bin\\bash.exe';
    expect(
      statusLineShell(
        'win32',
        { CLAUDE_CODE_GIT_BASH_PATH: configured, PATH: GIT_CMD },
        filesAt(configured, `${GIT_CMD}\\git.exe`, GIT_BASH),
      ),
    ).toBe(configured);
  });

  it('finds Git Bash beside the git.exe on PATH', () => {
    expect(
      statusLineShell(
        'win32',
        { PATH: `C:\\Windows\\system32;${GIT_CMD}` },
        filesAt(`${GIT_CMD}\\git.exe`, GIT_BASH),
      ),
    ).toBe(GIT_BASH);
  });

  it('skips a git.exe with no bash.exe beside it and keeps searching PATH', () => {
    const mingwGit = 'C:\\Git\\mingw64\\bin';
    expect(
      statusLineShell(
        'win32',
        { PATH: `${mingwGit};${GIT_CMD}` },
        filesAt(`${mingwGit}\\git.exe`, `${GIT_CMD}\\git.exe`, GIT_BASH),
      ),
    ).toBe(GIT_BASH);
  });

  it('falls back to the default Git install when git is not on PATH', () => {
    expect(
      statusLineShell(
        'win32',
        { PATH: 'C:\\Windows\\system32', ProgramFiles: 'C:\\Program Files' },
        filesAt(GIT_BASH),
      ),
    ).toBe(GIT_BASH);
  });

  it('runs PowerShell when there is no Git Bash, even when CLAUDE_CODE_GIT_BASH_PATH names a missing file', () => {
    expect(
      statusLineShell(
        'win32',
        {
          CLAUDE_CODE_GIT_BASH_PATH: 'D:\\gone\\bash.exe',
          PATH: 'C:\\Windows\\system32',
          ProgramFiles: 'C:\\Program Files',
        },
        filesAt(),
      ),
    ).toBe('powershell.exe');
  });
});
