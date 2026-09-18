# ADR 043: highlight moments in the shared simulation

Status: accepted after three independent design reviews (simulation/protocol, gameplay, verification); implemented in the same change.

## Intent

After a match, show the plays worth talking about — a rider cut off on a trail laid a second earlier, one bomb that took two riders, a shell that banked off a wall into someone, a rider that got out of a blast zone with half a second to spare — the way Worms replays the turn that mattered. This note covers detection and the recap listing. Visual replay of a moment is a separate, later change (see **Replay later**).

## Why detection belongs in `src/shared/game.ts`

- Every fact a highlight needs exists only inside `step`, at the tick it happens: the elimination cause and credited owners, which trail segment killed and when it was laid, which bomb landed on a head, which shell hit and how often it had bounced. None of it survives the tick: bombs are deleted on explosion, causes are locals, and the wire events carry ids only.
- Online play folds the identical deterministic state on every peer (`src/shared/apply-tick.ts`, rewound and replayed by `src/online/rollback.ts`). A pure detector inside `step` therefore agrees everywhere with no new packet type, survives rollback because it lives in the cloned state, and reaches the LAN TV through the `matchOver` snapshot exactly like `matchStats` does.
- A presentation-side detector would need geometry the wire does not carry, would double-count under rollback (events are never retracted on rewind), and could not reach the LAN display at all.

## What is detected

A **moment** is `{ kind, round, tick, elapsed, playerId, targetIds, value }`, recorded during `step` from observations `step` already makes: `tick` is the absolute simulation tick a replay clip would be cut around, `elapsed` the tick within the round for the card's clock, and `value` the kind's own integer measure. Scores, titles and copy are presentation (`src/shared/match-recap.ts`), so tuning them never changes the replicated state or its hash. Thresholds are named constants in `src/shared/moments.ts`.

| kind                | Trigger (within one tick)                                                                                                                                                                | protagonist → targets     | value                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| `multiKill`         | One rider is the sole credited owner of ≥2 eliminations this tick, any cause (a trail that takes two counts)                                                                             | killer → victims          | riders                             |
| `directHit`         | A landing bomb touches a rider (landing contact, radius `RIDER_RADIUS + SHELL_RADIUS`) and that rider dies to it: the bomb hit a head, not the blast                                     | thrower → victim          | 1                                  |
| `trickShot`         | A shell (not a gun bullet: it never bounces) eliminates a rider after ≥1 wall or trail bounce, within 40 ticks of launch — an aimed ricochet, not a stray that pinballed for ten seconds | shooter → victim          | bounces                            |
| `cutOff`            | A rider dies on another rider's trail segment laid ≤ 12 ticks earlier (≈ one rider turn), sole owner                                                                                     | trail owner → victim      | segment age (ticks)                |
| `boxedIn`           | A rider dies on another rider's trail (sole owner) while not drunk, having travelled 40 ticks (300 units) but moved < 100 units net: nowhere left to go                                  | trail owner → victim      | net displacement (units)           |
| `bombDodge`         | A non-immune rider who is not the blast's owner was inside a blast's radius 10 ticks before it went off (its own trail records where it was) and is alive and outside it now             | dodger → owner            | clearance beyond the blast (units) |
| `ownGoal`           | A rider dies to an explosion whose sole owner is itself (own blast, or own shell after its 6-tick owner immunity)                                                                        | victim → none             | 1                                  |
| `mutualDestruction` | ≥2 riders die in one tick, at least one of them to a rider's trail, body or blast, and nobody is left alive (two idle riders reaching opposite walls together is not a moment)           | first victim → the others | riders                             |

Rejected during review, with reasons: `closeCall` (a 2-unit band nobody can see, fired constantly by riders spiralling their own trail); `longShot` (launch distance is a quarter-second charge slider, so most bomb kills would qualify); `chainReaction` (frequent, and a non-event unless someone dies). `bombDodge` was redefined from "missed by 6 units" (where a rider happened to be) to "left the kill zone" (what the rider did).

Shell bounces are counted in `BombState.shell.bounces`, incremented by `advanceShell` on each wall or trail reflection, and carried across ticks; it is the one persistent field outside the moment list. Gun bullets never bounce and never carry it.

