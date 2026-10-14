# Art direction

The target look for everything drawn in the office: the background, the room shell (floors, walls, partitions), furniture, characters, status badges, speech bubbles and the HUD. New art follows this note. Art that cannot follow it changes the note in the same pull request.

![The default office](media/art-direction/office.png)

## Decisions

- **Everything stays generated from code.** Characters, furniture and floors are written by `scripts/iso-art/` (`npx tsx scripts/iso-art/generate.ts`), the walls, the floor slab and the background are drawn procedurally at runtime (`webview-ui/src/office/isoWalls.ts`, `backdrop.ts`). No hand-drawn sheets and no third-party asset packs: the generator keeps every asset reviewable as a diff, reproducible, and free of licence questions.
- **The office is a Habbo Hotel room, and no Habbo asset is copied.** Habbo Hotel is the reference for everything on screen: the daylight hotel view behind the room, the thick floor slab and its tile grid, the tall thin wallpapered walls, the glossy chunky furniture, the big-headed figures and the white rounded windows of the client. [habboassets.com](https://www.habboassets.com/) is the reference library because it renders every item at Terrarium's own tile size. It is a community mirror, unaffiliated with Sulake, and the art belongs to Sulake: no Habbo pixel is traced, sampled, downloaded into the repository, shipped in the npm tarball or the Docker image, or fetched at runtime. The references below are looked at, never used as input to a generator.
- **Daylight.** Habbo's hotel view is a sunny sky over a city, so the night office and its indigo skyline are gone. The room is evenly lit, colours are bright and saturated, and every object is held together by a black line.
- **Readable first.** A viewer across the room must tell who is working, who is waiting and who needs approval without reading a badge.

## Pixel grid and projection

- 2:1 isometric. A floor tile is a 32×16 diamond, Habbo's small zoom (a Habbo 2×1 sofa at size 32 is within 2 px of Terrarium's). One world unit of height is one sprite pixel: desk tops at 12, chair seats at 6, back walls 56 tall, glass partitions 30.
- Nearest-neighbour sampling only. No anti-aliasing, no blur, no sub-pixel placement, no smooth gradients. Shading comes in hard bands, and the only blend between two bands is an ordered dither.
- One sprite pixel is one art pixel. Never scale a sprite inside its sheet.

## Background

Habbo's hotel view by day, drawn by `backdrop.ts`:

- **Sky** in hard horizontal bands, `#4aa6e0` at the top through `#7cc4ec` and `#a8daf3` to `#d2eef9` at the horizon.
- **Clouds**: flat white `#ffffff` puffs with a `#cfe9f7` underside, stepped like pixel art, never round gradients.
- **City** along the bottom: two rows of daytime towers, far `#9fc6dc` and near `#7aaac6`, with pale `#e3f4fb` windows in a grid, and a few rooftop details. No stars, no lit windows.

## Light

One key light from the screen's upper left, softer than a night interior because the room is daylit.

| Surface                                       | Brightness |
| --------------------------------------------- | ---------- |
| Top faces                                     | 100%       |
| Left faces (facing +row, screen lower left)   | 80%        |
| Right faces (facing +col, screen lower right) | 60%        |

- **Shadows shift toward a cool grey-blue `#2c3446`**, never toward black. Brightness is quantized into bands (`lit()` in `scripts/iso-art/lib/scene.ts`).
- **Gloss**: Habbo plastic, lacquer and screens carry a white highlight streak or a lighter rim on their top front edges.
- **Contact shadows**: characters stand on a translucent `#00000033` iso ellipse, furniture casts its traced shadow on the floor.

## Outline

- **Ink is `#111111`**, Habbo's near-black line. It outlines characters, furniture, badges, bubbles, windows and the floor slab.
- **Characters** get a full 1 px outline, including the inner line between parts that overlap (an arm over the torso, the shirt hem over the trousers, a hand over a sheet).
- **Furniture** gets a full 1 px outline: every silhouette pixel is ink. Where one part passes in front of another the edge is a dark line, the colour mixed 65% toward ink. Edges between two faces of the same box are drawn by the light bands.
- **Floors** draw their tile grid instead of an outline. **Walls** get an ink line along the top edges of the cap.

## Room shell

