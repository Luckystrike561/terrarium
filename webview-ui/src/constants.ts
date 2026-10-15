import { CHAR_FRAME_H, CHAR_FRAME_W } from '../../core/src/assets/constants.ts';
import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
/** Typing/reading run a calmer 4-frame loop (CHARACTER_FRAMES type1-4 /
 *  read1-4): this is the duration of each of those 4 frames. */
export const TYPE_FRAME_DURATION_SEC = 0.2;
/** How long each frame shows in every other (2-frame) pose loop. Slow for
 *  breathing, quick for a waving hand. */
export const IDLE_FRAME_DURATION_SEC = 1.0;
export const REST_FRAME_DURATION_SEC = 1.4;
export const RAISE_HAND_FRAME_DURATION_SEC = 0.4;
export const HOLD_FORM_FRAME_DURATION_SEC = 0.6;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;
/** After a turn ends, a seated agent lingers at its desk in the rest pose
 *  this long before heading to the lounge — work resuming within the window
 *  resumes typing in place instead of a stand-up-and-walk-away/back churn. */
export const SEAT_LINGER_SEC = 90.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
/** The spawn rain sweeps the whole character frame. */
export const MATRIX_SPRITE_COLS = CHAR_FRAME_W;
export const MATRIX_SPRITE_ROWS = CHAR_FRAME_H;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
/** How far a seated character's sprite drops into each kind of seat, in
 *  world px, keyed by the seat's furniture group. The seated frames are drawn
 *  with their hips at one shared height, and every PixelLab seat has its own. */
export const SEAT_SINK_PX: Readonly<Record<string, number>> = {
  EXEC_CHAIR: 10,
  CUSHIONED_CHAIR: 11,
  WOODEN_CHAIR: 12,
  SOFA: 8,
  WOODEN_BENCH: 5,
};
/** Share of the way from a seat tile toward the middle of its multi-tile seat
 *  that the sitter moves: sofa and bench art is narrower than its footprint. */
export const SEAT_PULL_TO_CENTER = 0.5;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
/** How much higher a seated frame draws the head than a standing one, added
 *  to both the bubble and badge vertical offsets. PixelLab's seated poses
 *  crouch rather than drop the hips (measured via scripts/pixellab/pack.ts),
 *  so a chair-raised seated crown ends up taller than standing, not shorter:
 *  negative here means "subtract less" i.e. raise the bubble/badge further. */
export const BUBBLE_SITTING_OFFSET_PX = -7;
/** The crown of a standing character, above its feet (measured from the
 *  packed character sheets). */
export const BUBBLE_VERTICAL_OFFSET_PX = 32;
/** Persistent state badge (working/done/waiting/idle/permission): vertical
 *  distance above the anchor point, slightly less than BUBBLE_VERTICAL_OFFSET_PX
 *  so it sits at head height rather than floating above it like a bubble. */
export const STATUS_BADGE_VERTICAL_OFFSET_PX = 28;
/** Horizontal offset to the right of center, clear of the center-anchored
 *  speech bubble so the two never overlap regardless of bubble state. */
export const STATUS_BADGE_HORIZONTAL_OFFSET_PX = 13;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#d9c4a0';
/** Exposed floor edge thickness and colours (left = +row face, right = +col). */
export const FLOOR_SLAB_PX = 8;
export const FLOOR_SLAB_LEFT_COLOR = '#b8a788';
export const FLOOR_SLAB_RIGHT_COLOR = '#988970';
/** A building of several floors (one per machine): each floor stands on a slab this thick, the
 *  floor above starts this far over the top of the walls below, and two pillars along the side
 *  corners join each floor to the one under it. */
export const BUILDING_SLAB_PX = 12;
export const BUILDING_FLOOR_GAP_PX = 16;
export const BUILDING_PILLAR_WIDTH_PX = 4;
/** Floor name written on its slab: base size (pre-zoom), legibility floor in device px, colour. */
export const FLOOR_NAME_FONT_SIZE_PX = 20;
export const FLOOR_NAME_MIN_FONT_SIZE_PX = 20;
export const FLOOR_NAME_COLOR = '#f4ecd8';
/** Ink used by the room shell: the back wall's cap line, the floor slab's bottom edge and the
 *  glass partition frame. */
