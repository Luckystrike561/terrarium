/**
 * Builds the GitHub Pages site into dist/site/: site/index.html with its supported-agents table filled in from
 * the provider registry, plus the stylesheet, font and media it links to.
 *
 * The table's rows are the registry's agent modules and multiplexer modules, never a hand-kept list. What each
 * agent module shows is declared in AGENT_COVERAGE below, and the build fails when that map and the registry
 * disagree, so adding or removing a module cannot leave the site stale.
 */
import * as fs from 'fs';
import * as path from 'path';

import { agentModules, multiplexerModules } from '../server/src/providers/index.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const SITE_SOURCE_DIR = path.join(REPO_ROOT, 'site');
const SITE_OUTPUT_DIR = path.join(REPO_ROOT, 'dist', 'site');
const AGENT_TABLE_MARKER = '<!-- AGENT-TABLE -->';
const AGENT_COUNT_MARKER = '<!-- AGENT-COUNT -->';
const QUICK_START_MARKER = '<!-- AGENT-QUICK-START -->';
const CONTAINER_HOME = '/home/node';

/** Files copied verbatim, source relative to the repo root, destination relative to the site root. */
const STATIC_FILES: ReadonlyArray<{ source: string; destination: string }> = [
  { source: 'site/style.css', destination: 'style.css' },
  { source: 'docs/media/logo.png', destination: 'media/logo.png' },
  { source: 'docs/media/demo.gif', destination: 'media/demo.gif' },
  { source: 'icon.png', destination: 'media/icon.png' },
  {
    source: 'webview-ui/public/fonts/FSPixelSansUnicode-Regular.ttf',
    destination: 'fonts/FSPixelSansUnicode-Regular.ttf',
  },
];

/** Where a CLI keeps its sessions by default, relative to the home directory. */
interface SessionStore {
  path: string;
  /** A SQLite store needs a writable mount: readers create the WAL index beside the database. */
  isDatabase: boolean;
  /** The module cannot run in the Docker image (Claude's hooks would point at container paths). */
  isHostOnly?: boolean;
}

/** What the office shows for an agent module's sessions, from the records its CLI actually writes. */
interface AgentCoverage {
  toolActivity: boolean;
  turnEnds: boolean;
  approvals: boolean;
  /** The CLI records its own exit. Without it, a session leaves the office once it has been quiet for a while. */
  cleanExit: boolean;
  store: SessionStore;
  note?: string;
}

function files(storePath: string): SessionStore {
  return { path: storePath, isDatabase: false };
}

function database(storePath: string): SessionStore {
  return { path: storePath, isDatabase: true };
}

const AGENT_COVERAGE: Readonly<Record<string, AgentCoverage>> = {
  claude: {
    toolActivity: true,
    turnEnds: true,
    approvals: true,
    cleanExit: true,
    store: { path: '.claude/projects', isDatabase: false, isHostOnly: true },
    note: 'Hooks after you approve them in the app, transcripts otherwise. Clean exit needs the hooks. Sub-agents and Agent Teams too.',
  },
  omp: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: true,
    store: files('.omp/agent/sessions'),
  },
  agy: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.gemini/antigravity-cli'),
  },
  cline: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: true,
    store: files('.cline/data/sessions'),
  },
  codex: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.codex/sessions'),
  },
  copilot: {
    toolActivity: true,
    turnEnds: true,
    approvals: true,
    cleanExit: true,
    store: files('.copilot/session-state'),
  },
  cursor: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.cursor/projects'),
  },
  devin: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: database('.local/share/devin/cli'),
  },
  droid: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: true,
    store: files('.factory/sessions'),
  },
  gemini: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.gemini/tmp'),
  },
  grok: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.grok/sessions'),
  },
  hermes: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: true,
    store: database('.hermes'),
  },
  kilo: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: database('.local/share/kilo'),
  },
  kimi: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.kimi-code/sessions'),
  },
  kiro: {
    toolActivity: true,
    turnEnds: true,
    approvals: true,
    cleanExit: false,
    store: files('.kiro/sessions'),
    note: 'Approvals from Kiro 3 (--v3) sessions only.',
  },
  letta: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.letta/lc-local-backend/conversations'),
  },
  maki: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.local/state/maki/sessions'),
  },
  mastracode: {
    toolActivity: true,
    turnEnds: true,
    approvals: true,
    cleanExit: false,
    store: database('.local/share/mastracode'),
  },
  opencode: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: database('.local/share/opencode'),
  },
  pi: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.pi/agent/sessions'),
  },
  qodercli: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.qoder/projects'),
  },
  qwen: {
    toolActivity: true,
    turnEnds: true,
    approvals: false,
    cleanExit: false,
    store: files('.qwen/projects'),
  },
};

const MULTIPLEXER_SUMMARY: Readonly<Record<string, string>> = {
  herdr:
    'Every agent in a herdr pane, on this machine or over SSH, with its status, name, task and pending approvals. Hands each local pane to the agent module for its CLI when that module runs.',
};

