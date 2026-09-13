# ADR-012: Homing Spark launch modifier

- Status: Superseded by ADR-016; retained as historical design. Previously Accepted
- Date: 2026-09-13

## Context

A Homing Spark pickup can make one charged launch curve toward a rival during its short flight. It should reward timing and positioning without becoming an unavoidable auto-aim weapon, and it must compose with Triple Shot.

## Decision

Add a `homing` pickup that arms the next successful launch with one pending use; collection while armed refreshes the flag without stacking. At release, select the nearest other alive participant from the authoritative state. Ties use stable player ID order. Capture that target's player ID and exact center once; do not read live target state or retarget during flight.

During the six-tick flight, steer the projectile toward the captured target position using a bounded turn of at most `0.12` radians per tick (0.72 radians total), with shortest-angle wrapping. Apply the turn before advancing each flight tick, then move one sixth of the captured charged distance. The engine precomputes and snapshots an immutable seven-point `flightPath` containing the launch point and six steps; the final point is clamped to the safe interior and is the bomb's landing position. Optional captured target ID and coordinates support the TV tether. This produces a visible curve rather than a snap and remains dodgeable. Homing never changes blast range, fuse timing, hitboxes, or chain rules.

Homing combines with Triple Shot: all three fan bombs capture the same selected target point and independently apply the same turn cap from their own current directions. A successful release consumes the pending homing flag; cancel, disconnect, watchdog neutralization, death before release, and invalid/stale release preserve it. The same four-second cooldown and one-active-volley capacity apply. Round reset clears the pending flag.

The TV may draw a thin target tether/arc during flight and the controller may show an armed icon, but neither is authoritative. No client input or render frame may select or retarget a victim.

## Review resolution

The review accepted the `0.12` radians/tick cap, exact launch-time target center, precomputed seven-point path, and stable ID tie break. The six-tick flight, 40-tick fuse, and release-ahead launch remain unchanged. Auto-aim snapping, continuous retargeting, and homing after landing are outside this ADR.
