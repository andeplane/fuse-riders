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
