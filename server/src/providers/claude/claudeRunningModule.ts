import * as fs from 'fs';
import * as path from 'path';

import type {
  ModuleHandle,
  ModuleHost,
  RestoredSession,
  RunningAgentModule,
} from '../../../../core/src/provider.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from '../../constants.js';
import { PathSet, pathsMatch } from '../../pathKey.js';
import { SessionRouter } from '../../sessionRouter.js';
import { type ClaudeAgentState, ClaudeAgentStore } from './claudeAgentStore.js';
import {
  bridgeClaudeStore,
  emitSessionReassigned,
  privateIdOf,
  sessionRefOf,
} from './claudeBridge.js';
import {
  adoptExternalSessionFromHook,
  ensureProjectScan,
  reassignAgentToFile,
  scanForBackgroundAgentFiles,
  scanForTeammateFiles,
  setAgentRemovalCallback,
  setDismissalTracker,
  setSubagentWatch,
  setTeammateRegisterCallback,
  setTeammateRemovalCallback,
  startExternalSessionScanning,
  startFileWatching,
  startStaleExternalAgentCheck,
} from './claudeFileWatcher.js';
import {
  ClaudeHookHandler,
  type ClaudeHookPayload,
  type ClaudePendingSession,
  type ClaudeRoutedEvent,
} from './claudeHookHandler.js';
import { claudeTeamProvider } from './claudeTeamProvider.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './claudeTimers.js';
import {
  setBackgroundAgentCompletedCallback,
  setBackgroundAgentDetectedCallback,
  setTeamSwitchCallback,
} from './claudeTranscriptParser.js';
import { getAllSessionRoots, getSessionDirs } from './claudeVocabulary.js';
import { DismissalTracker } from './dismissalTracker.js';
import { SubagentWatch } from './subagentWatch.js';
import { TranscriptFollower } from './transcriptFollower.js';

/** Start Claude's own session discovery: a private store, the heuristic scanners, the hook handler, and the bridge
 *  that turns the store's activity into AgentEvents on `host`. */
export function startClaudeModule(host: ModuleHost): RunningAgentModule {
  return new ClaudeRunningModule(host);
}

class ClaudeRunningModule implements RunningAgentModule {
  private readonly store = new ClaudeAgentStore();
  private readonly fileWatchers = new Map<number, fs.FSWatcher>();
  private readonly pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private readonly waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly knownJsonlFiles = new PathSet();
  private readonly projectScanTimer: { current: ReturnType<typeof setInterval> | null } = {
    current: null,
  };
  private externalScanTimer: ReturnType<typeof setInterval> | null = null;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly hooksEnabled = { current: true };
  private readonly dismissalTracker = new DismissalTracker();
  private readonly subagentWatch: SubagentWatch;
  private readonly sessionRouter = new SessionRouter<ClaudeRoutedEvent, ClaudePendingSession>();
  private readonly hookHandler: ClaudeHookHandler;
  private readonly transcriptFollower: TranscriptFollower;
  private readonly unbridge: () => void;

