# ADR-045: Projectiles through portal gates

- Status: Accepted
- Date: 2026-09-16

## Decision

Carry a Green Shell and a Gun ray through a portal gate the way ADR-018 carries a rider: enter at the earliest gate met, leave just beyond its partner on the side consistent with travel, at the same proportional height, keeping heading and speed. This extends ADR-014, which scoped transit to riders. Nothing there is withdrawn: a live projectile's flight location and landing site still reserve a rider's exit against an overlap.

Lobbed and Target bombs are excluded. They resolve against a landing point committed at launch rather than travelling, so a gate along the way is not something they can meet; changing that would move a landing point that the aim preview, the bots and portal placement reservation all read.

Find the gate with a throwaway pass over the whole tick, then commit the tick in two passes split at that entry fraction rather than rewinding the first. A bounce can fall on either side of a gate within one tick, and only a split preserves the velocity the shell actually carried into the gate. Keep one path run per hop and sweep rider contact within a run only: the gap between gates is travel the shell never made, and a rider standing on that line is not in its way.

Give a shell its own portal cooldown, of the same 15 ticks and the same shape as a rider's, stored as an optional `BombState` field. Without it a shell aimed down a gate's axis orbits the pair until it expires. It travels to a joiner like any other simulation state, because the peer snapshot is the checkpoint codec. Leave it out of the render snapshot, which carries only what a screen draws: presentation projects a shell forward from its own velocity rather than interpolating between two snapshots, so it needs no discontinuity guard.

Resolve a Gun ray on the press tick as before, continuing the cast from the exit when a gate is reached before anything solid. A ray carries no cooldown of its own — it exists for one tick. Spend each pair at most once per ray instead, which bounds a ray at `MAX_PORTAL_PAIRS` hops and stops gates arranged in a cycle holding a bullet. The hop counter is defence in depth behind that: it keeps the last iteration resolving rather than portalling, should a state ever carry more pairs than the spawn cap and the checkpoint schema allow. Record each stretch past a gate as its own 3-tick tracer carrying the same owner and shot, so the renderer keeps drawing every tracer as the straight line it already assumes. A continuation tracer reports no `bombPlaced` event and no placement statistic: the trigger was pulled once.

Hold a projectile's exit only to arena bounds and to foreign portal walls, not to the rider rule. A projectile has no problem appearing beside a rider or a trail, where a rider would be placed into a lethal overlap: a shell landing on someone resolves against them on the spot, in the same tick and with no swept travel, and a shell landing in a trail bounces off it from the next tick. A refused exit leaves the projectile travelling as though the gate were not there.

Do not count a projectile's transit as its owner's portal jump. That statistic feeds the GATE CRASHER award and the recap's rider comparison, and it means a rider went through a gate.

ADR-029 asks that projectile portal discontinuities be marked so interpolation never cuts a chord through a wall. That requirement does not arise here: presentation projects a shell forward from its own velocity rather than interpolating between two snapshots, so there is no chord to cut. The cost is that the projection is portal-unaware, and for up to one projection window a shell can be drawn a little past a gate before the next snapshot corrects it.

## Validation

Test exit position, preserved velocity and bounce count, entry height mapped onto a partner of a different centre and length, transit in both directions, and a gate met after a bounce as well as before one. Test the cooldown at its exact deadline, refusing the tick before and allowing the tick it falls on. Test that a rider between two gates survives a shell teleporting across them and that a rider beyond the exit does not.

Test a Gun ray killing past the partner gate; a body in front of a gate taking the shot instead; the hole cut beyond the gate and not between the gates; a fouled or out-of-bounds exit leaving the path unchanged, paired against the same launch succeeding without the obstruction; and a cycle of gates terminating at one tracer per pair. Test that a continuation tracer reports no placement event or statistic and that a projectile transit credits no portal jump.

Every one of these must fail if the feature is reverted: an assertion that holds on the unchanged path is not a test of it. Test that a checkpoint round-trips the new field and that a hopping ray folds identically from a checkpoint decoded in another map order.

## Review resolution

Scope confirmed with the user before implementation: shells and Gun rays only, each bounded against re-entry, lobbed bombs unchanged.

Review found five of the first eleven regressions still passing with the feature reverted, including the cooldown and entry-height tests, and named branches with no negative case at all. The suite was rebuilt against that finding rather than argued with.
