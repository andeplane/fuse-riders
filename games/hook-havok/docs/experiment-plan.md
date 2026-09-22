# Hook Havok experiment plan

## Delivery boundaries

Name: **Hook Havok**, technical id `hook-havok`. Use TypeScript and the repository's Phaser version. Preserve the existing solo-room architecture: a solo playable game is a room with no peers, not a new offline gameplay path. Tests and an art showcase may run independently.

The first milestone delivers visual concepts, source-asset trials, and this implementation brief. Art remains provisional until reviewed in motion at gameplay size. Later milestones are separate increments, not silently included in this change.

## Phases

### 0. Visual foundation (current)

- Record scope, architecture, fixed arena and initial movement hypotheses.
- Compare belfry, observatory and overgrown sanctuary compositions with a small original player silhouette.
- Recommend a direction, record weaknesses, and retain alternatives for user review.
- Preserve exact generation prompts and source files.

Exit: reviewable compositions and an original visual vocabulary. This is not a gameplay screenshot or evidence of runtime performance.

### 1. Asset-production proof

- Establish a side-view reference for one lantern keeper.
- Generate and inspect a clean background and platform source.
- Verify actual alpha, source dimensions, and file sizes rather than trusting requested output specifications.
- Produce aligned idle and movement poses, correct silhouette drift, and preview animation at approximately 64 pixels tall.
- Fix sprite scale, baseline, pivots and frame bounds. Create a reusable hook and lantern asset.

Exit: a consistent small kit and a short animation. Static generated assets alone do not complete this phase.

### 2. Browser art showcase

- Create package and page under `games/hook-havok`; verify discovery in build/dev serving.
- Add asset manifest, loading/error/retry states and scene disposal.
- Compose background, platforms, actor, tether, effects and edge-only foreground.
- Add restrained mist and lantern motion; show a repeatable scripted presentation sequence.
- Capture actual browser evidence at normal and reduced display sizes.

Exit: convincing motion and readable terrain. Showcase scripting must not become a second physics engine.

### 3. Movement playground

- Implement engine-owned state, inputs, tuning, static map, collision, character motion, grapple and view contract.
- Implement validated codec, rules version, replay fixture, and `RollbackGame` adapter for a solo room.
- Add keyboard/mouse controls, cancellation, respawn, restart and debug overlays.
- Add a small tuning panel; changes reset the exercise and are recorded in replay metadata.
- Test buffered/released jumps, high-speed collisions, contact ties, hook misses, attachment, obstruction, release and reset; test deterministic replay and checkpoint rejection.

Exit: predictable movement without decorative effects, no tunneling or stuck hook states.

### 4. Feel and audio

- Derive idle/run/rise/fall/land/fire/pull animation from engine view; never derive physics from animation frames.
- Add landing compression, dust, attachment flash, tether tension and release feedback.
- Inspect and extract the existing game-local radio and music catalog into an appropriate shared module; reuse existing music files. The main-based worktree currently has the radio in `games/fuse-riders/src/client/radio.ts`; the Ball Bros branch has a proposed `fuse-ui/assets` catalog, which must not be assumed to exist on main. Reconcile with the latest main before implementing. No cross-game imports.
- Add short jump/land/fire/attach/release/respawn effects with bounded concurrency, gesture unlock and teardown.
- Respect `?mute`; keep effect and music volume independent.

Exit: feedback clarifies rather than hides movement. Shared consumers retain working radio behavior.

### 5. Single-player POC review

- Playtest a repeatable route: ordinary jump, central gap, high anchor, release-and-land, awkward recovery, fall/reset.
- Review small-scale readability, grayscale, frame alignment and foreground occlusion.
- Run focused tests, typecheck/build, affected browser flow, and full unit suite at integration.
- Measure a documented traversal workload; record revision, browser/device and limits.
- Deliver reviewed PR and muted preview for user playtesting; do not merge or deploy without authorization.

### 6. Later experiments

Separate increments: physical-phone control trial; stationary knockback target; one bounded splitting ball; 2–5 player integration with rollback/reconnect tests; then compare respawning, elimination and score modes. Decide additional maps, procedural generation and bespoke music only after those results.

## Module ownership

`engine/`: state, input, tuning, maps, collision, movement, grapple, step, codec, view. Imports nothing from app/render/network.

`render/`: scene, assets, backgrounds, platforms, character, tether, effects and debug drawing. Reads the engine view contract.

`app/`: browser controls, UI, audio and composition. `online/`: adapter and room runtime. Shared packages remain game-agnostic; never import another game. Create modules when needed, not as empty scaffolding.

## Initial map

Logical world: 1600 × 900, origin upper-left; fixed camera and aspect-preserving fit. Rectangles are specified as x, top y, width, height. Art concepts are approximate compositions, not authoritative maps.

| Surface          |    X |   Y | Width | Height |
| ---------------- | ---: | --: | ----: | -----: |
| Starting terrace |  120 | 810 |   400 |     40 |
| Lower-left       |  220 | 670 |   220 |     28 |
| Lower-middle     |  570 | 610 |   240 |     28 |
| Middle-left      |  250 | 470 |   230 |     28 |
| Middle-right     |  950 | 480 |   250 |     28 |
| Upper-middle     |  620 | 330 |   260 |     28 |
| Upper-right      | 1170 | 270 |   250 |     28 |
| High anchor beam |  670 | 120 |   300 |     28 |

All surfaces initially solid and grappleable, with explicit properties. Spawn on starting terrace. Horizontal bounds prevent exiting sideways. Falling fully below the world triggers respawn. Validate reachability after tuning; decorative scenery never participates in collision or attachment.

## Movement hypotheses

Fixed 60 Hz simulation; collider approximately 32 × 52 units. Initial running speed 360 units/s, gravity 1800 units/s², jump launch 760 units/s upward, terminal fall 1000 units/s, coyote and jump buffer 6 ticks each, respawn 30 ticks. These are hypotheses, not approved balance or measured feel.

Use acceleration/braking, air steering and jump-release shortening. Swept collision against static rectangles resolves earliest contact with stable ties, bounded iterations and surface sliding. Validate spawn positions. Agree on numeric rounding and direction quantization before implementation; fixed timesteps alone do not guarantee cross-device determinism.

Grapple: Ready → Flying → Attached → Retracting → Ready. One hook, captured fire direction, bounded range/flight time, earliest valid hit. Holding pulls toward the anchor with bounded velocity; release preserves bounded momentum. Stop pulling near the anchor. New obstructions detach; no wrapping, physical rope, teleport or auto-mantle. Require a new press after retraction. Death/reset/focus loss/room interruption cancel input. Full-circle mouse aim is a lab starting point, not a commitment for phone controls.

## Review standard

Art and game feel require user review. Preserve reference provenance and source masters. Mark generated concepts, source trials, runtime exports and actual gameplay evidence distinctly. A static painting cannot prove alpha quality, animation consistency, collision alignment or mobile performance.
