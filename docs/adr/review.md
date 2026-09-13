# Architecture review: Fuse Riders MVP

- Reviewer: independent architecture review agent
- Date: 2026-09-13
- Scope: `docs/architecture.md` and ADR-001 through ADR-003
- Verdict: Accepted after revision; implementation may begin

The proposed single-room Node/WebSocket architecture is appropriate for tonight's five-controller LAN game. Server authority, fixed-step simulation, separate display/controller surfaces, input sequencing, heartbeat cleanup, and stale-snapshot rejection are sound decisions. WebRTC and multi-room infrastructure are correctly excluded from this MVP.

The first review found the following ambiguous or contradictory contracts. All were resolved in the accepted ADRs and the binding `docs/architecture.md` contract before implementation began.

## Must-fix findings

### 1. Define one unambiguous tick transaction

`architecture.md` says rider movement performs swept collision checks and later says simultaneous collisions are resolved after bomb placement/explosions. ADR-002 explicitly leaves trail clearing versus rider collision order undecided. This is the core fairness contract.

Specify the exact phases of a tick and the state each phase reads. At minimum, settle trail expiry, candidate rider movement, due/chain explosions, trail clearing, rider-versus-wall/trail/body collision, trail commit, deaths, and round transition. Collision outcomes for all riders must be computed from the same phase snapshot before deaths are committed. State whether a trail cleared by a bomb on tick T is lethal to a rider crossing it on tick T, and whether a rider hit by an explosion may also create a trail segment that tick.

### 2. Make trails independent segments on the wire and in state

The prose requires timestamped segments and swept collision, but `PlayerState.trail` and `GameSnapshot.players[].trail` contain only points. Deleting a point hit by a blast can reconnect its neighbours into a phantom lethal line; points also cannot express partial clearing cleanly.

Use explicit independently serialized segments with `x1`, `y1`, `x2`, `y2`, creation/expiry tick (or equivalent). Define whether blast intersection removes a whole segment or splits it. Define rider radius, trail width/collision tolerance, self-trail grace distance or age, and endpoint-touch semantics. The representation and tests must prevent collisions with visually cleared gaps.

### 3. Specify continuous bomb geometry and resource rules

The arena uses continuous world coordinates, while explosion events and ADR-002 refer to unexplained `cells`. No cell size, world-to-cell mapping, ray thickness, occlusion rule, or default blast range is defined. Bomb recharge/capacity is also absent even though the game proposal promised a recharge and edge-triggering alone still permits tap spam.

Choose and document one geometry. For this open arena, axis-aligned blast rectangles in world coordinates are the simplest contract; snapshots/events should carry those rectangles or enough constants to derive them exactly. Define blast range and thickness, arena-boundary clipping, bomb chain intersection, trail removal, rider hit testing, bomb placement coordinate, maximum active bombs per player and/or cooldown, and expose `bombReadyAtTick` (or equivalent) for the controller UI. A chain-queued bomb must explode at most once.

### 4. Resolve QR, join, host, and reconnect token lifecycles

The same QR must admit up to five phones, but the documents describe it as both a short-lived join token and a one-time lobby token. A one-time token cannot serve the shared QR. ADR-001 also says a reconnect token is valid only until the round ends, while ADR-002 says rematch preserves connected identities. The host bootstrap example does not explain how the display obtains its secret without making it retrievable from a controller-reachable HTTP route.

For the single-room MVP, define a reusable random lobby admission token in the QR (or explicitly allow an open LAN join), then issue a distinct random player token per occupied seat. Define token expiry across rounds, server restart, explicit leave, seat replacement, and simultaneous reconnect attempts. Define host bootstrap concretely: for example, print a `/display#hostToken` URL locally, have display send an auth message, and ensure URL fragments never reach HTTP requests. The server must bind host actions to the authenticated socket role, never a client-declared route/role. Host tokens must be absent from QR payloads, controller responses, snapshots, and logs.

