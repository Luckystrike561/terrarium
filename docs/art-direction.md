# Art direction

The target look for everything drawn in the office: characters, furniture, floors, walls, status badges, speech bubbles and the HUD. New art follows this note. Art that cannot follow it changes the note in the same pull request.

![The default office](media/art-direction/office.png)

## Decisions

- **Everything stays generated from code.** Characters, furniture and floors are written by `scripts/iso-art/` (`npx tsx scripts/iso-art/generate.ts`), walls are drawn procedurally at runtime (`webview-ui/src/office/isoWalls.ts`). No hand-drawn sheets and no third-party asset packs: the generator keeps every asset reviewable as a diff, reproducible, and free of licence questions.
- **The target is Habbo Hotel's look, and no Habbo asset is copied.** Habbo's rooms are the reference for the figure proportions, the furniture outline and the fabric texture. [habboassets.com](https://www.habboassets.com/) is the reference library because it renders every item at Terrarium's own tile size. It is a community mirror, unaffiliated with Sulake, and the art belongs to Sulake: no Habbo pixel is traced, sampled, downloaded into the repository, shipped in the npm tarball or the Docker image, or fetched at runtime. The references below are looked at, never used as input to a generator.
- **One style: Habbo-style 2:1 iso pixel art at night.** A late-shift office floating in the dark, lit warm inside against a deep indigo city outside. Habbo's room view floats each room over a dark void too, so the night setting and the indigo skyline stay. Characters are readable first, detailed second: a viewer across the room must tell who is working, who is waiting and who needs approval without reading a badge.

## Pixel grid and projection

- 2:1 isometric. A floor tile is a 32×16 diamond, the size of Habbo's small zoom (a Habbo 2×1 sofa at size 32 is within 2 px of Terrarium's). One world unit of height is one sprite pixel: desk tops at 12, chair seats at 6, back walls 40 tall, glass partitions 30.
- Nearest-neighbour sampling only. No anti-aliasing, no blur, no sub-pixel placement, no smooth gradients. Shading comes in hard bands, and the only blend between two bands is an ordered dither.
- One sprite pixel is one art pixel. Never scale a sprite inside its sheet.

## Light

One key light from the screen's upper left.

| Surface                                       | Brightness |
| --------------------------------------------- | ---------- |
| Top faces                                     | 100%       |
| Left faces (facing +row, screen lower left)   | 70%        |
| Right faces (facing +col, screen lower right) | 45%        |

- **Shadows shift toward cool violet `#1f1830`**, never toward black. Brightness is quantized into six bands (`lit()` in `scripts/iso-art/lib/scene.ts`).
- **Rim light**: one lighter pixel row on the top front edges of boxes, the way Habbo picks out the edge of a table top or a wooden frame.
- **Characters** follow the same light: the figure's screen-right side is the shaded side, the left side carries the light tone.
- **Contact shadows**: characters stand on a translucent `#00000040` ground shadow, furniture casts its traced shadow on the floor.

## Outline

- **Ink is `#1a1426`.** It is the outline of characters, furniture, badges and bubbles. It stands in for Habbo's near-black line and keeps the violet shadow family.
- **Characters** get a full 1 px outline, including the inner line between parts that overlap (an arm over the torso, a hand over a sheet, the torso over the hips), so poses read at 1×.
- **Furniture** gets a full 1 px outline, like Habbo furniture: every silhouette pixel is ink, not a darkened colour. Where one part passes in front of another (a cushion in front of a backrest, a monitor in front of a wall) the edge is a dark line, the colour mixed 65% toward ink. Edges between two faces of the same box are drawn by the light bands, not by a line.
- **Floors and walls** have no outline. Tiles read through the light: seams and bevels, not lines.

## Texture

- **Fabric is dithered.** Upholstery, cushions and rugs carry Habbo's woven look: a 1 px checker of the face's lit tone and a tone mixed 18% toward ink, laid on the face's own coordinates so it follows the iso grid. Mesh keeps its own coarser weave.
- **Hard materials are flat.** Wood (grain streaks only), metal, plastic, leather, glass, paper and plants take the light bands and nothing else.
- **No value noise** on any surface: noise reads as grime at 1×, a dither reads as cloth.

## Palette

Base colours are the fully lit (top face) tone. Side tones are derived from them by the light, never picked by hand. Keep bases mid to light so the shaded faces don't collapse into the shadow colour.

| Role                | Colours                                           |
| ------------------- | ------------------------------------------------- |
| Ink (outlines)      | `#1a1426`                                         |
| Text ink on paper   | `#2b2433`                                         |
| Shadow tint         | `#1f1830`                                         |
| Wood (desks, plank) | `#c98b52` `#a8673a` `#7a4528`                     |
| Upholstery          | sage `#a8b89a`, grey `#8b8796`, leather `#9a5a3c` |
| Metal               | `#dfe3ea` `#b7bcc8` `#6d7383`                     |
| Paper               | `#f6f1e2` `#f1e6c8` `#e2d2a8`                     |
| Plants              | `#8fd36a` `#5fae4e` `#3e7d3a`                     |
| Night outside       | `#090a1a` → `#36275e`, lit windows `#f0c06a`      |