export const ROOM_INK_COLOR = '#111111';
/** Interior glass partitions: height (sprite px), ink frame, light cyan pane and white sheen. */
export const WALL_GLASS_HEIGHT_PX = 30;
export const GLASS_FRAME_COLOR = ROOM_INK_COLOR;
export const GLASS_PANE_COLOR = '#bfe3f066';
export const GLASS_SHEEN_COLOR = '#ffffff8c';

// ── Backdrop (daylight hotel skyline behind the office) ─────
/** Daylight sky, hard bands from the top of the canvas to the horizon. */
export const BACKDROP_SKY_COLORS = ['#4aa6e0', '#7cc4ec', '#a8daf3', '#d2eef9'] as const;
export const BACKDROP_CLOUD_COLOR = '#ffffff';
export const BACKDROP_CLOUD_SHADOW_COLOR = '#cfe9f7';
/** Clouds: placed on a grid of cells this size, this often, within the top share of the canvas. */
export const BACKDROP_CLOUD_CELL_PX = 40;
export const BACKDROP_CLOUD_CHANCE = 0.35;
export const BACKDROP_CLOUD_BAND = 0.55;
/** Cloud puff widths and heights in backdrop pixels: [min, max). */
export const BACKDROP_CLOUD_WIDTH_PX = [14, 26] as const;
export const BACKDROP_CLOUD_HEIGHT_PX = [6, 10] as const;
export const BACKDROP_FAR_BUILDING_COLOR = '#9fc6dc';
export const BACKDROP_NEAR_BUILDING_COLOR = '#7aaac6';
export const BACKDROP_WINDOW_COLOR = '#e3f4fb';
/** Building widths and heights in backdrop pixels: [min, max). */
export const BACKDROP_FAR_BUILDING_WIDTH_PX = [5, 13] as const;
export const BACKDROP_FAR_BUILDING_HEIGHT_PX = [22, 56] as const;
export const BACKDROP_NEAR_BUILDING_WIDTH_PX = [8, 18] as const;
export const BACKDROP_NEAR_BUILDING_HEIGHT_PX = [10, 36] as const;
/** Share of far towers carrying a rooftop detail (vent or tank), and its height. */
export const BACKDROP_ROOFTOP_DETAIL_CHANCE = 0.25;
export const BACKDROP_ROOFTOP_DETAIL_HEIGHT_PX = 4;
/** Near-tower window grid: inset from the walls, cell size. */
export const BACKDROP_WINDOW_INSET_PX = 2;
export const BACKDROP_WINDOW_STEP_X_PX = 3;
export const BACKDROP_WINDOW_STEP_Y_PX = 4;
export const BACKDROP_WINDOW_HEIGHT_PX = 2;

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
// ── Carpets ──────────────────────────────────────────────────
/** Main (lowest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_COLOR: ColorValue = { h: 0, s: 71, b: -32, c: 0, colorize: true };
/** Accent (highest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_ACCENT_COLOR: ColorValue = {
  h: 34,
  s: 64,
  b: 21,
  c: 0,
  colorize: true,
};

// ── Areas (named, colored workspace-folder zones) ────────────
/** Translucent overlay alpha for area tile fills. */
export const AREA_OVERLAY_ALPHA = 0.25;
/** Base font size (pixel-pre-zoom) for area centroid labels. */
export const AREA_LABEL_FONT_SIZE_PX = 14;
/** Minimum on-screen label size to keep labels legible at low zoom. */
export const AREA_LABEL_MIN_FONT_SIZE_PX = 12;
/** Alpha of the area label text. */
export const AREA_LABEL_ALPHA = 1.0;
/** Fallback label color when an area has no color set (shouldn't happen in practice). */
export const AREA_LABEL_FALLBACK_COLOR = '#ffffff';
/** Drop-shadow color behind area labels for legibility on light backgrounds. */
export const AREA_LABEL_SHADOW_COLOR = '#000000';
/** Drop-shadow alpha behind area labels. */
export const AREA_LABEL_SHADOW_ALPHA = 0.6;

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 11;
/** From the feet to the crown of a standing character (measured from the
 *  packed character sheets). */
