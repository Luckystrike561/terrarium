/**
 * Generates the 13 PixelLab characters (12 workers + the CTO): a standing
 * character, its seated state, and the standing/seated animations, then
 * downloads every frame. Resumable: progress lands in cast.json after every
 * step, and a rerun skips whatever is already recorded or already on disk.
 *
 *   npx tsx scripts/pixellab/generate.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  createAnimations,
  createCharacterState,
  createCharacterV3,
  fetchBytes,
  getBalance,
  getCharacter,
  waitForJob,
} from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const castFile = path.join(here, 'cast.json');
const framesDir = path.join(here, 'frames');

interface AnimDef {
  name: string;
  action: string;
}

interface AnimProgress {
  groupId?: string;
  jobIds?: string[];
  status: 'pending' | 'done' | 'error';
  retries: number;
  error?: string;
}

interface CastCharacter {
  id: string;
  description: string;
  dominantColor: string;
  seed: number;
  standingCharacterId?: string;
  standingJobId?: string;
  seatedCharacterId?: string;
  seatedJobId?: string;
  animations?: Record<string, AnimProgress>;
}

interface Cast {
  view: string;
  promptSuffix: string;
  seatedStateEditDescription: string;
  directions: string[];
  frameCount: number;
  standingAnimations: AnimDef[];
  seatedAnimations: AnimDef[];
  characters: CastCharacter[];
  spentGenerations?: number;
}

/** Budget: the run aborts before issuing a paid call that would cross this. */
const GENERATION_BUDGET_CAP = 900;
/** Conservative per-call estimates (generations), used only to decide
 *  whether to attempt the next paid call; actual usage replaces the
 *  estimate once a job reports it. */
const ESTIMATED_COST = { create: 2, state: 16, animation: 2 };
const MAX_ANIMATION_ATTEMPTS = 3;
/** The account's Tier 1 plan allows 8 concurrent PixelLab background jobs;
 *  stay under that so other jobs (e.g. a retry racing a still-running one)
 *  don't trip the cap. */
const JOB_SLOT_CAPACITY = 6;
const RETRY_429_MAX_ATTEMPTS = 60;
const CONCURRENCY = 13;

class JobGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  async acquire(n: number): Promise<void> {
    while (this.active + n > this.capacity) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.queue.push(resolve);
      await promise;
    }
    this.active += n;
  }

  release(n: number): void {
    this.active -= n;
    while (this.queue.length > 0 && this.active < this.capacity) {
      this.queue.shift()?.();
    }
  }

  constructor(private readonly capacity: number) {}
}

const jobGate = new JobGate(JOB_SLOT_CAPACITY);

async function withRetry429<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('429') || attempt >= RETRY_429_MAX_ATTEMPTS) throw err;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5000 + Math.random() * 10000);
      await promise;
    }
  }
}

let saveChain = Promise.resolve();
function save(cast: Cast): Promise<void> {
  saveChain = saveChain.then(() =>
    fs.promises.writeFile(castFile, JSON.stringify(cast, null, 2) + '\n'),
  );
  return saveChain;
}

function recordUsage(cast: Cast, usage: { generations?: number | null } | null | undefined): void {
  if (usage?.generations) cast.spentGenerations = (cast.spentGenerations ?? 0) + usage.generations;
}

function budgetOk(cast: Cast, estimate: number): boolean {
  return (cast.spentGenerations ?? 0) + estimate <= GENERATION_BUDGET_CAP;
}

async function ensureStanding(cast: Cast, ch: CastCharacter): Promise<string> {
  if (ch.standingCharacterId) return ch.standingCharacterId;
  if (!budgetOk(cast, ESTIMATED_COST.create)) {
    throw new Error(`budget cap ${GENERATION_BUDGET_CAP} would be exceeded creating ${ch.id}`);
  }
  await jobGate.acquire(1);
  try {
    const res = await withRetry429(() =>
      createCharacterV3({
        description: ch.description + cast.promptSuffix,
        seed: ch.seed,
        view: cast.view as 'high top-down',
      }),
    );
    ch.standingCharacterId = res.character_id;
    ch.standingJobId = res.background_job_id;
    await save(cast);
    const job = await waitForJob(res.background_job_id);
    recordUsage(cast, job.usage);
    if (job.status !== 'completed' && job.status !== 'done' && job.status !== 'success') {
      throw new Error(`character creation for ${ch.id} ended with status ${job.status}`);
    }
  } finally {
    jobGate.release(1);
  }
  await save(cast);
  return ch.standingCharacterId!;
}

async function ensureSeated(cast: Cast, ch: CastCharacter): Promise<string> {
  if (ch.seatedCharacterId) return ch.seatedCharacterId;
  const standingId = await ensureStanding(cast, ch);
  if (!budgetOk(cast, ESTIMATED_COST.state)) {
    throw new Error(`budget cap ${GENERATION_BUDGET_CAP} would be exceeded seating ${ch.id}`);
  }
  await jobGate.acquire(1);
  try {
    const res = await withRetry429(() =>
      createCharacterState({
        characterId: standingId,
        editDescription: cast.seatedStateEditDescription,
        seed: ch.seed,
        stateName: 'seated',
      }),
    );
    ch.seatedCharacterId = res.character_id;
    ch.seatedJobId = res.background_job_id;
    await save(cast);
    const job = await waitForJob(res.background_job_id);
    recordUsage(cast, job.usage);
    if (job.status !== 'completed' && job.status !== 'done' && job.status !== 'success') {
      throw new Error(`seated state creation for ${ch.id} ended with status ${job.status}`);
    }
  } finally {
    jobGate.release(1);
  }
  await save(cast);
  return ch.seatedCharacterId!;
}