**State colours** are shared by status badges, bubbles and the HUD, and nothing else uses them:

| State             | Colour           |
| ----------------- | ---------------- |
| Working           | blue `#3794ff`   |
| Needs approval    | amber `#cca700`  |
| Waiting for input | violet `#7c5cff` |
| Done              | green `#44bb66`  |
| Idle              | grey `#8891a8`   |

## Characters

A frame is 32×56, half of Habbo's 64×110 figure frame rounded to whole rows. The feet touch the bottom centre of the frame, on a one-row ground shadow. Seated frames sit 11 px lower, so the hips rest on a chair seat at height 6.

**Proportions.** Habbo's: a tall, slim body under a big head with a small face. A standing figure is about 44 px from crown to sole, about 2.75 heads: head and hair about 16 px, torso 14, legs 16 including the shoes. The shoulders are 14 px wide, no wider than the head, and the arms hang 3 px thick beside the torso. The face keeps two-pixel eyes (white plus pupil) and a one-pixel mouth inside the big head. Builds vary the shoulders by up to 2 px either way and the legs by 2 px, never the head.

**Parts.** A figure is composed from parts, the way Habbo composes one from `hd`, `ch`, `lg` and `sh`: legs and shoes, a torso with its outfit cut, two arms posed by the frame, a head, hair, and one accessory. The arms and legs are drawn from joint positions per pose (`scripts/iso-art/characters/body.ts`), the head, hair and accessories are pixel templates, and every part is outlined in ink where it overlaps another.

**Views.** Row 0 faces DOWN (3/4 front, screen lower left), row 1 faces UP (3/4 back, screen upper right), row 2 faces RIGHT and is row 0 mirrored. LEFT is row 1 mirrored at runtime. Habbo draws eight directions, but Terrarium moves on the tile grid, so four facings are enough.

**Poses.** Every sheet carries the same frames, in this order (`CHARACTER_FRAMES` in `core/src/assets/constants.ts`):

| Frames                                | Pose                                                                | Used for                                         |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `walk1` `walk2` `walk3`               | walk cycle, `walk2` is the passing pose                             | walking                                          |
| `type1` `type2`                       | seated, hands on the keyboard                                       | writing tools                                    |
| `read1` `read2`                       | seated, holding a sheet                                             | reading tools                                    |
| `idle1` `idle2`                       | standing, breathing: the second frame exhales one pixel lower       | standing idle                                    |
| `rest1` `rest2`                       | seated, leaning back, hands in lap, eyes closed on the second frame | lounge sofas, resting at a desk, the CTO's couch |
| `raiseHand1` `raiseHand2`             | standing, one hand raised, waving                                   | waiting for input, at the CTO's door             |
| `raiseHandSeated1` `raiseHandSeated2` | seated, one hand raised, waving                                     | waiting for input, on a CTO visitor chair        |
| `holdForm1` `holdForm2`               | standing, holding up a form with an amber mark                      | needs approval, at the CTO's door                |
| `holdFormSeated1` `holdFormSeated2`   | seated, holding up a form with an amber mark                        | needs approval, on a CTO visitor chair           |

Only working agents type or read. An agent that sits without working rests, and an agent that needs the human shows it with its body: a raised hand asks a question, a held-up form asks for a signature. The raised hand and the form reach above the head on opposite sides, so the two read apart from the front and the back.

**Variety.** Twelve distinct workers ship (`char_0.png` to `char_11.png`), so a twelve-agent office has no two alike. Each one differs from every other in at least two of: build, hair, outfit cut, accessory, and its dominant outfit colour is distinct at 1×. Hue-shifted copies only appear from the thirteenth agent on. The CTO has a sheet of its own (`cto.png`) that no agent uses.

## Furniture

- Modelled as primitives (boxes, cylinders, spheres) and ray traced by `IsoScene` (`scripts/iso-art/lib/scene.ts`), which applies the light, the shadow tint, the outline, the fabric dither and the rim light above. Colours come from `PAL` (`scripts/iso-art/lib/palette.ts`).
- An item with footprint fw×fh is `(fw+fh)*16` px wide and its floor diamond touches the image's left, right and bottom edges. Ids and footprints are unchanged by this direction, so the default layout keeps its `REVISION`.
- Electronics have an off and an on state. Screens glow `#7fe0c8` or `#5aa6e8` when on.

## Floors

- Floors are 16×16 grayscale patterns, colourized per tile, then projected onto the 32×16 diamond. They are generated by `scripts/iso-art/floors.ts`.
- A pattern draws a material, not a grid. Each cell carries a bright seam along its top and left edge (the shared boundary with the next cell when tiled) and a darker inset line along its bottom and right edge, so slabs, planks, bricks and tiles read as slightly raised pieces. `floor_0`–`floor_8` keep a fixed index-to-material mapping that the default layout and any saved layout rely on: `floor_0` plain polished slab, `floor_1` large pale tile (bright seam), `floor_2` large tile (dark grout), `floor_3` small square tile (dark grout), `floor_4` wood planks with grain, `floor_5` running-bond brick (bright mortar), `floor_6` aligned brick (dark mortar), `floor_7` fine checkerboard, `floor_8` coarse checkerboard.
- Faces are flat between the seams, like Habbo's floor tiles: no noise. Only the wood planks carry grain.

