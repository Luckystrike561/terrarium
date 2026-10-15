/**
 * Minimal PixelLab v2 API client: character creation, seated states,
 * animations and background-job polling. Only what scripts/pixellab/generate.ts
 * needs.
 */

import { pixelLabApiKey } from './env.js';

const BASE = 'https://api.pixellab.ai/v2';

async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${pixelLabApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PixelLab ${method} ${path} -> ${res.status}: ${text.slice(0, 1000)}`);
  }
  return JSON.parse(text) as T;
}

export interface BackgroundJob {
  id: string;
  status: string;
  usage?: { type: 'usd' | 'generations'; usd?: number | null; generations?: number | null } | null;
}

export async function getBackgroundJob(id: string): Promise<BackgroundJob> {
  return api<BackgroundJob>('GET', `/background-jobs/${id}`);
}

export async function waitForJob(
  id: string,
  pollMs = 4000,
  limitMs = 15 * 60 * 1000,
): Promise<BackgroundJob> {
  const start = Date.now();
  for (;;) {
    const job = await getBackgroundJob(id);
    if (job.status !== 'processing' && job.status !== 'pending') return job;
    if (Date.now() - start > limitMs) {
      throw new Error(`PixelLab job ${id} timed out after ${limitMs}ms (status ${job.status})`);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, pollMs);
    await promise;
  }
}

export interface CreateCharacterResponse {
  character_id: string;
  background_job_id: string;
  status?: string;
}

export async function createCharacterV3(args: {
  description: string;
  seed?: number;
  imageSize?: { width: number; height: number };
  view?: 'low top-down' | 'high top-down' | 'side';
  outline?: string;
  detail?: string;
}): Promise<CreateCharacterResponse> {
  return api<CreateCharacterResponse>('POST', '/create-character-v3', {
    description: args.description,
    seed: args.seed,
    image_size: args.imageSize ?? { width: 64, height: 64 },
    view: args.view ?? 'high top-down',
    outline: args.outline ?? 'single color black outline',
    detail: args.detail ?? 'medium detail',
  });
}

export interface CreateCharacterStateResponse {
  character_id: string;
  background_job_id: string;
  status?: string;
}

export async function createCharacterState(args: {
  characterId: string;
  editDescription: string;
  seed?: number;
  stateName?: string;
}): Promise<CreateCharacterStateResponse> {
  return api<CreateCharacterStateResponse>('POST', '/create-character-state', {
    character_id: args.characterId,
    edit_description: args.editDescription,
    seed: args.seed,
    state_name: args.stateName,
    use_color_palette_from_reference: true,
  });
}

export interface AnimationsResponse {
  background_job_ids: string[];
  directions: string[];
  animation_group_id?: string | null;
  status?: string;
}

export async function createAnimations(args: {
  characterId: string;
  animationName: string;
  actionDescription: string;
  directions: string[];
  frameCount?: number;
  seed?: number;
}): Promise<AnimationsResponse> {
  return api<AnimationsResponse>('POST', '/characters/animations', {
    character_id: args.characterId,
    animation_name: args.animationName,
    action_description: args.actionDescription,
    directions: args.directions,
    frame_count: args.frameCount ?? 8,
    mode: 'v3',
    seed: args.seed,
  });
}

export interface CharacterAnimationDirection {
  direction: string;
  frame_count: number;
  frames: string[];
}

export interface CharacterAnimation {
  animation_type: string;
  display_name: string | null;
  animation_group_id: string | null;
  directions: CharacterAnimationDirection[];
}

export interface CharacterRecord {
  id: string;
  status: string;
  animations: CharacterAnimation[];
}

export async function getCharacter(characterId: string): Promise<CharacterRecord> {
  return api<CharacterRecord>('GET', `/characters/${characterId}`);
}

export interface Balance {
  credits: { type: string; usd: number };
  subscription: { type: string; status: string; plan: string; generations: number; total: number };
}

export async function getBalance(): Promise<Balance> {
  return api<Balance>('GET', '/balance');
}

export async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
