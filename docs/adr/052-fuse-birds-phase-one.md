# ADR-052: Phase 1 is a complete two-weapon game with finished graphics

- Status: Phase 1 implementation contract delivered in open PR #407; user playtesting before merge
- Date: 2026-09-22
- Related: [physics](048-fuse-birds-physics.md), [headless game engine](049-fuse-birds-game-engine.md), [generation](050-fuse-birds-level-generation.md), [rendering](051-fuse-birds-rendering.md), [concept](../design/fuse-birds.md)

## Context

The user defines Phase 1 as a fully playable game with nice graphics, an unlimited basic Pebble, and a few Scatter Bombs with the remaining number visible beside the weapon. Earlier drafts included Boom Egg, several powerups and prototype-first delivery stages that could be mistaken for acceptable Phase 1 endpoints. They are broader ideas, not the delivery contract.

The approved V2 images remain the visual target: small birds on a large detailed battlefield, no grid, neon Riders identity, zoomable phones and full-map shared TV. Their four-slot weapon tray is concept art, not a requirement to implement those extra weapons.

## Decision and precedence

Phase 1 delivers one complete 2–5-player online game with exactly two usable weapons and one fully finished visual theme. The game remains a headless library; UI, renderer and networking are adapters. ADRs 048–051 define its architecture; this ADR controls which features ship in Phase 1 wherever their broader examples differ. No game implementation, merge or deployment is performed by writing these ADRs.

Use Neon burrow V2 as the first finished theme. The other four accepted styles remain future skins of the same game; their asset packs do not block Phase 1. Random terrain within the finished theme is required, so this is not a single fixed scene disguised as a game. The material registry and terrain contract allow later themes without different physics.

### Exact starting loadout

| Weapon       | Phase 1 rule                                                                           | Visible tray label                       |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Pebble       | Unlimited; one projectile with direct/blast damage and a small terrain crater          | `Pebble ∞`                               |
| Scatter Bomb | Three shots per bird at each round start; each shot splits into three weaker fragments | `Scatter Bomb ×3`, then `×2`, `×1`, `×0` |

Three is an initial balance decision, not a user-specified exact count. Start every bird equally; keep this a named versioned rules constant rather than duplicating the value across UI and engine. Phase 1 does not need a room slider for starting ammunition.

The Pebble must remain useful for reaching and damaging every opponent after Scatter runs out, and its small blast must allow terrain excavation. No Boom Egg, Shield, Drill Beak, Bounce Berry, Gust Jar, Medkit or Power Feather in Phase 1's inventory, tray, loot table or playable action schema. Do not show disabled teaser slots for unfinished weapons.

### Scatter behavior and inventory correctness

A committed Scatter launch spends one bomb atomically, regardless of the number of fragments or enemies hit. Dragging, selecting, cancelling, rejected/stale inputs and duplicate packets spend nothing. Store a finite integer `scatterAmmo`; represent unlimited Pebble by its rule, not numeric Infinity in serialized state. A repeated action or rollback must not double-spend or invent a refund.

The upward-moving parent splits on the first physics step where its vertical velocity crosses from upward to non-upward. Use the integer launch lattice in ADR-048 and a fixed three-vector spread relative to its current velocity. If an admitted launch has no upward segment, split at its first physics step at the launch point, after checking immediate contact. Parent contact before the split detonates once with a defined early-impact profile, consumes the parent and suppresses splitting; collision wins an exact apex/contact tie. A split replaces the parent without a parent explosion. Children inherit owner, shot ID and the original shot's absolute expiry, have stable child IDs, and never split recursively. These rules belong to the phase order in ADR-048, not an independent render timer.

The first balance fixture pins parent/fragment damage, blast radius, launch spread and lifetime. Tune total damage so Scatter rewards coverage and terrain disruption without making Pebble irrelevant. This document does not pretend that untested damage values are already balanced.

Render counts from the current engine view, not a local click counter. At zero, keep Scatter visible with `×0`, make it unavailable, and select Pebble as the default for the next aiming turn. The host application clears a pending Scatter aim if a corrected view makes it illegal. An invalid release never silently fires Pebble; switching weapons while dragging cancels that drag before changing selection. A rejected launch preserves ammunition and reports why the shot was not accepted.

The active player's tray appears on their own device and the shared TV; other devices show the correct current player/turn state. Screen readers announce both weapon and remaining shots. The number must remain visible at phone portrait and landscape sizes, independently of map zoom. Unlimited ammunition displays a clear infinity indicator and an accessible "unlimited" label.

### Keep crates small in scope

Preserve the original shoot-to-collect supply-crate requirement with one Phase 1 reward: **one Scatter Bomb refill**. Use the same crate and parachute visual language as V2. Direct or blast contact collects once for the living shot owner, including in flight. Add one to their inventory, capped at five; excess is discarded and the crate is consumed. Full inventory does not prevent damage from the collecting shot. A refill is available for a later turn and cannot add a second shot or alter flying fragments.

Keep the existing bounded cycle-based drop schedule, reachable landing-site validation and maximum three live crates. Crate identity/reward is public and unambiguous; there are no mystery weapon categories, health or shield pickups yet. A Scatter shot can collect several crates, but each grant is deduplicated separately and the ammo cap still applies. Starting inventory resets to three each round, not on reconnect or temporary absence.

### What fully playable includes