export const CHARACTER_HIT_HEIGHT = 32;
/** A seated frame draws the head BUBBLE_SITTING_OFFSET_PX higher, not lower:
 *  see its comment. Kept as its own measured constant rather than derived,
 *  since "seated minus an offset" no longer describes the real geometry. */
export const CHARACTER_SEATED_HIT_HEIGHT = 39;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 47;

// ── Greeter + Intro bubble ──────────────────────────────────
/** Reserved character id for the Intro's greeter. Far outside both real agent
 *  ids (positive) and sub-agent ids (small negatives from -1 down). */
export const GREETER_ID = -1_000_000_000;
/** The fixed CTO character (not an agent): its id and how many agents can
 *  queue outside the CTO office door at once. */
export const CTO_ID = -1_000_000_001;
export const CTO_QUEUE_MAX_SLOTS = 8;
/** The CTO's loop: seconds working at the desk, then on the office couch. */
export const CTO_DESK_SEC = 30;
export const CTO_COUCH_SEC = 15;
/** Seconds a queued agent keeps a visitor chair before the next agent waiting
 *  at the door takes its turn. */
export const CTO_VISIT_SEC = 20;
/** Stacking order for the Intro's bubble. Deliberately BELOW the modal stack
 *  (ui/Modal defaults to 50, ChangelogModal 51, the migration notice z-100): the
 *  Intro is diegetic furniture over the office, not a modal, so a modal opened
 *  on top of it must cover it rather than slide underneath. */
export const INTRO_BUBBLE_Z_INDEX = 45;
/** The greeter stands this many tiles in from the office's bottom-left corner
 *  (target tile (margin, rows-1-margin); nearest walkable tile if blocked). */
export const GREETER_TILE_MARGIN = 3;
/** World px above the greeter's anchor (feet) where the bubble's bottom sits.
 *  Kept well above the head target (INTRO_TAIL_TARGET_RISE_WORLD) so the
 *  tail squares have a visible run between bubble and head. */
export const INTRO_BUBBLE_ANCHOR_RISE_PX = 50;
/** World px right of the greeter's center where the bubble's left edge starts —
 *  just clear of the sprite so the tail points down-left at the head. */
export const INTRO_BUBBLE_OFFSET_X_PX = 10;
/** Bubble width cap (CSS px) and the margin kept from the container edges.
 *  Wide on purpose: the disclosure reads as three short paragraphs instead of
 *  a tall column (still clamped to the container on narrow panels). */
export const INTRO_BUBBLE_MAX_WIDTH_PX = 560;
export const INTRO_BUBBLE_EDGE_MARGIN_PX = 4;
/** Where the Intro's Claude Code step sends people who don't have it yet. */
export const CLAUDE_CODE_URL = 'https://claude.com/claude-code';
export const CLAUDE_CODE_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code';
/** Speech-tail squares: placed at fraction `t` along the segment from the
 *  bubble's nearest edge point to the greeter's head, shrinking toward the
 *  speaker. Recomputed every frame so the tail stays connected no matter where
 *  edge-clamping or panning puts the bubble relative to the character. */
export const INTRO_TAIL_STEPS = [
  { t: 0.25, size: 12 },
  { t: 0.55, size: 9 },
  { t: 0.82, size: 6 },
] as const;
/** World px above the greeter's anchor (feet) the tail points at — the head. */
export const INTRO_TAIL_TARGET_RISE_PX = 30;
/** Camera-offset caps while centering character + bubble. The ideal composition
 *  assumes the bubble fits beside/above the character; when it can't (narrow or
 *  short viewports clamp the bubble to the screen), uncapped offsets shove the
 *  greeter to the viewport edge. Horizontal offset is capped to this fraction
 *  of the viewport; vertical offset always keeps this many world px of the
 *  character visible above the bottom edge. */
export const INTRO_CAMERA_MAX_X_OFFSET_VIEWPORT_FRACTION = 0.25;
export const INTRO_CAMERA_MIN_CHAR_VISIBLE_PX = 48;
/** Extra downward camera shift (CSS px) so the character+bubble composition
 *  sits a bit above the vertical center instead of dead-centered. */
export const INTRO_CAMERA_DOWN_SHIFT_PX = 50;

