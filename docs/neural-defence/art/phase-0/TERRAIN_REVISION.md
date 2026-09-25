# Terrain sprite revision — 2026-09-25

Generated with the built-in imagegen tool, one asset per call. The first seven requests ran independently in parallel. Existing assets were preserved. Source PNGs were copied unchanged into `games/neural-defence/src/assets/`.

The visual reference is the user-provided Neural Defence board: sculpted cool stone, luminous biological units, and readable terrain. This batch provides ground and obstacles only; ownership, hex borders, selection, and glow remain renderer effects.

## Files and validation

All files are 1254 × 1254 pixels. Ground fills the square and must be clipped by the renderer; it contains no baked hexagonal base, border, or selection state.

| File | Channels | Alpha | Inspection |
| --- | --- | --- | --- |
| terrain-slate-a-v2.png | RGB | Opaque | Quiet weathered slate; replaces the appearance of the older hex slab without overwriting it |
| terrain-slate-b.png | RGB | Opaque | Broader shallow slate fractures |
| terrain-slate-c.png | RGB | Opaque | Rougher broad stone strata |
| terrain-moss-a.png | RGB | Opaque | Slate with subdued moss and tiny cyan flecks |
| terrain-soil-a.png | RGB | Opaque | Compacted earth, small stones, shallow erosion |
| terrain-sand-a.png | RGB | Opaque | Cool beige sand and broad shallow ripples |
| blocker-rock-cluster-a.png | RGBA | 0–255; 53.94% fully transparent | Compact five-rock silhouette; visible alpha > 128 bounds (98,117)–(1177,1159) |
| blocker-rock-ridge-a.png | RGBA | 0–255; 66.27% fully transparent | Diagonal broken ridge; visible alpha > 128 bounds (101,69)–(1183,1191) |

Validation used Pillow to inspect dimensions, channel mode, alpha extrema, transparent-pixel fraction, and visible silhouette bounds. All eight outputs were visually inspected. No generated pixels were edited after generation.

Ground textures were prompted for repeatability, but exact opposite-edge continuity is **not certified**. They are suitable as independent hex-clipped ground variants; arbitrary adjacent variants do not form a continuous crack network. A later continuous world texture should be checked with a tiled seam preview before adoption.

Rock facets intentionally retain dimensional relief. The ridge reads more sculpted than a flat orthographic map symbol; review its presentation alongside the other game objects at gameplay scale. Very faint alpha fringe extends beyond its opaque silhouette, but the visible rock is contained.

## Exact prompts and generated sources

### terrain-slate-b.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-c1aeb61b-de53-4413-9c11-d3512337daf6.png`

Use case: stylized-concept. Asset type: individual production terrain texture for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, no isometric perspective. Style: hand-finished AAA stylized PBR game art, readable broad material shapes with restrained fine detail. Lighting: soft diffuse daylight from upper left, medium brightness, no black shadows, consistent cool slate-blue neutral palette. Composition: seamless square texture filling EVERY pixel edge to edge, opaque ground, NO hex shape, NO tile border, NO frame, NO bevel, no platform, no blank margin, no horizon. This texture will be clipped into hexagons by the game renderer. No text, symbols, UI, units, buildings or mineral pickups. Calm readable ground so colorful neurons can stand out. Subject: gently fractured blue-gray bedrock surface. Three broad irregular shallow stone plates with subtle mineral grain and narrow natural hairline fissures. Very slight muted purple undertone. Quiet corners, consistent medium-value surface across all edges; seamless repeatable pattern.

### terrain-slate-c.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-a0f087c7-f215-4fa7-a8ff-fc03ce32d607.png`

Use case: stylized-concept. Asset type: individual production terrain texture for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, no isometric perspective. Style: hand-finished AAA stylized PBR game art, readable broad material shapes with restrained fine detail. Lighting: soft diffuse daylight from upper left, medium brightness, no black shadows, consistent cool slate-blue neutral palette. Composition: seamless square texture filling EVERY pixel edge to edge, opaque ground, NO hex shape, NO tile border, NO frame, NO bevel, no platform, no blank margin, no horizon. This texture will be clipped into hexagons by the game renderer. No text, symbols, UI, units, buildings or mineral pickups. Calm readable ground so colorful neurons can stand out. Subject: weathered blue-gray slate ground with broad softly faceted natural strata and two shallow branching irregular fissures, a few tiny embedded pebbles. Cooler silver-blue highlights than variant B, but same medium-value surface and scale. Subtle polished organic science-fiction landscape, seamless repeatable pattern.

### terrain-moss-a.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-f6b89864-5ee5-4b06-9f58-3dffdbbbc998.png`

Use case: stylized-concept. Asset type: individual production terrain texture for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, no isometric perspective. Style: hand-finished AAA stylized PBR game art, readable broad material shapes with restrained fine detail. Lighting: soft diffuse daylight from upper left, medium brightness, no black shadows, consistent cool slate-blue neutral palette. Composition: seamless square texture filling EVERY pixel edge to edge, opaque ground, NO hex shape, NO tile border, NO frame, NO bevel, no platform, no blank margin, no horizon. This texture will be clipped into hexagons by the game renderer. No text, symbols, UI, units, buildings or mineral pickups. Calm readable ground so colorful neurons can stand out. Subject: blue-gray rocky ground softened by thin organic moss islands and tiny lichen scattered unevenly over half the surface. Desaturated sage and emerald greens with slate visible beneath. Very faint bioluminescent moss flecks, never bright enough to compete with units. Flat traversable moss, not bushes, not trees. Seamless repeatable pattern.

