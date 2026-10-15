import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const castFile = path.join(here, 'cast.json');
const framesDir = path.join(here, 'frames');

const cast = JSON.parse(fs.readFileSync(castFile, 'utf8'));

cast.seatedStateEditDescription =
  'sitting on an office chair, viewed from the side: both legs are symmetric mirror images of each other, ' +
  'both feet are flat on the floor side by side at the same height, both knees bent at the same right angle, ' +
  'neither leg crosses the other, neither foot is tucked under the body, no leg rests on top of the other knee, ' +
  'back straight, sitting upright, facing forward, ' +
  'do not draw the chair, draw only the seated body';

const typeAnim = cast.seatedAnimations.find((a: { name: string }) => a.name === 'type');
typeAnim.action =
  'sitting still in the chair, only both hands moving quickly at chest height as if typing on an invisible keyboard, ' +
  'nothing else changes, no new objects appear, no desk, no keyboard, no monitor, no furniture, no props, ' +
  'body and head stay fixed in the same seated pose the whole time';

const SEATED_ANIM_NAMES = ['type', 'read', 'rest', 'waveSeated', 'holdFormSeated'];
const DIRECTIONS = ['south-west', 'north-east'];
const FRAME_COUNT = 8;

let removedFrameFiles = 0;
for (const ch of cast.characters) {
  if (ch.id === 'worker0') {
    ch.seatedCharacterId = 'acf5440f-597d-40cc-91b1-62ce362599ab';
    ch.seatedJobId = '0c706cc4-3dc8-43d7-b520-588e8109be1d';
  } else {
    delete ch.seatedCharacterId;
    delete ch.seatedJobId;
  }
  for (const anim of SEATED_ANIM_NAMES) {
    delete ch.animations?.[anim];
    for (const dir of DIRECTIONS) {
      for (let i = 0; i <= FRAME_COUNT; i++) {
        const file = path.join(framesDir, ch.id, `${anim}_${dir}_${i}.png`);
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          removedFrameFiles++;
        }
      }
    }
  }
}

fs.writeFileSync(castFile, JSON.stringify(cast, null, 2) + '\n');
console.log(`migrated cast.json, removed ${removedFrameFiles} stale frame files`);
