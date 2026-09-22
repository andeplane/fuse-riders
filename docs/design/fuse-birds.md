# Fuse Birds — concept specification

Status: V2 visual direction accepted; gameplay and architecture proposed, 2026-09-22. This document and the accompanying generated screenshots describe a new game; no playable implementation is included.

## The pitch

A multiplayer slingshot artillery game for 2–5 friends: the tactile pull-and-release of Angry Birds, the angle/power/wind decisions of classic Tank Wars, and the destructible landscapes, ridiculous weapons and supply crates of Worms. Use original birds, names, sounds and artwork. The fun is making a clever shot, ruining someone's perch, and deciding whether a tempting crate is worth spending your turn on.

Proposed default: one bird per player, free-for-all, alternating turns, 100 health, last bird standing. Birds operate portable slingshots and fire ammunition; firing does not routinely launch your own character. A later special weapon could do that. Target rounds of 5–8 minutes, with a best-of-three room option. All numeric values below are initial tuning proposals.

Phase 1 is now defined by [ADR-052](../adr/052-fuse-birds-phase-one.md): a complete playable 2–5-player online game, single-round matches with rematch, unlimited Pebble, three starting Scatter Bombs with a visible remaining count, Scatter-refill crates, and finished Neon burrow graphics matching V2. Best-of-three, other weapons/powerups and the other theme packs are later scope. A headless-only demo or placeholder renderer does not complete Phase 1.

## A turn

1. See whose turn is next, the wind, health, ammo and the current crate opportunities.
2. Aim from the bird's current position. There is no walking or hopping; birds remain at their generated positions for the whole round, including after explosions.
3. Select a weapon and pull the sling backwards to set direction and power. A short dotted preview explains the initial arc without solving the entire shot.
4. Release to launch one shot. A phone camera can follow the projectile and its impact; the shared TV stays on the full map. Everyone sees the projectile, explosions, damage and crate collection resolve.
5. When the world settles, advance to the next living player. A cancelled drag never fires. A 25-second decision timer prevents stalling; expiry passes the turn without consuming ammo.

Wind is visible and constant for a complete cycle of living players, then changes from the seeded stream. Rotate first player between rounds. Birds have no knockback or fall damage. Rising water reaching a fixed bird eliminates it. If the final explosion eliminates everyone, the round is a draw. After a tunable cycle limit, rising water ends stalemates with a visible warning.

## Weapons and powerups

| Phase 1 weapon | Role                                 | Rule and display                                                                                                               |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Pebble         | Dependable baseline                  | Unlimited ammunition, useful damage and a small crater; display `Pebble ∞`                                                     |
| Scatter Bomb   | Spread damage and terrain disruption | Three per bird per round; split into three weaker fragments; display `Scatter Bomb ×3` and update the number from engine state |

Three starting Scatter Bombs is a proposed balance default. One accepted launch spends one bomb; cancelling, duplicate delivery or a rejected action does not. At `×0`, Scatter remains visible but unavailable and the next aiming turn defaults to Pebble. Reconnecting restores the real count; starting a new round resets it. Exactly two weapon slots appear on phones and the TV; there are no extra unfinished buttons.

Later ideas, outside Phase 1: Boom Egg (larger explosive), Drill Beak (terrain penetration), Bounce Berry (bank shots), Gust Jar (push), Nest Shield, Medkit and Power Feather. They must not enter Phase 1's loot table or action schema merely because earlier concepts showed them. Keep aiming central before expanding the inventory.

## Crates are targets

Wooden ammo crates arrive by parachute between complete turn cycles. Every Phase 1 crate grants one Scatter Bomb refill, capped at five held bombs. Its symbol clearly identifies the reward. Spawn toward reachable terrain with a bounded search and skip a drop when no valid location exists. Cap live crates at three initially.

