const base = process.argv[2] ?? "127.0.0.1:8799";
const tokens: Record<string, string> = { "laptop-a": "scratch-token-laptop-a", "laptop-b": "scratch-token-laptop-b", server: "scratch-token-server-00" };
type Agent = { host: string; id: string; kind: string; folder: string; parent?: string; script: (string | null)[] };
const agents: Agent[] = [
	{ host: "laptop-a", id: "a1", kind: "omp", folder: "terrarium", script: ["tool:read", "tool:edit", "tool:bash", "state:working", "tool:todo"] },
	{ host: "laptop-a", id: "a1-sub", kind: "omp", folder: "terrarium", parent: "a1", script: ["tool:grep", "tool:read"] },
	{ host: "laptop-a", id: "a1-sub2", kind: "omp", folder: "terrarium", parent: "a1", script: ["tool:web_search", "state:working"] },
	{ host: "laptop-a", id: "a2", kind: "claude", folder: "website", script: ["tool:Edit", "tool:WebFetch", "state:done", "state:idle"] },
	{ host: "laptop-b", id: "b1", kind: "codex", folder: "terrarium", script: ["tool:bash", "tool:hub", "state:blocked"] },
	{ host: "laptop-b", id: "b2", kind: "opencode", folder: "notes", script: ["state:blocked", "tool:task"] },
	{ host: "laptop-b", id: "b3", kind: "gemini", folder: "infra", script: ["state:idle", "tool:glob"] },
	{ host: "server", id: "s1", kind: "omp", folder: "homelab", script: ["tool:grep", "tool:write", "error:bash"] },
	{ host: "server", id: "s2", kind: "aider", folder: "website", script: ["state:working", "tool:lsp"] },
	{ host: "server", id: "s3", kind: "claude", folder: "notes", script: ["state:done", "tool:eval"] },
];
const sockets = new Map<string, WebSocket>();
for (const host of Object.keys(tokens)) {
	const ws = new WebSocket(`ws://${base}/ingest`, { headers: { authorization: `Bearer ${tokens[host]}` } } as unknown as string[]);
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
	sockets.set(host, ws);
}
const send = (host: string, agentId: string, kind: string, data: Record<string, unknown>) =>
	sockets.get(host)?.send(JSON.stringify({ v: 1, host, ts: Date.now(), agentId: `${host}:${agentId}`, kind, data }));
for (const agent of agents) {
	send(agent.host, agent.id, "agent.seen", { agentKind: agent.kind, folder: agent.folder, ...(agent.parent ? { parentAgentId: `${agent.host}:${agent.parent}` } : {}) });
}
let step = 0;
const tick = () => {
	for (const host of Object.keys(tokens)) send(host, "-", "host.heartbeat", {});
	for (const agent of agents) {
		const action = agent.script[step % agent.script.length] ?? "state:idle";
		const prev = agent.script[(step + agent.script.length - 1) % agent.script.length] ?? "";
		if (prev.startsWith("tool:") || prev.startsWith("error:")) send(agent.host, agent.id, "tool.end", { tool: prev.split(":")[1], isError: prev.startsWith("error:") });
		const [type, value] = action.split(":");
		if (type === "tool" || type === "error") send(agent.host, agent.id, "tool.start", { tool: value });
		else send(agent.host, agent.id, "agent.state", { state: value });
	}
	step++;
};
tick();
const period = Number(process.argv[3] ?? "6000");
setInterval(tick, period);
