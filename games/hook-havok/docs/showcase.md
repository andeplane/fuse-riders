# Phaser belfry showcase — Phase 2

## What changed

The new built `/hook-havok/` page is a presentation-only Phaser scene, reached through a clearly named art-showcase link on the party landing screen. It keeps A's belfry/keeper and the planned eight-platform arrangement inspired by B. Running, jumping, attachment, pulling, release and landing are sampled from a twelve-second authored timeline. They are not collision outcomes, predicted inputs, a physics engine or multiplayer evidence.

Phaser owns one presentation loop. DOM controls pause, replay, choose planted idle, scrub and toggle atmosphere. CSS framing and source art provide depth; radial textures add mist and warm light, while bounded drawn motes, sparks and dust provide feedback. Edge framing stays at the sides. There is no camera shake, audio or external asset service.

The hook now attaches to the outer corner of the upper-middle ledge; the authored route passes around that ledge. This fixes an early visual route that crossed an intermediate platform. Future engine geometry must decide actual valid attachment and traversal.

## Idle correction

The initial generated idle cells have different horizontal torso registration. Switching them made the keeper appear to slide. Both the old source inspector and new showcase use a single idle drawing, fixed x/foot baseline and a ±0.9% vertical breathing scale over three seconds. At a 76-unit source silhouette this is under one unit of vertical movement. This is a conservative placeholder, not a skeletal knee/torso animation. Later: lock boots separately, bend knees slightly, move chest/scarf with delayed follow-through and add sparse blinks. Avoid translating the entire sprite to fake breathing.

## Architecture and build

- `src/render/showcase-timeline.ts`: pure presentation keyframes, no world state.
- `src/render/assets.ts`: Vite-managed asset URLs and source alpha bounds.
- `src/render/scene.ts`: Phaser composition, effects and the only render loop.
- `src/app/main.ts`: controls, bounded loading, retry, navigation and teardown.
- Package declares Phaser as a development dependency. No game id/room/platform registration is added.
- Vite discovers the page automatically; the existing room service serves the built directory. The menu and home link preserve `?mute`.
- Docker's frozen workspace install needs the new package manifest, so `Dockerfile.cloud` copies it before installation. No deployment was performed.
- Source PNGs are emitted through Vite with hashed URLs; five selected images total 5,715,607 source bytes. Runtime atlas/compression work remains: the original approximate 5 MB art target is not yet met. No new image generation occurred in this phase.

The old Canvas inspector remains standalone tooling, not a concurrent renderer or a second game implementation. Its source frames are retained unchanged.

## Failure and accessibility behavior

Import/initialization/artwork readiness has a 15-second deadline. Attempt tokens reject late completions. Failed assets, initialization and context-loss events expose retry; retry destroys the previous Phaser game and replaces its canvas. Page exit disposes the scene; BFCache return starts it again. Reduced-motion preference starts paused with moving atmosphere off. Hidden documents do not advance the authored timeline.

## Verification

- Typecheck, focused ESLint and formatting pass.
- Four Hook Havok tests cover idle registration, attachment/release, transition continuity and game/package boundaries.
- Chrome smoke follows the actual landing link, verifies muted navigation, stable idle over a whole cycle, reduced motion, playback/pause, replay, scrubbing, resize, missing-image retry and injected context-loss retry.
- Same smoke passes a build mounted under `/fuse-riders/`, checking base-path asset loading and navigation.
- The old Canvas inspector's smoke also passes after the idle change.
- Desktop and narrow-viewport browser screenshots were visually inspected. This is browser emulation, not a physical-phone test or performance qualification.
- The context-loss test dispatches an event; it does not demonstrate recovery from actual GPU loss. Import-timeout/stale-import and BFCache paths were inspected but not directly exercised by smoke.
- Full local suite: 1615 tests, 1606 passed and 9 failed initially. Eight match the Windows failures already reproduced on clean main `0386f4af` in backend-paths, ci-manifest and new-game tests. The ninth caught the missing Docker workspace manifest; fixed and rechecked with `service-image-dependencies.test.ts` plus all four Hook Havok tests (5/5 pass). No test assertions were removed or weakened.
- Builds pass with the existing large-chunk warning. No container execution or deployment was performed.

Run commands are in the README. Root `artifacts/hook-havok-showcase-*.log` and browser screenshots retain local evidence. [Actual browser screenshot](evidence/phaser-showcase-desktop.png).

## Next phase

Implement the deterministic movement playground and solo-room adapter. Keep rendering dependent on a future engine view; replace the authored sequence as the normal play path. Do not copy its keyframe positions or easing into simulation rules. Validate collision, input cancellation, checkpoint rejection and replay independently of this visual prototype.
