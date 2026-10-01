# Artillery impact depth

Siege hits now have a distinct 680 ms impact plume after their 180 ms cosmetic
flight: five ground dust puffs, three rising smoke puffs and four embers.
The twelve nodes are allocated once per effect, animated from absolute age and
removed by the existing effect lifetime. The 48-effect limit, reduced-motion
suppression and authoritative simulation remain unchanged.

The renderer smoke uses the existing real-command rules-9 combat recording,
verifies its final hash `67aef741`, and inspects launch/arrival/impact ages in
Chromium and WebKit on desktop and emulated-phone viewports. The screenshots are
diagnostic views of that replay, not normal UI screenshots. A separate normal UI
smoke exercises menu entry, camera, panels and phone layouts.

Validation: 1,748 repository tests pass; after the final color/height adjustment,
15 focused presentation tests, typecheck, lint, build and both replay-browser
checks pass. Review found no blocking timing, cleanup or state-mutation issues.

Visual inspection found an existing WebKit issue: CSS filters on SVG groups do
not tint enemy art or blacken cast shadows. The phone image records that defect;
it is separate from the plume and is corrected by the subsequent native-SVG
filter change documented in `../native-svg-filters-2026-09-27/`.
Human visual acceptance and physical-phone testing remain outstanding.