A projectile touching a crate, or a blast reaching it, claims it for the living shot owner immediately, including while it descends under its parachute. This is remote collection: the bird need not walk over it. Terrain blocks blast collection just as it blocks blast damage. The ammo count updates after the collecting damage batch, but the refill is usable only on a later turn; it cannot change flying fragments or create a second shot. One blast may collect multiple crates in stable crate-ID order. A crate cannot be claimed twice by scatter fragments or replayed inputs. At full inventory the crate is consumed and excess ammo discarded. Merely walking over a crate does not collect it.

Crates fall when their supporting ground disappears; hitting water destroys them. A shot can collect a crate and damage a player. Damage resolves before the refill; an owner eliminated by that damage consumes the hit crate without receiving ammo. No health, shield, mystery or explosive trap crates in Phase 1. A passive descending crate does not block the next turn.

Example: you have a clean shot at a rival for modest damage, but an ammo crate sits above a narrow bridge. Aim at its support and collect it with the blast, potentially dropping the rival too. A good shot can change both inventory and terrain.

## Random maps with deliberate constraints

Use a seed and a versioned generator to produce a side-on, bounded destructible solid/empty grid. This supports hills, shelves, arches, tunnels and disconnected islands, unlike a simple heightfield. Render the collision contour smoothly or as pixels depending on the selected art direction; visual themes never change collision geometry.

Generate large landforms first, cut a small number of caves/arches, then choose player perches and crate sites. Initial families: rolling islands, split canyon and archipelago. Water forms a clear lower hazard boundary.

The map must feel substantially larger relative to the birds than in the first five art concepts. Start prototyping at roughly 128 bird body widths across the playable map, matching the small-bird intent of V2, with several distinct landforms and long-range shot opportunities; this is a tuning target, not a locked balance constant. Provide enough vertical space for high arcs. Tune launch range, blast radius and crate reachability together with this scale so that the larger world creates choices rather than unreachable opponents or tedious traversal. Map dimensions are shared world data and never depend on a device's viewport. At full-map scale, use small player badges and active-turn highlights to help locate birds without enlarging their physical bodies or collision shapes.

Validate minimum spawn separation, headroom, support thickness, launch clearance, survivable footing and reasonable height spread. Reject sealed spawn pockets and immediate lethal spawn configurations. Use a bounded regeneration count and a known-good fallback layout. A seed alone is not proof of balance: sample many seeds and record the failed constraints. Offer a visible seed and rematch/same-map option; no map editor initially.

Explosion circles clear terrain cells deterministically. Unsupported crates fall; birds remain at their fixed launch positions. Floating terrain stays fixed for the first version; loose soil, fluid simulation, debris collision and structural collapse are deliberately outside the first scope. Debris is cosmetic. This keeps the physics readable and affordable while still allowing tactical craters and destroyed bridges.

## Controls and presentation

Support individual-device play and the existing room shared-screen mode with phones as controllers. Desktop: drag the sling, release to fire, Escape to cancel; keyboard angle/power adjustment plus explicit fire should also be available. Touch: drag from the sling's enlarged invisible interaction target to aim, with weapon selection and a visible cancel zone. A relative aim pad can be an accessibility alternative. Pointer cancellation, app backgrounding and disconnection cancel an uncommitted aim. Keep the active bird and trajectory clear above the aiming finger.

The shared TV always fits the full map, including the playable flight envelope, with player health, turn timer, wind and current weapon in screen-space UI. It never adopts a phone's zoom, pans to an individual bird or follows a projectile. Fit the world within the available display area without cropping; letterbox if needed.

Phones have an independently zoomable and pannable battlefield, like Angry Birds, both in individual-device play and when controlling a shared TV. Pinch to zoom around the gesture midpoint; drag empty space to pan. Provide explicit Overview and My Bird buttons, plus accessible zoom controls. Overview fits the whole map; My Bird restores a useful aiming close-up. A minimap or edge indicators locate off-screen opponents and crates. The weapon tray and turn information stay at a fixed readable UI size regardless of world zoom. Players can inspect the map while waiting without changing anyone else's view.