### terrain-soil-a.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-c867a5dc-dcdf-4eb0-91e8-60255bbbbc89.png`

Use case: stylized-concept. Asset type: individual production terrain texture for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, no isometric perspective. Style: hand-finished AAA stylized PBR game art, readable broad material shapes with restrained fine detail. Lighting: soft diffuse daylight from upper left, medium brightness, no black shadows, consistent cool slate-blue neutral palette. Composition: seamless square texture filling EVERY pixel edge to edge, opaque ground, NO hex shape, NO tile border, NO frame, NO bevel, no platform, no blank margin, no horizon. This texture will be clipped into hexagons by the game renderer. No text, symbols, UI, units, buildings or mineral pickups. Calm readable ground so colorful neurons can stand out. Subject: compacted muted brown-gray alien soil with subtle dusty lilac undertones, tiny embedded stone chips and thin branching shallow erosion cracks. Fine soft organic grain, no roots that look like units, no large objects. Same surface scale and medium brightness as slate ground. Seamless repeatable pattern.

### terrain-sand-a.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-b64679cd-30fe-492e-8209-766ad5f59b58.png`

Use case: stylized-concept. Asset type: individual production terrain texture for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, no isometric perspective. Style: hand-finished AAA stylized PBR game art, readable broad material shapes with restrained fine detail. Lighting: soft diffuse daylight from upper left, medium brightness, no black shadows, consistent cool slate-blue neutral palette. Composition: seamless square texture filling EVERY pixel edge to edge, opaque ground, NO hex shape, NO tile border, NO frame, NO bevel, no platform, no blank margin, no horizon. This texture will be clipped into hexagons by the game renderer. No text, symbols, UI, units, buildings or mineral pickups. Calm readable ground so colorful neurons can stand out. Subject: cool desaturated beige-gray fine sand over bedrock, broad very shallow wind ripples, a few tiny blue-gray stone specks. Muted pale ochre accents, no saturated yellow, no dune horizon. Flat traversable surface of same scale and medium brightness as slate ground. Seamless repeatable pattern.

### blocker-rock-cluster-a.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-91381c99-bb1d-438f-a665-31bce78a4976.png`

Use case: stylized-concept. Asset type: ONE isolated rock obstacle sprite for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, NO side or isometric camera. Subject: compact irregular cluster of five sculpted blue-gray basalt rocks of differing sizes, broad readable angular facets, tiny pale mineral flecks, restrained cool violet shadows. Style: high-quality hand-finished stylized PBR, dimensional forms but strictly viewed from above, natural stone not crystals. Lighting: soft diffuse upper-left cool daylight, medium bright slate highlights, no black silhouette. Composition: centered contained compact obstacle filling 78% of square, generous clean margin on all sides. Genuinely TRANSPARENT background with alpha, no checkerboard pattern baked in, no floor, no tile base, no hex, no framing border. Entire rock silhouette visible; no objects cut off. No neurons, lights, UI, text, symbols or extra props.

### blocker-rock-ridge-a.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-fe725a0a-736b-48d8-ace5-c9ea49910afa.png`

Use case: stylized-concept. Asset type: ONE isolated rock obstacle sprite for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, NO side or isometric camera. Subject: low broken rocky ridge made from three connected large angular blue-gray basalt slabs, diagonal northwest-to-southeast organic silhouette, a narrow fissure between main slabs and two tiny stones close by. Broad readable facets, subtle mineral grain, restrained cool violet shadows. Style: high-quality hand-finished stylized PBR, dimensional forms but strictly viewed from above, natural stone not crystals. Lighting: soft diffuse upper-left cool daylight, medium bright slate highlights, no black silhouette. Composition: centered compact obstacle filling 78% of square, clean transparent margin on all sides. Genuinely TRANSPARENT background with alpha, no checkerboard pattern baked in, no floor, no tile base, no hex, no framing border. Entire rock silhouette visible; no objects cut off. No neurons, lights, UI, text, symbols or extra props.

### terrain-slate-a-v2.png

Source: `/Users/anderhaf/.codex/generated_images/01a0d76b-df38-7543-ba2b-55a6a43e4c29/exec-91a70090-de20-4b0a-b565-b26ec4072e7f.png`

Use case: stylized-concept. Asset type: individual production terrain texture for a polished sci-fi neural RTS web game. Camera: exactly vertical orthographic top-down, no isometric perspective. Style: hand-finished AAA stylized PBR game art, readable broad material shapes with restrained fine detail. Lighting: soft diffuse daylight from upper left, medium brightness, no black shadows, consistent cool slate-blue neutral palette. Composition: seamless square texture filling EVERY pixel edge to edge, opaque ground, NO hex shape, NO tile border, NO frame, NO bevel, no platform, no blank margin, no horizon. This texture will be clipped into hexagons by the game renderer. No text, symbols, UI, units, buildings or mineral pickups. Calm readable ground so colorful neurons can stand out. Subject: flat gently weathered blue-gray slate bedrock with subtle mineral grain, quiet broad irregular patches, two shallow fine natural cracks and only a few very tiny embedded pebbles. Average color muted slate blue-gray around RGB 105 116 132, not pale or nearly black. Same scale and coherent material family as slate B and C. No centralized focal element. Seamless repeatable pattern.