- **Floor tiles** read as Habbo's grid: every tile is flat colour with a 1 px darker seam along its two upper edges, so the room shows its diamonds. `floor_0`–`floor_8` keep their index-to-material mapping (`floor_0` plain, `floor_1` large pale tile, `floor_2` large tile with dark grout, `floor_3` small tile, `floor_4` wood planks, `floor_5` running-bond brick, `floor_6` aligned brick, `floor_7` fine checkerboard, `floor_8` coarse checkerboard), each flat between its seams, only wood carrying grain. They are generated by `scripts/iso-art/floors.ts`.
- **Floor slab**: the room stands on an 8 px thick slab, like Habbo's floor edge: the left face a little darker than the floor, the right face darker still, outlined in ink along the bottom.
- **Back walls** are thin and tall like Habbo's: 56 px high and 4 world units thick, standing on the inner edge of their tile so wall items keep hanging on the same face. Flat wallpaper faces (left face 92%, right face 74% of the wall colour), a narrow cap at 115% with the ink line on its outer top edges, and a 3 px skirting board at 60%.
- **Glass partitions** stand 30 px high, an ink frame, a light cyan pane at 40% opacity and a white diagonal sheen.

## Palette

Base colours are the fully lit tone. Side tones come from the light. Habbo's colours are bright: keep bases light to mid and saturated.

| Role                | Colours                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| Ink (outlines)      | `#111111`                                                                         |
| Text ink on paper   | `#222222`                                                                         |
| Shadow tint         | `#2c3446`                                                                         |
| Wood                | `#e0a463` `#c4824a` `#8e5530`                                                     |
| Plastic and lacquer | white `#f4f4f4`, red `#e04b3f`, blue `#3f8ee0`, yellow `#f2c23a`, green `#5cbf4a` |
| Upholstery          | teal `#4bb3b0`, orange `#ef8a3c`, cream `#efe3c4`                                 |
| Metal               | `#e8ecf0` `#b9c1cb` `#6f7884`                                                     |
| Paper               | `#ffffff` `#f4efe1`                                                               |
| Plants              | `#7ed957` `#4caf3c` `#2f7d2c`                                                     |
| Sky and city        | see Background                                                                    |

**State colours** are shared by status badges, bubbles and the HUD, and nothing else uses them:

| State             | Colour           |
| ----------------- | ---------------- |
| Working           | blue `#3794ff`   |
| Needs approval    | amber `#cca700`  |
| Waiting for input | violet `#7c5cff` |
| Done              | green `#44bb66`  |
| Idle              | grey `#8891a8`   |

## Characters

A frame is 32×56, half of Habbo's 64×110 figure frame. The feet touch the bottom centre of the frame, on a translucent iso ellipse.

**Proportions**, measured on Habbo figures and halved: about 40 px from crown to sole. A big head about 17 px tall including the hair, a torso about 15 px, short legs about 8 px on 2 px shoes. The head and the torso are the same width, about 14 px: a Habbo figure is a block body under a block head, not a tapering one.

**Construction.** The torso is a small iso box, a lit front face and a narrow shaded side face, and the shirt hem runs down at the iso slope. Arms are 3 px wide, hang straight at the sides with small skin hands. The legs are two columns, the far one behind, the shoes flat iso blocks. The head is turned 3/4 toward where the figure faces: both eyes on that half of the face, white with a dark pupil toward the facing side, the nose a 1 px bump past the contour, a small mouth, the ear on the far side, the jaw narrowing toward the facing side. Hair is a big shape with a 1 px dither in its darker tone.

**Parts.** A figure is composed from parts, the way Habbo composes one from `hd`, `ch`, `lg` and `sh`: legs and shoes, a torso with its outfit cut, two arms posed by the frame, a head, hair, and one accessory, all drawn by `scripts/iso-art/characters.ts` and `scripts/iso-art/characters/`.

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

Seated frames put the hips on a chair seat at height 6 and bend the legs forward. Only working agents type or read. An agent that sits without working rests, and an agent that needs the human shows it with its body: a raised hand asks a question, a held-up form asks for a signature, on opposite sides so the two read apart from the front and the back.

**Variety.** Twelve distinct workers ship (`char_0.png` to `char_11.png`), so a twelve-agent office has no two alike. Each one differs from every other in at least two of: build, hair, outfit cut, accessory, and its dominant outfit colour is distinct at 1×. Hue-shifted copies only appear from the thirteenth agent on. The CTO has a sheet of its own (`cto.png`) that no agent uses.

## Furniture

