# FuseOS game icons

One Windows-98-style desktop icon per portal game: `<id>.png` is 64×64 (drawn at 32 px on the desktop and at the top
of the Start menu), `<id>-16.png` is 32×32 (title bars, taskbar buttons, submenus). Both are transparent RGBA PNGs
with a uniform 1 px dark outline added around the art; `tests/fuseos-game-icons.test.ts` checks that every
`games/<id>/portal.json` has both files.

## From the games' own art (cropped, scaled and outlined, 2026-11-14)

| Icon          | Source                                                   |
| ------------- | -------------------------------------------------------- |
| elasto-fuse   | `public/games/elasto-fuse/art/v1/head.png` (the helmet)  |
| fuse-drivers  | `public/fuse-drivers/assets/truck-orange.png`            |
| fuse-lane     | `public/fuse-lane/avatars/fox-portrait.png`              |
| fuse-volley   | `public/games/fuse-volley/art/v1/ball.png`               |
| hook-havok    | `games/hook-havok/art-source/props/brass-hook-source.png` |

## Generated with GPT Image (`gpt-image-2`, 1024×1024, medium quality, 2026-11-14)

The other games draw their sprites in code, so their icons were generated with each game's gallery capture or sprite
sheet as the reference image, then keyed from the painted checkerboard and scaled like the ones above. Shared prompt
suffix: "Windows 98 style desktop application icon, matching the attached game art. One single clear object,
centered, slight three-quarter perspective, crisp 1px dark outline, simple flat cel shading with a few bold colours,
chunky pixel-art feel, no text, no letters, no frame, no background scene, fully transparent background, readable
when shrunk to 32 pixels."

| Icon            | Reference                                       | Subject                                        |
| --------------- | ----------------------------------------------- | ---------------------------------------------- |
| ball-bros       | `public/gallery/ball-bros.jpg`                  | cyan core sphere with an orbital paddle        |
| fuse-axe        | `games/fuse-axe/docs/images/hero-riders.png`    | the hero's double-bladed battle axe            |
| fuse-birds      | `public/gallery/fuse-birds.jpg`                 | a round cyan bird in a slingshot               |
| fuse-bombers    | `games/fuse-bombers/docs/images/gunships.png`   | an orange gunship firing a rocket              |
| fuse-choppers   | `public/gallery/fuse-choppers.jpg`              | a lime helicopter gunship                      |
| fuse-craft      | `games/fuse-craft/src/assets/brain-v3.png`      | a glowing blue brain in a bone-white cradle    |
| fuse-freight    | `public/gallery/fuse-freight.jpg`               | a yellow locomotive pulling one wagon          |
| fuse-front      | `games/fuse-front/docs/images/robots-heroes.png`| a yellow battle robot holding a flag           |
| fuse-riders     | `public/gallery/fuse-riders.jpg`                | a cyan light-cycle rider with a magenta trail  |
| fuseball        | `public/gallery/fuseball.jpg`                   | a neon yellow ball with a rocket flame         |
| graveyard-shift | `public/gallery/graveyard-shift.jpg`            | a mint ghost pulled into a vacuum nozzle       |
| fusemania       | `public/gallery/fusemania.jpg`                  | a magenta rhythm arrow with a cyan music note  |
| killer-fuse     | `games/killer-fuse/public/killer-fuse/art/cover.png` | the crowned cyan queen bee with her spear |
