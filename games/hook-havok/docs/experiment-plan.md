# Hook Havok experiment plan

## Delivery boundaries

Name: **Hook Havok**, technical id `hook-havok`. Use TypeScript and the repository's Phaser version. Preserve the existing solo-room architecture: a solo playable game is a room with no peers, not a new offline gameplay path. Tests and an art showcase may run independently.

The first milestone delivers visual concepts, source-asset trials, and this implementation brief. Art remains provisional until reviewed in motion at gameplay size. Later milestones are separate increments, not silently included in this change.

## Phases

### 0. Visual foundation (delivered)

- Record scope, architecture, fixed arena and initial movement hypotheses.
- Compare belfry, observatory and overgrown sanctuary compositions with a small original player silhouette.
- Recommend a direction, record weaknesses, and retain alternatives for user review.
- Preserve exact generation prompts and source files.

Exit: reviewable compositions and an original visual vocabulary. This is not a gameplay screenshot or evidence of runtime performance.

### 1. Asset-production proof

Current increment: separate character/prop sources and a six-pose browser animation trial are delivered. See [animation trial](animation-trial.md) for the exact assets, alignment method, known visual limits and reproduction commands. This establishes the workflow; final animation polish and user acceptance remain open.

- Establish a side-view reference for one lantern keeper.
- Generate and inspect a clean background and platform source.
- Verify actual alpha, source dimensions, and file sizes rather than trusting requested output specifications.
- Produce aligned idle and movement poses, correct silhouette drift, and preview animation at approximately 64 pixels tall.
- Fix sprite scale, baseline, pivots and frame bounds. Create a reusable hook and lantern asset.

Exit: a consistent small kit and a short animation. Static generated assets alone do not complete this phase.

### 2. Browser art showcase

Delivered: a discoverable Phaser page, asset manifest, bounded loading/retry, atmospheric composition and authored sequence with pause/replay/scrubbing. [Showcase details and limits](showcase.md). User feedback led to replacing the sliding two-pose idle with one foot-anchored breathing pose. Actual platform physics and ordinary controls remain Phase 3.

- Create package and page under `games/hook-havok`; verify discovery in build/dev serving.
- Add asset manifest, loading/error/retry states and scene disposal.
- Compose background, platforms, actor, tether, effects and edge-only foreground.
- Add restrained mist and lantern motion; show a repeatable scripted presentation sequence.
- Capture actual browser evidence at normal and reduced display sizes.

Exit: convincing motion and readable terrain. Showcase scripting must not become a second physics engine.

### 3. Movement playground

Implemented: solo room admission, deterministic movement/grapple engine, validated checkpoints, keyboard/mouse controls, reset/respawn, tuning and collision overlay. See [movement playground](movement-playground.md) for controls, architecture and verification. User playtesting remains the acceptance check for movement feel.

- Implement engine-owned state, inputs, tuning, static map, collision, character motion, grapple and view contract.
- Implement validated codec, rules version, replay fixture, and `RollbackGame` adapter for a solo room.
- Add keyboard/mouse controls, cancellation, respawn, restart and debug overlays.
- Add a small tuning panel; changes reset the exercise and are recorded in replay metadata.
- Test buffered/released jumps, high-speed collisions, contact ties, hook misses, attachment, obstruction, release and reset; test deterministic replay and checkpoint rejection.

Exit: predictable movement without decorative effects, no tunneling or stuck hook states.

### 4. Feel and audio

Implemented: view-derived pose selection and restrained feedback, six synthesized effect cues, separate volume controls, gesture/mute/disposal handling and an opt-in shared radio. Existing movement tuning is unchanged pending the user's later movement discussion. See [feedback and audio](feedback-audio.md).

- Derive idle/run/rise/fall/land/fire/pull animation from engine view; never derive physics from animation frames.
- Add landing compression, dust, attachment flash, tether tension and release feedback.
- Inspect and extract the existing game-local radio and music catalog into an appropriate shared module; reuse existing music files. The main-based worktree currently has the radio in `games/fuse-riders/src/client/radio.ts`; the Ball Bros branch has a proposed `fuse-ui/assets` catalog, which must not be assumed to exist on main. Reconcile with the latest main before implementing. No cross-game imports.
- Add short jump/land/fire/attach/release/respawn effects with bounded concurrency, gesture unlock and teardown.
- Respect `?mute`; keep effect and music volume independent.

