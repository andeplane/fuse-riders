# ADR-002: Fixed-step deterministic Fuse Riders simulation

- Status: **Partly current.** What survives is the premise: the rules are a pure fixed-step 20 Hz simulation over ticks, not frames, with swept collision and a seeded RNG. Everything about where it runs and what it computes has been replaced.
  - **The server-authoritative model is superseded by [ADR 047](047-p2p-input-log-lockstep-rollback.md).** No server advances the simulation and no client interpolates between received snapshots: every device folds the same input log locally and rolls back late entries. The LAN server went in [#271](https://github.com/andeplane/fuse-riders/pull/271).
  - **The module is superseded.** `games/fuse-riders/src/shared/game.ts` no longer exists. The rules live in `games/fuse-riders/src/engine/`, and a tick is the ordered `PHASES` list in `games/fuse-riders/src/engine/sim/pipeline.ts` — which is now the single statement of the tick ordering this ADR describes in prose ([engine pipeline](../design/engine-pipeline.md)).
  - **The gameplay numbers are superseded** by the pickups, weapons and match rules added since ([ADR 017](017-radial-blasts-and-five-shot.md) onwards). Take dimensions, tolerances, fuses and win conditions from `games/fuse-riders/src/engine/tuning.ts`, `pickups.ts`, `weapons.ts` and the round rules, never from this ADR.
  - The references below to limits "frozen in `docs/architecture.md`" are stale: that document is the system map and deliberately does not copy balance tables. `RULES` in `games/fuse-riders/src/engine/apply-tick.ts` and `games/fuse-riders/tests/golden-hash.test.ts` are what actually freeze behaviour now ([engine safety net](../design/engine-safety-net.md)).
- Date: 2026-09-13

## Context

Fuse Riders combines continuous movement and fading trails with timed bombs, chain reactions, and collisions. Frame-rate-dependent rules would make outcomes differ between displays and make bugs hard to reproduce.

## Decision

Implement the rules as a pure TypeScript simulation in `games/fuse-riders/src/shared/game.ts`. The server advances it at a fixed 20 Hz timestep, consuming only the latest validated left/right/bomb intent for each player. State transitions use simulation ticks, not wall-clock frame counts. The client interpolates between received snapshots for smooth rendering but never predicts authoritative outcomes.

Players move at constant speed and steer by a bounded turn rate. Trails are independent timestamped line segments and expire after eight seconds. Collision uses swept movement segments so a rider cannot tunnel through a trail or rider between ticks. Bombs have a two-second fuse and four-second placement cooldown, with at most one live bomb per player. Their continuous horizontal/vertical blast rectangles clear every intersected trail segment, test swept riders, and enqueue intersected bombs exactly once for chain detonation. Bombs do not block riders.

Each tick expires old geometry, computes candidate moves, accepts bomb edges, resolves explosions and clears trails, computes all wall/trail/rider collisions against the post-blast state, commits deaths simultaneously, commits survivor movement/trails, then performs one round transition. Thus a blast can open a safe trail gap on the same tick, and a rider killed that tick emits no new trail. Exact dimensions, tolerances, self-trail grace, cause priority, and expiry boundaries are frozen in `docs/architecture.md`.

Rounds end when one rider remains or all remaining riders die; simultaneous last-player deaths are a draw. A deterministic shrinking boundary begins after 60 seconds and a round with multiple survivors at 90 seconds is a draw. First to five wins ends the match. Two to five participants spawn equally around a centered circle and head along the clockwise tangent.

Use a seeded match RNG for any future random arena/pickup feature. The initial arena is deterministic and has no random gameplay dependency. Each snapshot carries a tick and match/round identifier so stale or mixed-session state can be rejected.

## Consequences

Pure simulation tests can cover movement, expiration, blast occlusion/clearing, chain reactions, simultaneous deaths, disconnect neutrality, and win conditions without a browser. A 20 Hz snapshot stream is adequate for phones and a TV, but the server must cap catch-up steps to avoid a runaway loop after laptop sleep.

## Review resolution

Independent review accepted the deterministic simulation after tick ordering, independent segment representation, continuous blast geometry, cooldown/capacity, collision tolerances, fair spawns, and deterministic overtime were frozen in `docs/architecture.md`.
