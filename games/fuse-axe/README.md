# Fuse Axe

A co-op pixel-art beat-em-up for 1–5 heroes in the spirit of Golden Axe II. Work in progress: see
[`docs/design.md`](docs/design.md) for the game and the delivery plan, and
[`docs/concept-art.html`](docs/concept-art.html) (open it in a browser) for the concept art.

## Play it

Open `/fuse-axe/` on a running service, or pick **Fuse Axe** from the app portal (the dot grid at the top left of
every game). **PLAY SOLO** opens the hero picker; **CREATE ROOM** makes a room to share by code, link or QR code,
where everyone picks a hero (duplicates are allowed) and the host presses **START**. So far the heroes walk and jump
through a placeholder scene of boxes; combat, the pixel-art renderer, phone pads and the shared screen follow.

| Keys          | Does                                |
| ------------- | ----------------------------------- |
| Arrows / WASD | Walk the road, up and down in depth |
| J / Z         | Attack                              |
| K / X         | Jump                                |
| L / C         | Magic                               |

```sh
pnpm build && pnpm exec tsx service/dev.ts   # then open http://localhost:8787/fuse-axe/?mute
pnpm exec tsx --test games/fuse-axe/tests/*.test.ts
node games/fuse-axe/preview/smoke.mjs http://localhost:8787/ [screenshot-dir]   # by hand, against the service
```

Production serves Fuse Axe rooms only once `EXTRA_GAME_IDS` names `fuse-axe` ([GCP deploy](../../docs/online/GCP-DEPLOY.md));
until then the page offers solo only.
