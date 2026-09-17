# ADR 033: Snapshot-driven Phaser presentation

Status: Accepted for implementation after independent root review; activation remains gated on benchmarks and implementation review.

## Context and alternatives

The current custom Canvas 2D renderer is functionally complete but redraws trails and expensive glows every frame. The user requests Phaser and a significant increase in arcade visual quality. Rewriting simulation in Phaser physics would couple render timing to game outcomes and break deterministic networking. Keeping only a Canvas texture inside Phaser would add cost without obtaining sprite batching.

## Decision proposed

Use Phaser 3.90 as a presentation-only renderer with native batched sprites, cached trail geometry, reusable graphics layers and capped particle emitters. The existing pure TypeScript game remains authority. `render(snapshot, now, theme)` accepts the same already interpolated/predicted snapshot as the Canvas renderer; no simulation timer or physics engine exists in the scene. DOM menus, controls, audio and accessibility remain outside Phaser.

A renderer instance owns its canvas, scene, generated textures and event listeners. It exposes readiness, render, resize, metrics and destroy. The caller supplies the sole frame clock; the Phaser automatic loop is stopped after loading and manually stepped once per caller frame. Context loss suspends rendering and restoration resets transient effect identity before rebuilding from current snapshots. It supports WebGL with Phaser Canvas fallback. The old Canvas renderer remains available for comparison and operational fallback. Integration replaces only arena draw calls, not input or networking. An explicit authority epoch/match identifier plus snapshot round resets effect identity; repeated frames cannot replay bursts. Effect caches and particle count are bounded, and hidden/destroyed renderers stop work. Visual geometry uses authoritative radii and clips trails/blasts to the shrinking playfield. Cosmetics never affect collision geometry or player colors.

Textures use existing avatar assets and pickup sprites, neon/pixel colors, multilayer luminous trails, animated fuse/charge rings, radial shockwaves and short pixel spark bursts. Expensive full-screen postprocessing is excluded initially; quality options cap resolution and particle counts rather than changing rules.

## Failure and cost

No hosting changes. Phaser adds a client bundle download, GPU memory and startup cost. Dynamic loading keeps controllers without a board lightweight. Unsupported WebGL uses Canvas; initialization failure falls back to the existing renderer. Context restoration must reconstruct visual state from the latest snapshot. Browser suspension pauses cosmetics without advancing authority.

## Acceptance

Typecheck and deterministic tests must pass. Verify both themes, avatars, all current powerups, portals, target reticle, shrinking boundary, death, round transition and disposal. Run five-rider long-trail / bomb / shell / explosion browser workloads for both renderers at identical resolution: capture p50/p95/p99 frame duration, render CPU, scene object and live particle counts; document hardware/browser and duration. Target p95 frame interval <=20ms at 1600x900 desktop and bounded object counts over sustained runs; report software-WebGL and physical mobile limitations separately. Independent implementation review and LAN/online Chrome/WebKit smoke tests gate activation.

## Sources

- https://docs.phaser.io/phaser/concepts/gameobjects/particles
- https://docs.phaser.io/phaser/concepts/gameobjects/render-texture
- https://docs.phaser.io/api-documentation/3.90.0/class/gameobjects-particles-particleemitter

## Design review

Independent root review approved the presentation-only design with explicit scope, one frame loop, context-loss reset, themed fallbacks and benchmark-gated activation. The netcode reviewer independently requested authority epoch/match/round scoping and preservation of supplied render time. The API accepts a caller-provided scope string (epoch plus match ID); round is appended internally. Phaser 3.90.0 is pinned intentionally for the reviewed APIs rather than adopting the newly available 4.x during this migration.

## 2026-09-16: Retire the separate Canvas renderer

Keep one Phaser scene, with WebGL by default and Phaser's built-in Canvas backend when WebGL is unavailable. Remove the hand-written renderer, duplicate sprite loaders and `?renderer=canvas` selection. This supersedes the operational fallback and comparison decision above; recorded benchmark evidence remains historical.

Context restoration remains automatic for two seconds. Failed restoration or a ten-second load/startup deadline exposes an in-place graphics retry, which replaces the canvas and reconstructs presentation from the latest snapshot without rejoining the room. Attempts are generation-scoped so stale asynchronous completions cannot overwrite a retry. No physics, inputs or network behavior changes. The tradeoff is an interrupted view after unrecoverable graphics failure rather than continued rendering through a separately maintained scene.