## State, bounds and compatibility

- `GameState.moments: Moment[]`, cleared with match statistics (`createGame`, `resetMatch`, `returnToLobby`), kept across rounds. Each kind keeps at most `MAX_MOMENTS_PER_KIND = 8`, first come first kept; nothing in state depends on a tunable score. Bots are riders: their plays count.
- Both elimination sites in `step` (the movement sweep and the same-tick Gun resolution; Target Bomb shared the latter until it was removed in `fuse-p2p-39`) feed one observation record; detection runs once per tick before round resolution, so aggregates such as `multiKill` see every death of the tick.
- Per-tick cost: no new geometry on ordinary ticks, only a few empty containers. Death ticks scan the victim's own trail once (`boxedIn`); blast ticks scan each rider's own trail once (`bombDodge`).
- Determinism: squared distances, `hypot2`, integer rounding of deterministic values. No `Math.hypot`, no wall clock, no randomness.
- `toSnapshot` emits `moments` only at `matchOver`, next to `matchStats`. The LAN server's slim controller snapshot strips it like `matchStats`; the online controller status keeps it (it is what a phone shows in its recap).
- Checkpoint and wire validation (`src/online/checkpoint.ts`): a bounded array, enumerated kinds, `round` in `[1, game.round]`, `elapsed ≤ tick ≤ game.tick`, protagonist and targets present in `matchStats` (riders may have left the room), targets bounded, unique and never the protagonist, integer values, no more per kind than `pushMoment` keeps; `shell.bounces` optional non-negative integer. `gameInvariants` adds "lobby ⇒ no moments". The peer-to-peer fold rules (`RULES` in `src/shared/apply-tick.ts`) move to `fuse-p2p-3`, so peers on older rules never share a world with these; as with every rules bump, all clients refresh together.

## Recap

`buildMatchRecap(stats, moments)` gains `highlights`: the top `RECAP_HIGHLIGHTS = 5` by presentation score (a wipe of three or more at 100, direct hit 70, double kill 60, trick shot 50–60 by bounces, boxed in 50, cut off 30–54 by trail freshness, bomb dodge 35, mutual destruction 25, own goal 12), one entry per `(round, tick, protagonist)` so one bomb that hit a head and took two riders is one card, and at most two cards per kind and per protagonist for variety. Each card has a title, one line of copy naming the riders, and the round with the time into it. Both recap renderers (`src/client/main.ts` and `src/online/ui.ts`) render the cards with the award-card styling plus a `highlight-card` class, in their own `recap-highlights` container ahead of the awards; the LAN recap grid gains a row (`with-reel`) only while the reel is shown, and the recap smoke counts award cards inside `recap-awards` only. Empty moments render no section.

## Replay

Every full view already produces a fresh `ViewSnapshot` per tick (`session.snapshot()` in `src/online/runtime.ts`; LAN displays receive one per tick). [ADR 044](044-instant-replay.md) builds the instant replay on that: a presentation-only ring buffer of those references, a clip cut around a moment's tick, and a broadcast-style playback during a lengthened round-over pause. This note only establishes that moments carry the round and tick a clip is cut around.

## Verification

- `tests/moments.test.ts`: each kind triggered by a constructed scene in the `tests/game.test.ts` style, with its nearest negative (a landing hit on a shielded rider, a gun kill with bounces, a shell kill older than 40 ticks, a 13-tick-old trail, a drunk victim, an immune or owning rider inside a blast, two overlapping owners, three players with one survivor); per-kind bound; reset on rematch and lobby; determinism across two identical runs.
- `tests/rollback.test.ts`: a rewind across a moment replays it once, identical to a straight run.
- `tests/online-checkpoint.test.ts`: round-trip with moments and bounces; rejection of a missing list, an unknown kind, a future tick, an unknown rider, an oversized list and a bad bounce count.
- `tests/match-recap.test.ts`: highlight ordering, dedupe, variety, copy, empty case, signature change.
- `scripts/match-recap-smoke.ts` is unchanged: a solo match may end with zero highlights, so the smoke does not require the section.
