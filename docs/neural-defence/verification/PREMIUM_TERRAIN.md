# RTS presentation and terrain verification — 2026-09-25

The v4 generated background suggested cliffs on open cells. It was replaced with flat traversable moss/earth, and the renderer now selects obstacle art exclusively from authoritative terrain categories. Unknown/mismatched variants cannot turn open ground into an apparent rock or hide a blocked tile. Obstacle/resource images and shadows are clipped to their cell. The minimap uses complete hex footprints from the same map data. Simulation and map topology are unchanged.

## Local evidence

- `pnpm test`: **1,681 passed**.
- `pnpm typecheck` and `pnpm build`: passed; Vite retains its existing large-chunk advisory.
- `scripts/neural-defence-ui-smoke.ts`: Chromium and WebKit passed desktop, portrait, narrow phone and short landscape command geometry; pages, ghosts, progress, disabled help, wheel zoom and drag. Chromium also passed trusted multi-touch pinch/pan.
- `scripts/neural-defence-terrain-smoke.ts`: Chromium and WebKit verified every sandbox tile against the loaded map, hovered a real visible rock to get an invalid ghost, clicked it without queuing construction, and navigated using the minimap.
- `scripts/neural-defence-finish-smoke.ts`: Chromium and WebKit passed the normal-time defeat, short-landscape result layout and immediate rematch. The test disables only the dev reload socket in its offline browser; an earlier run during source edits timed out. Play again restores both brains without an extra confirmation.
- `scripts/neural-defence-network-smoke.ts`: Chromium and WebKit passed actual timed auto-expansion, links, moving supply, neuron variation/animation and reduced motion at desktop and phone sizes during this polish pass. Final floor replacement does not alter those rules.
- Presentation regression checks cover missing obstacle assets, category-mismatched variants, deposit identity, clipping, shared building art, minimap cell round-trips and event cue deduplication.

## Review

Independent review found that suspending audio on mute preserved scheduled voices. The fix cancels/disconnects every active voice before suspension and disposal. `scripts/neural-defence-audio-smoke.ts` uses native AudioContext with browser output muted: four active victory oscillators, zero after mute, and zero after unmute/dispose. It also checks zero-volume cancellation and forced mute. This checks resource lifecycle, not perceived sound quality. No further terrain or minimap lifecycle findings were reported.

## Limits

Phone evidence is browser emulation, not physical hardware. The reference art quality remains a user-facing acceptance question; test success is not proof of visual equivalence. No production deployment or merge is included.

## Anatomy and selection follow-up

The follow-up replaces rotation-only neuron variation with three distinct illustrated anatomies, shared by live units, ghosts and portraits. It also fixes clicking a tall building's upper body selecting the terrain behind it. Placement still targets terrain. Independent review found no actionable regression.

Full suite: **1,682 passed**. Typecheck/build, focused lint and 21 focused presentation/UI tests passed. Chromium and WebKit passed the body-versus-ground pointer regression, all three image forms in the live combat lab, and normal-time expansion/supply/reduced-motion checks at desktop and phone sizes. [Assets and exact prompts](../art/NEURON_FORMS.md).

## Full roster and supply readability

`scripts/neural-defence-roster-smoke.ts` passed in Chromium and WebKit using normal game time and ordinary commands, without injected resources or world state. It expands to both resources, researches all five technologies, constructs Pulse/Siege/Relay, checks matching ghosts and portraits, selects unlocked particle profiles, and supplies each tower. Desktop and phone captures are saved as `premium/roster-desktop.png` and `premium/roster-phone.png`. The phone capture uses an emulated viewport and camera keyboard navigation; it is not additional touch-device evidence.

That flow exposed overlapping arrival rings obscuring towers. Arrivals now coalesce per destination and render as brief, faint ground pulses beneath buildings. Regression coverage checks packet coalescing, layer order and reduced-motion cleanup. Independent review found no actionable issues.

Latest full suite: **1,683 passed**. Build and focused ESLint passed; both browser roster runs passed again after the effect correction.

## Building status readability

A second visual audit distinguished persistent supply halos from arrival pulses: those halos still covered the illustrated bodies. Stock now appears as a faint ellipse beneath the building, while moving particles and orbit dots remain. Damage bars use the same building height as the artwork and sit above it instead of crossing tower cores.

Chromium and WebKit passed actual damaged-tower geometry, ground-marker paint order, selection/placement and the normal-time full roster again. Updated desktop/phone roster captures show supplied buildings without body-covering rings. The review caught a Linkedom SVG parsing assumption in the regression test; the test now checks document paint order, supplemented by direct sibling-order assertions in both browsers. No product regression was found. Latest full suite: **1,684 passed**; build and focused lint passed.

## Final ground material

The v6 floor replaces blurred moss/earth with flush slate, fine gravel and low moss. It is composited at 65% opacity to retain surface detail without competing with units. Raised blockers still come exclusively from authoritative terrain cells. Independent visual/code review accepted the new material and its reduced contrast on desktop and phone, with no actionable findings. Repetition is still possible in the continuous material; it adds no collision features.

Final checks: **1,684 tests passed**, build and focused ESLint passed. Chromium and WebKit passed the full UI flow, desktop/portrait/short-landscape layouts, wheel/drag, command pages, placement, help, auto-expansion and terrain rejection; Chromium also passed trusted pinch/pan. The UI smoke's old brain selection targeted the terrain behind the new raised body hit region; it now clicks the actual building hit region, while illegal terrain-placement checks remain intact.

`premium/desktop.png`, `premium/phone.png`, `premium/landscape.png` and `premium/neuron-forms-phone.png` now show v6 in real menu-to-game flows. Earlier roster/result images document their respective completed flows before this material-only update. Normal-time browser finish evidence is defeat/rematch, not a normal-time player victory; outcome rules and victory UI also have automated tests. Physical phones, production deployment and online multiplayer UI are not claimed.

The final requirements audit found no missing functional item in the agreed local game scope: command grid/categories/shortcuts, gesture camera, continuous ground, map-accurate blockers, placement ghosts and progress, unpaid plans and connected support, persistent auto-expansion, catalog-driven research help, varied connected animated neurons, local skirmish loop and current tech-tree documentation all have implementation and verification evidence. Rendered images establish the delivered appearance; automated checks do not establish equivalence to the reference game's graphics.
