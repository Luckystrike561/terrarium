/**
 * A Claude hook payload, normalized. Only the Claude hook handler reads these: they carry the correlation state of
 * raw hooks (sub-agent starts and stops, the transcript a session writes), which the office never sees directly.
 */
export type ClaudeHookEvent =
  | { kind: 'sessionStart'; source?: string; transcriptPath?: string; cwd?: string }
  | { kind: 'sessionEnd'; reason?: string }
  | {
      kind: 'toolStart';
      toolId: string;
      toolName: string;
      input?: unknown;
      runInBackground?: boolean;
    }
  | { kind: 'toolEnd'; toolId: string }
  | { kind: 'turnEnd'; awaitingInput?: boolean }
  | {
      kind: 'subagentStart';
      parentToolId: string;
      toolId: string;
      toolName: string;
      input?: unknown;
      runInBackground?: boolean;
    }
  | { kind: 'subagentEnd'; parentToolId: string; toolId: string }
  | { kind: 'permissionRequest' }
  | { kind: 'subagentTurnEnd'; parentToolId: string; reason: 'idle' | 'completed' };

// All raw Claude hook payload fields (tool_name, tool_input, agent_type, etc.) are
// read HERE and HERE ONLY. The hook handler sees only the normalized
// ClaudeHookEvent union.
//
// Sentinel 'current' toolIds are returned for PostToolUse/SubagentStop because the
// raw hook payload doesn't carry the id: the handler correlates using its own
// currentHookToolId state. Synthetic hook-* ids are returned for PreToolUse because
// the real tool id arrives later via JSONL polling.

export function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: ClaudeHookEvent } | null {
  const eventName = raw.hook_event_name;
  const sessionId = raw.session_id;
  if (typeof eventName !== 'string' || typeof sessionId !== 'string') return null;

  switch (eventName) {
    case 'PreToolUse': {
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : '';
      const toolInput =
        typeof raw.tool_input === 'object' && raw.tool_input !== null
          ? (raw.tool_input as Record<string, unknown>)
          : {};
      return {
        sessionId,
        event: {
          kind: 'toolStart',
          toolId: `hook-${Date.now()}`,
          toolName,
          input: toolInput,
          runInBackground: toolInput.run_in_background === true,
        },
      };
    }

    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { sessionId, event: { kind: 'toolEnd', toolId: 'current' } };

    case 'Stop':
      return { sessionId, event: { kind: 'turnEnd' } };

    case 'UserPromptSubmit':
      // No normalized kind for user prompts yet, so silently ignore. No longer
      // installed (it forwarded the prompt text here only to be dropped), but a
      // stale install keeps POSTing it until its next install/uninstall runs,
      // so the drop must stay graceful.
      return null;

    case 'SubagentStart': {
      const agentType = typeof raw.agent_type === 'string' ? raw.agent_type : 'unknown';
      return {
        sessionId,
        event: {
          kind: 'subagentStart',
          parentToolId: 'current',
          toolId: `hook-sub-${agentType}-${Date.now()}`,
          toolName: agentType,
          input: raw,
          runInBackground: raw.run_in_background === true,
        },
      };
    }

    case 'SubagentStop':
      return {
        sessionId,
        event: { kind: 'subagentEnd', parentToolId: 'current', toolId: 'current' },
      };

    case 'PermissionRequest':
      return { sessionId, event: { kind: 'permissionRequest' } };

    case 'Notification': {
      const notificationType =
        typeof raw.notification_type === 'string' ? raw.notification_type : '';
      if (notificationType === 'permission_prompt') {
        return { sessionId, event: { kind: 'permissionRequest' } };
      }
      if (notificationType === 'idle_prompt') {
        // idle_prompt = Claude went idle waiting on the user, not just a finished
        // turn. awaitingInput drives the "Waiting for input" label (vs "Done" for Stop).
        return { sessionId, event: { kind: 'turnEnd', awaitingInput: true } };
      }
      return null;
    }

    case 'SessionStart':
      return {
        sessionId,
        event: {
          kind: 'sessionStart',
          source: typeof raw.source === 'string' ? raw.source : undefined,
          transcriptPath: typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined,
          cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        },
      };

    case 'SessionEnd':
      return {
        sessionId,
        event: {
          kind: 'sessionEnd',
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        },
      };

    // Agent Teams: a teammate went idle / marked a task complete. Normalize as
    // `subagentTurnEnd` so the team handler can route by the provider's event-specific identity.
    // `reason` discriminates the two so handlers don't read raw eventName.
    case 'TeammateIdle':
      return {
        sessionId,
        event: { kind: 'subagentTurnEnd', parentToolId: 'current', reason: 'idle' },
      };
    case 'TaskCompleted':
      return {
        sessionId,
        event: { kind: 'subagentTurnEnd', parentToolId: 'current', reason: 'completed' },
      };

    // TaskCreated is informational: no ClaudeHookEvent shape fits it. Drop. No
    // longer installed for that reason, but stale installs still POST it,
    // so keep tolerating it here.
    case 'TaskCreated':
    default:
      return null;
  }
}
