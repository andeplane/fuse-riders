# Bot steering check — 2026-09-16

The controller now considers short turns followed by straight escape paths, looks ahead 1.6 seconds, anticipates new trails, and ranks survival ahead of target chasing. Attack inputs and authoritative game physics are unchanged. The existing swept segment-distance helper is exported for prediction rather than copied.

## Reproduction

Baseline simulation: `266d1f2bc176546112a6c2b5cdebfc4d380244dd`.
Updated controller SHA-256: `2a233be545b5017e3cf1b520320ea7ee9133409c44d976b6a16c9250812e1c1c`.
Environment: macOS arm64, Node v22.14.0. Commands from the source checkout:

```sh
node --import tsx scripts/benchmark-bot-survival.ts
node --import tsx scripts/benchmark-bots.ts
```

For a baseline comparison, use the survival harness from this change with the baseline source. The harness uses seeds `bot-survival-0` through `bot-survival-9` for each workload, varies initial headings by a seeded offset in ±0.35 radians, and clears initial trails. Steering-only runs disable firing and pickup spawning; combat runs keep both. Each first round ends normally or is capped at 60 seconds. Observed survival includes survivors censored at round end, so it is not an uncensored lifetime estimate or a human win-rate measurement. Reports with individual samples are written to `artifacts/bot-survival.json` and `artifacts/bot-benchmark.json`; `BOT_SURVIVAL_REPORT` can preserve a separately named run.

## Survival

Each workload uses ten rounds. Early crashes count wall, trail and rider eliminations before ten seconds (not bomb deaths).

| Workload                 | Baseline observed survival | Updated observed survival | Early crashes before → after |
| ------------------------ | -------------------------: | ------------------------: | ---------------------------: |
| Two bots, steering only  |                    44.72 s |                   37.04 s |                        0 → 1 |
| Two bots, normal combat  |                    16.03 s |                   20.65 s |                        0 → 0 |
| Five bots, steering only |                     8.29 s |                   47.29 s |                       33 → 3 |
| Five bots, normal combat |                     9.17 s |                   34.72 s |                       30 → 1 |

The crowded-game improvement is substantial, and normal duels improve more modestly. This is not a universal survival improvement: the synthetic two-bot workload without weapons regresses. Opponent pursuit remains enabled, so in that workload it creates risk without its normal opportunity to attack. Removing pursuit was deliberately not part of this steering change. These small, fixed-seed comparisons do not establish player-perceived difficulty or fun.

## Decision cost

Four bots together, 50 warmups then 500 timed samples for each fixed workload, seed `bot-benchmark`:

| Existing trails | Baseline p95 | Updated p95 | Updated p99 |
| --------------- | -----------: | ----------: | ----------: |
| 0               |      0.13 ms |     1.49 ms |     1.94 ms |
| 800             |      0.23 ms |     3.23 ms |     3.80 ms |
| 4,000           |      0.61 ms |     1.14 ms |     1.37 ms |

The dense synthetic case rejects unsafe plans earlier, explaining its lower cost than 800 trails. This measures controller decisions only, not simulation, rendering, networking or physical phones. More planning costs more CPU; these desktop timings do not establish a mobile performance budget.

## Verification and limits

- Typecheck, unit tests, coverage thresholds and production build pass.
- Regression scenarios exercise an approaching corner, fresh crossing trails, boosted movement and boost expiry, shrinking overtime walls, and deterministic replay from a cloned world. These use normal simulation steps and preserve source state.
- Chromium smoke passes desktop and emulated-phone AI add/remove/start/scoring and authenticated LAN TV add/remove/start. The AI smoke selectors were updated for the current lobby and score labels. No physical-phone or WebKit qualification was performed.
- Independent review found no correctness blocker. Its requested overtime regression was added.
- Predictions still approximate opponent decisions and do not model gravity pull, portal transit or shell bounces. Bots can still crash.
- Online peers independently compute bot inputs. The new decisions change replay outcomes; old and new clients must refresh onto the same build for a release. No mixed-build compatibility or production deployment is claimed.
