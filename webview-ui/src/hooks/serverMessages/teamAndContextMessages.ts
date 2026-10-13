import type { ServerMessage } from '../../../../core/src/messages.js';
import type { MessageContext } from './messageContext.js';

/** Team and context family: per-agent team metadata, context gauge, and the
 *  name/task summary. Returns true if `msg.type` matched one of its variants. */
export function handleTeamAndContextMessage(msg: ServerMessage, ctx: MessageContext): boolean {
  const { building } = ctx;
  if (msg.type === 'agentTeamInfo') {
    const id = msg.id;
    building
      .officeOf(id)
      ?.setTeamInfo(
        id,
        msg.teamName,
        msg.agentName,
        msg.isTeamLead,
        msg.leadAgentId,
        msg.teamUsesTmux,
      );
    return true;
  } else if (msg.type === 'agentContextUsage') {
    const id = msg.id;
    building.officeOf(id)?.setAgentContext(id, msg.contextTokens, msg.maxContextTokens);
    return true;
  } else if (msg.type === 'agentInfo') {
    const id = msg.id;
    building.officeOf(id)?.setAgentInfo(id, msg.name, msg.task);
    return true;
  }
  return false;
}