function framePaths(
  characterId: string,
  anim: string,
  directions: string[],
  frameCount: number,
): string[] {
  const out: string[] = [];
  for (const dir of directions) {
    for (let i = 0; i <= frameCount; i++) {
      out.push(path.join(framesDir, characterId, `${anim}_${dir}_${i}.png`));
    }
  }
  return out;
}

function framesOnDisk(
  characterId: string,
  anim: string,
  directions: string[],
  frameCount: number,
): boolean {
  return framePaths(characterId, anim, directions, frameCount).every((f) => fs.existsSync(f));
}

async function downloadFrames(
  castCharacterId: string,
  pixelLabCharacterId: string,
  anim: AnimDef,
  groupId: string,
  directions: string[],
): Promise<void> {
  const record = await getCharacter(pixelLabCharacterId);
  const entry = record.animations.find((a) => a.animation_group_id === groupId);
  if (!entry)
    throw new Error(`animation group ${groupId} not found on character ${pixelLabCharacterId}`);
  const dir = path.join(framesDir, castCharacterId);
  fs.mkdirSync(dir, { recursive: true });
  for (const direction of entry.directions) {
    if (!directions.includes(direction.direction)) continue;
    for (let i = 0; i < direction.frames.length; i++) {
      const dest = path.join(dir, `${anim.name}_${direction.direction}_${i}.png`);
      if (fs.existsSync(dest)) continue;
      const bytes = await fetchBytes(direction.frames[i]);
      fs.writeFileSync(dest, bytes);
    }
  }
}

async function ensureAnimation(
  cast: Cast,
  ch: CastCharacter,
  pixelLabCharacterId: string,
  anim: AnimDef,
): Promise<void> {
  ch.animations ??= {};
  const prog: AnimProgress = ch.animations[anim.name] ?? { status: 'pending', retries: 0 };
  ch.animations[anim.name] = prog;

  if (prog.status === 'done' && framesOnDisk(ch.id, anim.name, cast.directions, cast.frameCount)) {
    return;
  }

  const submitting = !prog.groupId;
  if (submitting && !budgetOk(cast, ESTIMATED_COST.animation)) {
    throw new Error(
      `budget cap ${GENERATION_BUDGET_CAP} would be exceeded on ${ch.id}/${anim.name}`,
    );
  }
  if (submitting) await jobGate.acquire(cast.directions.length);

  try {
    if (submitting) {
      const res = await withRetry429(() =>
        createAnimations({
          characterId: pixelLabCharacterId,
          animationName: anim.name,
          actionDescription: anim.action,
          directions: cast.directions,
          frameCount: cast.frameCount,
          seed: ch.seed,
        }),
      );
      prog.groupId = res.animation_group_id ?? undefined;
      prog.jobIds = res.background_job_ids;
      await save(cast);
    }

    if (!prog.groupId || !prog.jobIds) {
      throw new Error(`${ch.id}/${anim.name}: animation request returned no group id`);
    }

    for (const jobId of prog.jobIds) {
      const job = await waitForJob(jobId);
      recordUsage(cast, job.usage);
      if (job.status !== 'completed' && job.status !== 'done' && job.status !== 'success') {
        throw new Error(`job ${jobId} ended with status ${job.status}`);
      }
    }
    await downloadFrames(ch.id, pixelLabCharacterId, anim, prog.groupId, cast.directions);
    if (!framesOnDisk(ch.id, anim.name, cast.directions, cast.frameCount)) {
      throw new Error('frames missing after download');
    }
    prog.status = 'done';
    prog.error = undefined;
  } catch (err) {
    prog.retries += 1;
    prog.error = err instanceof Error ? err.message : String(err);
    if (prog.retries <= MAX_ANIMATION_ATTEMPTS) {
      prog.groupId = undefined;
      prog.jobIds = undefined;
      prog.status = 'pending';
      await save(cast);
      if (submitting) jobGate.release(cast.directions.length);
      await ensureAnimation(cast, ch, pixelLabCharacterId, anim);
      return;
    }
    prog.status = 'error';
    await save(cast);
    if (submitting) jobGate.release(cast.directions.length);
    throw new Error(`${ch.id}/${anim.name} failed after ${prog.retries} attempts: ${prog.error}`);
  }
  if (submitting) jobGate.release(cast.directions.length);
  await save(cast);
}

async function processCharacter(cast: Cast, ch: CastCharacter): Promise<void> {
  const standingId = await ensureStanding(cast, ch);
  const standing = Promise.all(
    cast.standingAnimations.map((anim) => ensureAnimation(cast, ch, standingId, anim)),
  );
  const seated = ensureSeated(cast, ch).then((seatedId) =>
    Promise.all(cast.seatedAnimations.map((anim) => ensureAnimation(cast, ch, seatedId, anim))),
  );
  await Promise.all([standing, seated]);
}

async function pool<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const errors: unknown[] = [];
  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await run(item);
      } catch (err) {
        errors.push(err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (errors.length > 0) {
    for (const e of errors) console.error('[pixellab]', e instanceof Error ? e.message : e);
    throw new Error(`${errors.length} character(s) failed`);
  }
}

async function main(): Promise<void> {
  const cast: Cast = JSON.parse(fs.readFileSync(castFile, 'utf8'));
  fs.mkdirSync(framesDir, { recursive: true });

  const balance = await getBalance();
  console.log(
    `[pixellab] balance: ${balance.subscription.generations}/${balance.subscription.total} generations left`,
  );

  await pool(cast.characters, CONCURRENCY, (ch) => processCharacter(cast, ch));
  await save(cast);
  await saveChain;

  console.log(`[pixellab] done. spent ~${cast.spentGenerations ?? 0} generations this run.`);
}

main().catch((err) => {
  console.error('[pixellab]', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
