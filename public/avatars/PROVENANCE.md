# Neon rider heads

Generated with the built-in imagegen tool on 2026-09-13. Final project asset: `public/avatars/neon-heads.png`, originally 1983 × 793 RGBA, five columns by two rows; runtime crops source cells without modifying the generated image or alpha channel. It is 1985 × 1191 and five by three since the eleventh head below.

## Generation prompt

Use case: stylized-concept. Asset type: single game sprite atlas for a neon-pixel multiplayer snake racing game. Create exactly TEN distinct friendly character HEAD sprites in one regular 5-column by 2-row atlas, landscape aspect 5:2, all ten cells square and equal. Row 1 left to right: silver robot head, cyan cat head, orange fox head, lime alien head, white astronaut helmet. Row 2 left to right: ivory skull head, pink octopus head, purple dragon head, golden owl head, teal slime face. Each sprite is centered in its exact cell, approximately 70% of cell width and height with generous transparent padding. Faces look straight at viewer, heads only, no bodies. Cohesive crisp chunky 16-bit pixel art, navy outlines, bright contrasting small highlights, richly recognizable silhouettes readable when rendered only 40 pixels tall. Actual transparent background including cell margins; NO checkerboard, NO grid lines, NO labels, NO text, NO shadows outside sprites, NO gradients or scenery. All ten heads must be present and separated with no overlap. This is one production sprite sheet, not a mockup or UI.

## The eleventh head

Added 2026-09-20 (rules `fuse-p2p-51`), when the robot became the AI riders' alone and a human-selectable head was
needed in its place. It is **not** image-generated: `scripts/build-avatar-atlas.ts` draws the mushroom from a 32×32
pixel grid built out of geometry — a domed cap with cream spots over a rounded body, one navy outline computed from
the silhouette — and composites it into the sheet, which grows from five columns by two rows to five by three. The ten
original cells are copied in one piece and are not redrawn; the only thing done to them is the 0.13% vertical stretch
that makes the sheet an exact three rows (793 → 794 = 2 × 397).

Re-run the script to change the cell, and `--check` to confirm the committed PNG is what it draws. Replacing the
mushroom with a generated cell later means dropping it into that cell and deleting the drawing code.
