/**
 * The building: one floor per machine, stacked. Covers what the office
 * promises about floors without a browser: an agent sits only on its own
 * machine's floor, floors never overlap on screen, a click on any floor finds
 * that floor's character, and a lone office is fitted exactly as before.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { Building } from '../src/office/engine/building.js';
import { worldToIso } from '../src/office/iso.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { boundsRect, contentBounds } from '../src/office/projection.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const CHAIR = 'TEST_CHAIR';

beforeAll(() => {
  buildDynamicCatalog({
    catalog: [
      {
        id: CHAIR,
        label: 'Chair',
        category: 'chairs',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        canPlaceOnWalls: false,
      },
    ],
    // eslint-disable-next-line terrarium/no-inline-colors -- a one-pixel test sprite, not a UI colour
    sprites: { [CHAIR]: [['#000000']] },
  });
});

/** An open room with two chairs. */
function roomWithTwoChairs(): OfficeLayout {
  const cols = 8;
  const rows = 6;
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'chair-a', type: CHAIR, col: 2, row: 2 },
      { uid: 'chair-b', type: CHAIR, col: 5, row: 2 },
    ],
  };
}

function buildingOf(machineIds: string[]): Building {
  const building = new Building();
  building.setFloors(machineIds.map((id) => ({ id, name: id })));
  building.setLayouts(roomWithTwoChairs(), roomWithTwoChairs());
  return building;
}

test('a lone office is fitted exactly as before floors existed', () => {
  const building = buildingOf(['local']);
  assert.equal(building.floors.length, 1);
  assert.deepEqual(building.viewRect(), boundsRect(contentBounds(building.ground.getLayout())));
});

test('an agent only ever takes a seat on its own floor, even when that floor is full', () => {
  const building = buildingOf(['local', 'ssh:pi']);
  for (const id of [1, 2, 3]) building.addAgent('ssh:pi', id);

  const pi = building.floors[1].office;
  assert.deepEqual(
    [1, 2, 3].map((id) => building.floorOf(id)?.id),
    ['ssh:pi', 'ssh:pi', 'ssh:pi'],
  );
  assert.equal([...pi.seats.values()].filter((seat) => seat.assigned).length, 2);
  assert.equal(pi.characters.get(3)?.seatId, null, 'the third agent finds no free seat on the Pi');
  assert.ok(
    [...building.ground.seats.values()].every((seat) => !seat.assigned),
    'no seat on this machine was handed to a Pi agent',
  );
});

test('agents of one machine share its floor whatever reported them', () => {
  const building = buildingOf(['local', 'ssh:vps']);
  building.addAgent('local', 1);
  building.addAgent('local', 2);
  building.addAgent('ssh:vps', 3);

  assert.deepEqual([...building.ground.characters.keys()].sort(), [1, 2]);
  assert.deepEqual([...building.floors[1].office.characters.keys()], [3]);
});

test('floors stack bottom to top without overlapping on screen', () => {
  const building = buildingOf(['local', 'ssh:vps', 'ssh:pi']);
  const screenRect = (index: number) => {
    const floor = building.floors[index];
    const rect = boundsRect(contentBounds(floor.office.getLayout()));
    return {
      top: rect.minY - floor.elevation,
      bottom: rect.maxY + building.slabPx - floor.elevation,
    };
  };

  for (let storey = 1; storey < building.floors.length; storey++) {
    assert.ok(
      screenRect(storey).bottom < screenRect(storey - 1).top,
      `floor ${storey} sits wholly above floor ${storey - 1}`,
    );
  }
  const view = building.viewRect();
  assert.ok(
    view.minY <= screenRect(2).top && view.maxY >= screenRect(0).bottom,
    'the view covers the building',
  );
});

test('a click on an upper floor finds the character standing there, not the one below', () => {
  const building = buildingOf(['local', 'ssh:pi']);
  building.addAgent('local', 1, undefined, undefined, undefined, true);
  building.addAgent('ssh:pi', 2, undefined, undefined, undefined, true);
  const below = building.getCharacter(1)!;
  const above = building.getCharacter(2)!;
  // Put both on the same tile of their own floor.
  above.x = below.x;
  above.y = below.y;

  const onUpper = worldToIso(above.x, above.y, building.floors[1].elevation);
  const onGround = worldToIso(below.x, below.y);
  assert.equal(building.getCharacterAt(onUpper.x, onUpper.y - 4), 2);
  assert.equal(building.getCharacterAt(onGround.x, onGround.y - 4), 1);
});

test('dropping a floor removes its characters and their selection', () => {
  const building = buildingOf(['local', 'ssh:pi']);
  building.addAgent('ssh:pi', 7);
  building.selectedAgentId = 7;
  building.cameraFollowId = 7;

  building.setFloors([{ id: 'local', name: 'laptop' }]);

  assert.deepEqual(
    building.floors.map((floor) => floor.id),
    ['local'],
  );
  assert.equal(building.getCharacter(7), undefined);
  assert.equal(building.selectedAgentId, null);
  assert.equal(building.cameraFollowId, null);
});

test('an agent naming a machine before its floor is announced gets that floor on top', () => {
  const building = buildingOf(['local']);
  building.addAgent('ssh:vps', 4);

  assert.deepEqual(
    building.floors.map((floor) => floor.id),
    ['local', 'ssh:vps'],
  );
  building.setFloors([
    { id: 'local', name: 'laptop' },
    { id: 'ssh:vps', name: 'VPS' },
  ]);
  assert.equal(building.floorOf(4)?.name, 'VPS');
});

test('sub-agent ids stay unique across floors', () => {
  const building = buildingOf(['local', 'ssh:pi']);
  building.addAgent('local', 1);
  building.addAgent('ssh:pi', 2);

  const first = building.addSubagent(1, 'tool-a');
  const second = building.addSubagent(2, 'tool-a');

  assert.notEqual(first, second);
  assert.equal(building.floorOf(second)?.id, 'ssh:pi', 'a sub-agent spawns on its parent floor');
  assert.equal(building.subagentParentOf(second), 2);
});
