# ADR-016: Stronger Beer Worms and retire Homing Spark

- Status: Accepted; root reviewed before implementation
- Date: 2026-09-13

## Decision

Increase the deterministic Beer Worms angular-velocity bound from 2 to 5 radians/second and shorten its smooth-noise knots from 10 to 8 ticks. Keep the four-second duration, pure seed/player/tick input, smoothstep interpolation, and additive ordinary steering. The effect can temporarily overpower steering but controls continue contributing 2.8 radians/second; it never teleports or changes movement speed. Verify reproducibility, bounds, continuity, and a measurable winding path over representative seeds.

Remove Homing Spark from the pickup pool and all active state, protocol, rendering, stats, fixtures, and assets. Existing ADR-012 remains historical with a superseded note. Charged launch and Triple Shot retain deterministic straight flight paths and existing timings. This decision interprets the requested “drop homing missile” as retiring that power-up.

## Consequences

Beer becomes visibly disruptive without nondeterministic browser effects. Removing homing simplifies the launch path and eliminates its target-selection state. Existing runtime sessions need the normal coordinated release because snapshots change.

## Review

Root approved the proposed amplitude, frequency, retained steering, and complete Homing retirement before implementation. Regression validation must compare actual four-second paths against the previous tuning, not only assert constants.
