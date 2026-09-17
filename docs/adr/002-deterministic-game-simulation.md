# ADR-002: Fixed-step deterministic Fuse Riders simulation

- Status: Historical; deterministic fixed-step foundation retained, original gameplay and server-only model superseded. See [current architecture](../architecture.md), [radial blasts](017-radial-blasts-and-five-shot.md), and the current source definitions.
- Date: 2026-09-13

## Context

Fuse Riders combines continuous movement and fading trails with timed bombs, chain reactions, and collisions. Frame-rate-dependent rules would make outcomes differ between displays and make bugs hard to reproduce.

## Decision

Implement the rules as a pure TypeScript simulation in `src/shared/game.ts`. The server advances it at a fixed 20 Hz timestep, consuming only the latest validated left/right/bomb intent for each player. State transitions use simulation ticks, not wall-clock frame counts. The client interpolates between received snapshots for smooth rendering but never predicts authoritative outcomes.

Players move at constant speed and steer by a bounded turn rate. Trails are independent timestamped line segments and expire after eight seconds. Collision uses swept movement segments so a rider cannot tunnel through a trail or rider between ticks. Bombs have a two-second fuse and four-second placement cooldown, with at most one live bomb per player. Their continuous horizontal/vertical blast rectangles clear every intersected trail segment, test swept riders, and enqueue intersected bombs exactly once for chain detonation. Bombs do not block riders.

Each tick expires old geometry, computes candidate moves, accepts bomb edges, resolves explosions and clears trails, computes all wall/trail/rider collisions against the post-blast state, commits deaths simultaneously, commits survivor movement/trails, then performs one round transition. Thus a blast can open a safe trail gap on the same tick, and a rider killed that tick emits no new trail. Exact dimensions, tolerances, self-trail grace, cause priority, and expiry boundaries are frozen in `docs/architecture.md`.

Rounds end when one rider remains or all remaining riders die; simultaneous last-player deaths are a draw. A deterministic shrinking boundary begins after 60 seconds and a round with multiple survivors at 90 seconds is a draw. First to five wins ends the match. Two to five participants spawn equally around a centered circle and head along the clockwise tangent.

Use a seeded match RNG for any future random arena/pickup feature. The initial arena is deterministic and has no random gameplay dependency. Each snapshot carries a tick and match/round identifier so stale or mixed-session state can be rejected.

## Consequences

Pure simulation tests can cover movement, expiration, blast occlusion/clearing, chain reactions, simultaneous deaths, disconnect neutrality, and win conditions without a browser. A 20 Hz snapshot stream is adequate for phones and a TV, but the server must cap catch-up steps to avoid a runaway loop after laptop sleep.

## Review resolution

Independent review accepted the deterministic simulation after tick ordering, independent segment representation, continuous blast geometry, cooldown/capacity, collision tolerances, fair spawns, and deterministic overtime were frozen in `docs/architecture.md`.
