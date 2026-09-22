# ADR-050: Seeded destructible levels with verified shot reachability

- Status: Implemented; finite range/map corpus verified with documented late sudden-death cases
- Date: 2026-09-22
- Related: [concept spec](../design/fuse-birds.md), [physics](048-fuse-birds-physics.md), [game engine](049-fuse-birds-game-engine.md), [rendering](051-fuse-birds-rendering.md)

## Context

The approved V2 graphics establish a large landscape with very small birds. The user explicitly requires that every opponent remain possible to reach. Scaling up scenery without scaling and validating the shot model can create attractive but unplayable maps. Euclidean distance, a clear horizontal ray or a formula for maximum range does not prove a legal shot clears an intervening ridge.

Themes are visual skins over one game. A jungle map must not have different collision rules from a reactor map merely because its art is organic. Geometry may vary independently by seed and layout family.

## Decision

[ADR-052](052-fuse-birds-phase-one.md) fixes the initial scope: random playable maps in the finished Neon burrow theme, unlimited Pebble for all reachability checks, and a single crate reward of Scatter Bomb ammunition. Multiple geometry families and the other visual skins may follow; one robust family with genuine seeded variation and validated fallback is sufficient for Phase 1.

Generate a bounded binary occupancy grid deterministically from a seed, generator version, rule version, dimensions, layout family and player count. Keep terrain generation in the pure game engine, using the exact projectile kernel and legal launch vectors from ADR-048 to validate shots. Do not ask image generation or rendering to produce collision geometry.

Generation and validation are public headless library operations as defined in ADR-049. A command-line seed sweep must use the same resumable job as a live match and require no renderer, textures, browser worker or room connection. Worker scheduling is an optional adapter, not part of the algorithm.

### Current implementation decisions

Phase 1 uses one seeded ridge/arch family: integer control-point heights, widely separated high starting perches, and deep elliptical arches. Spawns follow stable roster order; first-turn rotation is separate. The proposed seeded spawn permutation and additional families are deferred. Every accepted layout still needs a real directed Pebble witness for each starting pair in all five winds. A witness currently stores the vector and wind; its impact/damage are reproducible with `traceShot`, rather than duplicated live state.

Preparation allows four procedural candidates and a flat fallback. Work is cumulative across retries and bounded to one million candidate/physics steps, with 2,200 per logical tick. Atomic traces defer when their worst case would exceed the current tick quota. The final 200,000 units are reserved for fallback. The fallback recomputes its witnesses with the same runtime validator instead of trusting shipped certificate vectors; failure enters an explicit fault. These are deterministic work limits, not latency measurements.

Supply searches are similarly checkpointed: eight seeded sites, up to 24 vectors per living grounded bird/site, 2,200 units per tick and 100,000 overall. Sites use current terrain and wind when tested; a successful trace spawns the descending interactive crate. No pending job blocks the next turn. Wind/supply RNG consumption follows ADR-049.

Rules 4 corrects supply certification to use the actual ten-cell-wide crate. A vertical sweep from the proposed drop position predicts its resting contact, including off-center ledges; occupied starts and submerged rests are rejected. Candidate shots use that crate collider, the live direct/blast pickup predicate and a living collecting owner, rather than a bird proxy at the center column's ground height. A ledge regression verifies predicted versus actual descent and reproduces the admitted shot as a live pickup. Terrain changes or other actions after certification can still change the tactical situation.

The continuing-play verifier (`scripts/fuse-birds-continuing-check.ts`) uses launch/pass only. Every witness must start from the current bird position; walking and hopping cannot qualify a map or escape route. Rules-5 movement-based corpora are superseded. Regenerate and independently replay stationary Pebble routes under rules 6.

The original launch model failed low-to-high cross-map and vertically aligned targets. ADR-048 increases the cap and adds direction-aware muzzle placement/downward aiming; `range-envelope.test.ts` retains both-direction, seven-height, five-wind edge checks and vertical cases. `scripts/fuse-birds-map-check.ts` also sweeps 400 maps and 1,050 terrain-free position/wind cases, retaining its report and counterexamples. Post-destruction escape qualification below is still required. Opening witnesses alone must not be reported as continuing-play proof.

### Two distinct reachability requirements

The old hard-coded late-water comparison is retired with the movement-based replay. Any new unresolved case must be investigated from its actual stationary-rule checkpoint; rising water alone does not establish shot reachability.

