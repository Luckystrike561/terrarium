/**
 * Herdr multiplexer module. Herdr hosts agents (omp, Claude, Codex, opencode, ...) in terminal panes and knows, for
 * each one, its kind, status level, working directory, pane title and session file. This module only reads that
 * (see herdrBridge.ts); what an agent is doing comes from the agent module for its kind.
 *
 * Nothing is written to any Herdr or third-party file — the bridge talks to the local socket only — so there is
 * nothing to consent to.
 */

import type { MultiplexerModule } from '../../../../core/src/provider.js';
import { HerdrBridge } from './herdrBridge.js';

export const herdrModule: MultiplexerModule = {
  kind: 'multiplexer',
  id: 'herdr',
  displayName: 'Herdr',
  connect(onSnapshot, log) {
    const bridge = new HerdrBridge({ onSnapshot, log });
    return { connected: bridge.start(), stop: () => bridge.stop() };
  },
};
