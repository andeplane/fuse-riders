# Fuse Riders architecture

The implementation follows the accepted ADRs in [docs/adr](adr/), including later decisions that supersede the original cross explosions, circular portals, and match length. Source modules are the authoritative type and constant definitions; this document describes their responsibilities and ordering rather than duplicating a partial protocol schema.

## Runtime and trust boundary

```text
phone /controller -- validated intents --> Node HTTP + WebSocket server
                                              |
                                     authoritative simulation
                                              |
                   TV /display <-- snapshots and transient events
```

One Node process serves both browser surfaces and owns the mutable room. It binds a configurable host/port and prints a private-LAN controller URL and a host display URL. `HOST_IP` overrides interface discovery. The QR contains only `/controller`; this household LAN game has no matchmaking or separate room-admission secret.

The host URL carries its capability in a fragment. The display captures it into session storage, removes the fragment from browser history, and authenticates each connection using `hostAuth`. A new valid fragment also updates authentication through `hashchange`. Several displays can authenticate with the same capability; there is no exclusive browser ownership. Merely opening `/display` grants no host control. Server restarts replace the host and player tokens, so a new host link is required afterward.

Production tokens use 24 cryptographically random bytes. The owning controller receives its player token in `joined`; tokens are absent from gameplay snapshots and the public controller URL. The startup host link intentionally includes its host capability. Names are rendered with text APIs rather than HTML.

## Modules and dependency injection

| Module | Responsibility |
| --- | --- |
| `src/shared/game.ts` | Deterministic state, lifecycle commands, authoritative tick transaction and snapshots. |
| `src/shared/protocol.ts` | Wire types and strict incoming message validation. |
| `src/shared/bomb-launch.ts`, `launch-modifiers.ts`, `blast-geometry.ts` | Charge distance, volley trajectories and exact swept disk intersections. |
| `src/shared/trail-clipping.ts`, `portal.ts`, `drunk.ts` | Independent geometry, portal placement/transit and seeded steering disturbance. |
| `src/shared/pickup-weights.ts`, `leaderboard.ts`, `match-stats.ts` | Drop weights, persistent session scoring and current-match statistics. |
| `src/server/index.ts`, `bomb-input.ts` | HTTP/WebSockets, authentication, seats, fixed scheduling and ordered bomb actions. |
| `src/client/snapshot-stream.ts`, `render-snapshot.ts` | Forward snapshot acceptance and bounded visual projection. |
| `src/client/controller-state.ts`, `controller-pointers.ts` | Typed input state and browser pointer/capture lifecycle. |
| `src/client/main.ts`, `pickup-renderer.ts`, `themes.ts` | TV/controller presentation, effects and interchangeable visual themes. |
| `src/client/viewport-lock.ts` | Controller gesture suppression and readable input sizing. |

`ServerDependencies` injects `now`, `token`, and `schedule`; the scheduler returns its cancellation function. `createGameServer` also accepts `manualTicks` and `buildDirectory`, and exposes `advance`, `checkConnections`, and `close` for isolated verification. Tests use actual serialized WebSocket messages while controlling simulation and watchdog time.

`ControllerInputState` receives an `InputTransport` whose `send` returns success. `ControllerPointerBindings` receives typed button surfaces, a terminal event target, and a change callback. Geometry functions receive explicit inputs; portal placement additionally receives random and safety functions. Engine replay uses a seed and typed input maps, without patching browser globals or relying on real-time sleeps.

## Simulation, transport and rendering cadence

World coordinates are continuous in a 1600 × 900 arena. The authoritative simulation runs at 20 Hz. It permits at most five catch-up steps per scheduler callback and discards excess backlog rather than fast-forwarding a sleeping machine through an entire race.

Authenticated displays receive full world snapshots at 20 Hz. Phones and unauthenticated sockets receive compact snapshots at 10 Hz, plus immediate lifecycle resyncs. Compact payloads retain player status, power-up timers, scores and phase, but empty trails, bombs, blasts, pickups, portal geometry and match statistics. Serialization is shared across recipients of the same payload shape. Events describe transient feedback and never supply missing simulation state. Exact message unions, event variants and envelope fields are defined in `protocol.ts`.

The TV immediately renders authoritative state and may extrapolate a living rider's position/angle for at most 50 ms. Velocity derives from simulation tick spacing, so bursty network delivery cannot amplify it. Projection does not cross match, round, phase, membership, death or portal-transit boundaries; stale state freezes. Bombs, trails, pickups, collisions and outcomes remain authoritative. Cached arena backgrounds and batched trail paths avoid per-segment expensive effects. Trail and blast drawing are clipped to the active field. Themes affect graphics and CSS variables, never hitboxes or rule timing.

## Seat and controller recovery

