# Neural sprite revision v2

Generated with the built-in imagegen tool, one individual asset per call. Original assets are preserved. Reference: user-provided Neural Defence concept sheet (`codex-clipboard-79122a2c-72a0-4197-aeff-ddb150ff17e7.png`).

## Direction

Luminous sculpted biological forms, saturated team colors, smooth circular neuron core and slender organic dendrites. Broad brain folds remain readable at gameplay scale. Transparent cutouts with no ground, pedestal, UI, metallic trim, jewelry or filigree. First pair is a style checkpoint before expanding the remaining team colors.

## Blue neuron

File: `games/neural-defence/src/assets/neuron-blue-v2.png`

Use case: stylized-concept. Asset type: ONE individual transparent gameplay sprite for Neural Defence. Input image is STYLE REFERENCE ONLY, specifically the simple blue circular neurons in the upper-left overview. Generate only one blue neuron, never a board or sheet. Exact overhead camera, very shallow volumetric relief like the reference. A clearly circular glowing cobalt cell nucleus inside a thick smooth luminous cyan biological ring, with exactly six slender slightly irregular organic dendrites radiating toward six evenly distributed directions, delicate tips, slight branching on two tips. Central ring diameter about 42% of full sprite width so recognizable at 50 pixels. Clean strong silhouette, few broad forms, smooth soft sculpted shading, living neural tissue with moderate electric cyan rim light, saturated cobalt midtones and lighter cyan upper surface. Three-dimensional polished mobile strategy game art matching the source artwork's painterly sculpted biology. Centered within square canvas, fills 78% of canvas, ample transparent padding, no ground plane, no tile, no pedestal, no cast ground shadow. Background must be genuinely transparent alpha. No metal, no jewelry, no bronze, no gold details, no machinery, no screws, no filigree, no ornate geometry, no decorative spirals, no flower, no text, no UI, no numbers, no whitewashed glowing blob. Only one single cutout neuron.

## Blue brain

File: `games/neural-defence/src/assets/brain-blue-v2.png`

Use case: stylized-concept. Asset type: ONE individual transparent brain headquarters gameplay sprite for Neural Defence. Input image is STYLE REFERENCE ONLY, specifically the blue brain in upper-left overview. Generate only one blue brain, never a board or sheet. Match the reference's luminous soft sculpted biology closely. Compact unmistakable brain with two rounded hemispheres and curved broad sulci, visible central fissure, small rounded frontal stem lobe at bottom; warm organic shapes in electric BLUE. Near overhead camera with shallow dimensional relief and subtly visible front contour, reference-like 3D sculpted handpainted strategy-game rendering. Brain body should occupy 70% of square canvas; a few slender dendritic tendrils extend from its lower sides with maximum total extent 82%. Strong silhouette legible at 70 pixels. SATURATED cobalt blue and sky blue broad tissue folds; dark blue creases; moderate cyan edge illumination; upper surfaces colored blue, not white. Soft translucent tissue feeling with simple clear fold structure, polished art. Centered within square canvas with transparent padding. Background must be genuinely transparent alpha. No ground, no tile, no pedestal, no halo disk, no typography, no UI, no metal, jewelry, filigree, gold ornament, armor, machinery, realistic gore, or washed-out white highlights. Only one single cutout blue brain.

## Inspection

All delivered files are 1254 × 1254 RGBA with actual transparency. The first neuron draft produced seven major stems; the delivered correction uses six. The appearance and gameplay-scale readability require integration review.

## Final delivery

Delivered in `games/neural-defence/src/assets/`:

- `brain-{blue,coral,green,gold}-v2.png`
- `neuron-{blue,coral,green,gold}-v2.png`
- `tower-experimental-v2.png`
- `particle-builder-v2.png`
- `particle-attack-v2.png`