  constructor(private readonly host: ModuleHost) {
    setDismissalTracker(this.dismissalTracker);
    this.subagentWatch = new SubagentWatch(this.store);
    setSubagentWatch(this.subagentWatch);
    setAgentRemovalCallback((id) => this.removeAgent(id));
    setTeammateRemovalCallback((id) => this.removeTeammate(id, 'team-config'));
    // New-style teammates run their own sessions; registering routes their hook
    // events (PreToolUse, Stop, SessionEnd) directly to the teammate agent.
    setTeammateRegisterCallback((sessionId, agentId) => this.registerAgent(sessionId, agentId));
    // Background spawns (teams OFF): classify by sidecar name on spawn (named
    // -> teammate character, unnamed -> shadow-watched sub-agent), remove when
    // the completion queue-operation lands on the lead.
    setBackgroundAgentDetectedCallback((leadId) => {
      scanForBackgroundAgentFiles(
        leadId,
        this.store,
        this.store.nextAgentId,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
      );
    });
    setBackgroundAgentCompletedCallback((leadId, toolUseId) => {
      for (const [id, agent] of this.store) {
        if (agent.leadAgentId === leadId && agent.spawnToolUseId === toolUseId) {
          this.removeTeammate(id, 'background-complete');
          break;
        }
      }
      // Unnamed spawns live in the shadow store; the webview sub-character is
      // cleared by the lead-side queue-op subagentClear, not by this call.
      this.subagentWatch.removeBySpawn(leadId, toolUseId);
    });
    // A resumed lead that spawns again belongs to a freshly minted implicit
    // team; its previous team's teammates are defunct. Promoted anonymous
    // background agents (leadAgentId but no teamName) are left untouched.
    setTeamSwitchCallback((leadId, previousTeamName) => {
      const stale = [...this.store].filter(
        ([, a]) => a.leadAgentId === leadId && a.teamName === previousTeamName,
      );
      for (const [id] of stale) this.removeTeammate(id, 'team-switch');
    });

    this.hookHandler = new ClaudeHookHandler(
      this.store,
      this.waitingTimers,
      this.permissionTimers,
      this.sessionRouter,
    );
    this.hookHandler.setLifecycleCallbacks({
      onExternalSessionDetected: (pending) => this.adoptConfirmedSession(pending),
      onSessionClear: (agentId, newSessionId, newTranscriptPath) => {
        if (newTranscriptPath) {
          this.knownJsonlFiles.add(newTranscriptPath);
          reassignAgentToFile(
            agentId,
            newTranscriptPath,
            this.store,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
          );
        }
        const agent = this.store.get(agentId);
        if (agent) {
          this.unregisterAgent(agent.sessionId, agent.id);
          agent.sessionId = newSessionId;
          this.registerAgent(agent.sessionId, agent.id);
          emitSessionReassigned(this.host, agentId, agent);
        }
      },
      onSessionResume: (transcriptPath) => {
        this.dismissalTracker.clearDismissal(transcriptPath);
        this.dismissalTracker.clearSeededMtime(transcriptPath);
        this.knownJsonlFiles.delete(transcriptPath);
      },
      onTeammateDetected: (parentAgentId, sessionId) => {
        const parentAgent = this.store.get(parentAgentId);
        if (!parentAgent) return;
        scanForTeammateFiles(
          parentAgent.projectDir,
          sessionId,
          parentAgentId,
          this.store.nextAgentId,
          this.store,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
        );
      },
      onTeammateRemoved: (teammateAgentId) => this.removeTeammate(teammateAgentId, 'hooks'),
      onSessionEnd: (agentId) => this.endSession(agentId),
    });

    this.transcriptFollower = new TranscriptFollower({
      sessionRoots: () => getAllSessionRoots(),
      adopt: (file, sessionId, sessionRef) =>
        this.adoptFollowedTranscript(file, sessionId, sessionRef),
      end: (agentId) => this.endSession(agentId),
    });

    this.unbridge = bridgeClaudeStore(this.store, host);

    const projectDir = getSessionDirs(process.cwd())[0];
    if (projectDir) {
      host.log(`Scanning project dir: ${projectDir}`);
      ensureProjectScan(
        projectDir,
        this.knownJsonlFiles,
        this.projectScanTimer,
        this.store.nextAgentId,
        this.store,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
      );
      this.externalScanTimer = startExternalSessionScanning(
        projectDir,
        this.knownJsonlFiles,
        this.store.nextAgentId,
        this.store,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.hooksEnabled,
      );
      this.staleCheckTimer = startStaleExternalAgentCheck(
        this.store,
        this.knownJsonlFiles,
        this.hooksEnabled,
      );
    }
  }

  // ── RunningAgentModule ──

  followSession(sessionRef: string): ModuleHandle {
    return this.transcriptFollower.followSession(sessionRef);
  }

  receiveHook(payload: Record<string, unknown>): void {
    this.hookHandler.handleEvent(payload as ClaudeHookPayload);
  }

  setHooksEnabled(enabled: boolean): void {
    this.hooksEnabled.current = enabled;
  }