A fresh join claims the lowest free slot in any phase; two to five connected players are required to start. During countdown or play, new riders wait inactive outside the current round participant set and enter automatically next round (ADR-022). A valid saved token can reclaim its seat in any phase, carrying `nextInputSeq` forward. The new socket replaces the previous one, which receives close code 4001 and stops automatic retries. This avoids two tabs repeatedly stealing the same seat. An expired token returns the phone to an explicit join form instead of silently claiming a new player.

A disconnect or six-second watchdog timeout neutralizes steering and cancels pending bomb actions. The rider continues with neutral steering for that round. Seats remain reserved until the next round boundary, when disconnected or explicitly leaving players are pruned before the next countdown. Explicit leave during play eliminates the rider and keeps scoring participation intact.

Controllers send state on each change and resend held state every 100 ms. The server neutralizes input after ten simulation ticks without an update. Sequences reject stale input. The strict parser rejects unknown fields, invalid types, unsafe sequences and payloads over 2 KiB. The socket-wide rate limit is 40 messages/second; fresh-seat admission is limited to five attempts/minute/address.

Pointer capture ownership is separate from held-button state. Window-level pointer-up/cancel handling works even when capture fails, recycled pointer IDs cancel stale ownership, and lost capture never fires a bomb. Blur, hidden-page transitions, teardown, disconnection and phase changes clear controls and release captures. Reconnection starts with a forced neutral message so old held input cannot launch a bomb. Normal bomb release emits an explicit `release`; interruption emits `cancel`, and the bounded server action queue preserves rapid press/release pairs between ticks.

The controller disables native pinch/double-click zoom gestures and overscroll, and keeps text inputs at least 16 px to prevent iOS focus zoom. The viewport and responsive layout keep controls usable in portrait and landscape. These protections do not change the TV's layout or game coordinates.

## Match and score lifecycle

```text
lobby --start with 2..5 connected--> countdown --> playing
playing --one/zero survivors or 90-second limit--> roundOver
roundOver --3 seconds and enough connected players--> countdown
playing --winner reaches three round wins--> matchOver
matchOver --authenticated rematch--> countdown of a new match
```

Countdown lasts three seconds. A round winner earns one match-local win; three wins end the match. A draw adds no win. The server initiates the next round after the three-second result interval when enough players remain; the engine otherwise stays at the inactive boundary.

Participants are captured at countdown creation in slot order. Spawns are evenly spaced on a circle of radius `0.28 * min(width, height)`, with clockwise tangent headings. Round resets clear position, survival state, trails, bombs, active drops, portal walls, power-ups, charge, cooldowns and input. A rematch also resets current-match statistics and round wins while preserving the process-lifetime session leaderboard.

Session placement awards are 5 / 3 / 2 / 1 / 0, using the occupied positions for two through five participants. Simultaneous eliminations and tied survivors split the average of their positions exactly using integer point units. Immutable round participation retains departures, and scoring commits once. Match statistics record authoritative survival ticks, actual travelled distance including fatal movement but excluding teleport distance, accepted/exploded bombs, collected upgrades, portal trips, wall bounces, final death causes and unambiguous non-self eliminations. The full statistics table appears only in match-over display snapshots; controller snapshots omit it.

## Power-ups and hazards

A seeded pickup attempt occurs every six playing seconds, with at most three active drops, 24 bounded placement attempts, and a 15-second lifetime. Locations respect walls, heads, bombs, trails and other drops. Collection uses swept movement, with nearest path distance then slot resolving contention. Failed portal-pair placement leaves the pickup available.

| Power-up | Authoritative effect |
| --- | --- |
| Blast | Raises radius by 75, up to two levels above the base radius of 90; each launched bomb captures its radius. |
| Star | Five seconds of hazard immunity; wall contact reflects/clamps the rider. Star contact defeats an ordinary rider; two immune riders survive. |
| Beer | Four seconds of bounded heading sway on other living riders, at most 15 degrees with a two-second cycle and no residual heading drift. The collector is unaffected. |
| Triple Shot | Arms the next accepted release with three projectiles at offsets −0.22, 0 and +0.22 radians. |
| Five Shot | Arms five projectiles at −0.44, −0.22, 0, +0.22 and +0.44 radians. The strongest armed volley wins. |
| Orbit Shield | Absorbs all hazards on one otherwise fatal tick, then gives ten ticks of grace. A protected rider does not consume a stored shield unnecessarily. |
| Portal | Opens another pair of vertical walls for ten seconds, with swept entry and safe linked exits. Up to three pairs run at once. |

Five Shot has weight 1; every other available drop has weight 3. It is therefore one third as likely as Triple Shot. Homing has been removed from drops, player state, flight targeting, statistics and rendering.