The final blue neuron was corrected to exactly six main single-tip dendrites at 60-degree intervals before deriving the final team variants. Discarded seven-stem color candidates were not copied into the project. The coordinating agent reviewed the brain direction before final expansion. Both particles face right before runtime rotation. Use the intrinsically colored team files; these are not white tint masks. All imagery and sprite editing used built-in imagegen only; Pillow is used only for contact-sheet concatenation.

The review sheet `sprites-v2-review.png` presents the final sprites on navy at enlarged and gameplay sizes. It is not a source atlas. Final browser and player acceptance are integration responsibilities.

### Six-port correction used for delivered blue neuron

Use case: precise-object-edit. Edit target is this blue neuron. Preserve its exact saturated cobalt/cyan living tissue material, charged circular core, soft blue translucent shading, transparency and overhead camera. Correct ONLY the radial silhouette: there MUST BE EXACTLY SIX main dendrites, like six spokes 60 degrees apart. Their directions are east (3 o'clock), northeast (1 o'clock), northwest (11 o'clock), west (9 o'clock), southwest (7 o'clock), southeast (5 o'clock). NO STEM at 12 o'clock or 6 o'clock. Six and only six long slim organic stems, each ending in one small rounded tip. Remove all branch forks and extra tips. The central body must stay circular with the raised smooth glowing cyan ring around blue nucleus. Make circle a little larger, diameter 42 percent of total sprite span. Transparent alpha background; no text or labels, no guide lines, no hexagon, no tile. Not jewelry, no filigree, no metal. One neuron cutout.

### brain-coral

Use case: precise-object-edit. Asset type: ONE transparent brain strategy-game sprite, coral team variant. Edit target: attached blue brain sprite. Preserve the identical polished luminous sculpted biological material, framing, proportions, camera, silhouette weight, broad soft shading and genuinely transparent background. Change the intrinsic tissue color throughout to coral pink / raspberry body, soft warm rose upper surfaces, deep burgundy folds and restrained pale pink rim light. No orange gold. This is a colored asset, not a white tint mask. Keep highlights modest and colored, not whitewashed. Keep two clear hemispheres, broad curved readable sulci and the small lower frontal lobe; slightly adjust two fold contours so it is a subtly individual brain. No metal, no filigree, no jewelry, no added hardware, no black background, no tile, no ground, no text, no UI. A single cutout sprite only.

### brain-green

Use case: precise-object-edit. Asset type: ONE transparent brain strategy-game sprite, green team variant. Edit target: attached blue brain sprite. Preserve the identical polished luminous sculpted biological material, framing, proportions, camera, silhouette weight, broad soft shading and genuinely transparent background. Change the intrinsic tissue color throughout to leaf green / jade body, soft fresh lime upper surfaces, deep forest-green folds and restrained yellow-green rim light. No turquoise. This is a colored asset, not a white tint mask. Keep highlights modest and colored, not whitewashed. Keep two clear hemispheres, broad curved readable sulci and the small lower frontal lobe; slightly adjust two fold contours so it is a subtly individual brain. No metal, no filigree, no jewelry, no added hardware, no black background, no tile, no ground, no text, no UI. A single cutout sprite only.

### brain-gold

Use case: precise-object-edit. Asset type: ONE transparent brain strategy-game sprite, gold team variant. Edit target: attached blue brain sprite. Preserve the identical polished luminous sculpted biological material, framing, proportions, camera, silhouette weight, broad soft shading and genuinely transparent background. Change the intrinsic tissue color throughout to amber / warm yellow body, soft lemon yellow upper surfaces, deep burnt-orange folds and restrained pale yellow rim light. Living colored tissue, explicitly NOT metallic gold. This is a colored asset, not a white tint mask. Keep highlights modest and colored, not whitewashed. Keep two clear hemispheres, broad curved readable sulci and the small lower frontal lobe; slightly adjust two fold contours so it is a subtly individual brain. No metal, no filigree, no jewelry, no added hardware, no black background, no tile, no ground, no text, no UI. A single cutout sprite only.

### neuron-coral

