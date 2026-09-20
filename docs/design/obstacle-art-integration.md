# Shared obstacle variants and map artwork

The first integrated pack uses the same sixteen props on desert, forest and city. Their floors, spacing and recipe counts remain map-owned; trees, bushes and cactuses are removed. Classic, wrap and crossed keep their obstacle-free layouts.

Each obstacle's immutable `(kind, id)` selects a stable catalog variant. The shared catalog owns that variant's fixed world dimensions. The authoritative layout samples positions, not independent width/height scales, and checkpoints validate dimensions against the same catalog. No extra asset path or presentation data enters the wire format. The ordering of variant lists is a rules contract: changing it or dimensions requires a rules bump. IDs persist when other obstacles are destroyed.

Presentation resolves the selected variant through a map artwork registry. Initially every map uses the same pack. A future forest override can give the same variant an overgrown building or Inca ruin image, with its own pixel anchor and a uniform pixels-to-world scale, while retaining the variant's collision shape and proportions. Replacing art alone must not change simulation geometry. Generated sidecars remain source art metadata; a compact TypeScript catalog is checked against them by tests.

Rocks are circles in all collision paths, including swept rider and gun contact, shell reflection, pickup clearance and blast damage. Buildings, crates and pyramids are rectangles. Placement deliberately uses conservative bounding-box separation for navigable gaps. The shell kernel accepts zero-length circular surfaces and explicit surface radii, preserving exact circle contact instead of approximating rocks with polygon walls.

Phaser preloads the props and reuses static image objects beneath trails on both WebGL and Canvas. Images use the collider center as their origin and one scale for both axes. A missing image renders a solid shape matching its collider, never an invisible obstacle. State changes rebuild scenery, including same-count replacements and rollback. No new render or simulation clock is introduced.
