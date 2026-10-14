# Desert / Industrial prop pack v1

Six buildings (three small, three large), four crates, three circular rocks and three pyramids. Each prop was generated independently with the built-in image generation tool using the approved sprite sheet as a style reference. None were sliced from a sheet or stretched; the delivered PNGs are a uniform resize of those originals, alpha preserved (see Delivery size below). All rectangles are aligned to the screen axes. The pack is used by desert, forest and city through the stable variant catalog in `games/fuse-riders/src/engine/arena-map.ts` and the artwork registry in `games/fuse-riders/src/render/arena-maps.ts`. Classic, wrap and crossed remain open layouts.

## Browse

From the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory public
```

Open <http://127.0.0.1:8766/props/desert-industrial-v1/>. Toggle **Show hitboxes**, compare suggested game sizes with enlarged detail, and switch between sand, navy and a transparency checker. This is a static art preview; it does not start or connect to a match. Each card links to its PNG and JSON.

## Files and coordinates

- `manifest.json` lists every asset and its metadata path, relative to this directory.
- Each `<id>.png` has a matching `<id>.json`. `image.file` is relative to that JSON's directory. `image.width` and `image.height` describe the full PNG canvas, including transparent padding; `sha256` identifies its exact bytes.
- `anchorPixels` is the collider center in the full PNG, measured from the top-left, with x right and y down. It can differ from the canvas center.
- `hitboxPixels` uses the same source-pixel coordinates: `rectangle` has `centerX`, `centerY`, `width`, `height`; `circle` has `centerX`, `centerY`, `radius`.
- `recommendedWorld.unitsPerPixel` is a **single uniform scale for both axes**. `recommendedWorld.hitbox` is centered at `(0, 0)` in world units, and `rotationDegrees` defaults to zero. These sizes are the fixed variant dimensions currently adopted by the shared catalog for the game's 1600 × 900 arena. Changing them is a simulation rules change.
- `collisionFit` records how the simple collider was fitted to the actual generated silhouette. Dimensions come from the PNG, not the approximate aspect ratio requested in the generation prompt.
- `generation.json` preserves the exact generation prompt for each asset and any follow-up edit prompt.

To draw at world position `(x, y)` using Canvas:

```js
const s = asset.recommendedWorld.unitsPerPixel;
ctx.drawImage(
  image,
  x - asset.anchorPixels.x * s,
  y - asset.anchorPixels.y * s,
  asset.image.width * s,
  asset.image.height * s,
);
```

For Phaser, set the origin to `(anchorPixels.x / image.width, anchorPixels.y / image.height)` and call `setScale(s)` with one value. Use the metadata hitbox, not the padded image dimensions, for the obstacle. For a rectangle, `halfWidth = hitboxPixels.width * s / 2` and `halfHeight = hitboxPixels.height * s / 2`; for a circle, `radius = hitboxPixels.radius * s`. Multiply `s` by one shared factor for a uniformly larger/smaller version. Choose a different variant when the layout needs a different aspect ratio; never independently force its width and height.

## Hitbox fit and integration limits

Rectangle bounds enclose pixels with alpha at least 128/255. Circle centers use those bounds and the radius is their mean half-extent, preserving circular physics despite small irregularities in the stone outline. The simple shapes approximate tiny bevels and natural stone edges. `silhouetteIoU` is the intersection-over-union area between this binary silhouette and the collider, using source pixel centers. Every asset exceeds 94%; most exceed 98%. Inspect the overlay before selecting gameplay sizes. Alpha below 128, including antialiasing and faint exterior pixels, does not define collision geometry. Some original PNGs retain isolated 1/255-alpha pixels in the padding.

The engine uses circular rocks and rectangular buildings, crates and pyramids consistently for riders, projectiles, blasts and pickup clearance. The authoritative layout chooses fixed dimensions from the shared variant catalog. An immutable `(kind, id)` selects the variant, so destroying other props cannot change the remaining artwork. Checkpoints validate catalog dimensions before restoration. These JSON sidecars are build-time reference data; the browser does not fetch or trust them as simulation rules.

For a forest or other map-specific appearance, add a variant-ID override in `MAP_OBSTACLE_ART` in `games/fuse-riders/src/render/arena-maps.ts`. Provide its image path, source dimensions, source collider anchor and one uniform scale that maps its collider to the existing world footprint. The default pack supplies every missing override. A forest ruin can therefore replace a pyramid's appearance while keeping the same identity and hitbox. Changing the catalog order, kinds or dimensions requires a `RULES` bump and refreshed golden hashes; changing only artwork does not.

This pack serves delivery-sized PNGs: about 1.6 MB in all, down from the roughly 17 MB the originals weighed. Each prop is resized so its own artwork carries three device pixels per world unit, which is headroom over the 2.4 the renderer can actually put on screen (`arenaBacking` caps its backing buffer at `sqrt(3840*2160 / (1600*900))`), so nothing visible was discarded. Each sidecar's `source` block keeps the original dimensions and hash, and the original bytes are in this repository's history.

Resizing an asset changes only `image`, `anchorPixels`, `hitboxPixels` and `recommendedWorld.unitsPerPixel`, all of which are in source pixels and scale with the image. The world footprint is the product of the collider and that scale, and it is held exactly equal across the change, so a resize is not a rules change and needs no golden refresh. An atlas remains a further optimization.
