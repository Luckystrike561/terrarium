import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  type ConnectionSettings,
  DEFAULT_CONNECTIONS,
  parseStoredConnection,
} from './connectionSettings.js';
import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface AdapterSettings {
  lastSeenVersion: string;
  hooksInfoShown: boolean;
  areaMappings: Record<string, string[]>;
  /** Centre a composed office (see readLayoutFromFile/clientMessageHandler's
   *  `isDefault`) on the CTO module, default true. No settings UI; edited by
   *  hand in config.json. */
  ctoOffice: boolean;
}

/** All keys in AdapterSettings. Used by adapters to map `terrarium.foo` → `foo`.
 *  The hooks preference is NOT here: it is per-provider, per-subject and machine-global
 *  (the hooks it governs live in one home-directory file per provider), so it
 *  lives beside `hooksConsent` at the config top level, not per namespace. */
export const ADAPTER_SETTING_KEYS = ['lastSeenVersion', 'hooksInfoShown', 'areaMappings'] as const;

export type AdapterSettingKey = (typeof ADAPTER_SETTING_KEYS)[number];

/** What the user answered a (provider, subject) consent ask with, durably. `granted` is recorded BEFORE the install
 *  writes, so it can exist with nothing on disk; `declined` means the ANSWER itself turned that subject off, the
 *  provenance a revised "Not Now" needs to know the preference is its to take back (a Settings toggle never records
 *  consent). Absent = unanswered, the ask is still open. */
export type HooksConsentState = 'granted' | 'declined';

/** Per-provider, per-subject consent/preference maps: `{ [providerId]: { [subjectId]: value } }`. A module with one
 *  subject (today, every module but Claude) still nests one level — the shape is uniform so no accessor needs two
 *  code paths. */
export type HooksConsentMap = Record<string, Record<string, HooksConsentState>>;
export type HooksEnabledMap = Record<string, Record<string, boolean>>;

/** Subject id every installer wrote implicitly before consent became per-subject. Old flat configs
 *  (`hooksConsent: { claude: 'granted' }`) migrate their one value onto this subject; a module's additional
 *  subjects (Claude's `statusLine`) start unanswered, since they were never askable under the old shape. */
const LEGACY_SUBJECT_ID = 'hooks';

export interface TerrariumConfig {
  standalone: AdapterSettings;
  /** Per-(provider, subject) consent to modify that subject's write (Claude hooks: ~/.claude/settings.json's
   *  `hooks`; Claude's status line: the same file's `statusLine`). Shared across surfaces — consent is per-human
   *  per-provider per-subject, not per-adapter. A (provider, subject) absent from the map has never been answered. */
  hooksConsent: HooksConsentMap;
  /** Per-(provider, subject) preference, machine-global for the same reason as the consent above. A pair absent
   *  from the map takes the default (true). */
  hooksEnabled: HooksEnabledMap;
  /** Ids of the provider modules this machine runs, as last chosen with `--provider`. Absent = never chosen: the
   *  registry's default set runs. */
  modules?: string[];
  /** The herdr servers the office listens to. Absent = never changed: the default local connection. */
  connections?: ConnectionSettings[];
}

const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  lastSeenVersion: '',
  hooksInfoShown: false,
  areaMappings: {},
  ctoOffice: true,
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/** Coerce a loose object into the nested `{ providerId: { subjectId: state } }` consent map. A value that is itself
 *  `'granted'`/`'declined'` is the OLD flat shape (`hooksConsent: { claude: 'granted' }`, from before consent was
 *  per-subject) and migrates onto `LEGACY_SUBJECT_ID` — the one write every installer made implicitly. Any other
 *  subject a module now asks about (Claude's `statusLine`) was never askable under that shape, so it starts
 *  unanswered rather than inheriting the provider's old answer. */
function parseHooksConsent(raw: unknown): HooksConsentMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: HooksConsentMap = {};
  for (const [providerId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'granted' || value === 'declined') {
      out[providerId] = { [LEGACY_SUBJECT_ID]: value };
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const subjects: Record<string, HooksConsentState> = {};
    for (const [subjectId, state] of Object.entries(value as Record<string, unknown>)) {
      if (state === 'granted' || state === 'declined') subjects[subjectId] = state;
    }
    if (Object.keys(subjects).length > 0) out[providerId] = subjects;
  }
  return out;
}

/** Coerce a loose object into the nested `{ providerId: { subjectId: enabled } }` preference map, migrating the old
 *  flat shape (`hooksEnabled: { claude: false }`) onto `LEGACY_SUBJECT_ID` the same way parseHooksConsent does. */