**Opening fairness:** from every assigned starting perch, every other player's starting body must be damageable in one legal shot with unlimited Pebble ammunition, without digging, self-elimination, rare weapons or crate luck. Check directed pairs: A hitting B does not prove B can hit A. Check every permitted initial wind state, not only calm air. For five players this is 20 ordered pairs per wind state.

For each pair, retain at least one witness: quantized launch vector, wind, flight length, first impact and target damage. A successful witness must use the actual collision and blast-exposure rules, including the other starting birds as possible blockers. Simulate each candidate against an isolated scratch copy of the same initial terrain, health and inventory, through impact and settlement; a failed candidate must not leave a crater that makes the next one pass. Prefer a small neighborhood of successful nearby launch vectors to reject maps that require a single barely representable trick shot. The minimum neighborhood is a versioned generation parameter.

**Continuing play:** the game's range envelope must cover the full allowed live-bird position/elevation domain, not just spawn points. Within that domain there must be a legal terrain-free trajectory to every other valid body position for every allowed wind state. Validate this envelope against the quantized kernel during development; reduce world bounds/wind or increase baseline launch capability if it fails. Wind must never make a distant opponent permanently unreachable.

Terrain can still provide temporary cover during play. The opening one-shot certificate is not a promise that every opponent is directly exposed on every later turn. Unlimited baseline ammo destroys every solid cell; no theme introduces unbreakable cover, and there is no ammo-based soft lock. Shots may deliberately open a route before the next attack. That is a tactical choice after play changes the terrain, not an excuse for an invalid starting map.

Starting perches need a launch-clearance mask above their footing, checked with actual outgoing trajectories. Do not automatically erase roofs when a bird settles: that would add unrequested free excavation and could unexpectedly drop another player. Blast displacement, falls and craters can create later launch pockets; an ordinary Pebble hitting nearby terrain must still explode and remove material, with normal self-damage. This permits tactical excavation but is not, by itself, a proof of escape.

The continuing-play requirement is an implementation obligation, not yet an established property. Unlimited ammo, local headroom and destructible cells alone do not prove it: a bird may lack an escape shot, and self-damage can make excavation fatal. Before accepting a geometry family, test the terrain-free range envelope over source height, target offset, launch quantization and all wind states, with the real world ceiling/bounds and lifetime. Also test reachable post-shot states for a damaging shot or a finite survivable sequence of ordinary Pebble excavation shots toward each opponent. Retain explicit counterexamples and replayable action witnesses; a seed sweep provides coverage, not a mathematical proof for every possible later state.

If that check finds a permanent inaccessible living player, constrain the geometry family, legal settling domain or baseline launch rules and repeat the validation. Do not call the requirement solved by adding a rare drill, teleportation or free terrain removal. It does not guarantee a win, a one-shot route through later cover or freedom from a strategically bad position. Rising water ensures termination, but does not substitute for reachability. Freeze supported map/rule bounds only after the range and trapped-position prototype resolves these counterexamples; until then this ADR's ongoing reachability guarantee remains unverified.

### Generation pipeline

1. Derive independent terrain and spawn RNG streams from the round seed using a pinned integer PRNG and stable domain tags. Do not use browser randomness or depend on object iteration order.
2. Choose a layout family: rolling ridges, split canyon or archipelago. Sample a low-frequency profile from integer control points, then rasterize land masses into the bounded grid. Preserve overhead flight space and a clear lower water boundary.
3. Cut bounded caves, arches and gaps with integer masks. Enforce minimum support and passage sizes relative to the bird collider. Include several useful heights without creating an impenetrable roof.
4. Find candidate supported perches with the launch-clearance mask, separation from water and world edges, and adequate support thickness. Spread candidates horizontally and limit initial height advantage.
5. Assign perches to player slots with a seeded permutation. Rotation of first turn is separate from map generation. Check health-neutral starting footing, pair separation and the absence of overlapping bodies or instant falls.
6. Validate all directed shot pairs for every allowed initial wind state with the real kernel. Reject the layout or deterministically repair the blocking terrain and revalidate; a repair invalidates all affected prior certificates.
7. Select reachable supply sites and record geometry hash, accepted attempt index, generator version and witness data for diagnostics. Decorations are generated separately by the renderer.

Use a small finite wind set initially, provisionally five integer acceleration values including calm. The actual values are pinned after the range-envelope tests pass. Do not validate only the two extremes: terrain and discrete launch vectors can make an intermediate wind state fail even when extremes pass.

### Validation strategy and cost

Use cheap geometry rejection first, then test a deterministic catalog of candidate vectors ordered toward likely ballistic solutions. Candidate ordering is an optimization only: acceptance still requires a successful real shot. An incomplete search may reject a playable layout; it must never accept an unverified one. Do not expose witness solutions in normal UI.

