# Hook Havok browser evidence — 2026-10-14

## Current cancellation contract

At source `13a45aaf`, `TEST_CONCURRENCY=2 pnpm test:coverage` completed with 3,707 tests passing, no failures or skips, and all five current browser-manifest flows passing. The final combined report was 97.36% lines/statements, 95.41% branches and 97.32% functions. Native Chromium ranges were collected against the exact Vite source; no earlier probe or cross-worktree maps were reused, and no coverage thresholds or exemptions changed.

Hook's own `tests/browser-coverage-flow.ts` selected Neon Spire through the real room controls, checked the current keyboard/right-click guide and restored arena focus after the menu. It then charged K, opened the menu, observed the charge drop without increasing the local keeper's persistent throw tally, resumed play and verified that ordinary K release increased the tally once. Browser output and the page were muted; there were no page errors. [Current real-flow screenshot](rules17-menu-cancel.png).

This uses `hook-havok-17`: lifecycle/pointer cancellation is a validated, scope-bound log edge distinct from release. Pre-17 input/checkpoint shapes are refused. The following screenshots and broader gameplay checks are retained evidence from the earlier combined Rule16 client.

## Earlier combined gameplay evidence

These screenshots come from actual rooms served by the compiled combined client at `http://localhost:4917/`, source commit `236c043c6d0ae704e14bd3da8cfcf29d83a6f75c`, using `hook-havok-16`. The browser used ordinary menus, keyboard, mouse and emulated touch input; no game state or clocks were injected. All audio was muted by the URL.

Both commands completed successfully, without browser page errors:

```sh
node games/hook-havok/preview/bombs-check.mjs http://localhost:4917/ docs/online/ui-evidence/hook-havok
node games/hook-havok/preview/integration-check.mjs http://localhost:4917/ docs/online/ui-evidence/hook-havok
```

The bomb smoke verified short and full throws, cooldown and the charge arc; self-knockout, fuse ring, blast, feed and protected return; diagonal release aim; right-click throws without a context menu or hook; touch charging and release; and no sideways scroll or overlapping arena/control boxes at 360 × 740 and 740 × 360. Its six `bombs-*.png` screenshots retain that real flow.

The integration smoke selected Neon Spire through Room & match, verified its 19 surfaces and four seeded pads, added two bots through the menu, verified their roster badges and movement, and saved `spire-bots-menu.png` and `spire-bots-arena.png`. It then removed the bots through the menu, selected Bombs off in the Development workshop, and used ordinary movement and Down + Space to reach the lower deck and collect the left pad. That run collected Triple jump and verified the visible power chip's kind and accessible label; `spire-power-pickup.png` shows the pickup and menus together.

The arena, menu, charge-arc and pickup screenshots were visually inspected. This is desktop Chrome and emulated touch evidence. Physical phones/TVs, unmuted sound, bot balance, sustained network impairment, every power's browser behavior, and a complete timed Spire round were not checked here.
