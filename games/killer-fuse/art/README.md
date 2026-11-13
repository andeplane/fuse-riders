# Killer Fuse art

Chunky pixel-art insects and a hand-pixelled arena in Fuse Riders' neon-on-navy palette, on a 480 × 270 canvas shown at an integer scale.

| Where                                                               | What                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `assets.ts`                                                         | Palette, every image-model prompt (`GENERATIONS`), and how each generated sheet is cut and animated |
| `procedural.ts`                                                     | Everything drawn by hand in code: hives, berries, tiles, goal posts, eggs, effects, banners         |
| `pixel.ts`                                                          | Dependency-free image tools (PNG codec, chroma key, grid detection, palette, outline)               |
| `raw/`                                                              | Generated sheets after `cut`: real pixels on the shared palette, team colour in neutral green       |
| `raw-full/`                                                         | The model's original 1–1.5 MB images; not committed                                                 |
| `preview/`                                                          | `contact-sheet.png`, `mock-scene.png`, `mock-victory.png`, for reviewing                            |
| `../public/killer-fuse/art/`                                        | What ships: the sheets and `manifest.json`                                                          |
| [`scripts/killer-fuse-art.ts`](../../../scripts/killer-fuse-art.ts) | The pipeline                                                                                        |

## Regenerating

```sh
# 1. Ask the image model for sheets (skips ones already in raw-full/; name ids to redo them).
OPENAI_API_KEY=... pnpm exec tsx scripts/killer-fuse-art.ts generate [worker queen snail gates bg-far bg-mid bg-near logo cover]
# 2. Turn them into real pixels in raw/.
pnpm exec tsx scripts/killer-fuse-art.ts cut [id...]
# 3. Build the shipped sheets, the manifest and the previews. Needs no key: run this after editing procedural.ts or assets.ts.
pnpm exec tsx scripts/killer-fuse-art.ts build
```

Never write the API key to a file or commit it. `queen`, `snail` and `gates` are generated as edits of `raw-full/worker.png`, and `cover` as an edit of `raw-full/queen.png` (the Queen portrait, now used only for that), so generate those first. That reference is what keeps the family in one style.

After a regeneration, look at `preview/contact-sheet.png` and `preview/mock-scene.png` before committing: the model does not draw the same sheet twice, and `cut` fails loudly when it finds a different number of drawings than `CUTS` expects.

## Pipeline

1. **Generate.** `gpt-image-2` (falling back to `gpt-image-1.5`), high quality. The models' transparent background either is not supported or eats dark shapes, so every sheet is drawn on a flat magenta key (`#ff00ff`; the logo on green), and the team-coloured parts are painted pure green.
2. **Cut.** Key out the background, find each drawing, measure the grid its soft "pixels" sit on (the model draws blocks of 7–13 screen pixels), sample one colour per block, remove specks, and map every colour to the shared palette; greens become a four-step neutral team ramp. Backgrounds are cropped to 16:9, area-averaged to 480 × 270 and mapped to a dark palette per layer; the cover is averaged to 256 × 256 and reduced to 40 colours.
3. **Build.**
   - Units are halved (the model draws them at about twice the game's size whatever it is told) by majority vote per 2 × 2 block, with the block alignment that keeps features whole; pupils are protected or restored so no frame loses its eye.
   - Frames are aligned in equal cells: standing frames by their soles, flying frames by the body's centre, the snail by its shell.
   - The green ramp is replaced by each team's ramp (cyan, pink; neutral for unowned gates), then a one-pixel dark outline is added.
   - Warriors are built in code from the worker's frames (`WARRIOR` in `assets.ts`): the antennae become a horn, a dark brow is added, wings are drawn behind the body in one of five poses, and a white lance with a gold guard points forward. Only the wings change between the three flap frames.
   - Speed workers and speed warriors are derived from the same frames (a helmet with a gold crest over a team-coloured lower half, a gold lightning-bolt antenna, gold boots, a gold scarf, a gold outline around the team-coloured body, a forward lean on moving frames, gold speed dashes), so they stay the same character.
   - Every unit form also gets a white `-flash` sheet with the same layout, for the invulnerability flash described in the manifest's `invulnerable` note.
   - The `transform` overlay (a worker changing inside a gate) is made from the worker's idle silhouette.
   - Carry frames add the carried berry over the worker's head; the manifest also gives the spot per frame.
   - Gates get their six states (neutral, cyan, pink, and each "in use" with the doorway lit).
   - The hive is drawn around the engine's hole positions, which the build reads from `src/engine/maps.ts`: it fails if the maps' hives stop sharing one layout. Pink's hive is Cyan's mirrored. The manifest gives each hole's centre relative to the hive's anchor.
   - Hand-pixelled sheets come straight from `procedural.ts`.
   - `manifest.json` lists every sheet: frame size, frame count, frame names, anchor, animations, and extras (hive hole positions, pile slots, saddle and carry spots).

## Sizes

Art pixels, including the one-pixel outline. Anchors are in the manifest; units and props stand on their anchor.

| Asset                  | Cell      | Drawn size, about  |
| ---------------------- | --------- | ------------------ |
| Worker, speed worker   | 24 × 28   | 14 × 18            |
| Warrior, speed warrior | 44 × 42   | 34 × 20 with lance |
| Queen                  | 48 × 34   | 14 × 19 plus wings |
| Snail                  | 40 × 20   | 29–37 × 17         |
| Gates                  | 23 × 29   | 23 × 29            |
| Hive (holes 11 × 11)   | 81 × 40   |                    |
| Berry                  | 8 × 8     | 6 × 6              |
| Tiles                  | 8 × 8     |                    |
| Goal post              | 18 × 42   |                    |
| Kill burst (8 frames)  | 48 × 48   |                    |
| Queen death (10)       | 64 × 64   |                    |
| Respawn (7)            | 24 × 36   |                    |
| Transform overlay (4)  | 24 × 28   |                    |
| Banner                 | 232 × 44  |                    |
| Snail strip (HUD)      | 200 × 7   |                    |
| Snail marker (HUD)     | 9 × 7     |                    |
| Logo                   | 106 × 60  | draw at 2×         |
| Backgrounds            | 480 × 270 |                    |
| Cover                  | 512 × 512 | 256 × 256 at 2×    |

The warrior's anchor is its feet at [22, 33], eight rows above the cell's bottom, which leaves room for the down-stroke wing. The Queen is built in code from the worker's frames, like the warriors (`queenOf`): the worker's body with a gold crown, a striped abdomen, two pairs of wings larger than a warrior's and a long gold stinger, so she is about 1.3 times a worker's height and has the same pixel density. Her anchor is her feet at [24, 25], eight rows above the cell's bottom. The snail is the generated drawing at three quarters of its size (`grow: 3`, `reduce: 4`) and the gates are reduced by 3 with two pillar rows taken out, to match the proportions of the arcade original: a gate is about two workers tall and the snail about two and a half workers long.

## Prompts

All prompts live in `assets.ts` (`GENERATIONS`, built from the shared fragments above it), so the text that made each image is the text in the repository.

## Licence

The images were generated with OpenAI image models (`gpt-image-2`) from the prompts in `assets.ts` and processed by the code here; the rest is drawn by that code. The designs are original to Killer Fuse: no sprites, logos or characters were copied from Killer Queen or any other game.
