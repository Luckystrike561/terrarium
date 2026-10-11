/**
 * Herdr multiplexer module. Herdr hosts agents (omp, Claude, Codex, opencode, ...) in terminal panes and knows, for
 * each one, its kind, status level, working directory, pane title and session file. This module only reads that:
 * what an agent is doing comes from the agent module for its kind.
 *
 * A local endpoint is herdr's socket on this machine. An ssh endpoint forwards a remote herdr's socket over OpenSSH
 * (herdr has no network listener). Nothing is written to any Herdr or third-party file, so there is nothing to
 * consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { MultiplexerEndpoint, MultiplexerModule } from '../../../../core/src/provider.js';
import { HERDR_RPC_TIMEOUT_MS, SSH_FORWARD_DIR_SEGMENTS } from './constants.js';
import { HerdrBridge, herdrRequest } from './herdrBridge.js';
import { herdrSocketPath } from './herdrSocket.js';
import { HerdrSshLink, probeOverSsh, type SshTransportOptions } from './herdrSsh.js';

function localSocketPath(endpoint: MultiplexerEndpoint): string {
  return herdrSocketPath({
    session: endpoint.session,
    home: os.homedir(),
    env: process.env,
    paths: path,
  });
}

/** `forwardName` keeps a probe's forward apart from the running connection's. */
function sshOptions(endpoint: MultiplexerEndpoint, forwardName: string): SshTransportOptions {
  if (!endpoint.target) throw new Error(`ssh endpoint ${endpoint.id} has no target`);
  return {
    target: endpoint.target,
    session: endpoint.session,
    localSocketPath: path.join(os.homedir(), ...SSH_FORWARD_DIR_SEGMENTS, `${forwardName}.sock`),
  };
}

export const herdrModule: MultiplexerModule = {
  kind: 'multiplexer',
  id: 'herdr',
  displayName: 'Herdr',
  connect(endpoint, watcher) {
    const link =
      endpoint.kind === 'ssh'
        ? new HerdrSshLink(sshOptions(endpoint, endpoint.id), watcher)
        : new HerdrBridge({ socketPath: localSocketPath(endpoint), watcher });
    link.start();
    return link;
  },
  async probe(endpoint) {
    if (endpoint.kind === 'ssh')
      return await probeOverSsh(sshOptions(endpoint, `${endpoint.id}-probe`));
    const reply = await herdrRequest(localSocketPath(endpoint), 'ping', HERDR_RPC_TIMEOUT_MS);
    return 'error' in reply ? reply.error : undefined;
  },
};
