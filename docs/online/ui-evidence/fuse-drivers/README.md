# Fuse Drivers cleanup browser evidence

Captured on 2026-10-14 from the real combined build at source `236c043c`, served by `service/dev.ts` at `http://127.0.0.1:4917/`. Chrome screenshots use a 1440 × 900 desktop viewport; the same smoke also exercised a 390 × 844 phone emulation.

Command: `ONLINE_URL=http://127.0.0.1:4917/ pnpm exec tsx scripts/fuse-drivers-smoke.ts`.

The smoke reached Drivers through the app portal, started solo, created a shared-screen room, seated two peers, opened the TV display, started the race and recovered the phone's existing seat after reload. It waited for Phaser readiness and checked that solo and TV arenas occupy more than 60% of viewport width and stay inside the viewport. Phone controllers hide the arena and the TV hides the controller pad. No page errors occurred.

- [Solo arena](cleanup-solo.png): arena, HUD and controls fit together after fixing the grid rows and giving Phaser a dedicated sizing box.
- [Shared TV arena](cleanup-display.png): the full arena fills the display instead of shrinking into the corner.

All captures use actual play and unaccelerated game clocks. Before captures remain in ignored `artifacts/fuse-drivers-before/`. These checks establish local Chrome behavior and browser emulation, not physical-phone, cross-network or subjective gameplay acceptance.
