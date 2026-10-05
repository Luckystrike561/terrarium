import type {
	AgentView,
	HostView,
	UsageRollup,
	UsageTotals,
	UsageWindow,
} from "@terrarium/protocol";
import type { WorldState } from "./world";

const WINDOW_LABEL: Record<UsageWindow, string> = {
	day: "Today",
	week: "7 days",
	month: "30 days",
};

const AGENT_COLUMNS = [
	"Agent",
	"State",
	"Tool",
	"Tokens",
	"Cost",
	"Last seen",
] as const;

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className !== undefined) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function totalTokens(totals: UsageTotals): number {
	return (
		totals.tokensIn +
		totals.tokensOut +
		totals.tokensCacheRead +
		totals.tokensCacheWrite
	);
}

function formatTokens(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
	if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${(value / 1_000_000_000).toFixed(2)}B`;
}

function formatCost(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatAge(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 5) return "now";
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86_400)}d`;
}

function usageCell(totals: UsageTotals | undefined): HTMLTableCellElement {
	const cell = el("td", "num");
	cell.append(
		el(
			"span",
			"tokens",
			`${formatTokens(totals ? totalTokens(totals) : 0)} tok`,
		),
		el("span", "cost", formatCost(totals?.cost ?? 0)),
	);
	return cell;
}

function headRow(labels: readonly string[]): HTMLTableSectionElement {
	const head = el("thead");
	const row = el("tr");
	for (const label of labels) row.append(el("th", undefined, label));
	head.append(row);
	return head;
}

export function renderUsage(
	table: HTMLTableElement,
	usage: UsageRollup[],
): void {
	const providers = [
		...new Set(usage.flatMap((rollup) => Object.keys(rollup.byProvider))),
	].sort();
	const body = el("tbody");
	const addRow = (
		label: string,
		pick: (rollup: UsageRollup) => UsageTotals | undefined,
		className?: string,
	): void => {
		const row = el("tr", className);
		row.append(el("th", "label", label));
		for (const rollup of usage) {
			const cell = usageCell(pick(rollup));
			cell.dataset.label = WINDOW_LABEL[rollup.window];
			row.append(cell);
		}
		body.append(row);
	};
	for (const provider of providers) {
		addRow(provider, (rollup) => rollup.byProvider[provider]);
	}
	addRow("All providers", (rollup) => rollup.total, "total");
	table.replaceChildren(
		headRow([
			"Provider",
			...usage.map((rollup) => WINDOW_LABEL[rollup.window]),
		]),
		body,
	);
}

function agentName(agent: AgentView): string {
	return agent.folder ?? agent.agentId.slice(agent.host.length + 1);
}

/** Top-level agents sorted by name, each followed by its subagents. */
function orderAgents(host: HostView): { agent: AgentView; depth: number }[] {
	const agents = Object.values(host.agents);
	const byName = (a: AgentView, b: AgentView): number =>
		agentName(a).localeCompare(agentName(b)) ||
		a.agentId.localeCompare(b.agentId);
	const children = new Map<string, AgentView[]>();
	const roots: AgentView[] = [];
	for (const agent of agents) {
		const parent = agent.parentAgentId;
		if (parent !== null && Object.hasOwn(host.agents, parent)) {
			const siblings = children.get(parent) ?? [];
			siblings.push(agent);
			children.set(parent, siblings);
		} else {
			roots.push(agent);
		}
	}
	const ordered: { agent: AgentView; depth: number }[] = [];
	const visit = (agent: AgentView, depth: number): void => {
		ordered.push({ agent, depth });
		for (const child of (children.get(agent.agentId) ?? []).sort(byName)) {
			visit(child, depth + 1);
		}
	};
	for (const root of roots.sort(byName)) visit(root, 0);
	return ordered;
}

function hostRow(host: HostView, now: number): HTMLTableRowElement {
	const row = el("tr", `host-row ${host.online ? "online" : "offline"}`);
	const cell = el("th");
	cell.colSpan = AGENT_COLUMNS.length;
	cell.scope = "rowgroup";
	const today = host.usage.find((rollup) => rollup.window === "day")?.total;
	const seen =
		host.lastHeartbeat > 0
			? `, last contact ${formatAge(now - host.lastHeartbeat)} ago`
			: "";
	cell.append(
		el("span", "host-dot"),
		el("span", "host-name", host.host),
		el("span", "host-meta", host.online ? "online" : `offline${seen}`),
		el(
			"span",
			"host-usage",
			`today ${formatTokens(today ? totalTokens(today) : 0)} tok, ${formatCost(today?.cost ?? 0)}`,
		),
	);
	row.append(cell);
	return row;
}

function agentRow(
	agent: AgentView,
	depth: number,
	now: number,
): HTMLTableRowElement {
	const row = el("tr", `agent-row state-${agent.state}`);
	const name = el("td", "agent");
	name.style.setProperty("--depth", String(depth));
	name.append(
		el("span", "agent-name", agentName(agent)),
		el(
			"span",
			"agent-kind",
			depth > 0 ? `${agent.agentKind} subagent` : agent.agentKind,
		),
	);
	const state = el("td", "state");
	state.append(
		el("span", "badge", agent.state),
		el("span", "since", formatAge(now - agent.stateSince)),
	);
	const tool = el("td", "tool");
	if (agent.currentTool !== null) {
		tool.append(
			el("span", "tool-name", agent.currentTool.name),
			el("span", "since", formatAge(now - agent.currentTool.startedAt)),
		);
	} else if (agent.lastToolError) {
		tool.append(el("span", "tool-error", "last tool failed"));
	} else {
		tool.append(el("span", "muted", "-"));
	}
	const cells = [
		name,
		state,
		tool,
		el("td", "num", formatTokens(totalTokens(agent.usage))),
		el("td", "num", formatCost(agent.usage.cost)),
		el("td", "num", formatAge(now - agent.lastSeen)),
	];
	cells.forEach((cell, index) => {
		cell.dataset.label = AGENT_COLUMNS[index] ?? "";
	});
	row.append(...cells);
	return row;
}

export function renderAgents(
	table: HTMLTableElement,
	state: WorldState,
	now: number,
): void {
	const bodies: HTMLTableSectionElement[] = [];
	for (const host of Object.values(state.hosts).sort((a, b) =>
		a.host.localeCompare(b.host),
	)) {
		const body = el("tbody");
		body.append(hostRow(host, now));
		const agents = orderAgents(host);
		if (agents.length === 0) {
			const row = el("tr", "empty");
			const cell = el("td", "muted", "No agents");
			cell.colSpan = AGENT_COLUMNS.length;
			row.append(cell);
			body.append(row);
		}
		for (const { agent, depth } of agents) {
			body.append(agentRow(agent, depth, now));
		}
		bodies.push(body);
	}
	table.replaceChildren(headRow(AGENT_COLUMNS), ...bodies);
}
