import { resolve, sep } from "node:path";
import type { Server } from "bun";
import type { Auth } from "./config";
import { errorMessage } from "./guards";
import type { Hub } from "./hub";
import { parseEvent } from "./sanitize";

export const WORLD_TOPIC = "world";

/** Close code sent to a browser whose view token was rejected. */
export const CLOSE_UNAUTHORIZED = 4401;

const MAX_MESSAGE_BYTES = 1024 * 1024;

export type SocketData =
	| { role: "collector"; host: string; dropped: number }
	| { role: "view"; authorized: boolean };

export type ServerOptions = {
	hostname: string;
	port: number;
	auth: Auth;
	hub: Hub;
	webDist: string;
	log: (message: string) => void;
};

function bearer(request: Request): string | null {
	const header = request.headers.get("authorization");
	const match = header === null ? null : /^Bearer\s+(\S+)$/i.exec(header);
	return match?.[1] ?? null;
}

async function serveStatic(root: string, pathname: string): Promise<Response> {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return new Response("Bad request", { status: 400 });
	}
	const path = resolve(root, `.${decoded}`);
	if (path !== root && !path.startsWith(root + sep)) {
		return new Response("Not found", { status: 404 });
	}
	const file = Bun.file(path);
	if (!path.endsWith(sep) && path !== root && (await file.exists())) {
		const immutable = decoded.startsWith("/assets/");
		return new Response(file, {
			headers: {
				"cache-control": immutable
					? "public, max-age=31536000, immutable"
					: "no-cache",
			},
		});
	}
	const index = Bun.file(resolve(root, "index.html"));
	if (!(await index.exists())) {
		return new Response(
			"The web UI is not built. Run `bun run build:web`, then reload.\n",
			{ status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
		);
	}
	return new Response(index, { headers: { "cache-control": "no-cache" } });
}

function messageText(message: string | Buffer): string {
	return typeof message === "string" ? message : message.toString("utf8");
}

export function startServer(options: ServerOptions): Server<SocketData> {
	const { auth, hub, log } = options;
	const root = resolve(options.webDist);
	return Bun.serve({
		hostname: options.hostname,
		port: options.port,
		async fetch(request, server) {
			const url = new URL(request.url);
			if (url.pathname === "/ingest") {
				const host = auth.collectorHost(bearer(request));
				if (host === null) {
					return new Response("Unauthorized", { status: 401 });
				}
				const data: SocketData = { role: "collector", host, dropped: 0 };
				return server.upgrade(request, { data })
					? undefined
					: new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			if (url.pathname === "/view") {
				const data: SocketData = {
					role: "view",
					authorized: auth.isViewToken(url.searchParams.get("token")),
				};
				return server.upgrade(request, { data })
					? undefined
					: new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			if (url.pathname === "/healthz") return new Response("ok\n");
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method not allowed", { status: 405 });
			}
			return serveStatic(root, url.pathname);
		},
		websocket: {
			data: {} as SocketData,
			maxPayloadLength: MAX_MESSAGE_BYTES,
			open(ws) {
				if (ws.data.role === "collector") {
					log(`collector connected: ${ws.data.host}`);
					hub.connect(ws.data.host);
					return;
				}
				// Upgraded first so the browser gets a close code it can show.
				if (!ws.data.authorized) {
					ws.close(CLOSE_UNAUTHORIZED, "unauthorized");
					return;
				}
				ws.subscribe(WORLD_TOPIC);
				ws.send(JSON.stringify(hub.snapshot()));
			},
			message(ws, message) {
				if (ws.data.role !== "collector") return;
				const { host } = ws.data;
				let raw: unknown;
				try {
					raw = JSON.parse(messageText(message));
				} catch {
					ws.data.dropped++;
					log(`collector ${host}: dropped a message that is not JSON`);
					return;
				}
				for (const item of Array.isArray(raw) ? raw : [raw]) {
					const parsed = parseEvent(item, host);
					if (!parsed.ok) {
						ws.data.dropped++;
						log(`collector ${host}: dropped an event: ${parsed.reason}`);
						continue;
					}
					try {
						hub.ingest(parsed.event);
					} catch (error) {
						log(`collector ${host}: ingest failed: ${errorMessage(error)}`);
					}
				}
			},
			close(ws, code) {
				if (ws.data.role !== "collector") return;
				log(
					`collector disconnected: ${ws.data.host} (code ${code}, ${ws.data.dropped} dropped)`,
				);
				hub.disconnect(ws.data.host);
			},
		},
	});
}
