# ADR-005: Larger arena and deterministic upgrade drops

- Status: Accepted
- Date: 2026-09-13

## Context

The current 1200×700 field becomes crowded with five riders, especially once trails and bombs overlap. Random upgrades add a useful rescue and risk/reward layer, but they must remain reproducible under the authoritative fixed-step simulation.

## Decision

Increase the world to **1600×900** (about 71% more playable area) while keeping rider speed at 150 world units per second. Preserve the existing 20-unit initial boundary inset and all collision tolerances unless explicitly changed by a later gameplay decision.

Add a seeded deterministic PRNG to `src/shared/game.ts`: FNV-1a converts `matchId` to a nonzero 32-bit default seed and Mulberry32 advances the public `GameState.randomState`; `createGame(matchId, seed?)` allows an explicit test seed. A new match ID reseeds the generator. Every 120 playing ticks, choose a pickup type with one PRNG draw, then make at most 24 deterministic position attempts, capped at three active pickups.

- `blast`: increases the collecting rider's blast level by one and adds 75 world units to future bomb range, capped at level 2. A bomb captures the owner's current range at placement, so later pickups do not change an existing fuse.
- `star`: grants 50 ticks (2.5 seconds) of invulnerability, active while `invulnerableUntilTick > tick`. The rider survives explosions and trails. At a wall it reflects the relevant heading axis (both at a corner) and clamps its center to the current inset bounds, so it never finishes a tick outside. When one invulnerable and one normal rider meet, only the normal rider dies; two invulnerable riders pass through one another.

Pickups have a 14-unit collection radius and spawn inside the current boundary plus a 40-unit margin. A candidate must be at least 80 units from every living rider head and bomb center, 40 units from every active trail centerline, and 28 units from another pickup. If the safe rectangle is empty or all 24 positions fail, skip the drop; the next attempt remains six seconds later. Pickups expire when `expiresAtTick <= tick`, after 300 ticks (15 seconds).

Pickup collection runs after candidate movement is computed and before bombs, explosions, and collision resolution. A rider collects when its swept centerline comes within rider radius plus pickup radius. For a contested pickup, smallest squared swept-path distance wins, then lower slot; process pickup IDs in ascending order and consume each once. A same-tick blast pickup therefore affects a bomb placed later in that tick, which captures `150 + 75 * blastLevel` as its immutable range. A same-tick star can rescue its collector from that tick's wall, trail, explosion, or rider collision. Star expiry is intentionally sharp: if protection has expired and the next swept path begins inside an active trail, the rider dies. Round reset clears pickups, pickup schedule, upgrade levels, and invulnerability; match reset also clears scores and reseeds from its new ID.

The display represents blast level with a rainbow pulse and invulnerability with a star symbol and countdown timer. Extend public snapshots with:

```ts
players[].blastLevel: 0 | 1 | 2
players[].invulnerableUntilTick: number
bombs[].blastRange: number
pickups: Array<{
  id: number; type: 'blast' | 'star'; x: number; y: number; expiresAtTick: number;
}>
```

## Consequences

The larger field gives five players room for longer loops without changing the movement feel. Seeded placement makes replays and tests deterministic, while bounded placement attempts prevent a crowded arena from stalling the tick. Upgrade rules add visual state and snapshot fields but do not require client authority or external services.

## Review resolution

Independent review accepted the 1600×900 framing after freezing the PRNG, 24-attempt spawn bound, clearance constants, nearest swept-path metric, collection order, immutable bomb range, star collision asymmetry, contained wall reflection, and exact expiry behavior. Additional upgrades such as extra bomb charges or shorter fuses remain future ideas and are outside this ADR.