## Walls

- **Back walls** are 40 px boxes lit from the same direction as furniture but softer, because a wall face is the largest surface in the room and full furniture contrast would swamp it: the cap at 118% of the wall colour with a brighter rim pixel on its front edges, the left face at 95%, the right face at 78%, a baseboard at 55%. Faces are flat paint, like Habbo's wallpaper, with a one-pixel lip under the cap at 70% that separates the cap from the face. They stay lower than Habbo's walls on purpose: they are the cut-away back of an office seen from above, and a standing figure may clear them.
- **Glass partitions** stand 30 px high: an ink-dark frame, a pale blue pane at 30% opacity and a diagonal white sheen, so the rooms behind stay visible.

## Badges and bubbles

- Small sprites (9×9 for badges, 11×13 for bubbles), `webview-ui/src/office/sprites/status-*.json` and `bubble-*.json`, drawn in the ink outline `#1a1426`. They float at the new head height: a badge beside the head, a bubble above the crown.
- A **badge** is a filled state-colour plate with a white (`#ffffff`) glyph: ▶ working, ! needs approval, ? waiting for input, ✓ done, Z idle.
- A **bubble** is paper (`#f6f1e2`) with an ink outline and a tail pointing at the head, carrying the state colour in its glyph, the way Habbo's chat bubbles are a pale plate with a dark line. The pet-petted heart bubble follows the same paper-and-ink shape with its own pink (`#e64566`) glyph: it is a reaction, not a state indicator, so it sits outside the state-colour table.

## HUD

- **The HUD is furnished like the office.** It is made of the same materials as the room: modals and notices are paper memos pinned with a square tack (`ui/Modal.tsx`, `ChangelogModal.tsx`, `MigrationNotice.tsx`: `.paper-sheet` plus a `.paper-pin`), and tooltips, toasts and in-world labels are paper tags (`Tooltip.tsx`, `VersionIndicator.tsx`, `ConnectionIndicator.tsx`, `ToolOverlay.tsx`'s activity label, the greeter's `IntroBubble.tsx`: `.paper-tag`, ink-bordered). There is no flat dark panel that belongs to no object in the room.
- **Font**: FS Pixel Sans, at the theme's pixel sizes.
- **Shape**: square corners, 2 px borders in wood-dark or ink, hard 2 px offset shadows (`2px 2px 0px`) with no blur, and no gradients except hard-edged bands such as wood grain. Habbo's UI windows share the hard line and the flat fill, so the HUD needs no change for this direction.
- **Colours**: wood, paper, ink and the state colours above. `npm run lint` enforces it: colour literals only in `constants.ts` and the CSS variables, pixel shadows, and the pixel font.

## References

Terrarium's own renders:

- [The default office](media/art-direction/office.png) at 1600×700 with twelve agents: five working, two needing approval, two waiting for input, three idle. This is the target state.
- [The office before this direction](media/art-direction/office-before.png), same scene and size, for comparison.
- [The twelve workers and the CTO](media/art-direction/characters.png), every frame of every sheet at 3×, one sheet per band (front, back and side rows).

Habbo Hotel on [habboassets.com](https://www.habboassets.com/), looked at for style, never copied. Each page shows the item in all four directions at size 32, Terrarium's tile:

- Figures: the [imager](https://www.habboassets.com/imager), for proportions (a 64×110 frame at the 64 px tile) and the inner outline between parts.
- Outline and fabric: the [Silo sofa](https://www.habboassets.com/furniture/sofa_silo), [armchair](https://www.habboassets.com/furniture/sofachair_silo) and [chair](https://www.habboassets.com/furniture/chair_silo): full dark line, dithered cushions, a lit edge on the wooden frame.
- Hard surfaces: the [Silo table](https://www.habboassets.com/furniture/table_silo_med) and the [Plasto chair](https://www.habboassets.com/furniture/chair_plasto): flat bands, a rim on the top's front edges.
- Plants: the [pineapple plant](https://www.habboassets.com/furniture/plant_pineapple).

## Checklist for new art

1. Generated by `scripts/iso-art/` or drawn procedurally. Regenerating reproduces the committed assets with no diff.
2. No Habbo asset, and nothing traced, sampled or fetched from habboassets.com or habbo.com.
3. Lit from the upper left, shadows toward `#1f1830`, colours from the palette above.
4. Outlined in ink as the section above says for its kind, fabric dithered, hard materials flat.
5. Characters: every frame of `CHARACTER_FRAMES` in all three rows, feet at the bottom centre, seated frames 11 px lower.
6. Furniture: the footprint anchor contract above, and a bump of the default layout `REVISION` if an id or a footprint changes.