function parseHooksEnabled(raw: unknown): HooksEnabledMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: HooksEnabledMap = {};
  for (const [providerId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') {
      out[providerId] = { [LEGACY_SUBJECT_ID]: value };
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const subjects: Record<string, boolean> = {};
    for (const [subjectId, enabled] of Object.entries(value as Record<string, unknown>)) {
      if (typeof enabled === 'boolean') subjects[subjectId] = enabled;
    }
    if (Object.keys(subjects).length > 0) out[providerId] = subjects;
  }
  return out;
}

/**
 * Coerce a loose object into `Record<string, string[]>`, dropping any entries whose value is not an array of strings.
 * Returns `{}` if the input isn't an object. Used to defensively load folder→area mappings from config.json, which
 * may have been hand-edited or written by an older build.
 */
export function parseAreaMappings(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [folder, labels] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof folder !== 'string') {
      continue;
    }
    if (!Array.isArray(labels)) {
      continue;
    }
    const filtered = labels.filter((l): l is string => typeof l === 'string');
    out[folder] = filtered;
  }
  return out;
}

/** Coerce a loose object into a valid AdapterSettings with defaults for missing/wrong-typed fields. */
function parseAdapterSettings(raw: unknown): AdapterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdapterSettings>;
  return {
    lastSeenVersion:
      typeof obj.lastSeenVersion === 'string'
        ? obj.lastSeenVersion
        : DEFAULT_ADAPTER_SETTINGS.lastSeenVersion,
    hooksInfoShown:
      typeof obj.hooksInfoShown === 'boolean'
        ? obj.hooksInfoShown
        : DEFAULT_ADAPTER_SETTINGS.hooksInfoShown,
    areaMappings: parseAreaMappings(obj.areaMappings),
    ctoOffice:
      typeof obj.ctoOffice === 'boolean' ? obj.ctoOffice : DEFAULT_ADAPTER_SETTINGS.ctoOffice,
  };
}

export function readConfig(): TerrariumConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return {
        standalone: { ...DEFAULT_ADAPTER_SETTINGS },
        hooksConsent: {},
        hooksEnabled: {},
      };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TerrariumConfig>;
    return {
      standalone: parseAdapterSettings(parsed.standalone),
      hooksConsent: parseHooksConsent(parsed.hooksConsent),
      hooksEnabled: parseHooksEnabled(parsed.hooksEnabled),
      modules: Array.isArray(parsed.modules)
        ? parsed.modules.filter((id): id is string => typeof id === 'string')
        : undefined,
      connections: Array.isArray(parsed.connections)
        ? parsed.connections.flatMap((raw: unknown) => parseStoredConnection(raw) ?? [])
        : undefined,
    };
  } catch (err) {
    console.error('[Terrarium] Failed to read config file:', err);
    return {
      standalone: { ...DEFAULT_ADAPTER_SETTINGS },
      hooksConsent: {},
      hooksEnabled: {},
    };
  }
}

// ── Enabled provider modules ────────────────────────────────

/** The module ids last chosen for this machine, or undefined when none ever were. */
export function getEnabledModuleIds(): string[] | undefined {
  return readConfig().modules;
}

export function setEnabledModuleIds(ids: readonly string[]): void {
  const cfg = readConfig();
  cfg.modules = [...ids];
  writeConfig(cfg);
}

// ── Multiplexer connections ─────────────────────────────────

export function readConnections(): ConnectionSettings[] {
  return readConfig().connections ?? [...DEFAULT_CONNECTIONS];
}

export function writeConnections(connections: readonly ConnectionSettings[]): void {
  const cfg = readConfig();
  cfg.connections = [...connections];
  writeConfig(cfg);
}

// ── Per-(provider, subject) hooks consent + preference ───────
// The provider id and subject id key these maps (AgentModule.id and HookInstaller.id — 'claude'/'hooks' and
// 'claude'/'statusLine' today). All writers go through readConfig→writeConfig, so a hand-edited or older file
// degrades to "unanswered"/default rather than crashing.

/** Delete `subjectId` from `map[providerId]`, and drop the now-empty provider object too — so "never answered" (no
 *  provider key) and "every subject cleared" read identically on disk, matching the pre-subject behavior the
 *  existing tests pin. */
function deleteSubject<T>(
  map: Record<string, Record<string, T>>,
  providerId: string,
  subjectId: string,
): void {
  const subjects = map[providerId];
  if (!subjects || !(subjectId in subjects)) return;
  delete subjects[subjectId];
  if (Object.keys(subjects).length === 0) delete map[providerId];
}

/** What the user durably answered this (provider, subject) ask with, or 'unanswered'. */
export function getHooksConsent(
  providerId: string,
  subjectId: string,
): HooksConsentState | 'unanswered' {
  return readConfig().hooksConsent[providerId]?.[subjectId] ?? 'unanswered';
}

/** Persist the one-time approval for modifying this (provider, subject) write. A grant REPLACING a decline also
 *  deletes that decline's off-remnant in the same write: without it, an install that then FAILS leaves a grant
 *  beside the retracted off-preference, and a later "Not Now" (which leaves the preference alone, since the grant
 *  never wrote it) ends at unanswered + off — an ask that never returns. A successful install persists on-enabled
 *  anyway, so this only changes the failure path. */