Holding the bomb button charges launch distance using the shared [bomb-launch rules](../src/shared/bomb-launch.ts), reaching full range in 0.4 seconds by default. Solo and online room settings can change this aim time for the next round. Releasing fires ahead using the committed rider heading, with a six-tick flight. The fuse ends 40 ticks after launch and the shared cooldown lasts 80 ticks. A player cannot launch another volley while any owned bomb remains live. Cancellation or rejected release preserves armed volley upgrades; successful release consumes them. Flying bombs cannot explode or chain before landing.

Explosions are disks, not crosses. Swept rider collision includes rider radius, trail clearing includes half the trail width, and chain reactions test bomb centers when the room's chain-reaction setting is on (#166). Damage occurs only on the explosion tick; visuals persist for eight ticks. Entire intersecting trail segments are removed independently, making gaps without joining their neighbors. Star, shield and portal grace retain their distinct defenses.

## Shrinking field and portal walls

The initial inset is 20. After 60 playing seconds it increases by 0.5 per tick; the 90-second hard limit resolves remaining survivors as a draw. Existing trail centerlines are clipped to the current closed rectangle before pickup placement and collision. New movement segments are clipped too, including immune wall bounces. Clipping preserves lifetime and independent segment identity, removes fully exterior segments, and never reconnects portal gaps.

Portal walls have an eight-unit thickness and initial length `min(300, playableHeight / 3)`. Seeded placement tries at most 24 candidates, requires 400 units of horizontal separation, and checks the entire wall corridor with conservatively overlapping safety disks, which also keeps a new pair off the walls of the pairs already open. Each wall shrinks to the remaining safe field and at most one third of its current height. Reclaimed wall centers or unusable lengths remove that pair alone.

Pairs accumulate rather than replace one another. Every collected Portal opens an additional pair that expires on its own schedule, up to `MAX_PORTAL_PAIRS` (three) at once; past that the oldest pair retires to make room, in the same tick as collection and therefore before that tick's transits. Pair identifiers are unique among the live pairs.

Entry tests the rider's swept movement against the wall capsule, including rounded endpoints. The earliest fresh entry across every live pair wins, and the rider always leaves through the partner of the gate actually entered, so pairs never cross-link; an exactly tied entry resolves by pair order and then gate index, which replay preserves. Remaining inside a wall does not retrigger it. Exit preserves proportional height along the linked wall and offsets to the outgoing side while keeping heading. Unsafe exits defer transport. Portal transit happens only after ordinary collisions and shield resolution, so it cannot skip an entry hazard. Accepted exits reserve space against other pending riders, trails, bombs, visible blasts, earlier accepted exits and the walls of every pair other than the one being used. Transit ends the old trail at entry and resumes a new segment after exit. Cooldown and grace are per rider, not per pair: a 15-tick cooldown applies to the next transit through any gate, and ten ticks of defensive grace protect both riders on contact without an offensive Star effect.

## Deterministic tick transaction

`step` performs this ordering once per tick:

1. Increment tick, expire portal pairs/trails/blasts/drops, and transition completed countdowns. Return a snapshot immediately when the phase is not playing.
2. Compute overtime inset; fit portal walls and clip existing trails to the field. Attempt a scheduled pickup spawn.
3. Compute all living riders' swept movements from input and deterministic Beer noise. Resolve collection, then reflect/clamp riders already immune on wall contact.
4. Resolve landed due bombs, and the deterministic chain reactions among them when the room setting allows, once per bomb. Remove trail segments intersecting the new disks.
5. Determine explosion, boundary, trail and rider collision causes against the post-blast trail set. Ignore recent self-trail segments during their ten-tick grace. Portal contact grace is defensive for both riders. Stable reporting precedence is explosion, wall, trail, rider.
6. Consume shields for otherwise fatal riders, clear that tick's causes, grant grace and reflect any wall hit. Find portal transits only for survivors, reserving accepted exits in stable order.
7. Record actual travelled distance/survival and commit deaths, survivor positions, portal status and clipped new trail segments. Fatal movement adds no trail.
8. Apply ordered bomb actions for living riders using committed positions/headings. Resolve round participation, placement points, round/match wins and phase exactly once, then produce the snapshot.

## Verification boundaries

Behavioral tests cover deterministic replay, exact deadlines, swept geometry, simultaneous outcomes, charged input edges, volley precedence, weighted drops, full-wall safety, shrinking trails/portals, statistics and scoring. Transport tests exercise real WebSocket serialization with injected time/scheduling, seat replacement, stale input, host authorization, privacy and admission limits. Pointer tests cover terminal events, failed/lost capture, cancellation and recycled IDs. Browser smoke checks both surfaces with five controller contexts, gesture input, themes, reconnect and rematch. Controlled renderer fixtures support visual and frame-rate review; physical phone latency and TV speaker output require separate real-device observation.