// ── Context Fuel Gauge ──────────────────────────────────────
/** Window assumed before the runtime reports one (it always does for agents
 *  that have taken a turn; this only covers characters created ahead of it). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
export const CONTEXT_WARN_THRESHOLD = 0.6;
export const CONTEXT_DANGER_THRESHOLD = 0.8;
export const CONTEXT_CRITICAL_THRESHOLD = 0.95;
export const CONTEXT_GAUGE_WIDTH_PX = 40;
export const CONTEXT_GAUGE_HEIGHT_PX = 4;
export const CONTEXT_GAUGE_COLOR_OK = '#44cc44';
export const CONTEXT_GAUGE_COLOR_WARN = '#ffcc00';
export const CONTEXT_GAUGE_COLOR_DANGER = '#ff8800';
export const CONTEXT_GAUGE_COLOR_CRITICAL = '#ff2222';
export const CONTEXT_GAUGE_BG = '#b9c1cb';

// ── Quota Coffee Beans ──────────────────────────────────────
/** One bean is this share of a quota: 10 beans fill a jar. */
export const QUOTA_BEANS_PER_JAR = 10;
/** Beans left at or below this count draw in the low colour. */
export const QUOTA_LOW_BEANS = 2;
/** Absorbs float error in `1 - usedFraction` (1 - 0.7 is 0.30000000000000004), so 70% used is 3 beans, not 4. */
export const QUOTA_BEAN_EPSILON = 1e-9;
/** How far above the coffee machine's floor tile the jars stand, in sprite px (above the counter and machine). */
export const QUOTA_JARS_RISE_PX = 44;
/** Where the jars sit, in CSS px from the top-left corner, when the layout has no coffee machine. */
export const QUOTA_JARS_FALLBACK_OFFSET_PX = 12;
export const QUOTA_BEAN_COLOR = '#6b3e1f';
export const QUOTA_BEAN_SEAM_COLOR = '#3a2010';
export const QUOTA_BEAN_LOW_COLOR = '#c8321e';
export const QUOTA_JAR_GLASS_COLOR = 'rgba(200, 230, 240, 0.35)';
export const QUOTA_JAR_EMPTY_BORDER_COLOR = '#ff2222';

// ── Agent Teams ─────────────────────────────────────────────
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── Pets ────────────────────────────────────────────────────────
/** Walking speed in world pixels per second (matches character walk speed visually but slower). */
export const PET_WALK_SPEED_PX_PER_SEC = 32;
/** Time per WALK animation cycle step (4 cycle steps × 0.15s = 0.6s per loop). */
export const PET_WALK_FRAME_DURATION_SEC = 0.15;
/** Time per IDLE animation cycle step (4 cycle steps × 0.3s = 1.2s per loop). */
export const PET_IDLE_FRAME_DURATION_SEC = 0.3;
/** Walk cycle: 4-step lookup into the 3-frame walkDown/walkUp/walkRight arrays. */
export const PET_WALK_SEQUENCE = [0, 1, 0, 2] as const;
/** Idle cycle: 4-step lookup into the 3-frame idleDown/idleUp arrays. */
export const PET_IDLE_SEQUENCE = [0, 1, 2, 1] as const;
/** Minimum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MIN_SEC = 3.0;
/** Maximum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MAX_SEC = 15.0;
/** Seconds between FOLLOW path re-computations. */
export const PET_FOLLOW_RECALC_INTERVAL_SEC = 1.0;
/** Probability that a pet enters FOLLOW (instead of WALK) when wanderTimer expires. */
export const PET_FOLLOW_CHANCE = 0.3;
/** Maximum Manhattan distance (tiles) at which a character can become a follow target. */
export const PET_FOLLOW_RADIUS_TILES = 3;
/** Minimum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MIN_SEC = 5.0;
/** Maximum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MAX_SEC = 15.0;
/** Hit-box half-width (world px) for pet click detection. */
export const PET_HIT_HALF_WIDTH = 8;
/** Hit-box height (world px) measured upward from the bottom-center anchor. */
export const PET_HIT_HEIGHT = 16;
/** Maximum string length for a PlacedPet.id (defends against pathologically-long layout entries). */
export const MAX_PET_ID_LENGTH = 128;
