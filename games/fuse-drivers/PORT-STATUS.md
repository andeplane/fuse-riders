# Fuse Drivers port status

The port replaces the original standalone simulation server with the shared Fuse input log. src/game owns racing rules, deterministic simulation and validated checkpoints; src/app owns the runtime adapter, shared menus and Phaser arena. The game is served at /fuse-drivers/ and appears in the shared app portal.

The focused suite covers rules, golden replay consistency, checkpoint corruption rejection, mesh impairment/recovery, real runtime control release, platform reporting, presenter/session behavior and arena helpers. See docs/design/fuse-drivers-port.md for the 30 Hz simulation over the 20 Hz log and its tradeoffs.

Product metrics use fuse-ui/play-metrics from actual runtime state, with the stable fuse-drivers game id. Browser composition and Phaser adapters are exempt from Node coverage and require the real browser smoke: ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/fuse-drivers-smoke.ts.

Production rooms require EXTRA_GAME_IDS to include fuse-drivers; this file does not assert that production is configured or deployed. The original repository, Pages site and standalone Cloud Run service require a separate deliberate cleanup after the monorepo deployment is verified.

Known presentation gaps: rollback does not replay the old event-only EMP shockwave or hit shake. Headless mesh and browser emulation do not establish physical-phone or cross-network behavior.
