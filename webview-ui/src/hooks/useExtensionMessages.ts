import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AddConnection,
  Connection,
  HooksConsentRequest,
  QuotaMeter,
  ServerMessage,
} from '../../../core/src/messages.js';
import type { Building } from '../office/engine/building.js';
import type { PendingAgent } from '../office/engine/existingAgents.js';
import type { ToolActivity } from '../office/types.js';
import { isE2E } from '../runtime.js';
import { transport } from '../transport/index.js';
import { handleAgentLifecycleMessage } from './serverMessages/agentLifecycleMessages.js';
import { handleAssetMessage } from './serverMessages/assetMessages.js';
import type { MessageContext, SubagentCharacter } from './serverMessages/messageContext.js';
import { hooksSubjectKey } from './serverMessages/messageContext.js';
import { handleSettingsMessage } from './serverMessages/settingsMessages.js';
import { handleTeamAndContextMessage } from './serverMessages/teamAndContextMessages.js';
import { handleToolActivityMessage } from './serverMessages/toolActivityMessages.js';

export type { SubagentCharacter };

interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  setSelectedAgent: (id: number) => void;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
  lastSeenVersion: string;
  extensionVersion: string;
  hooksEnabled: boolean;
  /** Actual install state per (provider, subject) pair (hooksStatus messages) — absent/false while first-run
   *  consent is pending, unlike hooksEnabled which defaults true. Keyed by `${providerId}:${subjectId}`; the hooks
   *  tooltip reads 'claude:hooks'. */
  hooksInstalled: Record<string, boolean>;
  /** Bumped per (provider, subject) pair on every hooksStatus message. `hooksInstalled` alone cannot say "the
   *  server answered": a failed install re-reports the `false` already held, so no effect runs. The Intro needs the
   *  ARRIVAL to tell a pending install from a failed one, per pair — one pair's status is never a verdict on
   *  another's install. Keyed the same way as hooksInstalled. */
  hooksStatusSeq: Record<string, number>;
  hooksInfoShown: boolean;
  /** First-run consent ask (hooksConsentRequest). Non-null while the server waits on an answer; carries the
   *  (provider, subject) pair and the server's exact disclosure copy, so the consent step renders the terms being
   *  approved with no client duplicate to drift. Cleared on answer/dismissal, and by a matching pair's hooksStatus
   *  installed=true. */
  consentRequest: HooksConsentRequest | null;
  /** Dismiss the ask at the head of the queue (both args null), or one matching (providerId, subjectId) pair
   *  specifically — two subjects of the same provider are two independent asks, so a dismissal must never drop the
   *  other one in its place. */
  dismissConsentRequest: (providerId: string | null, subjectId: string | null) => void;
  /** The herdr servers the office listens to. Null until the first connectionsLoaded, which the server sends only
   *  to tokened clients with a multiplexer enabled: null hides the Connections menu. */
  connections: Connection[] | null;
  addConnection: (input: Omit<AddConnection, 'type' | 'requestId'>) => Promise<string | undefined>;
  /** Every account quota meter, as the last quotaUpdate listed them. Empty draws no beans. */
  quotaMeters: QuotaMeter[];
}

export { hooksSubjectKey };

