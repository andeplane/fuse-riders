# ADR-009: Beer Worms drunk pickup debuff

- Status: Accepted (reviewed before implementation)
- Date: 2026-09-13

## Context

The Beer Worms pickup should create temporary chaos by making other living riders wobble, while preserving authoritative deterministic simulation and meaningful steering. The effect must be reproducible in tests and replays and must not depend on browser clocks or global randomness.

## Decision

Add a `beer` pickup type in a later integration change. When collected, it applies a four-second (`80` tick) drunk debuff to every other living rider in the round. The collector is immune to its own pickup. A rider already drunk is refreshed to `tick + DRUNK_DURATION_TICKS`; effects do not stack. Player left/right steering remains active, with the debuff adding a bounded coherent angular-velocity wobble. It must never directly move a player, override steering, or change collision geometry.

The wobble is a pure function of `(seed, playerId, tick)`, evaluated by the simulation at the current tick. It uses deterministic smooth noise with fixed amplitude and time frequency, bounded so the added angular velocity cannot exceed the documented maximum. No `Math.random()`, global time, client state, or mutable noise stream is allowed. The same seed/player/tick always returns the same value, and adjacent ticks vary smoothly enough to prevent a straight-line teleport or jitter.

The future shared state should expose `drunkUntilTick` and the pickup type in snapshots. The client may show a beer/rainbow wobble indicator, but rendering does not participate in the effect.

## Consequences

Beer Worms adds social disruption without giving the collector an unfair direct attack. Deterministic noise is replayable and easy to unit test, but its amplitude and frequency need tuning against the 1600×900 field and rider turn rate. Pickup spawn, collection ordering, expiry, and round reset follow ADR-005.

## Review questions

Review resolution: use `DRUNK_MAX_ANGULAR_VELOCITY = 2.0` radians/second, below the 2.8 radians/second steering turn rate. Use value-noise knots every 10 ticks (0.5 seconds), with smoothstep interpolation between independently hashed signed values in `[-1, 1]`. Hash the UTF-16 player ID with FNV-1a and mix it with the uint32 seed and knot index. Export `DRUNK_DURATION_TICKS = 80` and the pure `drunkAngularVelocity(seed, playerId, tick)` function. The noise stream is independent of any pickup PRNG, so future spawn changes cannot alter an existing rider's wobble. Existing star invulnerability does not block the drunk effect, and collecting beer does not cure a prior debuff. Extra drunk effects such as reversed controls, speed changes, camera distortion, or stacking are outside this ADR.
