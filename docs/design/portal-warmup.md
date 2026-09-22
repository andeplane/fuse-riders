# Portal warning and remaining lifetime

Portal pickups show both gates for 1.5 seconds before they can teleport anything. Dashed, translucent
gates labelled FORMING become solid at activation. Riders, shells and gun shots pass through forming
gates normally. A rider already overlapping a gate at activation can leave without being teleported.

The existing ten-second active lifetime starts after the warning. A small bar above each gate counts
down that active lifetime; the gate stays fully visible until expiry. Bars stay upright in portrait.
Shrinking arena walls and the three-pair cap can still remove a pair early, as before.

The engine derives activation from expiry minus `PORTAL_LIFETIME_TICKS`; new pairs expire after
`PORTAL_WARMUP_TICKS + PORTAL_LIFETIME_TICKS`. Both constants live in
[`portal.ts`](../../games/fuse-riders/src/engine/portal.ts). There is no additional timer or checkpoint
field. Checkpoints reject remaining durations longer than that total. Placement reserves forming
gates, while transit exit safety ignores them. Shared transit detection applies the same timing to
riders, shells and guns. Rendering receives these durations through `WorldView.rules`.

This changes simulation behavior and requires `fuse-p2p-54` peers; the golden recording is refreshed
with the rule change. The duration is game time and follows the existing acceleration when only AI
riders remain alive.

Verification: `pnpm exec tsx scripts/portal-browser.ts` checks the forming silhouette, both lifetime
bars, full active opacity and expiry on WebGL and Canvas. `BROWSER=webkit` selects WebKit.
The real solo flow is captured in [this screenshot](../online/ui-evidence/portal-warmup/solo.png).
To playtest, open solo play, choose ROOM SETTINGS → CONFIGURE POWERUPS → NO POWER-UPS, enable
PORTAL, then BACK TO LOBBY → START RACE. Settings save automatically. This makes every pickup a portal without changing
their placement or timing.
