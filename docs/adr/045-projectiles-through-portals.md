# ADR-045: Projectiles through portal gates

- Status: Accepted
- Date: 2026-09-16

## Decision

Carry a Green Shell and a Gun ray through a portal gate the way ADR-018 carries a rider: enter at the earliest gate met, leave just beyond its partner on the side consistent with travel, at the same proportional height, keeping heading and speed. This supersedes ADR-014's rider-only scope, which treated a projectile purely as an obstacle that could make an exit unsafe.

Lobbed, Target and Singularity bombs are excluded. They resolve against a landing point committed at launch rather than travelling, so a gate along the way is not something they can meet; changing that would move a landing point that the aim preview, the bots and portal placement reservation all read.

Integrate a shell's tick in two passes split at the entry fraction rather than advancing the whole tick and rewinding. A bounce can fall on either side of a gate within one tick, and only a split preserves the velocity the shell actually carried into the gate. Keep one path run per hop and sweep rider contact within a run only: the gap between gates is travel the shell never made, and a rider standing on that line is not in its way.

Give a shell its own portal cooldown, of the same 15 ticks and the same shape as a rider's, stored as an optional `BombState` field. Without it a shell aimed down a gate's axis orbits the pair until it expires. Leave it out of published snapshots: presentation projects a shell forward from its own velocity rather than interpolating between snapshots, so it needs no discontinuity guard.

Resolve a Gun ray on the press tick as before, continuing the cast from the exit when a gate is reached before anything solid. Spend each pair at most once per ray, which bounds a ray at `MAX_PORTAL_PAIRS` hops and stops two gates facing each other holding a bullet. Record each stretch past a gate as its own 3-tick tracer carrying the same owner and shot, so the renderer keeps drawing every tracer as the straight line it already assumes. A continuation tracer reports no `bombPlaced` event and no placement statistic: the trigger was pulled once.

Hold a projectile's exit only to arena bounds and to foreign portal walls, not to the rider rule. A projectile has no problem appearing beside a rider or a trail and resolves that contact on the ticks that follow, where a rider would be placed into a lethal overlap. A refused exit leaves the projectile travelling as though the gate were not there.

Do not count a projectile's transit as its owner's portal jump. That statistic feeds the GATE CRASHER award and the recap's rider comparison, and it means a rider went through a gate.

## Validation

Test exit position, preserved velocity and bounce count, proportional entry height, the cooldown refusing a return trip, and a bounce falling after the gate inside the same tick. Test that a rider between two gates survives a shell teleporting across them and that a rider beyond the exit does not. Test a Gun ray killing past the partner gate, stopping at the first body beyond it and cutting its hole there, a fouled exit leaving the path unchanged, and gates strung into each other terminating with one tracer per hop. Test that a checkpoint round-trips the new field.

## Review resolution

Scope confirmed with the user before implementation: shells and Gun rays only, each with its own re-entry cooldown, lobbed bombs unchanged.