Keep gesture ownership explicit: dragging the sling aims, dragging elsewhere pans, and two fingers navigate. A second finger during an aim cancels the uncommitted shot before pinch navigation begins; releasing either finger must not launch. Freeze camera movement during an active aiming drag and map pointer coordinates through the camera transform so zoom does not change the intended world-space shot. Clamp pan and zoom to useful world bounds; preserve a valid view after rotation or resize and cancel an in-progress aim if the mapping changes.

At turn start, default the active player's phone to My Bird. After release, it can follow the projectile and frame the impact, then return to that bird; a manual navigation gesture interrupts following. Spectators may inspect freely or enable follow. Shared TV remains full-map throughout. Camera state is entirely local presentation and is neither authoritative simulation state nor part of the shared input log. Color, player numbers and distinct silhouettes jointly identify players. Respect reduced motion; do not rely on screen shake or sound to communicate outcomes.

Each initial mock screenshot depicts a four-player turn with the cyan bird pulling a sling, a partial dotted trajectory, a reachable supply crate, uneven cutaway terrain and a compact weapon tray. They are visual proposals, not screenshots of functioning software. Their map-to-bird scale is superseded by the larger-map requirement above. Future concepts should show a full-map TV view with much smaller birds alongside a zoomed phone view of the same map. Keep a recognizable Fuse neon/pixel thread across the options while varying material and mood:

Art direction constraint from the user: graphics should be inspired by Flow Riders, with no background grid. The in-repository visual reference is the existing Riders screenshot, `docs/gameplay-phaser.png`, plus `docs/theme-assets.md` and `games/fuse-riders/src/render/themes.ts`: retain dark navy, cyan/magenta/orange/lime player identities, luminous edges, pixel headings, dark framed player cards and smooth rounded powerup icons. Omit the reference's grid entirely; use a quiet dark sky, subtle gradient or restrained distant scenery. All five directions retain this family; none is a standalone pastel, clay or painterly redesign. Translate the top-down visual language into side-on artillery.

1. **Neon burrow** — dark solid cutaway hills, cyan contour rims, a quiet dark sky without a grid and smooth luminous birds. Closest direct translation of the existing game.
2. **Pixel badlands** — stepped pixel cliffs, violet rock strata and amber terrain highlights, with the same dark navy and neon UI. Strongest retro Tank Wars flavor.
3. **Reactor islands** — floating dark geometric landforms, luminous undersides and sparse industrial surfaces. More graphic and clean, with the same 2D collision reading.
4. **Neon jungle** — dark organic arches, restrained glowing foliage and blue-green terrain edges. Richer environments without obscuring the shot or changing the interface family.
5. **Volcanic circuit** — charcoal terrain, orange fissures, magenta rim lights and cyan players/UI. Strongest warm/cool contrast; glowing scenery is cosmetic unless explicitly marked as water/hazard.

The user has accepted the V2 graphics. These are five themes of the same game, not alternatives requiring a new game-design choice. Start the rendering slice with Neon burrow, then apply the same material/asset pipeline to the other themes. Match the reference's detailed rock, edge light, distant scenery, water and sprite treatment; flat neon polygons are not an equivalent finished look. Do not let decorative details in a generated image silently become mechanics. ADR-051 specifies the asset pack, chunk compositing and visual acceptance approach.

## Architecture proposal and tradeoffs

Architecture decisions are developed in four proposed ADRs: [physics](../adr/048-fuse-birds-physics.md), [headless game library and room adapter](../adr/049-fuse-birds-game-engine.md), [level generation and shot reachability](../adr/050-fuse-birds-level-generation.md), and [rendering and cameras](../adr/051-fuse-birds-rendering.md). These are design decisions for implementation, not completed features. The headless-library boundary and accepted V2 visual direction are user requirements.

Implement a separate `games/fuse-birds/` game using the existing game-independent room, transport, netcode, account and UI packages; do not import Fuse Riders internals. See [the system map](../architecture.md) and [multi-game design](multi-game.md). Proposed game ID: `fuse-birds`; route and registration are implementation decisions to verify against the scaffolder.