  /** Resume reporting a persisted session, if its transcript is still there. Builds the private agent at END of
   *  file (no history replay) and lets the bridge's agentAdded handler announce it with exactly the given ref:
   *  `sessionId` is chosen so `sessionRefOf` reproduces `session.sessionRef` deterministically. */
  restoreSession(session: RestoredSession): void {
    const { sessionRef, team, backgroundToolIds } = session;
    // Derived background children (a name or a lead, but no teamName) are re-materialized by the 1s scan from live
    // sidecars, whether or not their lead was persisted; restoring them directly would resurrect immortal characters.
    if (
      team &&
      !team.teamName &&
      (team.agentName !== undefined || team.leadSessionRef !== undefined)
    )
      return;

    const file = this.resolveTranscript(sessionRef);
    if (!file) return;
    for (const a of this.store.values()) {
      if (pathsMatch(a.jsonlFile, file)) return; // already restored/adopted
    }

    let leadAgentId: number | undefined;
    if (team?.leadSessionRef !== undefined) {
      for (const [lid, a] of this.store) {
        if (sessionRefOf(a) === team.leadSessionRef) {
          leadAgentId = lid;
          break;
        }
      }
    }

    const id = this.store.nextAgentId.current++;
    const isPathRef = path.isAbsolute(sessionRef);
    // Own-session teammates (and ordinary sessions) use the top-level file's own
    // basename, reproducing sessionRef via sessionRefOf's top-level rule. A
    // path-ref teammate (sidecar/inline) must get a sessionId that is NOT its
    // own file's basename, so the rule falls through to the transcript path --
    // the lead's own sessionId does that naturally (teammates share leads'
    // session ids in hook payloads too).
    const sessionId = isPathRef
      ? leadAgentId !== undefined
        ? this.store.get(leadAgentId)!.sessionId
        : `lead-unknown-${id}`
      : path.basename(file, '.jsonl');

    const agent: ClaudeAgentState = {
      id,
      sessionId,
      projectDir: path.dirname(file),
      jsonlFile: file,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      // Live spawn ids survive the restart so the 1s scan can re-adopt the
      // spawns' transcripts and the completion queue-op still matches.
      backgroundAgentToolIds: new Set(backgroundToolIds),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      hookDelivered: false,
      contextTokens: 0,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      teamName: team?.teamName,
      agentName: team?.agentName,
      isTeamLead: team?.isTeamLead,
      leadAgentId,
      teamUsesTmux: team?.teamUsesTmux,
    };

    try {
      agent.fileOffset = fs.statSync(file).size;
    } catch {
      /* ignore stat errors on restore */
    }

    this.knownJsonlFiles.add(file);
    this.store.set(id, agent);
    startFileWatching(
      id,
      file,
      this.store,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
    );
    // A teammate sharing its lead's session id must not take the lead's hook routing over.
    if (!isPathRef) this.registerAgent(agent.sessionId, agent.id);
    this.host.log(`Restored Claude session -> ${path.basename(file)}`);
  }

  /** The user closed this session's character: dismiss the transcript (cooldown) and remove the private agent. */
  dismissSession(sessionId: string): void {
    const id = privateIdOf(sessionId);
    if (id === undefined) return;
    const agent = this.store.get(id);
    if (!agent) return;
    this.dismissalTracker.dismiss(agent.jsonlFile);
    this.unregisterAgent(agent.sessionId, id);
    this.removeAgent(id);
  }

  stop(): void {
    this.unbridge();
    this.transcriptFollower.stop();
    this.hookHandler.dispose();
    this.subagentWatch.dispose();

    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
    if (this.externalScanTimer) {
      clearInterval(this.externalScanTimer);
      this.externalScanTimer = null;
    }
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
    for (const timer of this.pollingTimers.values()) clearInterval(timer);
    for (const timer of this.waitingTimers.values()) clearTimeout(timer);
    for (const timer of this.permissionTimers.values()) clearTimeout(timer);
    for (const watcher of this.fileWatchers.values()) watcher.close();
    this.store.clear();
  }

  // ── Internals ──

  private registerAgent(sessionId: string, agentId: number): void {
    this.hookHandler.registerAgent(sessionId, agentId);
  }

  private unregisterAgent(sessionId: string, agentId: number): void {
    this.hookHandler.unregisterAgent(sessionId, agentId);
  }

  private removeAgent(id: number): void {
    const agent = this.store.get(id);
    if (!agent) return;
    this.fileWatchers.get(id)?.close();
    this.fileWatchers.delete(id);
    const pt = this.pollingTimers.get(id);
    if (pt) clearInterval(pt);
    this.pollingTimers.delete(id);
    cancelWaitingTimer(id, this.waitingTimers);
    cancelPermissionTimer(id, this.permissionTimers);
    this.store.delete(id); // fires agentRemoved -> bridge emits sessionEnd
  }

  private removeTeammate(teammateId: number, source: string): void {
    const agent = this.store.get(teammateId);
    if (!agent) return;
    console.log(`[Pixel Agents] Removing teammate ${teammateId} (source: ${source})`);
    this.dismissalTracker.dismiss(agent.jsonlFile);
    this.unregisterAgent(agent.sessionId, teammateId);
    this.removeAgent(teammateId);
    if (agent.leadAgentId !== undefined) {
      this.demoteLeadIfTeamEmpty(agent.leadAgentId);
    }
  }

  /** Remove all teammates of a lead agent. */
  private removeTeammates(leadId: number): void {
    const teammates: number[] = [];
    for (const [id, agent] of this.store) {
      if (agent.leadAgentId === leadId) teammates.push(id);
    }
    for (const id of teammates) {
      const agent = this.store.get(id);
      if (agent) {
        console.log(`[Pixel Agents] Removing teammate ${id} (lead ${leadId} closed)`);
        this.dismissalTracker.dismiss(agent.jsonlFile);
        this.unregisterAgent(agent.sessionId, id);
        this.removeAgent(id);
      }
    }
  }

