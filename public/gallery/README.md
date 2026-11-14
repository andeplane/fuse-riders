# Gallery captures

These JPEGs are resized copies of existing browser gameplay captures in the repository, rather than concept art. They illustrate the games and are not evidence of the current deployment. Images are limited to 1200 pixels wide (JPEG quality 84) to keep the catalog light.

| Image             | Source                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| fuse-riders.jpg   | docs/gameplay-phaser.png                                                     |
| fuse-drivers.jpg  | docs/online/ui-evidence/fuse-drivers/cleanup-solo.png                        |
| fuse-axe.jpg      | games/fuse-axe/docs/images/app-play-bots.png                                 |
| fuse-bombers.jpg  | games/fuse-bombers/docs/images/online-round.png                              |
| fuse-choppers.jpg | games/fuse-choppers/docs/evidence/cave-mid-round.png                         |
| fuse-craft.jpg    | docs/fuse-craft/verification/organic-light-2026-09-30/lit-desktop-battle.png |
| fuse-freight.jpg  | games/fuse-freight/docs/evidence/mid-round.png                               |
| fuse-lane.jpg     | games/fuse-lane/docs/screenshots/desktop-week.png                            |
| hook-havok.jpg    | games/hook-havok/docs/evidence/art-production-pull.png                       |

The images below are captured from real play by `scripts/gallery-capture.ts`, which drives each game's own menus into a solo or bot match in a 1200×750 browser and saves the frame:

```sh
pnpm build
pnpm gallery:capture             # every game with a recipe
pnpm gallery:capture fuseball    # only this one
```

| Image               | Recipe            |
| ------------------- | ----------------- |
| ball-bros.jpg       | `ball-bros`       |
| fuse-birds.jpg      | `fuse-birds`      |
| fuse-front.jpg      | `fuse-front`      |
| fuseball.jpg        | `fuseball`        |
| graveyard-shift.jpg | `graveyard-shift` |

Every game on the portal needs an image: `tests/gallery-screenshots.test.ts` fails for a `portal.json` without a `screenshot`, or one that names a missing file. For a new game, add a recipe to `scripts/gallery-capture.ts`, run `pnpm gallery:capture <id>`, look at the result, and set `screenshot` to `gallery/<id>.jpg` in the game's `portal.json`. To refresh one of the copied images above from live play, add a recipe for it the same way.