Use case: precise-object-edit. Edit the attached neuron into the coral team variant. Change ONLY intrinsic tissue coloration to coral pink and raspberry with deep burgundy shadows and rose-pink upper surfaces. Preserve exactly SIX main slender organic dendrites, spaced at 60 degree intervals at 1,3,5,7,9,11 o'clock, no extra stems or branches. Preserve circular charged core, camera, proportions, living luminous sculpted tissue material, size and genuinely transparent alpha background. Keep colored highlights, no whitewashing. One individual sprite. No extra features, no text, no UI, no metal, no filigree.

### neuron-green

Use case: precise-object-edit. Edit the attached neuron into the green team variant. Change ONLY intrinsic tissue coloration to leaf green and jade with forest-green shadows and fresh lime upper surfaces. Preserve exactly SIX main slender organic dendrites, spaced at 60 degree intervals at 1,3,5,7,9,11 o'clock, no extra stems or branches. Preserve circular charged core, camera, proportions, living luminous sculpted tissue material, size and genuinely transparent alpha background. Keep colored highlights, no whitewashing. One individual sprite. No extra features, no text, no UI, no metal, no filigree.

### neuron-gold

Use case: precise-object-edit. Edit the attached neuron into the gold team variant. Change ONLY intrinsic tissue coloration to warm yellow and amber with burnt-orange shadows and lemon upper surfaces; colored living tissue NOT metallic gold. Preserve exactly SIX main slender organic dendrites, spaced at 60 degree intervals at 1,3,5,7,9,11 o'clock, no extra stems or branches. Preserve circular charged core, camera, proportions, living luminous sculpted tissue material, size and genuinely transparent alpha background. Keep colored highlights, no whitewashing. One individual sprite. No extra features, no text, no UI, no metal, no filigree.

### tower-experimental

Use case: stylized-concept. Input image is reference for biological tissue material ONLY. Generate ONE transparent experimental neural defense tower sprite in this same soft sculpted luminous biological game-art family. A compact shallow spire growing naturally from a circular blue/cyan charged neural core, with six very short organic root tendrils. The spire is small and low, a tapering translucent cobalt blue living growth, not a tall castle, with one simple cyan tip. Near overhead camera with subtle front relief, bright colored blue tissue and darker blue creases. Unmistakably one spire silhouette, restrained cyan electric rim light, broad clear forms readable at 50px. Centered, fills 78% of square with padding. Genuinely transparent background, no ground shadow, no tile, no platform, no metal, no armor, no machinery, no crystal clusters, no gold trim, no filigree, no jewelry, no text or UI. Only one single cutout tower.

### particle-builder

Use case: stylized-concept. Input image is reference for luminous biological shading ONLY. Generate ONE individual transparent builder signal particle sprite for neural strategy game. A tiny compact living cyan-blue teardrop light, soft rounded cellular head, small droplet-shaped core, with a very short smooth curved cyan tail to the left. Direction of travel toward right. Pure simple luminous bioluminescent droplet, soft sculpted colored volumetric rendering with moderate glow, readable at 12px. Strong clean round-headed silhouette, centered in square fills 65%, genuine transparent alpha background with ample padding. No jewelry, metal, ornament, wings, fins, spacecraft, arrows, text, UI, board, scenery or tile. Single blue-cyan builder particle.

### particle-attack

Use case: stylized-concept. Input image is reference for luminous biological shading ONLY. Generate ONE individual transparent attack signal particle sprite for neural strategy game. A small intense magenta-violet neural impulse, compact pointed spearhead of light with a single tapering energy tail toward left, pointing and moving toward right. More angular and sharply pointed than the round builder droplet. A saturated pink-violet colored core with restrained bright pink edges, no white blob; a simple biological electric impulse with softly sculpted dimensional shading and moderate glow, readable at 12px. Centered in square fills 65%, transparent alpha background with ample padding. No jewelry, metal, ornament, wings, spacecraft, physical weapon, text, UI, board, scenery or tile. Single magenta-violet attack particle.

