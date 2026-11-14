# Killer Fuse art

Hand-pixelled insects and arena at arcade scale in Fuse Riders' neon-on-navy palette, on a 480 × 270 canvas shown at an integer scale.

| Where                                                               | What                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `assets.ts`                                                         | Palette, every image-model prompt (`GENERATIONS`), and how each generated sheet is cut and animated |
| `arcade.ts`                                                         | Units and props pixelled by hand at arcade scale: units, berries, hives, eggs, gates, goal nets     |
| `procedural.ts`                                                     | The rest drawn in code: tiles, effects, HUD strip, banners                                          |
| `pixel.ts`                                                          | Dependency-free image tools (PNG codec, chroma key, grid detection, palette, outline)               |
| `raw/`                                                              | Generated sheets after `cut`: real pixels on the shared palette, team colour in neutral green       |
| `raw-full/`                                                         | The model's original 1–1.5 MB images; not committed                                                 |
| `preview/`                                                          | `contact-sheet.png`, `mock-scene.png`, `mock-victory.png`, for reviewing                            |
| `../public/killer-fuse/art/`                                        | What ships: the sheets and `manifest.json`                                                          |
| [`scripts/killer-fuse-art.ts`](../../../scripts/killer-fuse-art.ts) | The pipeline                                                                                        |

## Regenerating

```sh
# 1. Ask the image model for sheets (skips ones already in raw-full/; name ids to redo them).
OPENAI_API_KEY=... pnpm exec tsx scripts/killer-fuse-art.ts generate [worker queen snail bg-far bg-mid bg-near logo cover]
# 2. Turn them into real pixels in raw/.
pnpm exec tsx scripts/killer-fuse-art.ts cut [id...]
# 3. Build the shipped sheets, the manifest and the previews. Needs no key: run this after editing arcade.ts, procedural.ts or assets.ts.
pnpm exec tsx scripts/killer-fuse-art.ts build
```

Never write the API key to a file or commit it. Only the snail, the backgrounds, the logo and the cover are generated art now. `worker` and `queen` are still in `GENERATIONS` because `snail` is generated as an edit of `raw-full/worker.png` and `cover` as an edit of `raw-full/queen.png`, so generate those first.

After a regeneration, look at `preview/contact-sheet.png` and `preview/mock-scene.png` before committing: the model does not draw the same sheet twice, and `cut` fails loudly when it finds a different number of drawings than `CUTS` expects.

## Pipeline

