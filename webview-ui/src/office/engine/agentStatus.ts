/**
 * Per-character status setters: current tool, speech bubbles, team linkage,
 * context usage and task info. CTO-queue and reseat side effects are passed
 * in as callbacks because the office that owns them decides what they do.
 */

import { DISMISS_BUBBLE_FAST_FADE_SEC, WAITING_BUBBLE_DURATION_SEC } from '../../constants.js';
import type { Character, CtoQueueReason } from '../types.js';

export function setAgentTool(
  id: number,
  tool: string | null,
  characters: ReadonlyMap<number, Character>,
): void {
  const ch = characters.get(id);
  if (ch) ch.currentTool = tool;
}

export function showPermissionBubble(
  id: number,
  characters: ReadonlyMap<number, Character>,
  joinCtoQueue: (id: number, reason: CtoQueueReason) => void,
): void {
  const ch = characters.get(id);
  if (!ch) return;
  ch.bubbleType = 'permission';
  ch.bubbleTimer = 0;
  joinCtoQueue(id, 'permission');
}

export function clearPermissionBubble(
  id: number,
  characters: ReadonlyMap<number, Character>,
  leaveCtoQueue: (id: number, reason?: CtoQueueReason) => void,
): void {
  const ch = characters.get(id);
  if (ch && ch.bubbleType === 'permission') {
    ch.bubbleType = null;
    ch.bubbleTimer = 0;
  }
  leaveCtoQueue(id, 'permission');
}

export function showWaitingBubble(
  id: number,
  awaitingInput: boolean,
  characters: ReadonlyMap<number, Character>,
  joinCtoQueue: (id: number, reason: CtoQueueReason) => void,
  leaveCtoQueue: (id: number, reason?: CtoQueueReason) => void,
): void {
  const ch = characters.get(id);
  if (!ch) return;
  ch.bubbleType = 'waiting';
  ch.waitingAwaitingInput = awaitingInput;
  ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  if (awaitingInput) joinCtoQueue(id, 'input');
  else leaveCtoQueue(id, 'input');
}

/** Dismiss bubble on click — permission: instant, waiting: quick fade. */
export function dismissBubble(id: number, characters: ReadonlyMap<number, Character>): void {
  const ch = characters.get(id);
  if (!ch || !ch.bubbleType) return;
  if (ch.bubbleType === 'permission') {
    ch.bubbleType = null;
    ch.bubbleTimer = 0;
  } else if (ch.bubbleType === 'waiting') {
    ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
  }
}

export interface TeamInfo {
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

/** A teammate discovered only after its plain external session was adopted is linked
 *  here, not at creation, so it never went through the seat-next-to-lead path addAgent
 *  runs for inline teammates. Cluster it now, once, on first link. */
export function setTeamInfo(
  id: number,
  info: TeamInfo,
  characters: ReadonlyMap<number, Character>,
  reseatNextToLead: (teammateId: number, leadId: number) => void,
): void {
  const ch = characters.get(id);
  if (!ch) return;
  const { teamName, agentName, isTeamLead, leadAgentId, teamUsesTmux } = info;
  const wasUnlinked = ch.leadAgentId === undefined;
  ch.teamName = teamName;
  ch.agentName = agentName;
  ch.isTeamLead = isTeamLead;
  ch.leadAgentId = leadAgentId;
  if (teamUsesTmux !== undefined) {
    ch.teamUsesTmux = teamUsesTmux;
  }
  if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
    reseatNextToLead(id, leadAgentId);
  }
}

export function setAgentContext(
  id: number,
  contextTokens: number,
  maxContextTokens: number,
  characters: ReadonlyMap<number, Character>,
): void {
  const ch = characters.get(id);
  if (!ch) return;
  ch.contextTokens = contextTokens;
  ch.maxContextTokens = maxContextTokens;
}

export function setAgentInfo(
  id: number,
  name: string | undefined,
  task: string | undefined,
  characters: ReadonlyMap<number, Character>,
): void {
  const ch = characters.get(id);
  if (!ch) return;
  if (name !== undefined) ch.folderName = name || undefined;
  if (task !== undefined) ch.task = task || undefined;
}
