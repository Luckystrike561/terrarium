export type HostName = "laptop-a" | "laptop-b" | "server";

export type TerrariumEventKind =
	| "agent.seen"
	| "agent.state"
	| "tool.start"
	| "tool.end"
	| "turn.usage"
	| "agent.gone"
	| "host.heartbeat";

export type TerrariumEvent = {
	v: 1;
	host: string;
	ts: number;
	agentId: string;
	kind: TerrariumEventKind;
	data: Record<string, unknown>;
};

export type AgentState =
	| "idle"
	| "working"
	| "blocked"
	| "done"
	| "unknown"
	| "offline";

export type UsageTotals = {
	tokensIn: number;
	tokensOut: number;
	tokensCacheRead: number;
	tokensCacheWrite: number;
	cost: number;
	messages: number;
};

export type UsageWindow = "day" | "week" | "month";

export type UsageRollup = {
	window: UsageWindow;
	byProvider: Record<string, UsageTotals>;
	byModel: Record<string, UsageTotals>;
	total: UsageTotals;
};

export type CurrentTool = {
	name: string;
	startedAt: number;
};

export type AgentView = {
	agentId: string;
	host: string;
	agentKind: string;
	folder: string | null;
	parentAgentId: string | null;
	state: AgentState;
	stateSince: number;
	currentTool: CurrentTool | null;
	lastToolError: boolean;
	lastSeen: number;
};

export type HostView = {
	host: string;
	online: boolean;
	lastHeartbeat: number;
	agents: Record<string, AgentView>;
	usage: UsageRollup[];
};

export type WorldSnapshot = {
	v: 1;
	type: "snapshot";
	ts: number;
	seq: number;
	hosts: Record<string, HostView>;
	usage: UsageRollup[];
};

export type WorldDelta = {
	v: 1;
	type: "delta";
	ts: number;
	seq: number;
	event: TerrariumEvent;
	hostsUpserted: HostView[];
	agentsUpserted: AgentView[];
	agentsRemoved: string[];
	usage: UsageRollup[] | null;
};