Exit: feedback clarifies rather than hides movement. Shared consumers retain working radio behavior.

### 5. Single-player POC review

Technical review complete: ordinary-input traversal/recovery fixture, real browser route, small-scale/grayscale captures, caption occlusion fix and reproducible headless benchmark. [Review findings and evidence](poc-review.md). User acceptance of movement feel remains pending; jump/grapple tuning is unchanged.

- Playtest a repeatable route: ordinary jump, central gap, high anchor, release-and-land, awkward recovery, fall/reset.
- Review small-scale readability, grayscale, frame alignment and foreground occlusion.
- Run focused tests, typecheck/build, affected browser flow, and full unit suite at integration.
- Measure a documented traversal workload; record revision, browser/device and limits.
- Deliver reviewed PR and muted preview for user playtesting; do not merge or deploy without authorization.

### 6. Later experiments

- **6A — Solo combat sandbox:** implemented per the user's selected experiment. Switch between movement, a knockback effigy and one bounded splitting ball. Includes first-contact shot resolution, split limits, target falls/return, checkpoint validation, hit feedback/audio and real-room browser checks. See [design and playtesting](combat-sandbox.md). User assessment of aiming and knockback feel remains open.
- **6B — Controls trial:** same-device touch controls implemented, with independent move/jump and aim/hook pads, eight-direction/free aiming comparison and portrait/landscape layouts. Native Chrome multi-touch emulation checks pass. [Physical-phone playtesting](touch-controls.md) remains necessary before choosing the aiming model; TV pairing belongs to the multiplayer increment.
- **6C — Multiplayer:** shared free play implemented for 2–5 keepers, with player knockback, independent respawn, invite/join, refresh recovery, seatless display and manager succession. Deterministic replay/impairment tests and real WebRTC browser checks cover the shared runtime. See [design and playtesting](multiplayer.md). Scoring, elimination and dedicated controller-only pairing remain later decisions.
- **6D — Rules comparison:** implemented free play, last-keeper elimination and timed hook scoring, with countdown, locked entrants, late-join waiting, forfeits, shared results and manager restart. See [rules and verification](rules-comparison.md). User comparison should decide which loop to develop next. Additional maps, procedural generation and bespoke music remain undecided.

### 7A. Presentation and readability

Implemented a compact playground header, colour/number player cards, readable in-arena badges, consistent remote/local animation poses and a reversible **Focus arena** view. Focus mode keeps player identity and competitive round status visible while moving setup/workshop controls out of view. Actual-browser verification covers five keepers, literal player names, phone portrait/landscape and a seatless display. See [presentation details](presentation.md).

Map geometry, movement, scoring, generated art sources and audio remain unchanged. Further arena layouts, costume/animation refinement and bespoke music should follow user feedback on the current loop.

### 7B. Art-production trial

Implemented the proposed first art increment: five costume colours and hood crests, a refined nine-pose keeper atlas with dedicated action silhouettes, outlined tethers and sharper impact effects, and integrated stone lighting/cloth dressing in the existing belfry. [Sources, exact prompts, limits and real-room evidence](art-production.md). Source alpha and cell separation are validated by the live loader. Gameplay rules, geometry and networking remain unchanged. Final animation polish, bespoke costumes and user acceptance are still open.

### 7C. Arena-design trial

Implemented selectable **Crossroads**, a symmetric fourteen-platform competitive layout with five separated starts, two jump-climb routes and central grapple opportunities. **Lantern Belfry** remains the default. Selection uses validated shared settings and resets the trial; physics, props, checkpoints and rendering all use the chosen geometry. See [design, playtesting and browser evidence](arena-trial.md). Rules are `hook-havok-6`; refresh all clients and create a fresh room. Competitive balance and physical-phone feel remain for user comparison.

### 7D. Finished arena section

Implemented a richer slate/iron/plum/amber visual language and a reusable painted environment kit on the three central Crossroads ledges as a lantern shrine. Surrounding ledges remain for comparison. See [art direction, sources and browser evidence](lantern-shrine.md). User assessment at desktop and phone scale should guide expansion.

### 7E. Arena depth and environmental animation

