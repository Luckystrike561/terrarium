import type { WorldMessage } from "@terrarium/protocol";
import { renderAgents, renderUsage } from "./render";
import { keepAwake, setupFullscreen } from "./screen";
import { Tank } from "./tank/scene";
import { applyMessage, type WorldState } from "./world";

const TOKEN_KEY = "terrarium.viewToken";
/** Must match the hub's close code for a rejected view token. */
const CLOSE_UNAUTHORIZED = 4401;
const MAX_RETRY_MS = 15_000;

type Status = "connecting" | "live" | "reconnecting" | "unauthorized";

function byId<T extends HTMLElement>(id: string): T {
	const node = document.getElementById(id);
	if (node === null) throw new Error(`missing #${id}`);
	return node as T;
}

const tankBox = byId<HTMLDivElement>("tank");
const statusBox = byId<HTMLDivElement>("status");
const statusText = byId<HTMLSpanElement>("status-text");
const wakeBadge = byId<HTMLSpanElement>("wake");
const detailsButton = byId<HTMLButtonElement>("details-button");
const fullscreenButton = byId<HTMLButtonElement>("fullscreen-button");
const details = byId<HTMLElement>("details");
const tokenForm = byId<HTMLFormElement>("token-form");
const tokenInput = byId<HTMLInputElement>("token-input");
const usageTable = byId<HTMLTableElement>("usage");
const agentsTable = byId<HTMLTableElement>("agents");

/** Without a working renderer the page still connects and shows the tables. */
const tank = await Tank.create(tankBox).catch((error: unknown) => {
	console.error("tank: renderer failed to start", error);
	details.hidden = false;
	detailsButton.setAttribute("aria-pressed", "true");
	return null;
});

let world: WorldState | null = null;
let socket: WebSocket | null = null;
let retryMs = 1_000;
let retryTimer: number | undefined;
let renderQueued = false;

function setStatus(status: Status, text: string): void {
	statusBox.dataset.state = status;
	statusText.textContent = text;
}

/** Moves a `?token=` from the URL into storage so it does not linger in history. */
function readToken(): string | null {
	const url = new URL(window.location.href);
	const fromUrl = url.searchParams.get("token");
	if (fromUrl !== null && fromUrl.length > 0) {
		localStorage.setItem(TOKEN_KEY, fromUrl);
		url.searchParams.delete("token");
		window.history.replaceState(null, "", url);
	}
	return localStorage.getItem(TOKEN_KEY);
}

function renderDetails(): void {
	renderQueued = false;
	if (world === null || details.hidden) return;
	renderUsage(usageTable, world.usage);
	renderAgents(agentsTable, world, Date.now());
}

function queueDetails(): void {
	if (renderQueued || details.hidden) return;
	renderQueued = true;
	requestAnimationFrame(renderDetails);
}

function askForToken(): void {
	tokenForm.hidden = false;
	tokenInput.focus();
}

function connect(token: string): void {
	clearTimeout(retryTimer);
	setStatus(socket === null ? "connecting" : "reconnecting", "Connecting");
	const scheme = window.location.protocol === "https:" ? "wss" : "ws";
	const ws = new WebSocket(
		`${scheme}://${window.location.host}/view?token=${encodeURIComponent(token)}`,
	);
	socket = ws;
	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string") return;
		const message = JSON.parse(event.data) as WorldMessage;
		if (message.type === "snapshot") {
			retryMs = 1_000;
			setStatus("live", "Live");
		}
		world = applyMessage(world, message);
		if (world === null) return;
		tank?.sync(world);
		if (message.type === "delta" && message.event !== null) {
			tank?.notify(message.event);
		}
		queueDetails();
	});
	ws.addEventListener("close", (event) => {
		if (socket !== ws) return;
		if (event.code === CLOSE_UNAUTHORIZED) {
			localStorage.removeItem(TOKEN_KEY);
			setStatus("unauthorized", "Token rejected");
			askForToken();
			return;
		}
		const wait = retryMs;
		retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
		setStatus(
			"reconnecting",
			`Offline, retrying in ${Math.round(wait / 1000)}s`,
		);
		retryTimer = window.setTimeout(() => connect(token), wait);
	});
}

tokenForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const token = tokenInput.value.trim();
	if (token.length === 0) return;
	localStorage.setItem(TOKEN_KEY, token);
	tokenInput.value = "";
	tokenForm.hidden = true;
	connect(token);
});

detailsButton.addEventListener("click", () => {
	details.hidden = !details.hidden;
	detailsButton.setAttribute("aria-pressed", String(!details.hidden));
	queueDetails();
});

setupFullscreen(fullscreenButton, document.documentElement);
keepAwake((state) => {
	wakeBadge.dataset.state = state;
	wakeBadge.title =
		state === "held"
			? "Screen stays on"
			: state === "released"
				? "Screen may sleep; tap to keep it on"
				: "Screen wake lock needs HTTPS or localhost";
});

window.setInterval(queueDetails, 1_000);

const token = readToken();
if (token === null) {
	setStatus("unauthorized", "Token needed");
	askForToken();
} else {
	connect(token);
}
