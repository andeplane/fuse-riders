# ADR-048: Fuse Birds deterministic artillery physics

- Status: Implemented and independently reviewed in PR #407
- Date: 2026-09-22
- Scope: Fuse Birds only
- Related: [concept spec](../design/fuse-birds.md), [game engine](049-fuse-birds-game-engine.md), [level generation](050-fuse-birds-level-generation.md), [rendering](051-fuse-birds-rendering.md)

## Context

Fuse Birds is side-on slingshot artillery on destructible terrain. Small birds inhabit a large world; phones zoom in, while a shared TV shows the whole map. Those camera choices cannot affect trajectories or collisions. Every peer must reproduce the same shot, crater, fall and pickup after replay or checkpoint recovery.

The required physics is narrow: ballistic projectiles, simple bodies, explosions, terrain removal, knockback and falling. There is no requirement for rotating rigid bodies, piles of debris, rope dynamics or fluid simulation. A general-purpose physics world would introduce additional solver and serialization behavior that this game does not need.

## Decision

[ADR-052](052-fuse-birds-phase-one.md) defines the Phase 1 deliverable: unlimited Pebble and limited Scatter Bomb, with shootable Scatter-refill crates. Other weapon examples in this ADR are future extensions, not Phase 1 requirements.

Build a small pure TypeScript physics kernel inside the new game's engine. Do not use Phaser physics or introduce Matter, Box2D or Rapier as the authoritative simulation in the initial implementation. This is a scope decision, not a claim that those libraries cannot be deterministic. Reconsider only if later mechanics require a general rigid-body solver and its replay/checkpoint behavior is demonstrated.

The kernel owns a binary terrain grid, fixed-step ballistic motion, swept collision and explosion geometry in `games/fuse-birds/src/engine/physics.ts`. The game reducer owns body settling, turns, ammunition, winners and facts. No engine imports from rendering, browser APIs, other games or networking packages.

It is part of the default headless game-library entry point in ADR-049. Collision masks come from engine data, never loaded image alpha. Running physics, generation or a complete match in Node must not initialize Phaser or require any UI. Browser animation and headless replay call exactly the same kernel.

### Coordinate system and arithmetic

Use world cells independent of screen pixels. Positive x points right and positive y points down. The first prototype uses a bounded 1536 × 768 terrain grid and a bird body approximately 12 cells wide, giving about 128 bird widths across the map. The playable surface occupies only part of its height; the rest reserves space for trajectories. These are initial tuning values, not measured performance results.

Positions, velocities and accelerations use signed integers with 256 subunits per cell. Store velocity as subunits per simulation step and acceleration as subunits per step squared. Freeze rounding rules: integer division truncates toward zero unless a named operation explicitly requires floor division, such as converting a negative coordinate to a grid index. Reject non-finite, non-integer and out-of-range state at boundaries.

Use JavaScript numbers only where the full intermediate arithmetic stays within the exact integer range. At the checkpoint bounds, coordinate differences are below 410,000 subunits and velocity magnitudes at most 8,000: fraction cross-products are below 3.4 billion, squared distance sums below 340 billion, and damage/impulse products below 1 billion. These fit safely below 2^53, so the implemented collision kernel needs no BigInt. Recalculate these bounds before enlarging the world or velocity limits. Intentional 32-bit coercion is limited to the PRNG/hash and packed-mask operations. Do not call native trigonometry, random generators or wall clocks in the kernel.

Launch actions carry a bounded quantized velocity vector selected from the engine's legal launch set. Implementation replaces the proposed angle/power lookup table with an exact integer lattice: vx is −3072…3072, vy is −2560…2560, both multiples of 16, and `abs(vx) + abs(vy) >= 128`. Both weapons use this small versioned predicate instead of a generated angle table. The slingshot maps its pull directly to that lattice; generation, admission and previews share `quantize`/`legalVector`. UI scaling imports the engine caps rather than duplicating them. No startup trigonometry or client angle label determines legality.