export function grantHooksConsent(providerId: string, subjectId: string): void {
  const cfg = readConfig();
  const subjects = cfg.hooksConsent[providerId] ?? {};
  if (subjects[subjectId] !== 'granted') {
    const replacingDecline = subjects[subjectId] === 'declined';
    cfg.hooksConsent[providerId] = { ...subjects, [subjectId]: 'granted' };
    if (replacingDecline) deleteSubject(cfg.hooksEnabled, providerId, subjectId);
    writeConfig(cfg);
  }
}

/** Record a durable decline ("Don't Ask Again") for this subject: consent 'declined' AND that subject off, in ONE
 *  readConfig→writeConfig cycle. They are one logical answer — split across two writes, a failed second leaves a
 *  state the answer disavows (a decline with the default-on preference, or an off-preference with no provenance). */
export function recordHooksDecline(providerId: string, subjectId: string): void {
  const cfg = readConfig();
  const alreadyDeclined =
    cfg.hooksConsent[providerId]?.[subjectId] === 'declined' &&
    cfg.hooksEnabled[providerId]?.[subjectId] === false;
  if (!alreadyDeclined) {
    cfg.hooksConsent[providerId] = { ...cfg.hooksConsent[providerId], [subjectId]: 'declined' };
    cfg.hooksEnabled[providerId] = { ...cfg.hooksEnabled[providerId], [subjectId]: false };
    writeConfig(cfg);
  }
}

/** Un-record a subject's answer AND restore its preference default in ONE cycle — the revised-notNow revert over a
 *  decline. Both keys go together so "never answered" and "answered and reverted" are indistinguishable on disk,
 *  and no partial-write order can leave a half-reverted answer. */
export function clearHooksAnswer(providerId: string, subjectId: string): void {
  const cfg = readConfig();
  const hadEither =
    cfg.hooksConsent[providerId]?.[subjectId] !== undefined ||
    cfg.hooksEnabled[providerId]?.[subjectId] !== undefined;
  if (hadEither) {
    deleteSubject(cfg.hooksConsent, providerId, subjectId);
    deleteSubject(cfg.hooksEnabled, providerId, subjectId);
    writeConfig(cfg);
  }
}

/** Un-record a subject's answer entirely, so the ask genuinely returns. Used when the
 *  user walks the Intro back from its closing step and revises an earlier
 *  answer down to "Not Now": whatever that answer left (a grant, a decline)
 *  must go, or the consent gate reads it as asked-and-answered forever.
 *  Callers only clear a grant after any uninstall verifiably landed. */
export function clearHooksConsent(providerId: string, subjectId: string): void {
  const cfg = readConfig();
  if (cfg.hooksConsent[providerId]?.[subjectId] !== undefined) {
    deleteSubject(cfg.hooksConsent, providerId, subjectId);
    writeConfig(cfg);
  }
}

/** The per-(provider, subject) preference. Absent = the default, true. */
export function getHooksEnabled(providerId: string, subjectId: string): boolean {
  return readConfig().hooksEnabled[providerId]?.[subjectId] ?? true;
}

export function setHooksEnabled(providerId: string, subjectId: string, enabled: boolean): void {
  const cfg = readConfig();
  if (cfg.hooksEnabled[providerId]?.[subjectId] !== enabled) {
    cfg.hooksEnabled[providerId] = { ...cfg.hooksEnabled[providerId], [subjectId]: enabled };
    writeConfig(cfg);
  }
}

/** Restore the subject's preference to its default (true) by REMOVING the key. Deleting rather than writing `true`
 *  keeps "never answered" and "answered and reverted" indistinguishable on disk. */
export function clearHooksEnabled(providerId: string, subjectId: string): void {
  const cfg = readConfig();
  if (cfg.hooksEnabled[providerId]?.[subjectId] !== undefined) {
    deleteSubject(cfg.hooksEnabled, providerId, subjectId);
    writeConfig(cfg);
  }
}

/** Return every hooks-related choice to factory state — all providers' consent and
 *  preferences cleared, hooksInfoShown back to default. Those choices belonged to an
 *  installation that no longer exists, so a future install starts from the first-run
 *  experience rather than inheriting a stale hooks-off that would skip the ask forever. */
export function resetHooksConfig(): void {
  const cfg = readConfig();
  cfg.hooksConsent = {};
  cfg.hooksEnabled = {};
  cfg.standalone.hooksInfoShown = DEFAULT_ADAPTER_SETTINGS.hooksInfoShown;
  writeConfig(cfg);
}

export function writeConfig(config: TerrariumConfig): void {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Terrarium] Failed to write config file:', err);
  }
}