The game itself is a library independent of UI and networking. Its default package entry point must support complete matches, map generation, bots, replays and checkpoint recovery in a headless Node process without browser globals, assets or a room connection. Browser rendering and online integration are separate adapters. Callers advance explicit ticks; the library owns all rules and never waits for an animation or UI callback.

Keep terrain, seeded RNG, wind, inventories, turn state, projectile rules, crate eligibility and result resolution in a pure game engine. The renderer consumes a view contract. Use bounded integer/fixed-point physics, a fixed simulation timestep and canonical ordering for simultaneous hits. The shared log carries scoped, validated turn actions (launch/pass), with shot parameters quantized before commitment. Visual aim previews need not be authoritative; final launches must be.

Reuse the existing peer-to-peer room lifecycle and recovery contract. The signalling service must not simulate or relay gameplay. Do not introduce a second network protocol merely because this game is turn-based: first verify how actions fit the current `RollbackGame` adapter. Presentation can animate a shot continuously while engine advancement remains deterministic. Terrain grids increase checkpoint size; bound dimensions and transfer sizes, and measure before choosing compression.

Validate actor, membership generation, match/round/turn, action sequence, weapon ownership and finite bounded shot values. Commit ammo and launch atomically. Duplicate launch packets must not spend ammo twice; old-turn inputs must not fire. Recovery installs a validated checkpoint atomically, including terrain, RNG, active projectiles, inventories and turn state. Rejoining players recover from a peer; do not add local world persistence. Use the existing authority succession mechanism for disconnects and define a logged timeout/pass outcome; local wall clocks must not independently choose the next player.

## Phase 1 delivery

The following are internal milestones of one delivery, not separate phases that lower the finished-game requirement:

1. **Headless library and real art slice:** deterministic Pebble flight/crater, generated terrain and an authored Neon burrow renderer matching V2 at full-map and phone scales.
2. **Complete rules:** limited Scatter Bombs, inventory/refill behavior, wind, validated maps, eliminations, result, rematch and deterministic replay/checkpoint tests.
3. **Online/device integration:** reachable menus and rooms, individual devices, full-map TV plus zoomable phone controls, reconnect recovery and scoped turn actions.
4. **Finished playable game:** final two-slot UI with ammo counts, polished artwork/effects, basic sound, accessibility, real browser evidence and a preview for user playtesting.

All four are required before Phase 1 is complete. ADR-052 supplies the acceptance matrix and later-scope exclusions. The current request prepares ADRs only; implementation, merge and deployment have not been performed.

## Acceptance targets for later implementation

- Identical seed, rule version and ordered actions produce identical terrain, health, inventory and winner across supported browsers.
- Random map validation terminates and gives safe, playable starting positions for every supported player count.
- Direct, blast and scatter crate hits grant once to the correct shooter; collection, death and victory have tested ordering.
- Cancelled aiming, repeated packets, late prior-turn actions and expired member generations cannot fire or consume ammo.
- Terrain collision uses swept projectile tests to avoid tunneling; projectile lifetimes and chain resolution are bounded.
- Reconnect during aiming, projectile flight and terrain settling restores the same world or reports a clear retry state.
- Real browser flows cover joining, starting, aiming, cancelling, firing, collecting, eliminating and rematching in both display modes. Physical-phone feel remains a separate playtest.
- Verify pinch, pan, Overview, My Bird, off-screen markers and interrupted projectile following on phones. A second finger, resize or cancelled gesture must never accidentally fire. Equivalent world-space shots at different zoom levels produce the same quantized launch action.
- With multiple phones at different pan/zoom positions, the shared TV still shows the complete map and flight envelope. Viewport size and camera gestures never change terrain, physics, player identity or another device's camera.

## Design deliverables

The five generated concepts and their exact generation prompts are stored in `fuse-birds-concepts/` beside this spec. The gallery now shows V2: birds roughly one-quarter their original rendered size, expanded terrain and no background grid. Each new image is labelled FULL MAP · V2; the original images remain for provenance. These are full-map TV art mockups, not phone close-ups or implemented gameplay. Art selection can mix a scene style from one option with the interface of another.
