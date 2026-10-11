import type { AgentModule, HookInstaller } from '../../../../core/src/provider.js';
import {
  areHooksInstalled as installerAreHooksInstalled,
  copyHookScript,
  installHooks as installerInstallHooks,
  uninstallHooks as installerUninstallHooks,
} from './claudeHookInstaller.js';
import { startClaudeModule } from './claudeRunningModule.js';
import {
  contextWindowForModel,
  formatToolStatus,
  permissionExemptTools,
  readingTools,
  subagentToolNames,
} from './claudeVocabulary.js';
import { CONSENT_DISCLOSURE, CONSENT_INSTALL_HEADLINE } from './consentCopy.js';

const claudeHooks: HookInstaller = {
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
  consentDisclosure: () => ({ headline: CONSENT_INSTALL_HEADLINE, disclosure: CONSENT_DISCLOSURE }),
  /** Every entry runs the bundled claude-hook.js, so it is copied into
   *  ~/.pixel-agents/hooks/ before any entry points at it. */
  stageHookFiles: copyHookScript,
};

export const claudeModule = {
  kind: 'agent',
  id: 'claude',
  displayName: 'Claude Code',
  protocolVersion: 2,

  hooks: claudeHooks,

  formatToolStatus,
  permissionExemptTools,
  subagentToolNames,
  readingTools,
  contextWindowForModel,

  start: startClaudeModule,
} satisfies AgentModule;
