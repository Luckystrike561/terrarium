/**
 * Server-side palette assignment helper.
 *
 * Assigns palette and hueShift to agents when they're created, ensuring
 * consistent character appearance across all connected clients.
 */

import { CHAR_COUNT } from '../../core/src/assets/constants.js';
import { pickDiversePalette } from '../../core/src/paletteUtils.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { AgentState } from './types.js';

/**
 * Runtime palette count: the number of character sheets that actually
 * loaded. Defaults to CHAR_COUNT until setPaletteCount is called after assets
 * load. Mirrors the setTranscriptModule / setTeamSwitch module-level setter
 * pattern in transcriptParser.ts.
 */
let currentPaletteCount = CHAR_COUNT;

/** Set the palette count after asset loading. */
export function setPaletteCount(count: number): void {
  currentPaletteCount = Math.max(1, Math.floor(count));
}

/**
 * Assign palette and hueShift to an agent if not already set.
 * Uses the diversity algorithm to pick a palette that's least used among
 * existing agents.
 *
 * @param agent - The agent to assign a palette to (mutated in place)
 * @param store - The agent state store (used to count existing palettes)
 */
export function assignPaletteIfNeeded(agent: AgentState, store: AgentStateStore): void {
  if (agent.palette !== undefined) return;

  const count = currentPaletteCount;
  const paletteCounts = new Array(count).fill(0);
  for (const existing of store.values()) {
    if (existing.palette !== undefined && existing.palette < count) {
      paletteCounts[existing.palette]++;
    }
  }

  const pick = pickDiversePalette(count, paletteCounts);
  agent.palette = pick.palette;
  agent.hueShift = pick.hueShift;
}