  /** Drop the LEAD badge when the last teammate leaves. teamName is kept: it
   *  still routes discovery of late-arriving teammates of the same generation. */
  private demoteLeadIfTeamEmpty(leadId: number): void {
    const lead = this.store.get(leadId);
    if (!lead || !lead.isTeamLead) return;
    for (const a of this.store.values()) {
      if (a.leadAgentId === leadId) return;
    }
    lead.isTeamLead = undefined;
    this.store.broadcast({
      type: 'agentTeamInfo',
      id: leadId,
      teamName: lead.teamName,
      agentName: lead.agentName,
      isTeamLead: undefined,
      leadAgentId: lead.leadAgentId,
    });
  }

  private endSession(agentId: number): void {
    const agent = this.store.get(agentId);
    if (!agent) return;
    this.dismissalTracker.clearSeededMtime(agent.jsonlFile);
    this.dismissalTracker.dismiss(agent.jsonlFile);
    // Covers real team leads AND leads of background teammates (which
    // have children but no teamName). No-op when childless.
    this.removeTeammates(agentId);
    // Unnamed background spawns die with their lead's session too.
    this.subagentWatch.removeByLead(agentId);
    this.unregisterAgent(agent.sessionId, agentId);
    this.removeAgent(agentId);
  }

  /** Adopt a session whose first event after SessionStart arrived and that no agent reports yet. */
  private adoptConfirmedSession(pending: ClaudePendingSession): void {
    const { sessionId, transcriptPath, cwd } = pending;
    // Teammate session of a tracked lead? Attach it as a teammate character
    // instead of adopting a generic external agent -- tracking the lead is
    // the opt-in for its team. (Newer harnesses run every spawned agent as
    // an independent top-level session that fires its own hooks.)
    if (transcriptPath) {
      const teamMeta = claudeTeamProvider.getTeamMetadataForSession(transcriptPath);
      if (teamMeta?.teamName && teamMeta.agentName) {
        for (const [leadId, lead] of this.store) {
          if (lead.teamName !== teamMeta.teamName || lead.leadAgentId !== undefined) continue;
          console.log(
            `[Pixel Agents] Hook: session ${sessionId.slice(0, 8)}... is teammate "${teamMeta.agentName}" of Agent ${leadId}, attaching`,
          );
          scanForTeammateFiles(
            lead.projectDir,
            lead.sessionId,
            leadId,
            this.store.nextAgentId,
            this.store,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
          );
          break;
        }
        // Done only if discovery actually adopted this transcript. Old-style
        // tmux teammates (non-UUID transcript names outside discovery's scan)
        // fall through to normal external adoption and self-identify from
        // their record tags.
        for (const a of this.store.values()) {
          if (pathsMatch(a.jsonlFile, transcriptPath)) return;
        }
      }
    }
    adoptExternalSessionFromHook(
      sessionId,
      transcriptPath,
      cwd,
      this.knownJsonlFiles,
      this.store.nextAgentId,
      this.store,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      (agent) => this.registerAgent(agent.sessionId, agent.id),
    );
  }

  /** Watch the transcript a multiplexer pane reports. A private agent already watching it keeps it; the pane
   *  simply joins that character via the runtime's own sessionRef join (no agent-field mutation needed here). */
  private adoptFollowedTranscript(
    file: string,
    sessionId: string,
    _sessionRef: string,
  ): number | undefined {
    const watching = [...this.store.values()].find((a) => pathsMatch(a.jsonlFile, file));
    if (watching) return undefined;
    // A live pane writing the file outranks an earlier end of the same session (a resume in a new pane).
    this.dismissalTracker.clearDismissal(file);
    this.dismissalTracker.clearSeededMtime(file);
    let adopted: number | undefined;
    adoptExternalSessionFromHook(
      sessionId,
      file,
      '',
      this.knownJsonlFiles,
      this.store.nextAgentId,
      this.store,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      (agent) => {
        // No hook has reached this session, so the transcript is what shows its tools and ends its turns.
        agent.hookDelivered = false;
        this.registerAgent(agent.sessionId, agent.id);
        adopted = agent.id;
      },
    );
    return adopted;
  }

  private resolveTranscript(sessionRef: string): string | undefined {
    if (path.isAbsolute(sessionRef)) {
      return fs.existsSync(sessionRef) ? sessionRef : undefined;
    }
    const fileName = `${sessionRef}.jsonl`;
    for (const root of getAllSessionRoots()) {
      let projectDirs: fs.Dirent[];
      try {
        projectDirs = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const candidate = path.join(root, dir.name, fileName);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return undefined;
  }
}
