import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { normalizeProjectPath } from '../../../../core/src/normalizeProjectPath.js';
import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../constants.js';
import {
  CLAUDE_LARGE_CONTEXT_WINDOW,
  CLAUDE_SMALL_CONTEXT_MODEL_PATTERN,
  CLAUDE_SMALL_CONTEXT_WINDOW,
} from './constants.js';

export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(inp.file_path)}`;
    case 'Edit':
      return `Editing ${base(inp.file_path)}`;
    case 'Write':
      return `Writing ${base(inp.file_path)}`;
    case 'Bash': {
      const cmd = (inp.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const desc = typeof inp.description === 'string' ? inp.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
      return 'Planning';
    case 'NotebookEdit':
      return 'Editing notebook';
    case 'TeamCreate': {
      const teamName = typeof inp.team_name === 'string' ? inp.team_name : '';
      return teamName ? `Creating team: ${teamName}` : 'Creating team';
    }
    case 'SendMessage': {
      const recipient = typeof inp.recipient === 'string' ? inp.recipient : '';
      return recipient ? `-> ${recipient}` : 'Sending message';
    }
    default:
      return `Using ${toolName}`;
  }
}

export const permissionExemptTools: ReadonlySet<string> = new Set([
  'Task',
  'Agent',
  'AskUserQuestion',
]);
export const subagentToolNames: ReadonlySet<string> = new Set(['Task', 'Agent']);
export const readingTools: ReadonlySet<string> = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
]);

export function getSessionDirs(workspacePath: string): string[] {
  // Claude stores sessions at ~/.claude/projects/<workspace-path-with-dashes>/.
  const dirName = normalizeProjectPath(workspacePath);
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);

  if (fs.existsSync(projectDir)) return [projectDir];

  // Case-insensitive fallback for Windows: drive letter casing can differ
  // between what `process.cwd()` gives us (e.g. "c:\...") and Claude's encoding ("C:\...").
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (fs.existsSync(projectsRoot)) {
      const lowerDirName = dirName.toLowerCase();
      const match = fs.readdirSync(projectsRoot).find((c) => c.toLowerCase() === lowerDirName);
      if (match) return [path.join(projectsRoot, match)];
    }
  } catch {
    /* ignore scan errors */
  }

  // Return the expected path even if it doesn't exist yet (caller tolerates missing dirs).
  return [projectDir];
}

/** Root that holds every Claude session across all workspaces. Used by the
 *  global session scanner. */
export function getAllSessionRoots(): string[] {
  return [path.join(os.homedir(), '.claude', 'projects')];
}

/**
 * Window a Claude model's context is measured against.
 *
 * Claude Code writes the model id on every assistant record but never the
 * limit, so this table is the only thing standing between the context gauge and a
 * wrong denominator: assuming 200k for a 1M model reads five times too full.
 * Unknown ids return undefined so the runtime keeps whatever it already
 * assumed rather than adopting a fresh guess.
 */
export function contextWindowForModel(model: string | undefined): number | undefined {
  if (!model || model === '<synthetic>') return undefined;
  return CLAUDE_SMALL_CONTEXT_MODEL_PATTERN.test(model)
    ? CLAUDE_SMALL_CONTEXT_WINDOW
    : CLAUDE_LARGE_CONTEXT_WINDOW;
}
