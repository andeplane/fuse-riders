# Fuse Drivers cleanup browser evidence

Captured on 2026-10-14 from the individual Drivers PR build at source `c9bbdceb`, after integrating main `bdd0c792`, served by `service/dev.ts` at `http://localhost:4923/`. Chrome screenshots use a 1440 × 900 desktop viewport; the same smoke also exercised a 390 × 844 phone emulation.

Command: `ONLINE_URL=http://localhost:4923/ pnpm exec tsx scripts/fuse-drivers-smoke.ts`.

The smoke reached Drivers through the gallery and app portal, started solo, created a shared-screen room, seated two peers, opened the TV display, started the race and recovered the phone's existing seat after reload. Recovery kept the name form hidden and retained one roster row for that driver. It waited for Phaser readiness and checked that solo and TV arenas occupy more than 60% of viewport width and stay inside the viewport. Phone controllers hide the arena and the TV hides the controller pad. No page errors occurred.

- [Solo arena](cleanup-solo.png): arena, HUD and controls fit together after fixing the grid rows and giving Phaser a dedicated sizing box.
- [Shared TV arena](cleanup-display.png): the full arena fills the display instead of shrinking into the corner.

All captures use actual play and unaccelerated game clocks. An earlier local run timed out waiting for the shared-room HUD; its diagnostic rerun and this final run passed. These checks establish local Chrome behavior and browser emulation, not physical-phone, cross-network or subjective gameplay acceptance.
