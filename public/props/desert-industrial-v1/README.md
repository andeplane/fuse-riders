# Desert / Industrial prop pack v1

Six buildings (three small, three large), four crates, three circular rocks and three pyramids. Each prop was generated independently with the built-in image generation tool using the approved sprite sheet as a style reference. The PNGs retain their original pixels and alpha; none were sliced from a sheet or stretched. All rectangles are aligned to the screen axes. The pack is intended for future integration and is not loaded by the game yet.

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
- `recommendedWorld.unitsPerPixel` is a **single uniform scale for both axes**. `recommendedWorld.hitbox` is centered at `(0, 0)` in world units, and `rotationDegrees` defaults to zero. These sizes are starting suggestions against the game's 1600 × 900 arena, not adopted balance rules.
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

The current engine in `src/shared/arena-map.ts` has rectangular rock collision, no `pyramid` obstacle kind, and separate collision paths for riders, projectiles, blasts and placement. These sidecars do **not** change those rules or automatically register new assets. Future integration must choose stable asset IDs/sizes with the authoritative layout and make the intended geometry consistent across all affected simulation paths. Circular rock physics and a new pyramid kind require explicit engine work, a `RULES` bump and refreshed golden hashes when behavior changes. Presentation alone must not silently change LAN or online collision geometry.

The full-resolution source PNGs total approximately 17 MB. Future runtime integration can create uniformly reduced delivery textures or an atlas; load only the assets actually needed. This pack intentionally retains the independently generated originals for further art work.
