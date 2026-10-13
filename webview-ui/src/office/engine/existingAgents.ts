// webview-ui/src/office/engine/existingAgents.ts
//
// Pure reconciliation for the `existingAgents` restore message. Extracted from
// useExtensionMessages so it can be unit-tested without React (mirrors
// officeCanvasCursor.ts). The deliberate e2e-over-unit policy forbids unit
// tests against the React message handler itself.
//
// The webview must handle BOTH orders in which the two restore messages arrive:
//   - existingAgents before layoutLoaded → buffer, flush on the next layoutLoaded
//   - layoutLoaded before existingAgents → layout + seats already built, add now
// Depending on layoutLoaded always arriving last stranded restored agents when
// layout arrived first, issue #334.

import { LOCAL_MACHINE_ID } from '../../../../core/src/constants.js';

/** Per-agent seat metadata carried by the existingAgents message. */
export interface ExistingAgentMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

/** An agent buffered until the layout (and its seats) has been built. */
export interface PendingAgent {
  id: number;
  /** The floor (machine) it runs on. */
  machineId: string;
  palette?: number;
  hueShift?: number;
  seatId?: string;
  folderName?: string;
}

/** Minimal structural view of the Building this reconciler needs. */
export interface ExistingAgentsBuilding {
  getCharacter: (id: number) => unknown;
  addAgent: (
    machineId: string,
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
  ) => void;
}

/** The `existingAgents` payload, keyed by agent id. */
export interface ExistingAgentsSnapshot {
  agents: number[];
  meta: Record<number, ExistingAgentMeta>;
  folderNames: Record<number, string>;
  machineIds: Record<number, string>;
}

/**
 * Reconcile an `existingAgents` payload into the building, each agent on its
 * machine's floor. When the layout is already built, agents are added
 * immediately (skipping the matrix spawn effect, as restored agents do) unless
 * they already exist; otherwise they are pushed onto `pending` to be flushed by
 * the next `layoutLoaded`. Returns true if any agent was added directly, so the
 * caller can persist seat assignments.
 */
export function reconcileExistingAgents(
  building: ExistingAgentsBuilding,
  snapshot: ExistingAgentsSnapshot,
  layoutReady: boolean,
  pending: PendingAgent[],
): boolean {
  let addedDirectly = false;
  for (const id of snapshot.agents) {
    const m = snapshot.meta[id];
    const p: PendingAgent = {
      id,
      machineId: snapshot.machineIds[id] ?? LOCAL_MACHINE_ID,
      palette: m?.palette,
      hueShift: m?.hueShift,
      seatId: m?.seatId,
      folderName: snapshot.folderNames[id],
    };
    if (layoutReady) {
      if (!building.getCharacter(p.id)) {
        building.addAgent(p.machineId, p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
        addedDirectly = true;
      }
    } else {
      pending.push(p);
    }
  }
  return addedDirectly;
}
