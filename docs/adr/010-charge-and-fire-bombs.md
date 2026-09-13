# ADR-010: Charge-and-fire bomb launches

- Status: Accepted
- Date: 2026-09-13

## Context

Instant bomb placement makes the bomb button difficult to read and removes a useful risk/reward choice. The replacement should let a player hold to charge, release to fire ahead of the rider, and visibly communicate the launch on both the TV and controller. Input interruptions must not accidentally fire.

## Decision

Replace placement on button edge with an authoritative charge lifecycle. A `bomb` press edge starts charging in the game engine, which records the accepted start tick on `PlayerState`. A release edge launches using the authoritative hold duration and the rider's direction at release. A quick tap has a minimum travel distance of 100 world units; charge increases distance linearly to a maximum of 400 units at 1.2 seconds (`24` ticks), then clamps. Simulation ticks alone determine range. One active bomb per rider remains, and the four-second cooldown starts at launch. A press is accepted only for a living rider that is not already charging, owns no bomb, and has completed its cooldown. A release without an accepted charge is ignored.

The wire input remains `{ seq, left, right, bomb }` and gains optional `bombAction: 'press' | 'release' | 'cancel'`. `press` is valid only with `bomb: true`; `release` and `cancel` are valid only with `bomb: false`. Held-state resends omit the action. The server stores actions in arrival order in a queue of at most eight entries per seat and passes them to the engine as `InputIntent.bombActions?: readonly BombAction[]`. A press and release received before the same simulation step are both preserved and produce the minimum range. Duplicate/stale messages are rejected before queuing. `cancel` is sent on pointer cancellation, blur, visibility loss, page teardown, socket close, reconnect, or watchdog neutralization; neutralization replaces any queued actions with one `cancel`, so it never launches. The engine never infers release from the held `bomb` boolean.

At release, create the bomb at the rider center and snapshot its release direction. Render it as a flying projectile to its landing point for exactly six simulation ticks, with a client-side arc/easing effect. `BombState` carries `launchX`, `launchY`, landing `x`, landing `y`, `launchedTick`, and `landsAtTick`; the existing fuse begins at launch and detonates 40 ticks later. The projectile is visual state only: it does not collide during flight and a blast cannot chain-trigger it before `landsAtTick`. Clamp its landing center at release time to `boundaryInset + RIDER_RADIUS` through the corresponding right/bottom safe-interior bounds. Its later blast uses the landing point and current arena clipping. Death, disconnect cancellation, and round reset clear an unfinished charge without creating a bomb.

The display shows charge progress, the projected launch direction/range, and the flying arc before the normal fuse indicator. The controller shows a held-charge meter and a clear release/cancel state. Neither surface is authoritative for charge or outcome.

## Consequences

Holding creates a readable tactical choice and makes short taps reliable. The server needs a small per-seat charge state and explicit edge handling, while snapshots/events gain projectile/charge presentation data. Disconnect and touch cleanup become safety-critical. The flight animation adds visual state without changing collision rules during the arc.

## Review resolution

The review accepted the 24-tick cap, 100/400-unit distances, six-tick visual flight, fuse start on release, rider-radius landing margin, explicit optional wire edge, and bounded ordered engine action list. Snapshot players expose `bombChargeStartedTick?: number`; snapshot bombs expose the launch, landing, and flight ticks above. Existing `bombPlaced` events fire on an accepted release. Tests cover quick taps, capped holds, release direction and boundary clamping, duplicate/stale edges, cancel paths, disconnects, cooldown, one-active-bomb, deterministic replay, flying-bomb chain immunity, and bounded input queues.