1. **Generate.** `gpt-image-2` (falling back to `gpt-image-1.5`), high quality. The models' transparent background either is not supported or eats dark shapes, so every sheet is drawn on a flat magenta key (`#ff00ff`; the logo on green), and the team-coloured parts are painted pure green.
2. **Cut.** Key out the background, find each drawing, measure the grid its soft "pixels" sit on (the model draws blocks of 7–13 screen pixels), sample one colour per block, remove specks, and map every colour to the shared palette; greens become a four-step neutral team ramp. Backgrounds are cropped to 16:9, area-averaged to 480 × 270 and mapped to a dark palette per layer; the cover is averaged to 256 × 256 and reduced to 40 colours.
3. **Build.**
   - Units come from `arcade.ts`: each frame is a head, a torso and a pair of legs written as rows of letters, plus a wing pose and a sword grip, drawn in a stand-in green. The build recolours them per team and adds a one-pixel dark outline.
   - Speed workers and speed warriors are the same frames with gold antennae or horns, gold boots and a gold outline around the body.
   - Every unit form also gets a white `-flash` sheet with the same layout, for the invulnerability flash described in the manifest's `invulnerable` note.
   - Carry frames put the berry on the worker's back at mid torso, so the sprite is no taller; the manifest also gives the spot.
   - The snail is the one generated character: reduced to three quarters, aligned by its shell; its `eat` frame is recoloured with a red head and claws, and the manifest gives `saddle` (the rider's soles) and `mouth`.
   - Gates have six states (neutral, cyan, pink, and each in use, with the berry in the socket and the doorway lit). `gate-emerge-*` is the new warrior rising out of the top of a gate.
   - A hive is a flat wall per map size (`day`, `dusk`, `night`) with twelve holes. Until the engine exports each map's hole points the build uses one layout (`HIVE_HOLES`); Pink's is Cyan's mirrored. The manifest gives each hole's centre relative to the hive's anchor.
   - `manifest.json` lists every sheet: frame size, frame count, frame names, anchor, animations, and extras (hive holes, pile slots, saddle, mouth and carry spots).

## Poses

Poses and proportions follow footage of the arcade original; the pixels are our own.

- **Queen.** Flying: slim body, a crest swept back from the head in the team colour, thin legs trailing, two pairs of wings, the sword level at the waist pointing forward. Diving: a column 7 wide, wings folded up the back, the sword straight down with its tip 4 pixels under the feet. On the ground the sword rests forward and down.
- **Warrior.** Horned helmet, small wings. Standing and walking, the sword points diagonally up and forward; flying, straight forward. Warriors do not dive.
- **Worker.** Upright, a dark visor with two eyes; standing still its hands are on its hips.
- **Gate.** The worker goes into the dark doorway and is not drawn; the warrior comes out of the top sword first (`gate-emerge-*`, half a second).
- **Kill.** No fireball: `kill-burst-*` is 44 specks of one or two pixels in the victim's colour, flung about 40 pixels.

## Sizes

Art pixels, including the one-pixel outline. Anchors are in the manifest; units and props stand on their anchor.

| Asset                           | Cell                      | Drawn size, about                             |
| ------------------------------- | ------------------------- | --------------------------------------------- |
| Worker, speed worker            | 14 × 14                   | 8 × 13; 11 wide with a berry on its back      |
| Warrior, speed warrior          | 19 × 18                   | body 10 × 17, 17 across with wings and sword  |
| Queen                           | 23 × 24                   | body 9 × 18, 22 across with wings and sword   |
| Snail                           | 40 × 20                   | 29–37 × 17                                    |
| Gates                           | 35 × 28                   | pillars 21 × 13; wings 31 across; 24–27 tall  |
| Gate emerge (6 frames)          | 35 × 40                   |                                               |
| Hive: day, dusk, night          | 54 × 54, 59 × 79, 86 × 55 | the bottom row is empty: it is the anchor row |
| Hive hole                       | 5 × 5                     |                                               |
| Egg                             | 10 × 16                   |                                               |
| Berry                           | 5 × 5                     |                                               |
| Berry pile (frames 0 to 6)      | 27 × 18                   | leaf 25 wide, berries 15 × 13                 |
| Goal net                        | 29 × 19                   |                                               |
| Tiles                           | 8 × 8                     | ground 5 rows drawn, platform 7               |
| Kill burst (6)                  | 84 × 84                   |                                               |
| Queen death (8)                 | 100 × 100                 |                                               |
| Respawn (7)                     | 14 × 24                   |                                               |
| Transform overlay (4)           | 14 × 14                   |                                               |
| Banner                          | 232 × 44                  |                                               |
| Snail strip, snail marker (HUD) | 200 × 7, 9 × 7            |                                               |
| Logo                            | 106 × 60                  | draw at 2×                                    |
| Backgrounds                     | 480 × 270                 |                                               |
| Cover                           | 512 × 512                 | 256 × 256 at 2×                               |

A unit's anchor is under its feet. The Queen's is at [11, 18], five rows above the cell's bottom: those rows hold only her diving sword.

## Prompts

All prompts live in `assets.ts` (`GENERATIONS`, built from the shared fragments above it), so the text that made each image is the text in the repository.

## Licence

The images were generated with OpenAI image models (`gpt-image-2`) from the prompts in `assets.ts` and processed by the code here (the snail, backgrounds, logo and cover); everything else is drawn by that code. The designs are original to Killer Fuse: no sprites, logos or characters were copied from Killer Queen or any other game.
