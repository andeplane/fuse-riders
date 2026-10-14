# Rules-8 construction-loss recording

`combat.replay.json` records ordinary Balanced versus Pressure commands on
Synaptic Reach through the first paid-site loss, tick 4640 (232 seconds), using
the rules-8 engine introduced with this artifact. No instant settings or resource
injection. Replaying from its initial checkpoint reproduces hash `20f8e061`.
Beta has one site loss and two completed-building losses; Alpha has zero and
four respectively. This is a diagnostic excerpt, not a completed balance match.

With the source preview running on port 5174:

```sh
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/construction-losses-2026-09-27/combat.replay.json /tmp/fuse-sites-effects site
```

The harness verifies the full recording, then renders the actual destroyed site
at 80, 240 and 650 ms in Chromium and WebKit, desktop and phone viewports.
`site-phone.png` is Chromium at 240 ms. These are diagnostic renderings of real
combat, not an ordinary menu-flow screenshot or physical-phone evidence.
