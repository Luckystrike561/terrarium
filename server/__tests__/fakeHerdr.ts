import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

interface RawAgentSession {
  kind?: string;
  value?: string;
}

export interface RawAgent {
  name?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
  workspace_id?: string;
  tab_id?: string;
  pane_id?: string;
  terminal_title_stripped?: string;
  agent_session?: RawAgentSession | null;
}

interface RawLabeled {
  workspace_id?: string;
  tab_id?: string;
  label?: string;
}

type AgentListMode = 'ok' | 'malformed' | 'hang';

/** How the fake answers `events.subscribe`: accept it like herdr, refuse it with an error, or hang up without a word
 *  (what the local end of an SSH forward does when the remote herdr is down). */
type SubscribeMode = 'accept' | 'refuse' | 'hangUp';

export interface FakeHerdrState {
  agents: RawAgent[];
  workspaces: RawLabeled[];
  tabs: RawLabeled[];
  agentListMode: AgentListMode;
  subscribeMode: SubscribeMode;
}

export function defaultState(): FakeHerdrState {
  return { agents: [], workspaces: [], tabs: [], agentListMode: 'ok', subscribeMode: 'accept' };
}

/** A herdr stand-in: a JSON-RPC 2.0 server over a unix socket, matching the real one-shot-vs-subscription
 *  connection semantics the bridge depends on. Resolves only once the socket is actually bound, so a caller that
 *  immediately fires a reconnect attempt against it never races the bind. The socket's directory is created. */
export async function startFakeHerdr(
  socketPath: string,
  state: FakeHerdrState,
): Promise<{ server: net.Server; liveConnections: () => number; closeAll: () => void }> {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); // a client that resets mid-reply is not a bridge concern here
    socket.setEncoding('utf8');
    let buffered = '';
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let idx: number;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 1);
        if (!line.trim()) continue;
        let request: { id?: string; method?: string };
        try {
          request = JSON.parse(line) as { id?: string; method?: string };
        } catch {
          continue;
        }
        if (request.method === 'events.subscribe') {
          // Long-lived: answered once, then kept open.
          if (state.subscribeMode === 'hangUp') socket.destroy();
          else if (state.subscribeMode === 'refuse') {
            socket.write(
              `${JSON.stringify({ id: request.id, error: { code: 'unsupported', message: 'no events here' } })}\n`,
            );
          } else {
            socket.write(
              `${JSON.stringify({ id: request.id, result: { type: 'subscription_started' } })}\n`,
            );
          }
          continue;
        }
        const reply = (result: unknown): void => {
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
          socket.end();
        };
        if (request.method === 'agent.list') {
          if (state.agentListMode === 'hang') continue; // simulate an unanswered poll
          reply(
            state.agentListMode === 'malformed' ? { notAgents: true } : { agents: state.agents },
          );
        } else if (request.method === 'workspace.list') {
          reply({ workspaces: state.workspaces });
        } else if (request.method === 'tab.list') {
          reply({ tabs: state.tabs });
        } else if (request.method === 'ping') {
          reply({ type: 'pong' });
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    server,
    liveConnections: () => sockets.size,
    closeAll: () => {
      for (const socket of sockets) socket.destroy();
    },
  };
}
