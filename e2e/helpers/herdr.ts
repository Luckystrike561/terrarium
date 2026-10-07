import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/** Subset of herdrBridge.ts's `HerdrAgent` shape this fake implements. */
export interface FakeHerdrAgent {
  pane_id: string;
  workspace_id?: string;
  tab_id?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
  terminal_title_stripped?: string;
  agent_session?: { kind: string; value: string } | null;
}

export interface FakeHerdrWorkspace {
  workspace_id: string;
  label: string;
}

export interface FakeHerdrTab {
  tab_id: string;
  workspace_id?: string;
  label: string;
}

export interface FakeHerdrServer {
  readonly socketPath: string;
  setAgents(agents: FakeHerdrAgent[]): void;
  setWorkspaces(workspaces: FakeHerdrWorkspace[]): void;
  setTabs(tabs: FakeHerdrTab[]): void;
  updateAgent(paneId: string, patch: Partial<FakeHerdrAgent>): void;
  removeAgent(paneId: string): void;
  stop(): Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method: string;
  params?: unknown;
}

/** macOS caps a unix socket path around 104 bytes (Linux allows a bit more);
 *  a deep isolated-HOME tmpdir would bind silently wrong rather than fail, so
 *  check up front and report the real blocker instead of a confusing timeout
 *  on the bridge's first connect attempt. */
const MAX_SOCKET_PATH_LENGTH = 100;

function writeLine(socket: net.Socket, payload: unknown): void {
  socket.write(`${JSON.stringify(payload)}\n`);
}

/**
 * Starts a fake Herdr instance: a Unix domain socket at
 * `<homeDir>/.config/herdr/herdr.sock` speaking the same newline-delimited
 * JSON-RPC 2.0 `herdrBridge.ts` talks to. One-shot requests (`agent.list`,
 * `workspace.list`, `tab.list`) get a reply and the connection is then closed
 * server-side, mirroring real Herdr's connection semantics; `events.subscribe`
 * connections are kept open (the bridge's authoritative source of truth is
 * its poll loop, so this fake never needs to push anything down them).
 *
 * Must be running (socket file present) BEFORE the standalone CLI starts: the
 * bridge's connect failure path only retries every 5s, so a late-starting
 * fake would otherwise cost every test that 5s on top of the bridge's normal
 * 2.5s snapshot interval.
 */
export async function startFakeHerdrServer(homeDir: string): Promise<FakeHerdrServer> {
  const socketDir = path.join(homeDir, '.config', 'herdr');
  fs.mkdirSync(socketDir, { recursive: true });
  const socketPath = path.join(socketDir, 'herdr.sock');
  if (socketPath.length > MAX_SOCKET_PATH_LENGTH) {
    throw new Error(
      `Fake herdr socket path too long for a unix socket (${socketPath.length.toString()} chars): ${socketPath}`,
    );
  }
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Did not exist yet -- fine.
  }

  let agents = new Map<string, FakeHerdrAgent>();
  let workspaces: FakeHerdrWorkspace[] = [];
  let tabs: FakeHerdrTab[] = [];
  const subscribers = new Set<net.Socket>();

  function handleRequest(socket: net.Socket, msg: JsonRpcRequest): void {
    const reply = (result: unknown): void => {
      writeLine(socket, { jsonrpc: '2.0', id: msg.id ?? '1', result });
    };
    switch (msg.method) {
      case 'agent.list':
        reply({ agents: [...agents.values()] });
        socket.end();
        return;
      case 'workspace.list':
        reply({ workspaces });
        socket.end();
        return;
      case 'tab.list':
        reply({ tabs });
        socket.end();
        return;
      case 'events.subscribe':
        subscribers.add(socket);
        reply({});
        return;
      default:
        writeLine(socket, {
          jsonrpc: '2.0',
          id: msg.id ?? '1',
          error: { code: -32601, message: 'method not found' },
        });
        socket.end();
    }
  }

  const server = net.createServer((socket) => {
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg: JsonRpcRequest;
        try {
          msg = JSON.parse(line) as JsonRpcRequest;
        } catch {
          continue;
        }
        handleRequest(socket, msg);
      }
    });
    socket.on('error', () => subscribers.delete(socket));
    socket.on('close', () => subscribers.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  return {
    socketPath,
    setAgents(next) {
      agents = new Map(next.map((a) => [a.pane_id, a]));
    },
    setWorkspaces(next) {
      workspaces = next;
    },
    setTabs(next) {
      tabs = next;
    },
    updateAgent(paneId, patch) {
      const current = agents.get(paneId);
      if (!current) return;
      agents.set(paneId, { ...current, ...patch });
    },
    removeAgent(paneId) {
      agents.delete(paneId);
    },
    async stop() {
      for (const socket of subscribers) {
        socket.destroy();
      }
      subscribers.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Already gone.
      }
    },
  };
}
