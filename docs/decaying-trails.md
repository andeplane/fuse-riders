# Decaying trail pieces (#213)

Keep ordered segments as the collision/snapshot representation. Active segments have no
`detached` metadata and retain the current Power-adjusted lifetime (160 base ticks plus 40 per pickup). Detached drawable runs carry a shared immutable piece id
and decay-start tick. Round-scoped ids come from `nextTrailPieceId`; crossing coordinates
never merge pieces. Portal gaps preserve the active tail's logical relationship, but
become separate drawable pieces on detachment/death.

All destructive operations use one cut helper. Only the newest surviving suffix still
linked to the head stays active; older chunks detach. Recut debris inherits its schedule.
Death detaches only active segments. At each playing tick, before clipping/weapons/collision,
existing pieces consume 1.875 units at each end (37.5 units/second per end) after a 20-tick pause. Both endpoint budgets
use the original path's arc length. Results freeze the whole trail board. Power extends
only active expiry. No rendering clock controls decay.

Bound each rider to 2,048 segments; if saturated, discard the oldest detached geometry
first, preserving the normal active-tail capacity. Checkpoints validate piece ids,
contiguity, ownership, schedules and limits before restore. Increment the peer fold rules
because both lifecycle state and deterministic outcomes change. Old clients must refresh;
there is no conversion of live rooms or production deployment in this change.

Render detached/dead trail bodies fully opaque on both Phaser backends, with authoritative
endpoints. Fade saturation to zero over three seconds from detachment, sampled from the
existing piece schedule and presentation tick; freeze color with the final board. Flying blast fragments remain a separate cosmetic effect.
