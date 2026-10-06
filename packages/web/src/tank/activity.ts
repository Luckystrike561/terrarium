import type { AgentView } from "@terrarium/protocol";

export type Activity =
	| "sleep"
	| "think"
	| "read"
	| "sniff"
	| "build"
	| "hammer"
	| "telescope"
	| "notepad"
	| "messenger"
	| "hatch"
	| "knock"
	| "celebrate"
	| "rest"
	| "trip"
	| "stone";

/**
 * The one tool -> animation table. Keys are normalized tool names (see
 * `normalizeTool`); a tool missing here animates as plain "working".
 */
const TOOL_ACTIVITY: Readonly<Record<string, Activity>> = {
	read: "read",
	lsp: "read",
	notebook_read: "read",
	grep: "sniff",
	glob: "sniff",
	find: "sniff",
	search: "sniff",
	ls: "sniff",
	edit: "build",
	multi_edit: "build",
	write: "build",
	ast_edit: "build",
	notebook_edit: "build",
	bash: "hammer",
	shell: "hammer",
	exec: "hammer",
	eval: "hammer",
	web_search: "telescope",
	web_fetch: "telescope",
	fetch: "telescope",
	browser: "telescope",
	todo: "notepad",
	todo_write: "notepad",
	hub: "messenger",
	task: "hatch",
	ask: "knock",
	ask_user_question: "knock",
};

/** `WebFetch`, `web-fetch` and `web_fetch` all become `web_fetch`. */
export function normalizeTool(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}

export function toolActivity(name: string): Activity {
	return TOOL_ACTIVITY[normalizeTool(name)] ?? "think";
}

/** The steady animation for an agent; transient ones (celebrate, trip) are layered on by the creature. */
export function baseActivity(agent: AgentView, hostOnline: boolean): Activity {
	if (!hostOnline) return "stone";
	switch (agent.state) {
		case "offline":
			return "stone";
		case "blocked":
			return "knock";
		case "idle":
			return "sleep";
		case "done":
		case "unknown":
			return "rest";
		case "working":
			return agent.currentTool === null
				? "think"
				: toolActivity(agent.currentTool.name);
	}
}

/** Activities during which the creature roams its zone instead of staying home. */
export function roams(activity: Activity): boolean {
	return activity === "think" || activity === "messenger";
}
