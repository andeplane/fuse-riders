# Battlefield art correction — 2026-09-25

The previous flat procedural neuron replacement was rejected during playtesting. This correction restores the existing illustrated `neuron-{team}-v2.png` artwork on the board and in placement previews, retaining gentle motion and cell-derived size/orientation variation. HUD portraits and world objects now use the same artwork. Connections remain separate renderings of actual friendly adjacency, with quieter strokes behind the tissue.

Ground uses one continuous world-space texture rather than repeating a separate slab in every hex. Ordinary hex boundaries are hidden; selection, hover, placement and debug geometry remain available. Explicit authored terrain variants still render in their own cells. Ground continues outside selectable cells so panning never reveals a black void. Terrain artwork does not change legal tiles, obstacles, deposits, connectivity or combat.

Large arenas begin at a readable unit scale centered on the player's brain. Wheel/pinch zoom and panning remain, with a minimum 0.8 CSS pixels per world unit. Short phone landscapes therefore show a local portion of the battlefield; pan to reach distant tiles. Root commands retain Q Particles, W Build, E Research and now use existing artwork. No rules-version change is needed.

## Generated asset

Saved asset: [terrain-battlefield-v3.png](../../../games/neural-defence/src/assets/terrain-battlefield-v3.png). Generated using the built-in imagegen tool, copied into the game's bundled assets. Existing source assets were preserved. The texture was requested as seamless; visual browser inspection is the acceptance evidence, not a mathematical guarantee of edge continuity.

Exact generation prompt:

> Create a seamless tileable terrain texture for a polished real-time strategy videogame viewed directly overhead. Square opaque texture only, no UI, no grid, no hexagons, no objects, no buildings, no text. Ground is weathered charcoal basalt and muted dark olive moss, soft patches of fine dark earth, subtle hairline stone fractures and scattered tiny grit. Strong natural variation at broad scale but low contrast overall so bright blue biological units and purple/lime resource crystals will read clearly on it. Mature hand-painted realistic game texture, akin to high-quality classic sci-fi RTS battlefield terrain, no neon, no large boulders, no visual focal point, no directional lighting or shadows. Seamless on all four edges. Do not render a scene or perspective. Save the generated texture as an image asset.

## Verification

The presentation regression checks that live neurons use the illustrated asset and ordinary tiles do not stamp repeated ground textures. Camera tests check initial readability on 1840px desktop and 390px phone viewports and the minimum zoom. Existing motion/connection tests remain.

The real network browser smoke passed growing three neurons and charging a node, verifying travel, animation and reduced motion in Chromium and WebKit at desktop/phone sizes. The broader UI smoke passed placement, menus, wheel zoom, pinch/pan, and narrow/landscape layouts, including panning to a target at the new readable minimum scale. Full repository tests passed (1,677), as did typecheck/build, focused ESLint and independent review. Build retains the pre-existing large-chunk warning. Phone emulation is not physical-device validation.

Screenshots: [opening desktop](../verification/art-opening-desktop.png), [expanded network](../verification/art-network-desktop.png), [phone](../verification/art-network-phone.png).
