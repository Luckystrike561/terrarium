import * as crypto from 'node:crypto';

import type { Connection, ConnectionState } from '../../core/src/messages.js';
import type {
  ModuleHandle,
  ModuleHost,
  MultiplexerEndpoint,
  MultiplexerLinkState,
  MultiplexerModule,
  RunningAgentModule,
} from '../../core/src/provider.js';
import { readConnections, writeConnections } from './configPersistence.js';
import {
  connectionLabelError,
  type ConnectionSettings,
  isSameServer,
  type NewConnection,
} from './connectionSettings.js';
import { CONNECTION_ID_BYTES } from './constants.js';
import { MultiplexerFeed } from './multiplexerFeed.js';

interface LinkStatus {
  state: MultiplexerLinkState;
  message?: string;
}

/** One enabled connection: a feed per multiplexer module, and how each is doing. */
interface RunningConnection {
  readonly feeds: MultiplexerFeed[];
  readonly statuses: Map<string, LinkStatus>;
}

/** Worst first: a connection reads as its least healthy multiplexer link. */
const STATE_SEVERITY: Record<MultiplexerLinkState, number> = {
  error: 3,
  reconnecting: 2,
  connecting: 1,
  connected: 0,
};

export interface MultiplexerConnectionsOptions {
  readonly multiplexers: readonly MultiplexerModule[];
  readonly hostFor: (module: MultiplexerModule) => ModuleHost;
  /** Running agent modules by id, for panes on this machine to hand their sessions to. */
  readonly agentModules: ReadonlyMap<string, RunningAgentModule>;
}

/**
 * The herdr servers the office listens to (persisted in config.json) and the feeds watching them. Every enabled
 * connection feeds the same runtime, so its agents join the office like any other. Adding one checks it with a
 * probe first, and nothing is saved unless the multiplexer answered.
 */
export class MultiplexerConnections implements ModuleHandle {
  private settings: ConnectionSettings[];
  private readonly running = new Map<string, RunningConnection>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: MultiplexerConnectionsOptions) {
    this.settings = readConnections();
  }

  start(): void {
    for (const connection of this.settings) {
      if (connection.enabled) this.startConnection(connection);
    }
  }

  stop(): void {
    for (const id of [...this.running.keys()]) this.stopConnection(id);
  }

  /** Every connection with its live state, in the order they were added. */
  list(): Connection[] {
    return this.settings.map((connection) => {
      const status = this.statusOf(connection);
      return {
        id: connection.id,
        label: connection.label,
        kind: connection.kind,
        target: connection.target,
        session: connection.session,
        enabled: connection.enabled,
        state: status.state,
        message: status.message,
      };
    });
  }

  /** Called after any change to list(). Returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Probe, then save and start. Resolves with why the connection was not added, or undefined once it was. */
  async add(connection: NewConnection): Promise<string | undefined> {
    const duplicate = this.settings.find((existing) => isSameServer(existing, connection));
    if (duplicate) return `Already listening to that herdr server as "${duplicate.label}"`;
    const added: ConnectionSettings = {
      ...connection,
      id: crypto.randomBytes(CONNECTION_ID_BYTES).toString('hex'),
      enabled: true,
    };
    for (const multiplexer of this.options.multiplexers) {
      const error = await multiplexer.probe(endpointOf(added));
      if (error) return error;
    }
    const raced = this.settings.find((existing) => isSameServer(existing, connection));
    if (raced) return `Already listening to that herdr server as "${raced.label}"`;
    this.settings = [...this.settings, added];
    writeConnections(this.settings);
    this.startConnection(added);
    this.notify();
    return undefined;
  }

  /** Rename and/or turn on or off. Returns why nothing changed, or undefined. */
  update(id: string, patch: { label?: unknown; enabled?: unknown }): string | undefined {
    const current = this.settings.find((connection) => connection.id === id);
    if (!current) return `No connection ${id}`;
    const label = typeof patch.label === 'string' ? patch.label.trim() : current.label;
    const labelError = connectionLabelError(label);
    if (labelError) return labelError;
    const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled;
    const updated: ConnectionSettings = { ...current, label, enabled };
    this.settings = this.settings.map((connection) =>
      connection.id === id ? updated : connection,
    );
    writeConnections(this.settings);
    if (!enabled) this.stopConnection(id);
    else if (!current.enabled) this.startConnection(updated);
    else this.relabel(updated);
    this.notify();
    return undefined;
  }

  /** Stop listening and forget the connection. Returns why nothing changed, or undefined. */
  remove(id: string): string | undefined {
    if (!this.settings.some((connection) => connection.id === id)) return `No connection ${id}`;
    this.stopConnection(id);
    this.settings = this.settings.filter((connection) => connection.id !== id);
    writeConnections(this.settings);
    this.notify();
    return undefined;
  }

  private startConnection(connection: ConnectionSettings): void {
    const statuses = new Map<string, LinkStatus>();
    const feeds = this.options.multiplexers.map((multiplexer) => {
      const host = this.options.hostFor(multiplexer);
      statuses.set(multiplexer.id, { state: 'connecting' });
      return new MultiplexerFeed({
        multiplexer,
        endpoint: endpointOf(connection),
        host,
        agentModules: this.options.agentModules,
        label: characterLabelOf(connection),
        onState: (state, message) =>
          this.onLinkState(connection.id, multiplexer, host, { state, message }),
      });
    });
    this.running.set(connection.id, { feeds, statuses });
    for (const feed of feeds) feed.start();
  }

  private stopConnection(id: string): void {
    const running = this.running.get(id);
    if (!running) return;
    this.running.delete(id);
    for (const feed of running.feeds) feed.stop();
  }

  private relabel(connection: ConnectionSettings): void {
    for (const feed of this.running.get(connection.id)?.feeds ?? []) {
      feed.relabel(characterLabelOf(connection));
    }
  }

  private onLinkState(
    id: string,
    multiplexer: MultiplexerModule,
    host: ModuleHost,
    status: LinkStatus,
  ): void {
    const running = this.running.get(id);
    if (!running) return;
    const previous = running.statuses.get(multiplexer.id);
    if (previous?.state === status.state && previous.message === status.message) return;
    running.statuses.set(multiplexer.id, status);
    const label = this.settings.find((connection) => connection.id === id)?.label ?? id;
    host.log(`${label}: ${status.state}${status.message ? ` (${status.message})` : ''}`);
    this.notify();
  }

  private statusOf(connection: ConnectionSettings): { state: ConnectionState; message?: string } {
    if (!connection.enabled) return { state: 'disabled' };
    const statuses = [...(this.running.get(connection.id)?.statuses.values() ?? [])];
    return statuses.reduce<LinkStatus>(
      (worst, status) =>
        STATE_SEVERITY[status.state] > STATE_SEVERITY[worst.state] ? status : worst,
      { state: 'connected' },
    );
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function endpointOf(connection: ConnectionSettings): MultiplexerEndpoint {
  return {
    id: connection.id,
    kind: connection.kind,
    target: connection.target,
    session: connection.session,
  };
}

/** Characters name the machine or session they run on, except on this machine's default session. */
function characterLabelOf(connection: ConnectionSettings): string | undefined {
  return connection.kind === 'ssh' || connection.session ? connection.label : undefined;
}
