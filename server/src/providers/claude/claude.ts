import type { AgentModule, HookInstaller } from '../../../../core/src/provider.js';
import {
  areHooksInstalled as installerAreHooksInstalled,
  copyHookScript,
  installHooks as installerInstallHooks,
  installStatusLineEntry,
  isStatusLineInstalled,
  uninstallHooks as installerUninstallHooks,
  uninstallStatusLineEntry,
} from './claudeHookInstaller.js';
import { startClaudeModule } from './claudeRunningModule.js';
import {
  contextWindowForModel,
  formatToolStatus,
  permissionExemptTools,
  readingTools,
  subagentToolNames,
} from './claudeVocabulary.js';
import {
  CONSENT_ACTION_LABEL,
  CONSENT_DISCLOSURE,
  CONSENT_INSTALL_HEADLINE,
  STATUS_LINE_ACTION_LABEL,
  STATUS_LINE_DISCLOSURE,
  STATUS_LINE_HEADLINE,
} from './consentCopy.js';
import { HOOKS_SUBJECT_ID, STATUS_LINE_SUBJECT_ID } from './constants.js';

/** The 12 hook entries — tool/turn activity. Asked and revised independently of the status line below; its own
 *  install/uninstall never touches `statusLine`. */
const hooksSubject: HookInstaller = {
  id: HOOKS_SUBJECT_ID,
  /** Async so an installer throw (e.g. unparseable settings.json) always reaches
   *  callers as a rejection they can surface, never a sync throw. */
  async installHooks(): Promise<void> {
    await installerInstallHooks();
  },
  async uninstallHooks(): Promise<void> {
    await installerUninstallHooks();
  },
  areHooksInstalled: () => Promise.resolve(installerAreHooksInstalled()),
  /** The strings live in consentCopy.ts (Claude-specific facts: the event
   *  count, the settings path), and the shared consent gate ships them verbatim. */
  consentDisclosure: () => ({
    headline: CONSENT_INSTALL_HEADLINE,
    disclosure: CONSENT_DISCLOSURE,
    actionLabel: CONSENT_ACTION_LABEL,
  }),
};

/** The `statusLine` slot — Claude Code's rate-limit readout. Asked and revised independently of the hook entries
 *  above: declining it leaves the 12 entries exactly as they are, and vice versa. */
const statusLineSubject: HookInstaller = {
  id: STATUS_LINE_SUBJECT_ID,
  async installHooks(): Promise<void> {
    await installStatusLineEntry();
  },
  async uninstallHooks(): Promise<void> {
    await uninstallStatusLineEntry();
  },
  areHooksInstalled: () => Promise.resolve(isStatusLineInstalled()),
  consentDisclosure: () => ({
    headline: STATUS_LINE_HEADLINE,
    disclosure: STATUS_LINE_DISCLOSURE,
    actionLabel: STATUS_LINE_ACTION_LABEL,
  }),
};

export const claudeModule = {
  kind: 'agent',
  id: 'claude',
  displayName: 'Claude Code',
  protocolVersion: 2,

  hooks: [hooksSubject, statusLineSubject],
  /** Every entry's and the status line's command runs the bundled claude-hook.js, so it is copied into
   *  ~/.terrarium/hooks/ before any subject's install points at it. Shared prerequisite, run once for both. */
  stageHookFiles: copyHookScript,

  formatToolStatus,
  permissionExemptTools,
  subagentToolNames,
  readingTools,
  contextWindowForModel,

  start: startClaudeModule,
} satisfies AgentModule;