The first implementation's upward cap of 2048 failed low-to-high cross-map tests. Increasing it to 2560 resolves those cases. A broader probe exposed vertical-target gaps caused by upward-only aiming and a side-offset muzzle. Rules version 3 permits downward aiming and places the muzzle along the dominant launch axis. Candidate generation solves that direction-dependent origin, and the same kernel serves real shots and previews. The short path to the muzzle is collision checked: a thin roof/wall/support cannot be skipped when spawning a shot. This resolves the retained terrain-free corpus, not survivable escape from every later terrain pocket; ADR-050 keeps that separate obligation.

### One fixed clock relationship

The existing netcode log advances every 50 ms ([clock source](../../packages/fuse-netcode/src/clock.ts)). Use three physics steps per log tick, producing 60 simulation steps per second. The adapter reports `steps() = 3` and `maxSteps = 3`; room tick advances once and simulation tick advances three times on every log tick, including idle phases. Do not choose the number of steps from frame rate or whether a device is a phone.

At each physics step, first update velocity from gravity and the current wind, then sweep the body from its old position to the proposed new position. The exact semi-implicit integration order is part of the rules. Wind acceleration applies to projectiles; birds and grounded crates do not drift with wind. Gravity, wind, speed caps and shot lifetime must be tuned together with the reachability envelope in ADR-050.

### Collision and bounded work

Represent birds, crates and projectiles with axis-aligned collision boxes specified by the engine. Circular appearance does not imply a hidden circle collider. This avoids rotation and square-root-dependent contact decisions in the initial kernel. Rendered silhouettes should fit these simple bodies closely enough that hits are understandable.

Sweep against occupied terrain cells and dynamic boxes using expanded axis-aligned bounds and rational entry fractions. Enumerate cells in the swept bounding box; do not test only the endpoint. Select the earliest contact, then break exact ties by collider class (terrain, crate, bird), terrain row/column, numeric crate ID and bird identity slot. A zero-duration contact while moving away from a boundary is not a collision; otherwise a grounded bird cannot be knocked away from its floor. A projectile cannot hit a bird through terrain at the same contact fraction. Ignore its owner's box only until it first clears that box; the shot lifetime bounds this phase and the flag belongs in checkpoints. Later returning shots can hit their owner.

For the initial weapons, a direct contact consumes the projectile and produces an impact fact. Scatter children use stable parent/child IDs and a fixed spread table. The later bouncing weapon needs an explicit remaining-travel and maximum-contacts rule; it must not be approximated by unbounded collision retries.

Pin and test caps for world dimensions, velocity, lifetime, active projectiles, fragments, swept-cell visits, blast radius and total effects per step. Start with at most eight active projectiles and 600 physics steps of projectile lifetime; tune before freezing the first rule version. A legitimate launch set must fit the work bounds. Invalid external state is rejected; a valid projectile reaching its lifetime or world boundary expires as a miss. Compute a step's mutations in bounded scratch state and commit only after validation. An unexpected work-budget breach leaves the last healthy state intact and returns an explicit fault to the caller. Do not install a half-carved terrain or pretend a replay of the same faulting input will repair it; the online adapter must stop/recover or present an abort/rematch path.

### A physics step has explicit phases

1. Apply scheduled launches; assign stable entity IDs. Existing projectiles compute this step's integration and any pending apex split.
2. Find each projectile's earliest contact against the same start-of-step terrain/body state. For a Scatter parent, resolve a contact at or before its split before considering fragmentation; if no such contact exists, replace the parent at its discrete apex with three children that begin movement next step. Contact wins a same-step apex tie. ADR-052 defines immediate splitting for launches with no upward segment and shared shot expiry; an immediate split occurs at launch position after resolving any zero-travel contact.
3. Collect impact facts in `(contact fraction, projectile ID)` order. Build the explosion batch against that same pre-destruction terrain state.
4. Compute damage, knockback and crate-hit facts. Aggregate simultaneous damage before asking the game engine to resolve deaths and rewards.
5. Apply the union of crater masks once, increment changed terrain chunk revisions and remove consumed projectiles/crates.
6. Sweep movable birds and crates against the updated terrain, apply bounded displacement and settling, then return fall/hazard facts.

