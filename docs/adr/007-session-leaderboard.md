# ADR-007: Persistent session leaderboard across matches

- Status: Accepted
- Date: 2026-09-13

> Scoring update (#226): the historical scoring/ranking below is superseded by [survival scoring](../online/PROTOCOL.md#survival-scoring). Matches rank by points, then round wins; session totals remain separate.

## Context

An evening game should reward consistent placement across multiple first-to-five matches, while still showing each round's result clearly. Scores must be fair when riders are eliminated on the same simulation tick and must survive ordinary seat removal and rematches.

## Decision

Define the current game as the lifetime of the server process. Maintain a session leaderboard independently of the current match's round wins. At the end of each round, rank the tracked participants by survival placement and award exact integer score units using the base table **5 / 3 / 2 / 1 / 0** for first through fifth place. Use `POINT_UNIT = 60`, so the values are 300 / 180 / 120 / 60 / 0 units; this is divisible by 1 through 5 for tie averaging. If riders share a placement because they died on the same simulation tick, average the points for the occupied ranks and award that average to each tied rider. Display totals to one decimal point by dividing units by 60. This removes arbitrary slot-order bias.

When only two participants started the round, the fixed table awards 5 points to the winner and 3 to the runner-up. A player who joins after countdown creation is not a participant for that round and receives no placement points. Track the participant set at countdown start and `eliminatedAtTick` for every participant, including explicit leave. The TypeScript API represents survivors with `undefined` and treats that value as positive infinity while ranking. Multiple survivors at the hard timeout tie across the highest occupied places. A draw with all final deaths on one tick averages every occupied place and awards no round win, as already defined by the game rules.

Leaderboard entries are keyed by player ID and contain:

```ts
interface SessionLeaderboardEntry {
  id: PlayerId;
  name: string;
  totalScoreUnits: number;
  roundsPlayed: number;
  roundWins: number;
  matchWins: number;
}
```

Entries persist when a seat is removed and across `resetMatch`; a new player ID creates a new entry. The session resets only when the server process restarts. A round-result view shows points awarded, and the TV may open the overall leaderboard in a button or drawer between rounds without shrinking the active arena. Showing each phone's cumulative points is optional.

## Consequences

Integer units keep scoring deterministic and averaging exact while allowing one-decimal display. Placement remains meaningful even when a player does not win a match. Session lifetime is easy to explain for one evening, but a future host-reset control would need a separate reviewed decision.

## Review resolution and integration contract

Independent review accepts the 60-unit integer scale: it makes every average across two to five occupied places exact. `rankRound` accepts exactly two to five unique participants, and `applyRoundScores` validates the complete result atomically before mutation. Timeout survivors share the top occupied ranks. The TV opens the session leaderboard only outside active play and does not reduce the arena viewport.

Engine integration captures immutable participant IDs and names when countdown is created, records each first elimination tick for both explicit leave and simulated hazards, and scores exactly once during `resolveRound`. Simulated elimination events remain first, followed by `roundEnded`, then `matchEnded` when applicable; the resulting snapshot already contains updated totals and placements. Session totals survive seat removal and `resetMatch`, while the active round participant set and placements reset at the next countdown. Integration tests cover explicit countdown leave, every simulated hazard, protected star contact, survivor timeout ties, late joins, repeat matches, and departed history.