export function useExtensionMessages(getBuilding: () => Building): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutWasReset, setLayoutWasReset] = useState(false);
  const [lastSeenVersion, setLastSeenVersion] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [hooksEnabled, setHooksEnabled] = useState(true);
  const [hooksInstalled, setHooksInstalled] = useState<Record<string, boolean>>({});
  const [hooksStatusSeq, setHooksStatusSeq] = useState<Record<string, number>>({});
  const [hooksInfoShown, setHooksInfoShown] = useState(true);
  // FIFO of pending consent asks, at most one per provider (a re-ask replaces that provider's entry in place). The
  // HEAD is what the Intro renders; answering, dismissing, or mooting it advances to the next provider's ask rather
  // than dropping it — the server sends one request per provider on the same handshake.
  const [consentQueue, setConsentQueue] = useState<HooksConsentRequest[]>([]);
  const consentRequest = consentQueue[0] ?? null;
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [quotaMeters, setQuotaMeters] = useState<QuotaMeter[]>([]);
  const pendingConnectionAddsRef = useRef<Map<string, (error: string | undefined) => void>>(
    new Map(),
  );
  const lastConnectionRequestIdRef = useRef(0);

  // The server answers an addConnection on the socket that carried it, so a transport drop mid-probe strands the
  // promise and the form stays on "Checking…" until a reload.
  useEffect(
    () =>
      transport.onStateChange((state) => {
        if (state === 'connected') return;
        for (const resolve of pendingConnectionAddsRef.current.values()) {
          resolve('Lost the connection to the server. Check the list before retrying.');
        }
        pendingConnectionAddsRef.current.clear();
      }),
    [],
  );

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  // Live background spawn tools per agent (runInBackground agentToolStart, or a
  // lazily-created watched sub). Their sub-characters outlive the parent's turn:
  // agentToolsClear must NOT remove them — despawning and re-creating moved the
  // character to a new tile every turn. Cleared by subagentClear/agentClosed.
  const backgroundParentToolIdsRef = useRef<Record<number, Set<string>>>({});

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    const pendingAgentsRef = { current: [] as PendingAgent[] };

    const ctx: MessageContext = {
      building: getBuilding(),
      pendingAgentsRef,
      layoutReadyRef,
      backgroundParentToolIdsRef,
      pendingConnectionAddsRef,
      setAgents,
      setSelectedAgent,
      setAgentTools,
      setAgentStatuses,
      setSubagentTools,
      setSubagentCharacters,
      setLayoutReady,
      setLayoutWasReset,
      setLastSeenVersion,
      setExtensionVersion,
      setHooksEnabled,
      setHooksInstalled,
      setHooksStatusSeq,
      setHooksInfoShown,
      setConsentQueue,
      setConnections,
      setQuotaMeters,
    };

    const handler = (msg: ServerMessage) => {
      ctx.building = getBuilding();
      // CI / e2e diagnostic: record every received transport message on the
      // window-side log. The fixture reads window.__terrariumTestHooks.
      // messageLog and attaches as JSON so CI failures can see the exact
      // sequence of messages the webview actually processed. Gated on the e2e
      // harness flag so this unbounded log never grows in a real session.
      if (isE2E && typeof window !== 'undefined') {
        if (!window.__terrariumTestHooks) window.__terrariumTestHooks = {};
        if (!window.__terrariumTestHooks.messageLog) {
          window.__terrariumTestHooks.messageLog = [];
        }
        const { id, toolName, status, toolId, parentToolId } = msg as {
          id?: number;
          toolName?: string;
          status?: string;
          toolId?: string;
          parentToolId?: string;
        };
        window.__terrariumTestHooks.messageLog.push({
          at: Date.now(),
          type: msg.type,
          id,
          toolName,
          status,
          toolId,
          parentToolId,
        });
      }

      if (
        handleAgentLifecycleMessage(msg, ctx) ||
        handleToolActivityMessage(msg, ctx) ||
        handleTeamAndContextMessage(msg, ctx) ||
        handleAssetMessage(msg, ctx) ||
        handleSettingsMessage(msg, ctx)
      ) {
        return;
      }
    };
    const unsubscribe = transport.onMessage(handler);
    transport.send({ type: 'webviewReady' });
    return unsubscribe;
  }, [getBuilding]);

  // Idle sub-agent characters between their turns: when every tracked tool row
  // for a sub is done, stop its typing animation (a later subagentToolStart
  // reactivates it). Watched background sub-agents get a synthesized done for
  // each live tool at their turn end, so they sit idle instead of typing forever.
  useEffect(() => {
    const building = getBuilding();
    for (const sub of subagentCharacters) {
      const rows = subagentTools[sub.parentAgentId]?.[sub.parentToolId];
      if (rows && rows.length > 0 && rows.every((t) => t.done)) {
        building.officeOf(sub.id)?.setAgentTool(sub.id, null);
        building.officeOf(sub.id)?.setAgentActive(sub.id, false);
      }
    }
  }, [subagentTools, subagentCharacters, getBuilding]);

  return {
    agents,
    selectedAgent,
    setSelectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    lastSeenVersion,
    extensionVersion,
    hooksEnabled,
    hooksInstalled,
    hooksStatusSeq,
    hooksInfoShown,
    consentRequest,
    // Called when a tour ends (answer + Let's Go, the X, Escape) with the (providerId, subjectId) pair that tour was
    // ABOUT, removing that entry so the next pair's ask becomes the head. Keyed by the pair, not a blind shift: an
    // answered ask's own installed:true moot may already have removed the head, and a shift would then drop the
    // NEXT pair's ask unanswered. An aborted ask returns on the next connect; the queue never re-adds it here.
    dismissConsentRequest: useCallback(
      (providerId: string | null, subjectId: string | null) =>
        setConsentQueue((q) =>
          providerId === null || subjectId === null
            ? q.slice(1)
            : q.filter((r) => r.providerId !== providerId || r.subjectId !== subjectId),
        ),
      [],
    ),
    connections,
    addConnection: useCallback(
      (input: Omit<AddConnection, 'type' | 'requestId'>) =>
        new Promise<string | undefined>((resolve) => {
          const requestId = String(++lastConnectionRequestIdRef.current);
          pendingConnectionAddsRef.current.set(requestId, resolve);
          transport.send({ type: 'addConnection', requestId, ...input });
        }),
      [],
    ),
    quotaMeters,
  };
}
