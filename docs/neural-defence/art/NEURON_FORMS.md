# Distinct neuron forms

The original v3 neuron remains one form. Two additional transparent PNGs give the network visibly different cell bodies, rather than just rotating one silhouette:

- `games/neural-defence/src/assets/neuron-lobed-v4.png`: three-lobed soma and three linked nuclei.
- `games/neural-defence/src/assets/neuron-folded-v4.png`: folded oval soma and curved synaptic fissure.

Both retain six primary roots, the same cobalt/ivory materials and overhead view. These are cosmetic forms of one unit, with identical gameplay. A stable cell-based resolver in `render/art.ts` chooses the form; world, placement ghost and selected portrait share it. Ownership only changes tint. The build catalog uses the representative original form.

Generated with the built-in image generator, using `neuron-v3.png` as the visual reference. Both files were inspected directly, alpha was verified, and the actual combat-lab network was captured on desktop and phone. Engine state and map geometry are unchanged.

## Exact prompts

Lobed:

> Use the supplied neuron sprite as the material, lighting and camera reference for a SECOND distinct neuron of the same biological RTS species. Create one isolated game sprite, genuine transparent alpha background. Preserve deep cobalt translucent living tissue, restrained bright cyan interior veins, smooth ivory fibrous ribs, sculpted painterly 3D volume, overhead orthographic camera, upper-left light and soft underside shading. Change the anatomy visibly: a broad asymmetrical three-lobed soma with three small glowing nuclei linked inside its membrane instead of one round central bulb; short thick root collars transitioning into finer curled tendrils. Exactly six principal connection arms, tips arranged roughly every 60 degrees around the center so it fits the same six-neighbor hex network. Asymmetric branching and varied root thickness, organic living tissue, not a machine or gun. The soma should occupy the central 45 percent of the overall footprint so its different body reads at 60px. Compact round footprint and clear transparent margins. No floor, scene, text, UI, border, shadow plane, extra sprites, or solid background. Entire object visible.

Folded:

> Use the supplied neuron sprite as the material, lighting and camera reference for a THIRD distinct neuron of the same biological RTS species. One isolated game sprite on genuine transparent alpha background. Preserve deep cobalt translucent living tissue, restrained cyan interior veins, ivory fibrous ribs, sculpted painterly 3D volume, overhead orthographic camera, upper-left light and soft underside shading. Change anatomy visibly: a compact slightly elongated kidney-shaped soma wrapped by an open spiral of ivory neural folds, with one long bright cyan synaptic fissure instead of a round central glowing bulb. The body is dense, folded and low, not hollow. Six principal organic connection roots roughly every 60 degrees around the soma, thick knotted bases and finer irregular branching tips; same six-neighbor hex network footprint. The soma occupies the central 45 percent so its unusual folded form reads when 60px wide. Living tissue, not a machine, eyeball or gun. Compact round footprint, clear transparent margin, all root tips visible. No floor, scene, text, UI, border, shadow plane, extra sprites, or solid background.

## Selection correction

Tall building images project above their ground hex. Previously, clicking the brain's upper body selected the empty hex behind it. Presentation-only hit regions now select the building. During placement these regions are disabled, so the same pointer position still targets the ground. This does not enlarge the building's simulation footprint.

The terrain browser smoke covers that exact pointer location in Chromium and WebKit, plus all three distinct neuron image URLs in a real network. Unit checks cover ghost/world/portrait consistency and stable anatomy across ownership colors. Independent diff review found no actionable regression.
