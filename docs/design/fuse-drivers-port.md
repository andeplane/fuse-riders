# Porting Fuse Drivers onto the shared netcode

Fuse Drivers is a top-down offroad racer (Super Off Road with Mario Kart items) built outside this repo at
`~/projects/personal/fuse-man`, on its own architecture: one authoritative Node server ran the simulation and
phones were thin controllers. This note records how it becomes `games/fuse-drivers`, a peer of Pig, on
`fuse-netcode`'s shared input log. It replaces that game's ADR 008, which chose the server.

## What is reused unchanged

The simulation is already a pure deterministic fold with no DOM, no clock and no I/O:
`step(state, inputs, track)` plus a truck kernel, items, tracks, bots and a series. It has a replay test that
hashes a whole race. That is exactly the shape the fold wants, so the rules port is mostly re-homing files and
changing who calls them.

The tracks (Tiled `.tmj`) and the built art in `public/assets` move verbatim.

## The one real mismatch: tick rate

The log tick is fixed at 50 ms for every game; a faster game runs more simulation steps per log tick
(`steps(room)`), never a faster log. Fuse Drivers runs at 30 Hz, which does not divide 20 Hz.

**Decision: run the race at 60 Hz, `steps: () => 3`, `maxSteps: 3`.** Sixty is the only clean multiple near the
original rate, and doubling is mechanical: every value expressed in seconds already holds, and the 22 constants
expressed in ticks double. The alternative, 40 Hz at two steps, multiplies tick constants by 4/3 and lands them
on fractions.

Cost: three fold steps per log tick, each moving five trucks, their projectiles and pickups. Rollback
re-simulates up to 40 ticks, so a worst case is 120 steps. Fuse Riders already runs an arcade simulation on this
netcode, so the budget is known to exist, but the port must measure before it is called done.

## Shape of the port

| Piece                                               | From                      | To                                                         |
| --------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| Truck kernel, items, race step, track, bots, series | `src/shared/*.ts`         | `games/fuse-drivers/src/game/`                             |
| Seat and input reducer                              | `src/shared/room.ts`      | deleted; `applyManagementTick` replaces it                 |
| Authoritative server                                | `src/server/main.ts`      | deleted; there is no server                                |
| Phone controller page                               | `src/pad/`                | deleted; the shared page serves phones                     |
| Party link                                          | `src/client/net/party.ts` | deleted; `PeerTransport` and `RoomRuntime` replace it      |
| Phaser scenes                                       | `src/client/scenes/`      | `games/fuse-drivers/src/app/`, Phaser 4 as a renderer only |

`Room` is the race state plus what the netcode requires: `seats`, `settings`, `stage`, `round`, `matchId`,
`tick`, and the seeded RNG already in the race state. It stays plain data and one `Map`, so it clones.

`Entry` is the management entries plus one control entry per change: the six input booleans pack into a
bitmask, so a truck sends a few bytes only when the player's thumbs change.

`View` is what the renderer already consumes: truck poses, projectiles, pickups, lap and placement. It must be
rebuilt fresh each call, and the renderer must read outcomes from it rather than from events, because a
rollback rewrites history without re-emitting.

## Determinism

The game already solved cross-engine drift: `fmath.ts` builds sine, cosine, atan2 and hypot from `+ - * /` and
`Math.sqrt` alone, because engines differ in the last bit of the transcendentals. That is stricter than this
repo's `@stdlib` wrappers and passes the same source guard, which bans the native transcendentals rather than
requiring a particular replacement. It moves across as `deterministic-math.ts` and the guard is pointed at the
new game's `src/game/`.

## Order of work

1. Scaffold and register the workspace. **Done.**
2. Rules: room, entry, fold, checkpoint, hash, result, at 60 Hz. Port the replay test with it.
3. Page: landing, lobby and results from `fuse-ui`; the arena as a lazy-loaded Phaser 4 renderer driven by the
   page's own frame loop, reading `frameTiming()`.
4. Platform: racing stats instead of Pig's rolls and busts.
5. Measure the step budget, then the browser smoke.
6. Production only after `EXTRA_GAME_IDS` includes the id; until then the page offers solo against bots.