const COVERAGE_COLUMNS: ReadonlyArray<{
  key: keyof Omit<AgentCoverage, 'note' | 'store'>;
  label: string;
}> = [
  { key: 'toolActivity', label: 'Tool activity' },
  { key: 'turnEnds', label: 'Turn ends' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'cleanExit', label: 'Clean exit' },
];

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function assertCoverageMatchesRegistry(): void {
  const registeredIds = new Set(agentModules.map((m) => m.id));
  const undeclared = [...registeredIds].filter((id) => !(id in AGENT_COVERAGE));
  const unregistered = Object.keys(AGENT_COVERAGE).filter((id) => !registeredIds.has(id));
  const missingSummaries = multiplexerModules
    .map((m) => m.id)
    .filter((id) => !(id in MULTIPLEXER_SUMMARY));
  const problems = [
    undeclared.length > 0 && `agent modules with no AGENT_COVERAGE entry: ${undeclared.join(', ')}`,
    unregistered.length > 0 &&
      `AGENT_COVERAGE entries for unregistered modules: ${unregistered.join(', ')}`,
    missingSummaries.length > 0 &&
      `multiplexer modules with no MULTIPLEXER_SUMMARY entry: ${missingSummaries.join(', ')}`,
  ].filter((problem): problem is string => typeof problem === 'string');
  if (problems.length > 0) {
    throw new Error(
      `The site's supported-agents table is out of date:\n- ${problems.join('\n- ')}`,
    );
  }
}

function renderCoverageCell(label: string, isShown: boolean): string {
  const mark = isShown
    ? '<span class="mark mark-yes" role="img" aria-label="yes">&#10003;</span>'
    : '<span class="mark mark-no" role="img" aria-label="no">&mdash;</span>';
  return `<td data-label="${label}">${mark}</td>`;
}

function renderAgentRow(id: string, displayName: string, coverage: AgentCoverage): string {
  const note = coverage.note ? `<span class="agent-note">${escapeHtml(coverage.note)}</span>` : '';
  const cells = COVERAGE_COLUMNS.map((column) =>
    renderCoverageCell(column.label, coverage[column.key]),
  ).join('');
  return `<tr><th scope="row"><code>${escapeHtml(id)}</code><span class="agent-name">${escapeHtml(displayName)}</span>${note}</th>${cells}</tr>`;
}

function renderMultiplexerRow(id: string, displayName: string): string {
  return `<tr class="multiplexer-row"><th scope="row"><code>${escapeHtml(id)}</code><span class="agent-name">${escapeHtml(displayName)} (multiplexer)</span></th><td colspan="${COVERAGE_COLUMNS.length}" class="multiplexer-summary">${escapeHtml(MULTIPLEXER_SUMMARY[id])}</td></tr>`;
}

function renderAgentTable(): string {
  const header = COVERAGE_COLUMNS.map((column) => `<th scope="col">${column.label}</th>`).join('');
  const rows = [
    ...multiplexerModules.map((m) => renderMultiplexerRow(m.id, m.displayName)),
    ...agentModules.map((m) => renderAgentRow(m.id, m.displayName, AGENT_COVERAGE[m.id])),
  ];
  return [
    '<table class="agent-table">',
    `<thead><tr><th scope="col">Module</th>${header}</tr></thead>`,
    `<tbody>${rows.join('')}</tbody>`,
    '</table>',
  ].join('\n');
}

function renderDockerMount(store: SessionStore): string {
  const mode = store.isDatabase ? '' : ':ro';
  return `-v "$HOME/${store.path}:${CONTAINER_HOME}/${store.path}${mode}"`;
}

function renderQuickStartCard(id: string, displayName: string, store: SessionStore): string {
  const docker = store.isHostOnly
    ? '<p class="quick-start-note">Host only: the hooks it installs would point at paths inside a container.</p>'
    : `<p>Docker: add this mount and <code>--provider ${escapeHtml(id)}</code>.</p><pre><code>${escapeHtml(renderDockerMount(store))}</code></pre>`;
  return [
    '<details class="quick-start-card">',
    `<summary><span class="agent-name">${escapeHtml(displayName)}</span><code>${escapeHtml(id)}</code></summary>`,
    `<p>Reads <code>~/${escapeHtml(store.path)}</code>.</p>`,
    `<pre><code>node dist/cli.js --provider ${escapeHtml(id)}</code></pre>`,
    docker,
    '</details>',
  ].join('');
}

function renderQuickStart(): string {
  const cards = agentModules.map((m) =>
    renderQuickStartCard(m.id, m.displayName, AGENT_COVERAGE[m.id].store),
  );
  return `<div class="quick-start-grid">${cards.join('')}</div>`;
}

function replaceMarker(html: string, marker: string, replacement: string): string {
  if (!html.includes(marker)) throw new Error(`site/index.html has no ${marker} marker`);
  return html.replaceAll(marker, replacement);
}

function buildSite(): void {
  assertCoverageMatchesRegistry();
  fs.rmSync(SITE_OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SITE_OUTPUT_DIR, { recursive: true });

  const template = fs.readFileSync(path.join(SITE_SOURCE_DIR, 'index.html'), 'utf8');
  const withTable = replaceMarker(template, AGENT_TABLE_MARKER, renderAgentTable());
  const withQuickStart = replaceMarker(withTable, QUICK_START_MARKER, renderQuickStart());
  const page = replaceMarker(withQuickStart, AGENT_COUNT_MARKER, String(agentModules.length));
  fs.writeFileSync(path.join(SITE_OUTPUT_DIR, 'index.html'), page);

  for (const file of STATIC_FILES) {
    const destination = path.join(SITE_OUTPUT_DIR, file.destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file.source), destination);
  }
  console.log(
    `[Site] Built ${path.relative(REPO_ROOT, SITE_OUTPUT_DIR)}/ with ${agentModules.length} agent modules`,
  );
}

buildSite();