Bound work by counts of candidate maps, candidate vectors and simulated projectile steps, never elapsed milliseconds. Use a provisional total budget of one million projectile steps across at most four procedural attempts, followed by a versioned fallback. This is a starting budget to profile, not a proven latency target. Early failure can reject a candidate before testing every pair. A map cannot become acceptable merely because the budget ran out.

Maintain known-good fallback layouts for each supported player count, tested against the same rules, wind set and launch-clearance requirements. Fallback selection is deterministic. Ship their witness vectors and verify those few shots at runtime before starting; a stale fallback certificate must fail visibly rather than launch an invalid match. Physics or baseline weapon changes invalidate generation fixtures and fallback certificates together.

Run generation as a deterministic resumable preparation job: fixed work quota per engine tick, with its PRNG, attempt index, cursor and partial validation state in the checkpoint. Other clients should see a preparation phase with progress and errors, not a frozen browser. A worker may later evaluate the exact same job for responsiveness, but result arrival time cannot become an authoritative transition; do not block a netcode tick waiting on an unbounded worker promise. Optimize only after measuring the first bounded implementation.

### Crate placement during a round

Crates use current terrain, current birds and the baseline shot model, not stale spawn certificates. At each eligible cycle boundary, sample a bounded set of safe supported sites. Avoid placing a crate inside a bird or below water. Require at least one living bird to have a legal collection shot from its current position in the upcoming wind; prefer multiple contenders and avoid repeatedly favoring one seat. A fairness preference may fall back to a single contender, but reachability may not.

The initial crate is interactive during its descent, matching the visible parachutes in the accepted screenshots. Spawn above a validated landing site, bound its vertical speed with a deterministic parachute rule and simulate its actual collider each physics step. It can be shot or blasted for collection before landing, and unsupported landed crates resume falling. Use the same cell/world caps and settling rules as other bodies; no client animation callback activates it. Players need not wait for a landed crate: only moving birds/projectiles block the next turn; a descending supply crate does not. The target site is a reachability certificate for an undisturbed landing, not a promise the crate remains safe after another shot changes the terrain. Skip a drop with no validated site within budget.

### Persistence and theme separation

Initial generation is reproducible from its manifest. After play starts, current terrain is a packed bitset in state/checkpoints; seed and shot history are not a substitute for bounded checkpoint recovery. Hash occupancy in canonical order along with the generator/rule versions and current physics state. Diagnostic witnesses may be stored outside live state after preparation; they do not authorize later client actions.

Theme ID selects palettes, textures, flora, rock layers, sky and cosmetic particles. It does not select gravity, wind, collider dimensions, blast radii, terrain masks or hidden surfaces. A seed rendered in all five themes must have identical occupancy, spawn points and replay hashes. A volcanic theme's decorative lava is not an additional hazard: playable hazard boundaries need the same explicit visual treatment across themes.

## Alternatives and consequences

- **Unconstrained random noise:** visually varied but not a fairness guarantee; rejected.
- **Distance-only range checks:** miss elevation, wind, quantization and occlusion; rejected as acceptance criteria.
- **Require a drill or lucky crate to reach an opponent:** violates baseline playability; rejected.
- **Symmetric maps only:** an available future mode, but not required when validated asymmetry offers more variety.
- **Always hand-authored maps:** appropriate for deterministic fallback, but not the requested random geometry as the main path.

The validator deliberately favors a playable subset over maximal randomness. All-pairs validation costs more than generating scenery; retain witnesses, failure reasons and budgets so the cost and acceptance rate are visible. Do not expand the maximum map size because the art looks good before the baseline weapon envelope and phone budgets pass.

## Validation

For each player count and wind state, run fixed seed corpora, assert all opening witnesses and record attempts, rejected constraints, fallback frequency and total simulated work. Check narrow tunnels, tall central ridges, edge spawns, overhangs, scatter craters, islands cut off by explosions and birds settling at the lowest/highest allowed positions. Test the continuing range envelope and launch-pocket escape independently from spawn fairness. Verify isolated candidate simulations, a crate intercepted mid-air, destroyed landing support, and bounded crate-site search while a room remains responsive.

Mutation-test the acceptance criteria by reducing baseline speed, increasing wind, inserting an occluding ridge or removing a perch's support: the relevant witness or validator must fail. Replay accepted seeds on supported browsers and compare occupancy, accepted attempt and spawn hashes. An attractive generated screenshot is not map-validation evidence.
