import {
	createTerrarium,
	type HookContext,
	type HookHandler,
	type TerrariumOptions,
} from "./terrarium";

export type FakeSession = {
	sessionFile: string;
	cwd: string;
	idle?: boolean;
};

export type Harness = {
	/** Runs every handler the extension registered for `hook`, as omp would. */
	fire(hook: string, event?: Record<string, unknown>): void;
	/** Flushes and closes the extension's socket connection. */
	close(): Promise<void>;
};

/**
 * Loads the extension against a stand-in for omp's extension API, so hooks
 * can be fired with synthetic payloads and no omp session.
 */
export function createHarness(
	options: TerrariumOptions,
	session: FakeSession,
): Harness {
	const handlers = new Map<string, HookHandler[]>();
	const extension = createTerrarium(options);
	extension.register({
		on(hook, handler) {
			handlers.set(hook, [...(handlers.get(hook) ?? []), handler]);
		},
	});
	const ctx: HookContext = {
		cwd: session.cwd,
		isIdle: () => session.idle ?? true,
		sessionManager: { getSessionFile: () => session.sessionFile },
	};
	return {
		fire(hook, event = {}) {
			for (const handler of handlers.get(hook) ?? []) {
				handler({ type: hook, ...event }, ctx);
			}
		},
		close: () => extension.close(),
	};
}
