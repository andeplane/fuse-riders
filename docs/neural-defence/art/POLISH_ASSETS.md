# Sculpted RTS presentation assets

Generated with the built-in image generator on 2026-09-25. Assets live in `games/neural-defence/src/assets/`; original generator outputs remain outside the repo. Gameplay geometry is never inferred from an image.

## Traversable ground

Current file: `terrain-walkable-v6.png`. It replaces the softer v5 floor with clearer flush slate, fine gravel and low moss. The renderer composites it at 65% opacity over the existing dark ground color to keep the fine texture subordinate to structures and actual blockers. Inspected in Chromium and WebKit at desktop and phone sizes; independent review confirmed that raised map blockers remain distinct. Source: `/Users/anderhaf/.codex/generated_images/01a0d798-3d5c-76a3-a900-6c4f8e88c21c/exec-95dd04af-df34-4594-a65d-596da618a9c1.png`.

Exact v6 prompt:

> Use case: stylized-concept. Asset type: production-ready seamless landscape 3:2 ground texture for a polished science-fiction RTS viewed from directly overhead. Primary request: beautiful readable traversable battlefield floor to support detailed blue biomechanical buildings placed separately. Richly authored 3D game environment material, not a noisy photograph. Flat weathered cool charcoal-grey slate paving partially reclaimed by low soft sage and muted emerald moss. Broad organic patches of fine compact gravel, worn smooth stone surfaces, delicate shallow hairline seams and a few tiny embedded grains. Balanced medium-scale variation: quiet open stone areas alternating with irregular soft moss mats; crisp tactile microdetail, restrained contrast so units stand out. All surfaces lie on ONE continuous level plane, all stones are flush in the ground, EVERYTHING is traversable. Diffuse upper-left lighting without directional cast shadows. Edge-to-edge opaque texture, seamless repeat on all sides, consistent scale throughout. Avoid raised rocks, boulders, cliffs, ledges, ridges, holes, water, tree roots, plants taller than moss, buildings, units, objects, large fissures, bright glow, text, interface, hex grids, outlines, vignette, depth perspective, horizon. Never paint an obstacle: real blockers are separate game objects. This must be usable as a ground material, not a complete scene illustration.

Historical file: `terrain-walkable-v5.png`. Flat moss and earth replaced the rejected v4 rock strata. The renderer places all raised blockers independently from map data and clips their art/shadows to the blocked tile. This preserves actual construction and network rules. Seamless edges were requested for both materials; perfect edge periodicity is not certified.

Exact final prompt:

> Use case: stylized-concept. Asset type: seamless flat walkable ground texture for a premium biological science-fiction RTS. Create a landscape 3:2 direct overhead orthographic texture of soft short sage-green moss intermingled with compact cool grey earth and weathered flat slate dust. The ENTIRE surface is level and traversable. Calm broad organic color variation with tiny grains, fine moss fibers and faint scuffs gives painterly 3D richness, restrained low contrast, soft diffuse daylight. No raised stones, boulders, ridges, ledges, cracks, cliffs, holes, roots, bushes, trees, buildings, objects, shadows from objects, pathways with borders, grids, hexes, text, UI, or glowing features. This image will cover open gameplay tiles; every actual obstacle is placed separately from collision data, so absolutely nothing in this image can suggest an obstacle or elevation. Edge-to-edge opaque surface, seamless tiling, no vignette.

## Buildings and tissue

Files: `brain-v3.png`, `neuron-v3.png`, `tower-pulse-v3.png`, `tower-siege-v3.png`, `tower-relay-v3.png`.

The Pulse, Siege and Relay prompts shared this base:

> Production-ready single game building sprite for a premium science-fiction biological RTS, rendered as detailed sculpted 3D game art viewed from above at a steep 60-degree RTS camera angle, orthographic, centered isolated on genuine transparent alpha background. Cohesive materials: weathered charcoal titanium, brushed silver edge trim, ivory biomechanical ribs, deep cobalt translucent living tissue, bright restrained cyan energy cores. Light from upper left, physically modeled volume and ambient occlusion, grounded wide base, no cast shadow beyond a small soft contact shadow. Not a flat icon, not a diagram, not cartoony, no text, no UI, no border. Whole silhouette must fit comfortably with transparent margins. Readable strong silhouette at 90px tall.

Pulse addition:

> A compact sturdy Pulse defense tower: broad hexagonal armored footing, three articulated organic conduits, a bulbous glowing blue neural orb cradled in a squat mechanical turret, two short forward emitters. Low broad heavy silhouette, front faces lower right. No tall antenna.

Siege addition:

> A Siege defense tower: heavy ribbed tripod platform supporting a long inclined spinal rail cannon with segmented ivory vertebrae around a cyan energy channel, stabilizer claws, small blue neural chamber at rear. Tall diagonal artillery silhouette, barrel points upper right.

Relay addition:

> A Relay defense tower: elegant three curved prongs forming a tall open crown around a levitating luminous cyan synaptic sphere, slender biomechanical mast and a compact triangular base with three bright energy ports. Graceful thin upright silhouette distinctly unlike a gun turret.

Brain prompt (Pulse image as visual reference):

> Create a new headquarters building sprite that belongs to exactly the same game art set as the reference Pulse tower: matching 3D sculpted material, upper-left light, weathered charcoal titanium, silver and ivory biomechanical ribs, cobalt tissue and restrained cyan light. This building is a NEURAL BRAIN headquarters: unmistakable large anatomically folded translucent blue human brain suspended in a protective open cradle, on a low broad six-sided foundation with six thick organic root ports extending outward, cables and small blue energy reservoirs. Brain visibly dominates upper silhouette. Steep overhead 60-degree orthographic RTS camera, readable at 110px tall, grounded heavy foundation. Strong volume and ambient occlusion. Entire object isolated centered with margin on genuine transparent alpha background; absolutely no opaque backdrop, no text, no UI, no frame, no floor plane. Keep the full building visible. This is game art, not a logo or icon.

Neuron prompt (Pulse image as visual reference):

> Create one small NEURON network junction game sprite in the same premium sculpted biological sci-fi RTS visual family as the reference, but this is living neural tissue, NOT a tower and NOT a gun. Low rounded dark cobalt soma with complex folded translucent membrane and tiny bright cyan nucleus, six short organically irregular branching root/dendrite tendrils spaced roughly every 60 degrees around it, subtle ivory fibrous collars where roots meet the soma. Rich tactile material with blue veins and glossy top-left lighting, dark underside/contact shading. Top-down steep 65-degree orthographic camera. Compact flat six-port footprint, tips occupy roughly a circle. No metal pedestal, no eye or face, no flat graphic symbol. Centered isolated whole object on genuine transparent alpha background, generous clear margin; no floor plane, no cast shadow beyond soft contact shadow, no text or UI. Must read as a living synaptic node when 60px wide, matching the darker refined material treatment of the reference building.