- Modelled as primitives (boxes, cylinders, spheres) and ray traced by `IsoScene` (`scripts/iso-art/lib/scene.ts`), which applies the light, the shadow tint, the ink outline, the fabric dither and the gloss. Colours come from `PAL` (`scripts/iso-art/lib/palette.ts`).
- The shapes are Habbo's: chunky, rounded where Habbo rounds (plastic shells, cushions, lamp shades), glossy plastic and lacquer, saturated colour, and a 1 px checker dither on upholstery.
- An item with footprint fw×fh is `(fw+fh)*16` px wide and its floor diamond touches the image's left, right and bottom edges.
- Electronics have an off and an on state. Screens glow `#7fe0c8` or `#5aa6e8` when on.

## The office

The default office (`scripts/iso-art/layout.ts`) is one Habbo room plan with themed areas, each with its own floor and colours: an open work area, the CTO's office, a lounge, a break corner with the coffee machine, a meeting room. Rooms are separated by glass partitions, the back walls carry wallpaper and wall items, plants and rugs break up the floor.

## Badges and bubbles

- Small sprites (9×9 for badges, 11×13 for bubbles), `webview-ui/src/office/sprites/status-*.json` and `bubble-*.json`, drawn in ink `#111111`. They float at the head: a badge beside it, a bubble above the crown.
- A **badge** is a filled state-colour plate with a white (`#ffffff`) glyph: ▶ working, ! needs approval, ? waiting for input, ✓ done, Z idle.
- A **bubble** is a white Habbo chat bubble with an ink outline and a tail pointing at the head, carrying the state colour in its glyph. The pet-petted heart bubble follows the same shape with its own pink (`#e64566`) glyph: it is a reaction, not a state indicator, so it sits outside the state-colour table.

## HUD

- **The HUD is Habbo's client.** Modals and notices are Habbo windows: a white body, an ink border, a coloured title bar with white title text and a close button, rounded 4 px corners. Tooltips, toasts and in-world labels are small white rounded tags with an ink border, like Habbo's name tags. Buttons are Habbo's: light grey with an ink border, green for a confirming action.
- **Font**: FS Pixel Sans, at the theme's pixel sizes. Habbo's own font is not used.
- **Shape**: 1 px or 2 px ink borders, small rounded corners, hard offset shadows (`2px 2px 0px`) with no blur, and no gradients.
- **Colours**: white, light grey, ink, the title bar blue `#2f80c0` and the state colours above. `npm run lint` enforces it: colour literals only in `constants.ts` and the CSS variables, pixel shadows, and the pixel font.

## References

Terrarium's own renders:

- [The default office](media/art-direction/office.png) at 1600×700 with twelve agents: five working, two needing approval, two waiting for input, three idle. This is the target state.
- [The office before this direction](media/art-direction/office-before.png), same scene and size, for comparison.
- [The twelve workers and the CTO](media/art-direction/characters.png), every frame of every sheet at 3×, one sheet per band (front, back and side rows).

Habbo Hotel on [habboassets.com](https://www.habboassets.com/), looked at for style, never copied:

- Figures: the [imager](https://www.habboassets.com/imager), for proportions (a 64×110 frame at the 64 px tile), the 3/4 head and the block body.
- Rooms: the [web promos](https://www.habboassets.com/images/webpromo), for the floor grid, the slab, the walls and how a furnished room reads.
- Outline and fabric: the [Silo sofa](https://www.habboassets.com/furniture/sofa_silo), [armchair](https://www.habboassets.com/furniture/sofachair_silo) and [chair](https://www.habboassets.com/furniture/chair_silo).
- Gloss and hard surfaces: the [Silo table](https://www.habboassets.com/furniture/table_silo_med) and the [Plasto chair](https://www.habboassets.com/furniture/chair_plasto).
- Plants: the [pineapple plant](https://www.habboassets.com/furniture/plant_pineapple).

## Checklist for new art

1. Generated by `scripts/iso-art/` or drawn procedurally. Regenerating reproduces the committed assets with no diff.
2. No Habbo asset, and nothing traced, sampled or fetched from habboassets.com or habbo.com.
3. Daylit from the upper left, shadows toward `#2c3446`, colours from the palette above.
4. Outlined in ink as the section above says for its kind, fabric dithered, plastic glossy.
5. Characters: every frame of `CHARACTER_FRAMES` in all three rows, feet at the bottom centre.
6. Furniture: the footprint anchor contract above, and a bump of the default layout `REVISION` when the layout changes.
