# ADR-004: Pluggable visual themes independent from game rules

- Status: Accepted (reviewed before renderer changes)
- Date: 2026-09-13

## Context

Fuse Riders needs a strong shared-TV presentation while allowing the group to switch styles. Visual changes must not alter deterministic physics, collision hitboxes, or the server protocol.

## Decision

Keep visual themes in a renderer-owned theme object backed by CSS variables and a public asset manifest. Neon Pixel is the default style, with Clean Neon as the included alternate. Theme assets are local SVGs under `public/themes`; no external image service or runtime network dependency is allowed. Sprite anchors, orientation, tintability, and filenames come from the manifest. Physics and hitboxes use world geometry from the shared engine and never read theme assets.

Any client may switch themes at any time — the LAN display from its `Visual style` selector, an online room from its header `STYLE` button, or either from a `?theme=` URL override — including mid-round, because the renderers read the palette per frame and preload every style's textures. The choice is per device, stored in `localStorage`, and never travels over the wire. It applies the selected theme to Canvas sprites and CSS chrome while preserving the same player IDs, colors, positions, and collision behavior. Missing assets fall back to procedural geometry.

## Consequences

New styles can be added without touching the server or simulation. The renderer must cache assets and keep a fallback, and theme authors must preserve the manifest contract and 32×32 sprite anchors.

See [`docs/theme-assets.md`](../theme-assets.md) for the asset authoring and frontend integration contract.
