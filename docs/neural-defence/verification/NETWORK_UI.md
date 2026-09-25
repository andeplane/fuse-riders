# Network and command refresh — 2026-09-25

The procedural neuron artwork recorded below was subsequently rejected in playtesting and replaced by the [battlefield art correction](../art/BATTLEFIELD_V3.md). The command layout and connectivity behavior remain.

The main command row is **Q Particles / W Build / E Research**, regardless of selection. Brain selection retains S Auto expand; D shows Log on the brain or empty ground and Charge on other friendly structures. The six-slot submenu layout and placement flow remain unchanged.

Neurons now use shared procedural artwork for the live board and placement preview. Cell-derived shapes vary without changing simulation geometry. Connected neurons breathe with staggered phases driven by presentation time, including across stock/HP updates. Reduced motion stops this idle animation. Actual neighboring friendly structures have visible curved axons; disconnected fragments show muted dashed links and dormant bodies. Existing moving particles show actual network traffic. Queued plans remain distinct dashed markers and never create a supply connection.

The [tech tree](../TECH_TREE.md) records current implemented unlocks and requirements, including the difference between disconnected planning and connected construction.

## Verification

- Focused presentation/UI tests: 16 passed, including link ownership/adjacency, dormant disconnected nodes, stable animation phase, reduced motion and simulation immutability.
- Full repository tests: 1,676 passed. A subsequent membrane shape polish was rechecked with the focused tests.
- Typecheck, build and focused ESLint passed. Build retains the existing large-chunk warning.
- `scripts/neural-defence-ui-smoke.ts`: Chromium and WebKit passed desktop, 390×844, 320×568 and 568×320 layouts; command shortcuts, placement, pan/zoom and reduced motion. Chromium also exercises trusted emulated pinch/pan.
- `scripts/neural-defence-network-smoke.ts` passed Chromium and WebKit at desktop and phone sizes. It exercises normal-time sandbox auto expansion and Charge through actual UI controls, verifying varied moving neurons, connected links, travelling attack particles, and OS reduced motion. Screenshots: [desktop](network-desktop.png), [phone](network-phone.png).
- Independent review found a placement-outline selector affecting the new neuron membrane; the selector was narrowed to the direct child outline. Follow-up review found no remaining actionable issues.

Phone viewports and touch emulation are browser evidence, not physical-phone qualification. No simulation rules changed, and no merge or deployment is included.