- Reachable game entry, create/join room, clear 2–5-player lobby and host start, current player/turn indication, instructions and a working leave/rematch path.
- Individual-device play and shared TV plus phone controllers through the existing online room system. No always-running physics server, new relay, or production deployment requirement for this delivery.
- One bird per player, bounded movement/hop, pull/release aiming with cancellation, partial trajectory preview, both weapons, seeded wind, destructible random terrain, damage, falls, eliminations, turn deadlines, finite sudden death, result and rematch. Use single-round matches initially; a best-of-three configuration is later scope.
- Phones can pinch/pan, recenter and inspect the full map. The shared TV always shows the whole playable map. Camera navigation cannot fire or affect physics.
- Shootable ammo crates, readable inventory counts, complete turn resolution, and healthy recovery or explicit retry on peer failure. Reconnect restores terrain and ammunition from peers rather than resetting the player.
- A full headless match/replay/checkpoint path through the public library API, with the same rules used by the browser.
- Finished Neon burrow artwork and HUD, legible impacts/explosions, feedback for crate collection, weapon selection, damage and victory, and basic sound with mute/reduced-motion support. A silent or reduced-motion session must still communicate every outcome visually.

New leaderboards, awards, career screens, sophisticated AI opponents, additional themes, advanced weapons, terrain editors, replay-viewer UI and public deployment are outside the Phase 1 acceptance list. Reuse existing account/room capabilities without creating a parallel platform. A scripted headless opponent/test driver is verification infrastructure, not a promise to ship a bot mode. If the shared runtime's solo contract requires an adapter policy, disable the unsupported solo menu path explicitly rather than presenting broken AI play.

### Finished graphics are part of Phase 1

Follow ADR-051's authored-asset and chunk-compositing recipe. The game must retain the V2 material richness: faceted/stratified dark rock, thin cyan edge light, layered navy scenery, animated water, coherent tiny birds and shaded supply/weapon art. Adapt the HUD to exactly two weapons; the old four-slot mockup is not an acceptance screenshot for inventory layout.

Use real assets and game views. A flat-color physics demo, a noninteractive screenshot background, or an art-only harness does not complete Phase 1. Newly cut crater faces must get the same material/edge treatment; removed support removes its decorations. At phone close-up scale, artwork reveals detail and remains readable. Full-map view preserves small birds with compact identity labels. No background grid and no giant birds added to compensate for missing close-up controls.

Build one complete rendered shot early, then extend that same implementation into the complete game. This makes visual feasibility part of the work rather than postponing it until after all networking/features are finished. Internal milestones below are work checkpoints, not reduced versions to hand off as "Phase 1 done."

## Implementation sequence

1. **Library and render slice:** bounded headless state/tick/checkpoint, Pebble flight and crater, a real generated terrain view and authored Neon burrow material/sprite pack. Show full-map and phone-close-up rendering of that shot. Establish collider/visual parity and snapshot cost before expanding.
2. **Complete local rules:** turn lifecycle, movement/settling, Scatter splitting, exact ammo counts, refill crates, range/generation validation, deaths, finite round ending and rematch. Run full headless matches and focused deterministic replay tests.
3. **Online/device integration:** room adapter, game menu/lobby, two device modes, gesture ownership, input dedupe and recovery. Use the same library and renderer; there is no second temporary gameplay implementation.
4. **Finish and playtest:** sound/effects, loading/error/retry screens, final two-slot HUD, responsive layout, reference-image comparison, real browser tests and a runnable muted preview. Fix scope-relevant defects before declaring completion.

## Acceptance evidence

| Area                    | Required evidence for Phase 1                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory               | Round starts at `∞` / `×3`; accepted Scatter launch decrements once; cancel/duplicate/late/rejected inputs do not; zero disables Scatter; refill adds one up to five; reconnect preserves count; rematch resets it                      |
| Scatter physics         | Apex split, early collision, exact contact/split tie, stable three children, one-shot accounting, inherited expiry, multiple crate hits and final-fragment double elimination                                                           |
| Headless boundary       | Complete match through default package import in Node without DOM/Phaser/room service; same action log hashes in supported browsers; checkpoint continuation matches uninterrupted play                                                 |
| Maps                    | Directed opening hit witnesses for each supported player count/wind, bounded generation/fallback, broad seed corpus and explicit range/launch-pocket counterexamples as required by ADR-050; Pebble cannot be made obsolete by map size |
| Browser gameplay        | Create/join/start, move, aim, cancel, launch both weapons, collect refill, eliminate, finish and rematch; run the affected flow with real room transport and verify recovered terrain/ammo                                              |
| Camera/input            | Shared TV remains full-map while two phones use different camera views; pinch/resize/blur cancel safely; counts remain readable and zoom does not alter a quantized shot                                                                |
| Graphics                | Captures from the real playable flow against V2 at full-map and phone zoom; multiple generated maps, new crater surfaces, removed decorations, no grid and no placeholder art in ordinary play                                          |
| Reliability/performance | Relevant focused and integration checks, encoded snapshot below transport bounds, measured generation/frame/upload costs with seed/device/viewport retained; explicitly separate emulated browsers from physical-phone/TV evidence      |

Run repository checks appropriate to the implementation and open a reviewed pull request when the game is ready. Provide a runnable preview for the user to try the feel and graphics. Stop there unless the user authorizes merge/deployment for that change. Documentation readiness is not a claim that the acceptance evidence already exists.
