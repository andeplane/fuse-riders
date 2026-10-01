# Connected rock relief

Stone blockers now have connected, textured upper surfaces and directional cliff
faces, rather than isolated rock sprites on a flat floor. Adjacent cells share
their upper edge and omit the internal wall. Exposed corners and ledges are
inset within the blocked footprints. Water and void variants retain their own
artwork. Height is cosmetic; no map, movement, weapon or construction rule changes.

The initial flat-colour prototype looked like hexagonal pedestals and was
rejected during screenshot inspection. Irregular inset corners, a fractured-rock
material and quieter edge highlights replaced that treatment. The result remains
illustrated 2.5D; it is not evidence of the requested overall AAA visual quality.

Relief is built with the static terrain cache. It adds no animation loop, dynamic
blur or new renderer dependency. The 512-pixel PNG material is about 510 KiB and
is bundled with the game. Numeric ground vertices are shared with the existing
projection; its SVG point output and inverse map selection remain unchanged.
Raised-rock hit ellipses move with the artwork, while placement still uses ground
cells. The desktop browser smoke caught the initial hit mismatch and passed after
the correction; the same flow now passes at 390×844.

Verification: all 1,725 repository tests, typecheck/build and focused lint pass.
Independent review found no additional issues. Chromium and WebKit pass raised
brain/rock selection, ground placement, blocked-ground rejection and minimap
navigation at desktop and phone sizes. Both reproduce combat replay hash
`8918c067` and render its effects at multiple ages. These are emulated-browser
checks, not physical-phone or human visual acceptance.

Evidence: [desktop combat](verification/terrain-relief-2026-09-27/desktop-combat.png)
and [ordinary phone placement](verification/terrain-relief-2026-09-27/phone-placement.png).

## Asset provenance

Built-in image-generation tool; output copied into
`games/fuse-craft/src/assets/terrain-cliff-material-v1.png`, then downsampled
to 512×512 for delivery. The original generated image was preserved outside the
repository. No externally sourced art or generation credentials are required at
runtime.

Final generation prompt:

> Use case: stylized-concept. Asset type: seamless square material texture for natural rock cliff faces and tops in an isometric science-fiction RTS. Create a full-frame, edge-to-edge dark blue-grey slate and granite rock material, richly sculpted irregular fractured facets, layered mineral fissures, tiny muted olive moss only in a few crevices. Orthographic close material study, no horizon, no objects, no ground plane, no borders, no text. Dense natural small-scale rock relief, readable at small game sizes, high quality hand-painted PBR-like material, coherent soft upper-left illumination, dark ambient occlusion in cracks. Tileable and uniform scale across frame; no isolated large boulders or central composition. Opaque texture, no transparency. This is the texture itself, not a screenshot or a rendered cube.