Implemented the shrine kit on all fourteen Crossroads platforms, with an original ruined-cathedral painting, distant central monument, varied ivy/candles/banners, banner sway, candle flicker, local embers and sparse dust. The existing fog remains a separate moving layer. Atmosphere and live reduced-motion preferences stop environmental motion. Belfry retains its earlier appearance and map geometry/rules are unchanged. See [sources, playtesting and browser evidence](cathedral-atmosphere.md). User assessment should guide further density and animation polish.

### 7F. Character animation and combat spectacle

Implemented a dedicated eight-frame run atlas with scarf motion, speed-driven cadence, foot registration, takeoff/landing recovery, hook recoil, victim-only impact reaction, directional hit accents, short airborne silhouette echoes and distinct exit/arrival effects. Local/remote keepers share presentation logic; reduced motion suppresses optional movement while retaining action silhouettes. Final elimination feedback survives the results transition. See [sources, limitations and verification](character-polish.md). Input, physics and rules remain unchanged; the generated frame animation still needs user assessment in motion.

### 7G. Freer bouncing-ball experiment

Implemented gentle and surge arena-wide presets alongside the bounded exercise: solid platform ricochets, different speeds/bounce heights and an explicit ball-only bottom boundary. Luminous split-family colours, animated cores, velocity trails and coloured split bursts remain cosmetic. The family grows from one large orb to at most four small orbs; more initial families and independent tuning sliders remain follow-ups if playtesting supports them. See [rules, tradeoffs and verification](ball-ricochets.md). Rules are `hook-havok-7`; refresh all clients and use a fresh room. User comparison should guide the next ball balance and interaction choices.

### 8A. Splash screen and main menu

Implemented an original cathedral entrance painting, live ivory/gold title, subtle drifting embers, Create room, Join room, How to play and Settings. Solo practice uses the same room flow. Native dialogs support keyboard/touch navigation; valid invites, refresh and shared displays enter directly. Loading, connection failures, separate illustration/graphics retries and application-load retry are covered. Existing atmosphere/audio/touch controls move between menu and workshop without duplicated state. See [source, behavior and browser evidence](entrance-menu.md). Rules and gameplay are unchanged; the workshop remains inside the room pending 8B.

### Control trials after 8A

Implemented optional spiked-wire ball contact, a second airborne jump (also available after dropping), and eight-direction keyboard aiming with J / Space jump and K hook. Shared Jump/Tether settings restart the trial; local keyboard mode preserves mouse mode as a comparison. Defaults retain the original behavior. See [controls, exact rules and verification](control-trials.md). Rules are now `hook-havok-8`; refresh all clients and create a fresh room. Playtesting should determine whether these become defaults.

### 8B. Room lounge, match HUD and results

Implemented a collapsible room lounge for invitations, match choices and manager status; illustrated P1–P5 cards, mode/map/timer HUD, countdown, late-watcher status, winner reveal and manager rematch/free-play actions. Numeric tuning, debug, art showcase and control experiments live in a collapsed Development workshop. Focus mode preserves the HUD and phone touch controls. Identity selection remains the existing pre-entry keeper name with assigned seat/color; this does not add an avatar picker or ready-vote protocol. See [behavior, review fixes and real browser evidence](match-shell.md). Rules remain `hook-havok-8`.

### 8C. Cohesion and local performance qualification

Implemented a lighter fog veil, keeper contact shadows, readable out/away cards and visible keyboard focus. Removed repeated crest drawing, copied pose-history scans and unchanged UI text writes; frozen environmental drawing is cached with map/settings invalidation. Reduced motion now also covers showcase landing/sparks. A reproducible five-player Crossroads/surge workload records browser callback cadence, task time and actual scene activity, with raw before/after evidence and exact source provenance. Existing arena and asset/context-recovery checks pass. See [measurements and limits](cohesion-performance.md): caption mutation dropped, but the short runs do not establish a CPU or frame-rate speedup. The local pass is complete; physical-phone qualification and user acceptance remain open.

### 9A. Shared power-up trial

Implemented optional Lift and Ward pickups on both maps, shared cooldowns, protection feedback and manager-controlled activation in Room & match. Deterministic collection and validated checkpoint state use rules `hook-havok-9`; refresh all clients and create a fresh room. See [rules, playtesting and verification](power-ups.md). User acceptance of balance and feel remains open.

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
