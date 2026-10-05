import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { errorMessage, isRecord } from "./guards";

const MIN_TOKEN_LENGTH = 16;

export type HubConfig = {
	/** Host name per collector token. */
	collectorTokens: ReadonlyMap<string, string>;
	viewTokens: readonly string[];
};

export type Auth = {
	/** The host a collector token belongs to, or null. */
	collectorHost(token: string | null): string | null;
	isViewToken(token: string | null): boolean;
	hosts: readonly string[];
};

export function loadConfig(path: string): HubConfig {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`cannot read hub config ${path}: ${errorMessage(error)}`);
	}
	return parseConfig(raw, path);
}

export function parseConfig(raw: unknown, origin: string): HubConfig {
	const fail = (message: string): never => {
		throw new Error(`invalid hub config ${origin}: ${message}`);
	};
	if (!isRecord(raw)) fail("expected a JSON object");
	const config = raw as Record<string, unknown>;
	const seen = new Set<string>();
	const checkToken = (token: unknown, where: string): string => {
		if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
			fail(
				`${where} must be a string of at least ${MIN_TOKEN_LENGTH} characters`,
			);
		}
		const value = token as string;
		if (seen.has(value)) fail(`${where} repeats another token`);
		seen.add(value);
		return value;
	};

	if (!isRecord(config.collectorTokens)) {
		fail('"collectorTokens" must map host names to tokens');
	}
	const collectorTokens = new Map<string, string>();
	for (const [host, token] of Object.entries(
		config.collectorTokens as Record<string, unknown>,
	)) {
		if (host.length === 0 || host.includes(":")) {
			fail(`host name "${host}" must be non-empty and contain no ":"`);
		}
		collectorTokens.set(checkToken(token, `collectorTokens.${host}`), host);
	}

	if (!Array.isArray(config.viewTokens) || config.viewTokens.length === 0) {
		fail('"viewTokens" must be a non-empty array');
	}
	const viewTokens = (config.viewTokens as unknown[]).map((token, index) =>
		checkToken(token, `viewTokens[${index}]`),
	);
	return { collectorTokens, viewTokens };
}

function digest(token: string): Buffer {
	return createHash("sha256").update(token).digest();
}

/** Compares digests in constant time so a token cannot be guessed by timing. */
export function createAuth(config: HubConfig): Auth {
	const collectors = [...config.collectorTokens].map(
		([token, host]) => [digest(token), host] as const,
	);
	const views = config.viewTokens.map(digest);
	return {
		collectorHost(token) {
			if (token === null) return null;
			const presented = digest(token);
			let match: string | null = null;
			for (const [expected, host] of collectors) {
				if (timingSafeEqual(presented, expected)) match = host;
			}
			return match;
		},
		isViewToken(token) {
			if (token === null) return false;
			const presented = digest(token);
			let match = false;
			for (const expected of views) {
				if (timingSafeEqual(presented, expected)) match = true;
			}
			return match;
		},
		hosts: [...new Set(config.collectorTokens.values())].sort(),
	};
}
