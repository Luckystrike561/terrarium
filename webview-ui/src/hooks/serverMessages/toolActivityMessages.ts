import type { ServerMessage } from '../../../../core/src/messages.js';
import { playDoneSound, playPermissionSound } from '../../notificationSound.js';
import { extractToolName, isSubagentToolName } from '../../office/toolUtils.js';
import type { ToolActivity } from '../../office/types.js';
import type { MessageContext } from './messageContext.js';
import { saveAgentSeats } from './messageContext.js';

/** Tool and sub-agent activity family: tool start/done/clear, agent status, permission
 *  bubbles, and the subagent tool-row lifecycle. Returns true if `msg.type` matched one
 *  of its variants. */
export function handleToolActivityMessage(msg: ServerMessage, ctx: MessageContext): boolean {
  const { building } = ctx;
  if (msg.type === 'agentToolStart') {
    const id = msg.id;
    const toolId = msg.toolId;
    const status = msg.status;
    const permissionActive = msg.permissionActive;
    ctx.setAgentTools((prev) => {
      const list = prev[id] || [];
      if (list.some((t) => t.toolId === toolId)) return prev;
      return {
        ...prev,
        [id]: [...list, { toolId, status, done: false, permissionWait: permissionActive || false }],
      };
    });
    const toolName = msg.toolName ?? extractToolName(status);
    const office = building.officeOf(id);
    office?.setAgentTool(id, toolName);
    office?.setAgentActive(id, true);
    // Don't clear the permission bubble if the hook already confirmed permission is needed
    if (!permissionActive) {
      office?.clearPermissionBubble(id);
    }
    // Create sub-agent character for Task/Agent tool subtasks.
    // agentToolStart for Task/Agent is always emitted via JSONL (with the stable
    // toolu_* id), never from the hook path — handlePreToolUse skips these tools.
    // runInBackground routing:
    //   - parent HAS teamName: teammate path (onTeammateDetected) creates the
    //     teammate; we skip here so we don't spawn a ghost sub-agent alongside.
    //   - parent has NO teamName: no teammate path exists, so we must still
    //     create the Subtask sub-character or the background task is invisible.
    const runInBackground = msg.runInBackground;
    if (runInBackground) {
      const set = (ctx.backgroundParentToolIdsRef.current[id] ??= new Set());
      set.add(toolId);
    }
    // Named spawns are Teammates-to-be: a teammate character will represent
    // them, so never create the Subtask ghost the teammate would replace.
    const isTeammateSpawn = msg.isTeammateSpawn;
    const parentChar = building.getCharacter(id);
    const parentHasTeam = !!parentChar?.teamName;
    if (isSubagentToolName(toolName) && !isTeammateSpawn && (!runInBackground || !parentHasTeam)) {
      const label = status.startsWith('Subtask:') ? status.slice('Subtask:'.length).trim() : '';
      const subId = building.addSubagent(id, toolId);
      ctx.setSubagentCharacters((prev) => {
        if (prev.some((s) => s.id === subId)) return prev;
        return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
      });
    }
    return true;
  } else if (msg.type === 'agentToolDone') {
    const id = msg.id;
    const toolId = msg.toolId;
    ctx.setAgentTools((prev) => {
      const list = prev[id];
      if (!list) return prev;
      return {
        ...prev,
        [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
      };
    });
    return true;
  } else if (msg.type === 'agentToolsClear') {
    const id = msg.id;
    const bgSet = ctx.backgroundParentToolIdsRef.current[id];
    ctx.setAgentTools((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Keep sub-tool rows of live background spawns: their sub-characters
    // survive the parent's turn end and stay animated by their own activity.
    ctx.setSubagentTools((prev) => {
      const agentSubs = prev[id];
      if (!agentSubs) return prev;
      const kept: Record<string, ToolActivity[]> = {};
      for (const [parentToolId, rows] of Object.entries(agentSubs)) {
        if (bgSet?.has(parentToolId)) kept[parentToolId] = rows;
      }
      const next = { ...prev };
      if (Object.keys(kept).length === 0) {
        delete next[id];
      } else {
        next[id] = kept;
      }
      return next;
    });
    // Remove this agent's sub-agent characters, EXCEPT:
    // - team leads with inline teammates: their sub-agents represent real
    //   teammates, removed only by SubagentStop/subagentClear;
    // - live background spawns: removing + re-creating them on every turn
    //   end teleported the character (subagentClear removes them for real).
    const clearCh = building.getCharacter(id);
    const hasInlineTeammates = clearCh?.teamName && clearCh?.isTeamLead && !clearCh?.teamUsesTmux;
    if (!hasInlineTeammates) {
      const doomed: string[] = [];
      for (const sub of building.subagentsOf(id)) {
        if (!bgSet?.has(sub.parentToolId)) doomed.push(sub.parentToolId);
      }
      for (const parentToolId of doomed) {
        building.removeSubagent(id, parentToolId);
      }
      ctx.setSubagentCharacters((prev) =>
        prev.filter((s) => s.parentAgentId !== id || bgSet?.has(s.parentToolId)),
      );
    }
    building.officeOf(id)?.setAgentTool(id, null);
    building.officeOf(id)?.clearPermissionBubble(id);
    return true;
  } else if (msg.type === 'agentStatus') {
    const id = msg.id;
    const status = msg.status;
    ctx.setAgentStatuses((prev) => {
      if (status === 'active') {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: status };
    });
    building.officeOf(id)?.setAgentActive(id, status === 'active');
    // Going active can steal a desk from an idle colleague (claimWorkSeatForActiveAgent) —
    // persist so the server copy of seat ownership follows.
    if (status === 'active') saveAgentSeats(building);
    if (status === 'waiting') {
      building.officeOf(id)?.showWaitingBubble(id, msg.awaitingInput === true);
      playDoneSound();
    }
    return true;
  } else if (msg.type === 'agentToolPermission') {
    const id = msg.id;
    ctx.setAgentTools((prev) => {
      const list = prev[id];
      if (!list) return prev;
      return {
        ...prev,
        [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
      };
    });
    building.officeOf(id)?.showPermissionBubble(id);
    playPermissionSound();
    return true;
  } else if (msg.type === 'subagentToolPermission') {
    const id = msg.id;
    const parentToolId = msg.parentToolId;
    // Show permission bubble on the sub-agent character
    const subId = building.getSubagentId(id, parentToolId);
    if (subId !== null) {
      building.officeOf(subId)?.showPermissionBubble(subId);
    }
    return true;
  } else if (msg.type === 'agentToolPermissionClear') {
    const id = msg.id;
    ctx.setAgentTools((prev) => {
      const list = prev[id];
      if (!list) return prev;
      const hasPermission = list.some((t) => t.permissionWait);
      if (!hasPermission) return prev;
      return {
        ...prev,
        [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
      };
    });
    building.officeOf(id)?.clearPermissionBubble(id);
    // Also clear permission bubbles on all sub-agent characters of this parent
    for (const sub of building.subagentsOf(id)) {
      building.officeOf(sub.id)?.clearPermissionBubble(sub.id);
    }
    return true;
  } else if (msg.type === 'subagentToolStart') {
    const id = msg.id;
    const parentToolId = msg.parentToolId;
    const toolId = msg.toolId;
    const status = msg.status;
    ctx.setSubagentTools((prev) => {
      const agentSubs = prev[id] || {};
      const list = agentSubs[parentToolId] || [];
      if (list.some((t) => t.toolId === toolId)) return prev;
      return {
        ...prev,
        [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
      };
    });
    // Update sub-agent character's tool and active state. The sub-agent is
    // usually created by an earlier agentToolStart from JSONL using the same
    // (real) parentToolId. When it's missing — a teamed lead's background
    // spawn (the creation gate above suppressed the Subtask) or a reloaded
    // panel that lost it — create it lazily; addSubagent is idempotent.
    let subId = building.getSubagentId(id, parentToolId);
    if (subId === null) {
      subId = building.addSubagent(id, parentToolId);
      const newSubId = subId;
      ctx.setSubagentCharacters((prev) => {
        if (prev.some((s) => s.id === newSubId)) return prev;
        return [...prev, { id: newSubId, parentAgentId: id, parentToolId, label: '' }];
      });
      // Only watched background spawns are created lazily -- mark the
      // parent tool as background so agentToolsClear preserves the sub.
      const set = (ctx.backgroundParentToolIdsRef.current[id] ??= new Set());
      set.add(parentToolId);
    }
    const subToolName = extractToolName(status);
    building.officeOf(subId)?.setAgentTool(subId, subToolName);
    building.officeOf(subId)?.setAgentActive(subId, true);
    return true;
  } else if (msg.type === 'subagentToolDone') {
    const id = msg.id;
    const parentToolId = msg.parentToolId;
    const toolId = msg.toolId;
    ctx.setSubagentTools((prev) => {
      const agentSubs = prev[id];
      if (!agentSubs) return prev;
      const list = agentSubs[parentToolId];
      if (!list) return prev;
      return {
        ...prev,
        [id]: {
          ...agentSubs,
          [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
        },
      };
    });
    return true;
  } else if (msg.type === 'subagentClear') {
    const id = msg.id;
    const parentToolId = msg.parentToolId;
    ctx.backgroundParentToolIdsRef.current[id]?.delete(parentToolId);
    ctx.setSubagentTools((prev) => {
      const agentSubs = prev[id];
      if (!agentSubs || !(parentToolId in agentSubs)) return prev;
      const next = { ...agentSubs };
      delete next[parentToolId];
      if (Object.keys(next).length === 0) {
        const outer = { ...prev };
        delete outer[id];
        return outer;
      }
      return { ...prev, [id]: next };
    });
    // Remove sub-agent character
    building.removeSubagent(id, parentToolId);
    ctx.setSubagentCharacters((prev) =>
      prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
    );
    return true;
  }
  return false;
}
