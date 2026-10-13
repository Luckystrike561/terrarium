import type { Dispatch, SetStateAction } from 'react';

import type { Connection, HooksConsentRequest, QuotaMeter } from '../../../../core/src/messages.js';
import type { Building } from '../../office/engine/building.js';
import type { PendingAgent } from '../../office/engine/existingAgents.js';
import type { ToolActivity } from '../../office/types.js';
import { transport } from '../../transport/index.js';

/** One sub-agent (Task/Agent tool subtask) character: a sub-character the office draws
 *  alongside its parent agent for the duration of one subtask. */
export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

/** Everything a server-message family handler needs: the current Building and every
 *  React setter/ref useExtensionMessages owns. Built once per effect run, with `building`
 *  refreshed for each message, so each family module stays a plain function, never a hook. */
export interface MessageContext {
  building: Building;
  /** Agents restored by `existingAgents` before the layout (and its seats) is ready.
   *  `layoutLoaded` flushes and replaces it, so always read it through `.current`. */
  pendingAgentsRef: { current: PendingAgent[] };
  layoutReadyRef: { current: boolean };
  backgroundParentToolIdsRef: { current: Record<number, Set<string>> };
  pendingConnectionAddsRef: { current: Map<string, (error: string | undefined) => void> };
  setAgents: Dispatch<SetStateAction<number[]>>;
  setSelectedAgent: Dispatch<SetStateAction<number | null>>;
  setAgentTools: Dispatch<SetStateAction<Record<number, ToolActivity[]>>>;
  setAgentStatuses: Dispatch<SetStateAction<Record<number, string>>>;
  setSubagentTools: Dispatch<SetStateAction<Record<number, Record<string, ToolActivity[]>>>>;
  setSubagentCharacters: Dispatch<SetStateAction<SubagentCharacter[]>>;
  setLayoutReady: Dispatch<SetStateAction<boolean>>;
  setLayoutWasReset: Dispatch<SetStateAction<boolean>>;
  setLastSeenVersion: Dispatch<SetStateAction<string>>;
  setExtensionVersion: Dispatch<SetStateAction<string>>;
  setHooksEnabled: Dispatch<SetStateAction<boolean>>;
  setHooksInstalled: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHooksStatusSeq: Dispatch<SetStateAction<Record<string, number>>>;
  setHooksInfoShown: Dispatch<SetStateAction<boolean>>;
  setConsentQueue: Dispatch<SetStateAction<HooksConsentRequest[]>>;
  setConnections: Dispatch<SetStateAction<Connection[] | null>>;
  setQuotaMeters: Dispatch<SetStateAction<QuotaMeter[]>>;
}

/** Composite key for `hooksInstalled`/`hooksStatusSeq`: two subjects of the same provider (Claude's `hooks` and
 *  `statusLine`) are two independently consented, independently installed asks, so one providerId key alone would
 *  conflate them. Exported so introTourState.ts and useIntroTour.ts build the identical key when they read these
 *  maps — the format must stay in lockstep across every reader. */
export function hooksSubjectKey(providerId: string, subjectId: string): string {
  return `${providerId}:${subjectId}`;
}

export function saveAgentSeats(building: Building): void {
  transport.send({ type: 'saveAgentSeats', seats: building.getPersistableSeats() });
}
