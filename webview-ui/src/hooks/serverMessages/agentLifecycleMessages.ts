import { LOCAL_MACHINE_ID } from '../../../../core/src/constants.js';
import type { AgentCreated, ServerMessage } from '../../../../core/src/messages.js';
import type { ExistingAgentMeta } from '../../office/engine/existingAgents.js';
import { reconcileExistingAgents } from '../../office/engine/existingAgents.js';
import { migrateLayoutColors } from '../../office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../../office/types.js';
import type { MessageContext } from './messageContext.js';
import { saveAgentSeats } from './messageContext.js';

/** The server already sends these Agent Teams fields on `agentCreated`, but the
 *  AsyncAPI contract predates teams and does not declare them. */
type AgentCreatedWire = AgentCreated & {
  isTeammate?: boolean;
  teammateName?: string;
  teamName?: string;
  parentAgentId?: number;
};

/** Agent lifecycle family: layout/floor restore and agent create/close/restore. Returns
 *  true if `msg.type` matched one of its variants. */
export function handleAgentLifecycleMessage(msg: ServerMessage, ctx: MessageContext): boolean {
  const { building } = ctx;
  if (msg.type === 'layoutLoaded') {
    const rawLayout = msg.layout as OfficeLayout | null;
    const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
    const rawFloorLayout = msg.floorLayout as OfficeLayout | undefined;
    const floorLayout =
      rawFloorLayout?.version === 1 ? migrateLayoutColors(rawFloorLayout) : layout;
    if (layout) {
      building.setLayouts(layout, floorLayout ?? layout);
    }
    // Add buffered agents now that layout (and seats) are correct
    for (const p of ctx.pendingAgentsRef.current) {
      building.addAgent(p.machineId, p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
    }
    ctx.pendingAgentsRef.current = [];
    ctx.layoutReadyRef.current = true;
    ctx.setLayoutReady(true);
    if (msg.wasReset) {
      ctx.setLayoutWasReset(true);
    }
    if (building.floors.some((floor) => floor.office.characters.size > 0)) {
      saveAgentSeats(building);
    }
    return true;
  } else if (msg.type === 'floorsLoaded') {
    if (Array.isArray(msg.floors)) building.setFloors(msg.floors);
    return true;
  } else if (msg.type === 'agentCreated') {
    const created = msg as AgentCreatedWire;
    const id = created.id;
    const machineId = created.machineId ?? LOCAL_MACHINE_ID;
    const folderName = created.folderName;
    const isTeammate = created.isTeammate;
    const teammateName = created.teammateName;
    const teammateParentId = created.parentAgentId;
    const teamName = created.teamName;
    ctx.setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
    // Don't auto-select teammates (keep focus on lead)
    if (!isTeammate) {
      ctx.setSelectedAgent(id);
    }
    if (isTeammate && teammateParentId !== undefined) {
      // Teammate: inherit parent's palette and workspace folderName (teammate runs
      // in the same workspace as the lead). Name shown via agentName (teamRoleLabel).
      // Seat them at the free seat closest to the lead so the team clusters.
      const parentCh = building.getCharacter(teammateParentId);
      const palette = parentCh ? parentCh.palette : undefined;
      const hueShift = parentCh ? parentCh.hueShift : undefined;
      building.addAgent(
        machineId,
        id,
        palette,
        hueShift,
        undefined,
        undefined,
        parentCh?.folderName,
        teammateParentId,
      );
      // Set team metadata on the character
      const ch = building.getCharacter(id);
      if (ch) {
        ch.leadAgentId = teammateParentId;
        ch.teamName = teamName ?? parentCh?.teamName;
        ch.agentName = teammateName;
      }
    } else {
      const palette = created.palette;
      const hueShift = created.hueShift;
      building.addAgent(machineId, id, palette, hueShift, undefined, undefined, folderName);
    }
    saveAgentSeats(building);
    return true;
  } else if (msg.type === 'agentClosed') {
    const id = msg.id;
    ctx.setAgents((prev) => prev.filter((a) => a !== id));
    ctx.setSelectedAgent((prev) => (prev === id ? null : prev));
    ctx.setAgentTools((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    ctx.setAgentStatuses((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    ctx.setSubagentTools((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Remove all sub-agent characters belonging to this agent
    delete ctx.backgroundParentToolIdsRef.current[id];
    building.removeAllSubagents(id);
    ctx.setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
    building.removeAgent(id);
    // removeAgent can migrate another agent off a rest seat onto the freed desk
    // (rebalanceRestSeatedAgents) — persist so the server copy follows.
    saveAgentSeats(building);
    return true;
  } else if (msg.type === 'existingAgents') {
    const incoming = msg.agents;
    const meta: Record<number, ExistingAgentMeta> = msg.agentMeta;
    const folderNames: Record<number, string> = msg.folderNames;
    const machineIds: Record<number, string> = msg.machineIds;
    // Order-independent restore: add agents now if the layout (and its seats)
    // is already built, otherwise buffer them for the next layoutLoaded.
    // Depending on layoutLoaded always arriving last stranded restored agents
    // on surfaces that send layout first (issue #334).
    if (
      reconcileExistingAgents(
        building,
        { agents: incoming, meta, folderNames, machineIds },
        ctx.layoutReadyRef.current,
        ctx.pendingAgentsRef.current,
      )
    ) {
      saveAgentSeats(building);
    }
    ctx.setAgents((prev) => {
      const ids = new Set(prev);
      const merged = [...prev];
      for (const id of incoming) {
        if (!ids.has(id)) {
          merged.push(id);
        }
      }
      return merged.sort((a, b) => a - b);
    });
    return true;
  }
  return false;
}
