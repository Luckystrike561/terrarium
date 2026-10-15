/**
 * AUTO-GENERATED FROM core/asyncapi.yaml. DO NOT EDIT MANUALLY.
 *
 * Run `npm run asyncapi:generate` to regenerate.
 *
 * Source of truth: the yaml at core/asyncapi.yaml.
 * Editors and clients in any language can consume the spec directly.
 */

export type ServerMessage =
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear
  | SubagentToolStart
  | SubagentToolDone
  | SubagentClear
  | SubagentToolPermission
  | AgentTeamInfo
  | AgentContextUsage
  | AgentInfo
  | LayoutLoaded
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | CarpetTilesLoaded
  | SettingsLoaded
  | HooksStatus
  | HooksConsentRequest
  | AreaMappingsLoaded
  | ConnectionsLoaded
  | ConnectionAddResult
  | FloorsLoaded
  | QuotaUpdate;

export type ClientMessage =
  | WebviewReady
  | CloseAgent
  | SaveAgentSeats
  | SetLastSeenVersion
  | HooksConsentResponse
  | SetHooksInfoShown
  | SaveAreaMappings
  | AddConnection
  | UpdateConnection
  | RemoveConnection;

export interface ProviderCapabilities {
  type: 'providerCapabilities';
  providers: ProviderToolTaxonomy[];
}

export interface ProviderToolTaxonomy {
  providerId: string;
  readingTools: string[];
  subagentToolNames: string[];
}

export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  folderName?: string;
  machineId: string;
  palette?: number;
  hueShift?: number;
}

export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  agentMeta: Record<string, AgentSeatMeta>;
  folderNames: Record<string, string>;
  machineIds: Record<string, string>;
}

export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
  awaitingInput?: boolean;
}

export type AgentActivityStatus = 'active' | 'waiting';

export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  status: string;
  toolName?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
  isTeammateSpawn?: boolean;
}

export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

export interface SubagentToolStart {
  type: 'subagentToolStart';
  id: number;
  parentToolId: string;
  toolId: string;
  status: string;
}

export interface SubagentToolDone {
  type: 'subagentToolDone';
  id: number;
  parentToolId: string;
  toolId: string;
}

export interface SubagentClear {
  type: 'subagentClear';
  id: number;
  parentToolId: string;
}

export interface SubagentToolPermission {
  type: 'subagentToolPermission';
  id: number;
  parentToolId: string;
}

export interface AgentTeamInfo {
  type: 'agentTeamInfo';
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentContextUsage {
  type: 'agentContextUsage';
  id: number;
  contextTokens: number;
  maxContextTokens: number;
}

export interface AgentInfo {
  type: 'agentInfo';
  id: number;
  name?: string;
  task?: string;
}

export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
  floorLayout?: Record<string, any>;
  isDefault?: boolean;
}

export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  sprites: Record<string, string[][]>;
}

export interface FurnitureAssetMessage {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
  cto: CharacterSpriteSet;
}

export interface CharacterSpriteSet {
  png: string;
}

export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  pets: PetSpriteFrameSet[];
  petNames: string[];
}

export interface PetSpriteFrameSet {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  sprites: string[][][];
}

export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  sets: string[][][][];
}

export interface CarpetTilesLoaded {
  type: 'carpetTilesLoaded';
  sets: string[][][][];
}

export interface SettingsLoaded {
  type: 'settingsLoaded';
  lastSeenVersion: string;
  extensionVersion: string;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  ctoOffice?: boolean;
}

export interface HooksStatus {
  type: 'hooksStatus';
  providerId: string;
  subjectId: string;
  installed: boolean;
}

export interface HooksConsentRequest {
  type: 'hooksConsentRequest';
  providerId: string;
  subjectId: string;
  headline: string;
  disclosure: string;
  actionLabel: string;
}

export interface AreaMappingsLoaded {
  type: 'areaMappingsLoaded';
  mappings: Record<string, string[]>;
}

export interface ConnectionsLoaded {
  type: 'connectionsLoaded';
  connections: Connection[];
}

export interface Connection {
  id: string;
  label: string;
  kind: ConnectionKind;
  target?: string;
  session?: string;
  enabled: boolean;
  state: ConnectionState;
  message?: string;
}

export type ConnectionKind = 'local' | 'ssh';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error' | 'disabled';

export interface ConnectionAddResult {
  type: 'connectionAddResult';
  requestId: string;
  error?: string;
}

export interface FloorsLoaded {
  type: 'floorsLoaded';
  floors: Floor[];
}

export interface Floor {
  id: string;
  name: string;
}

export interface QuotaUpdate {
  type: 'quotaUpdate';
  meters: QuotaMeter[];
}

export interface QuotaMeter {
  id: string;
  providerId: string;
  label: string;
  usedFraction?: number;
  usedAmount?: number;
  limitAmount?: number;
  unit?: QuotaUnit;
  resetsAt?: number;
  observedAt: number;
  stale: boolean;
}

export type QuotaUnit = 'usd' | 'tokens' | 'requests';

export interface WebviewReady {
  type: 'webviewReady';
}

export interface CloseAgent {
  type: 'closeAgent';
  id: number;
}

export interface SaveAgentSeats {
  type: 'saveAgentSeats';
  seats: Record<string, SeatAssignment>;
}

export interface SeatAssignment {
  palette: number;
  hueShift: number;
  seatId: string | null;
}

export interface SetLastSeenVersion {
  type: 'setLastSeenVersion';
  version: string;
}

export interface HooksConsentResponse {
  type: 'hooksConsentResponse';
  providerId: string;
  subjectId: string;
  choice: HooksConsentChoice;
}

export type HooksConsentChoice = 'install' | 'notNow' | 'never';

export interface SetHooksInfoShown {
  type: 'setHooksInfoShown';
}

export interface SaveAreaMappings {
  type: 'saveAreaMappings';
  mappings: Record<string, string[]>;
}

export interface AddConnection {
  type: 'addConnection';
  requestId: string;
  label: string;
  kind: ConnectionKind;
  target?: string;
  session?: string;
}

export interface UpdateConnection {
  type: 'updateConnection';
  id: string;
  label?: string;
  enabled?: boolean;
}

export interface RemoveConnection {
  type: 'removeConnection';
  id: string;
}