### 5. Define lifecycle transitions and mutation ownership

The state machine names phases but does not define legal transitions, timing, minimum players, joins during a round, disconnect behavior, countdown duration, round reset, or rematch semantics. It also says `step` is the sole mutator used by the server while exposing mutating `addPlayer`, `removePlayer`, and `setPhase`; `setPhase` cannot establish round-reset invariants on its own.

Specify transition commands such as `startMatch`/`startRound`/`resetMatch` and their preconditions and postconditions, or state precisely where each non-step mutation may occur. Define at least: start requires 2-5 occupied seats; late joins wait for the next round; disconnect yields neutral steering and preserves the seat for a bounded reconnect period; round restart resets position, alive state, trails, bombs, and current input while preserving identity and wins; match rematch resets wins and creates a new match scope. Scoring and end events must be emitted once. Define the zero-survivor draw and what happens when only one connected/occupied player remains.

### 6. Make snapshot/event delivery sufficient after packet loss and reconnect

WebSocket preserves order while connected, but events are not replayed after reconnect. Explosion geometry exists only in an event, so a display reconnect or delayed render can miss the visual state. The snapshots also lack countdown/round timing and controller-visible cooldown data.

Put every gameplay-relevant fact in snapshots. Add `phaseEndsAtTick` (when applicable), `roundStartedTick`, bomb readiness/cooldown per player, and active blast visuals with expiry ticks if explosions persist visually. Events may drive sound/particles but must not be required to reconstruct current game state. State the snapshot frequency and display interpolation delay, and require a complete snapshot immediately after authentication/reconnect.

### 7. Bound real-time recovery and define stale input precisely

ADR-002 says catch-up is capped but gives no cap or behavior after the cap. The server's “small sequence/window,” heartbeat timeout, and stale-input timeout are also unspecified. These values affect fairness and recovery after phone sleep or laptop suspension.

Freeze MVP constants or configuration defaults: simulation tick rate, maximum catch-up steps per loop, whether excess elapsed time is discarded, snapshot rate, heartbeat interval/timeout, and input staleness threshold. On socket close, timeout, `blur`, or `visibilitychange`, steering must become neutral and bomb must be false; an old held-bomb state must never fire after reconnect. Sequences are monotonic within a player session and reset only through an explicitly documented reconnect handshake.

### 8. Replace undefined overtime with a deterministic rule

“When no progress is possible” is not mechanically detectable as written, and `overtimeTicks` has no trigger or shrink function. This prevents deterministic tests and risks endless rounds.

Define a tick-based round timer and an exact sudden-death boundary schedule, including collision behavior at each shrink step and a hard maximum round duration. Alternatively remove overtime from the MVP and define a deterministic draw timeout. The displayed countdown must derive from authoritative phase/tick fields.

## Resolution

The revised documents define one tick transaction, independent trail segments, continuous blast rectangles, bomb resource rules, open-LAN admission with per-seat reconnect tokens, URL-fragment host bootstrap, legal lifecycle transitions, complete resynchronizing snapshots, bounded catch-up/input timeouts, deterministic overtime, fair two-to-five-player spawns, and slot colours. No must-fix finding remains open.

## Required implementation evidence

Implementation must supply tests for:

- equal-input deterministic replay and fixed tick ordering;
- swept wall, body, and trail collisions including self-grace and simultaneous deaths;
- exact trail expiry boundary and a blast-created gap with no phantom segment;
- bomb cooldown/capacity, cross geometry, clipping, chain reaction idempotence, and same-tick clearing semantics;
- first-to-five scoring, zero-survivor draw, timeout/overtime, and one-time round transitions;
- five-seat admission, sixth rejection, player reconnect, duplicate-token rejection, stale input neutralization, and host-action denial from controller sockets;
- host/player secrets omitted from public messages and logs, runtime rejection of malformed messages, and full snapshot resync.

Once these points are incorporated consistently, the architecture is small enough to implement rapidly and robust enough for a real five-phone session.
