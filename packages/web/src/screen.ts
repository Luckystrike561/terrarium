/** Safari on iPad still only ships the prefixed Fullscreen API. */
type PrefixedDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void> | void;
};
type PrefixedElement = HTMLElement & {
	webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenElement(): Element | null {
	const doc = document as PrefixedDocument;
	return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Wires a toggle button; hides it where the page cannot go fullscreen (iPhone, or already installed fullscreen). */
export function setupFullscreen(button: HTMLButtonElement, target: HTMLElement): void {
	const element = target as PrefixedElement;
	const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
	if (request === undefined || matchMedia("(display-mode: fullscreen)").matches) {
		button.hidden = true;
		return;
	}
	const sync = (): void => {
		const active = fullscreenElement() !== null;
		button.setAttribute("aria-pressed", String(active));
		button.title = active ? "Leave fullscreen" : "Fullscreen";
	};
	button.addEventListener("click", () => {
		const doc = document as PrefixedDocument;
		if (fullscreenElement() !== null) {
			void (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
		} else {
			void Promise.resolve(request.call(element, { navigationUI: "hide" })).catch(() => {});
		}
	});
	document.addEventListener("fullscreenchange", sync);
	document.addEventListener("webkitfullscreenchange", sync);
	sync();
}

export type WakeState = "held" | "released" | "unsupported";

/**
 * Keeps the screen on while the page is visible. The browser drops the lock
 * whenever the page is hidden, so it is requested again on every return, and
 * after any tap in case the first request needed a user gesture.
 */
export function keepAwake(onChange: (state: WakeState) => void): void {
	if (!("wakeLock" in navigator) || !window.isSecureContext) {
		onChange("unsupported");
		return;
	}
	let sentinel: WakeLockSentinel | null = null;
	let pending = false;
	const acquire = async (): Promise<void> => {
		if (pending || document.visibilityState !== "visible") return;
		if (sentinel !== null && !sentinel.released) return;
		pending = true;
		try {
			sentinel = await navigator.wakeLock.request("screen");
			onChange("held");
			sentinel.addEventListener("release", () => onChange("released"));
		} catch {
			onChange("released");
		} finally {
			pending = false;
		}
	};
	document.addEventListener("visibilitychange", () => void acquire());
	document.addEventListener("pointerup", () => void acquire());
	void acquire();
}
