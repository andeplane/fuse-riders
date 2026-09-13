# ADR-008: Authoritative end-of-match statistics

- Status: Accepted
- Date: 2026-09-13

## Context

Players want a memorable end-of-match recap with more personality than the winner's name. Stats must be fair and reproducible: every value shown as a fact should come from the authoritative simulation, while the persistent session leaderboard remains a separate scoring system.

## Decision

Track statistics for the current match only. Initialize them when `resetMatch` creates a new `matchId`; preserve them through each round, and freeze them in `matchOver`. Do not mix these values with session leaderboard totals or infer them from client frame rate, input timing, or rendered effects. A future match reset starts a fresh statistics record.

For each participant, track these exact counters:

```ts
interface MatchPlayerStats {
  playerId: PlayerId;
  name: string;
  slot: number;
  color: string;
  roundsPlayed: number;
  roundWins: number;
  roundsDrawn: number;
  matchPlacement: number;
  survivalTicks: number;
  longestSurvivalTicks: number;
  distanceUnits: number;
  bombsPlaced: number;
  bombsExploded: number;
  eliminations: number;
  deathsByCause: { wall: number; trail: number; explosion: number; rider: number };
  pickupsCollected: number;
  blastPickups: number;
  starPickups: number;
  invulnerableTicks: number;
  wallBounces: number;
  earlyExits: number;
}
```

Definitions are simulation-based. `survivalTicks` counts each playing tick on which the rider starts alive, including its death tick. `distanceUnits` sums the exact swept movement from the rider's old position to the final collision-checked endpoint on those ticks, including a fatal tick; for an invulnerable wall bounce this is the clamped endpoint. `longestSurvivalTicks` is the maximum single-round value. `bombsPlaced` counts accepted placements and `bombsExploded` counts bombs that detonate exactly once, including chain reactions. Pickup counters count successful one-time collections. `invulnerableTicks` counts an alive playing tick when the star is active after that tick's pickup collection. `wallBounces` counts one bounce per tick even when both axes reflect at a corner. A disconnected rider continues to accrue survival and distance while the simulation moves it. Countdown, round-over, dead, and lobby time do not count.

The engine first chooses each victim's final cause with its existing deterministic priority. An elimination is then credited only if that final cause has exactly one unambiguous non-self owner: the owner of the actual bomb whose blast killed the rider, the owner of the trail struck, or the sole other rider involved in the collision. A bomb triggered by a chain credits that bomb's owner, not the player who started the chain. Overlapping hazards from different owners receive no kill credit. A rider's own bomb or trail never awards a self-elimination. `deathsByCause` counts the final cause once; an explicit leave records `earlyExits` instead.

Round counters are finalized once with round scoring. All captured round participants gain `roundsPlayed`; the sole winner gains `roundWins`; on a no-winner timeout or simultaneous final elimination all participants gain `roundsDrawn`. At match end, `matchPlacement` uses competition ranking by `roundWins`, so tied players share a place and the next place skips accordingly. Identity, including slot and color, is captured when a player first participates and retained if the player later leaves.

At match end, show the top-level match facts: winner, rounds played, round wins, total survival time, longest survival, total distance, bombs placed and exploded, eliminations, pickups, wall bounces, and deaths by cause. The recap may award deterministic titles such as “Demolition Expert” (most bombs exploded), “Trailblazer” (most distance), “Untouchable” (most survival ticks), and “Collector” (most pickups), but a title is shown only when the underlying metric is non-zero and ties are displayed jointly. Titles never award points or alter the session leaderboard.

`GameSnapshot.matchStats` is an immutable array. It contains the complete table only in `matchOver` and is empty in every other phase. The server's compact controller snapshot also uses an empty array, including during `matchOver`; controllers do not need opponent statistics or private geometry. The display derives tied titles from this table. The authoritative state keeps current-match counters through rounds and departed participants, then `resetMatch` clears them while preserving the separate session leaderboard.

## Consequences

The recap gives players concrete stories without compromising deterministic scoring. Counters add small authoritative state and require event ordering to remain explicit, especially for chain bombs, simultaneous deaths, disconnects, and pickups collected on a death tick. Session leaderboard points remain the only cross-match competitive score.

## Review resolution

The review accepted actual bomb ownership through chains, fatal-tick movement, competition-ranked match placement, and joint display of non-zero title ties. It rejected speculative reaction-time, close-call, and simultaneous-draw metrics. The implementation must preserve one-time round finalization and avoid kill credit when ownership is ambiguous.