Dynamic body positions are deliberately frozen during the projectile phase, then move during the body phase. This operator order is the collision contract, not a claim of simultaneous continuous rigid-body motion. Bound displacement tightly and test fast falling/knocked birds crossing a projectile path; if that error is unacceptable, replace it with relative swept contacts in a new rule version. During aiming there are no live projectiles, but gravity and hazard checks still advance. Passing or timing out does not skip settling.

A fragment in this step does not pass through a hole made by another fragment in the same step. It may do so next step. This explicit batch rule prevents array iteration order from changing the result. A round is not over until all effects and settling relevant to its outcome have resolved.

### Explosions and terrain

Store occupancy as a packed bitset with fixed-size chunks for dirty tracking. A blast clears cells whose centers satisfy a pinned integer squared-distance test. Terrain never grows in the initial game; detached terrain stays fixed. No structural collapse, colliding debris or liquid physics. Water is a rule-defined hazard boundary with cosmetic animation.

Damage uses the same integer radius test with a documented body sampling point and falloff. Exposure and crate collection use line-of-sight tests against the pre-destruction terrain. A ground impact starts its exposure rays at the last free-space contact position, so the impacted cell does not incorrectly occlude every ray. The blast carves its full crater even where damage is occluded; a buried target can become exposed without taking immediate damage. Terrain blocks blast collection consistently with damage.

A projectile's directly contacted bird receives at least its weapon's contact damage without a separate blast line-of-sight test. For that one explosion, apply `max(contactDamage, exposedBlastDamage)` to the directly contacted bird, not their sum; other birds receive exposed blast damage only. Direct crate contact always produces one collection fact. Separate explosions/fragments may each contribute damage. This prevents a direct hit from doing zero damage because its target center falls outside a small blast, or accidentally doing double damage.

Crater radius, damage radius and physical hitboxes are engine data published to the view. Glow, foliage, lighting and screen shake cannot enlarge them. A hit crate produces an owner-scoped fact; inventory changes belong to ADR-049.

Birds have no player-controlled locomotion; they respond only to gravity and blast impulses, without body stacks or bird-on-bird pushing in the first slice. Birds do not act as platforms for each other. Ground support and fall damage derive from swept contacts, not visual terrain contours. After knockback, cap velocity and apply fixed ground friction. A settling deadline damps remaining horizontal motion deterministically; vertical motion then continues until grounded or below the hazard boundary, within a bound established from map height and velocity caps. Do not advance the turn with an unresolved falling bird.

Track fall height from the last supported/highest falling position; do not infer damage from render frames. No step-up, hop or movement allowance exists.

## Alternatives considered

- **General rigid-body engine:** useful if the game later needs rotating structures and chains; not selected for the initial narrow mechanics and state model.
- **Per-peer floating-point simulation with occasional correction:** makes disagreement a normal gameplay event; rejected for collisions, crate ownership and elimination.
- **Server-authoritative physics:** changes hosting and networking architecture without a requirement; rejected.
- **Heightfield terrain:** simple and compact, but cannot represent arches, tunnels and islands in the chosen graphics; rejected.
- **Polygon subtraction as collision authority:** attractive smooth geometry, but adds topology and numerical edge cases to every crater. Keep polygons/contours in presentation only.

## Consequences and validation

We own collision correctness and arithmetic bounds. The benefit is a small serializable state and one kernel shared by live shots, previews and generator verification. Do not promise performance before measuring terrain cloning, collision sweeps and rollback on phones.

Before integration, test tunneling, grazing/corner ties, spawn inside solid rejection, owner-clearance expiry, crater cell boundaries, occluded blasts, simultaneous fragment impacts, falling through a removed support, out-of-bounds shots and exact lifetime expiry. Check equivalent state with shuffled entity insertion order. Run fixed seeded shot logs on Chromium, Firefox and WebKit and compare every simulation hash, including restore-and-replay during flight and settling. Record rule version, seed, device/browser and workload for performance results.

Any change to launch tables, integration, collision ordering, crater masks or rounding changes Fuse Birds' rules version and its own golden replay fixtures. It does not bump Fuse Riders' rules.
