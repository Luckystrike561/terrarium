/**
 * Which body a character shows for what it is doing, drawn from the bundled
 * sheets: only working agents type or read, idle agents breathe, seated idle
 * agents rest, and agents in the CTO queue show why they wait.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { beforeAll, test } from 'vitest';

import { CHAR_COUNT, CTO_CHARACTER_FILE } from '../../core/src/assets/constants.js';
import { decodeCharacterPng } from '../../core/src/assets/pngDecoder.js';
import { IDLE_FRAME_DURATION_SEC } from '../src/constants.js';
import {
  advancePoseFrame,
  createCharacter,
  getCharacterPose,
  getCharacterSprite,
} from '../src/office/engine/characters.js';
import type { CharacterSprites } from '../src/office/sprites/spriteData.js';
import { getCharacterSprites, setCharacterTemplates } from '../src/office/sprites/spriteData.js';
import type { Character, CtoQueueReason, SpriteData } from '../src/office/types.js';
import { CharacterState, Direction } from '../src/office/types.js';

const CHARACTERS_DIR = path.join(import.meta.dirname, '../public/assets/characters');

let sprites: CharacterSprites;

beforeAll(() => {
  const read = (file: string) =>
    decodeCharacterPng(fs.readFileSync(path.join(CHARACTERS_DIR, file)));
  setCharacterTemplates(
    Array.from({ length: CHAR_COUNT }, (_, index) => read(`char_${index}.png`)),
    read(CTO_CHARACTER_FILE),
  );
  sprites = getCharacterSprites(0);
});

function character(overrides: Partial<Character>): Character {
  return { ...createCharacter(1, 0, null, null), dir: Direction.DOWN, ...overrides };
}

function queueSlot(reason: CtoQueueReason, seated: boolean): Character['ctoQueueSlot'] {
  return { col: 1, row: 1, facing: Direction.UP, seated, reason };
}

function framesOf(ch: Character) {
  return [0, 1].map((frame) => getCharacterSprite({ ...ch, frame }, sprites));
}

function assertNoSharedFrame(a: SpriteData[], b: SpriteData[], message: string): void {
  for (const frame of a) {
    for (const other of b) assert.notDeepEqual(frame, other, message);
  }
}

const typingFrames = () => framesOf(character({ state: CharacterState.TYPE, isActive: true }));

test('a standing idle agent breathes instead of holding a walk frame', () => {
  const ch = character({ state: CharacterState.IDLE, isActive: false });
  assert.equal(getCharacterPose(ch), 'idle');

  const idle = framesOf(ch);
  assert.notDeepEqual(idle[0], idle[1], 'the two idle frames differ');
  assert.ok(!idle.includes(sprites.walk[Direction.DOWN][1]), 'idle is not the held walk frame');

  ch.frameTimer = IDLE_FRAME_DURATION_SEC;
  advancePoseFrame(ch);
  assert.equal(ch.frame, 1, 'the loop steps after one idle frame duration');
});

test('a seated agent with no work rests instead of typing', () => {
  const resting = character({ state: CharacterState.TYPE, isActive: false, restSeatId: 'sofa' });
  assert.equal(getCharacterPose(resting), 'rest');
  assertNoSharedFrame(framesOf(resting), typingFrames(), 'a rest frame is not a typing frame');
});

test('an agent in the CTO queue shows why it waits, seated or standing', () => {
  const pose = (reason: CtoQueueReason, seated: boolean) =>
    getCharacterPose(
      character({
        state: seated ? CharacterState.TYPE : CharacterState.IDLE,
        isActive: reason === 'permission',
        ctoQueueSlot: queueSlot(reason, seated),
      }),
    );
  assert.equal(pose('input', true), 'raiseHandSeated');
  assert.equal(pose('permission', true), 'holdFormSeated');
  assert.equal(pose('input', false), 'raiseHand');
  assert.equal(pose('permission', false), 'holdForm');
});

test('waiting for input and needing approval look different, and neither types', () => {
  for (const seated of [true, false]) {
    const waiting = (reason: CtoQueueReason) =>
      framesOf(
        character({
          state: seated ? CharacterState.TYPE : CharacterState.IDLE,
          isActive: false,
          ctoQueueSlot: queueSlot(reason, seated),
        }),
      );
    const input = waiting('input');
    const approval = waiting('permission');
    assertNoSharedFrame(input, approval, 'the two waits share no frame');
    assertNoSharedFrame([...input, ...approval], typingFrames(), 'a wait is not typing');
  }
});
