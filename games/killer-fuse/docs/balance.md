# Killer Fuse balance

What the headless runner measures when bots play each other at rules `killer-fuse-4`, against the targets in [BRIEF.md](BRIEF.md). Every number here comes from bots; no person's play has been measured. Since this round the rules and values are Killer Queen Black's and were not tuned toward the targets: only the bots were. Several targets are missed, and they are listed as misses below.

## How to measure

```sh
pnpm exec tsx scripts/killer-fuse-sim.ts --games 300 --level hard [--level-b medium] [--map 1] [--seed 20001] [--max-seconds 300] [--json]
```

- Game `i` is seeded `seed + i`, so a run is reproducible.
- With `--level-b` the two teams play at different levels and swap screen sides every game.
- Every game is played twice and the two final state hashes must match; the run fails otherwise.
- A game undecided after `--max-seconds` is counted as a timeout and left out of the win and length figures. At the default of 300 s that is exactly the games the engine's own clock would decide (by eggs, then berries, then the snail, then a coin flip).

All results below are from revision `cced7bb3`, 300 games per row, seeds 20001 to 20300. With 300 games a share near 50% is uncertain by about 6 points either way (95%).

## Targets and results on map 1

Hard against hard on map 1, "Day", is the reference matchup.

| Target                                                               | Measured           | Met              |
| -------------------------------------------------------------------- | ------------------ | ---------------- |
| Win mix 62 / 24 / 14 military, economy, snail, each within 10 points | 47.3 / 20.7 / 32.0 | No               |
| Median game 68 to 84 s                                               | 61.0 s             | No               |
| Side balance 47 to 53% for the left team                             | 51.3%              | Yes              |
| 3 to 4 Queen deaths per game                                         | 2.53               | No               |
| Hard beats medium in at least 70%                                    | 73.3%              | Yes              |
| Medium beats easy in at least 70%                                    | 70.0%              | Yes, on the line |
| No games reaching the clock                                          | 0 of 300           | Yes              |

```
Killer Fuse, map 1: 300 games, hard against hard, seeds 20001..20300
decided 300, timeouts 0
side wins: left (team 0) 154 (51.3%), right (team 1) 146 (48.7%)
win kinds: military 142 (47.3%), economy 62 (20.7%), snail 96 (32%)
length: median 61 s, mean 67.5 s, p90 111.3 s
per game: Queen deaths 2.53, other kills 10.95, berries banked 10.73 (kicked in 0.15), gate uses 2.55, snail mounts 2.44, snail meals 0.24
determinism: every seed played twice, final hashes equal
```

## Every matchup, every map

"Mix" is military / economy / snail in percent, "QD" Queen deaths per game, "Side" the left team's share of wins, "Clock" the games that reached 300 s.

| Map | Matchup         | Stronger wins | Mix                | Median | p90     | QD   | Side  | Clock |
| --- | --------------- | ------------- | ------------------ | ------ | ------- | ---- | ----- | ----- |
| 1   | hard v hard     |               | 47.3 / 20.7 / 32.0 | 61.0 s | 111.3 s | 2.53 | 51.3% | 0     |
| 1   | medium v medium |               | 40.0 / 18.7 / 41.3 | 48.5 s | 82.0 s  | 2.27 | 45.7% | 0     |
| 1   | easy v easy     |               | 36.0 / 12.7 / 51.3 | 52.2 s | 83.9 s  | 2.30 | 50.0% | 0     |
| 1   | hard v medium   | 73.3%         | 35.7 / 24.3 / 40.0 | 54.7 s | 89.6 s  | 2.10 | 48.0% | 0     |
| 1   | medium v easy   | 70.0%         | 36.0 / 18.3 / 45.7 | 47.2 s | 80.1 s  | 2.17 | 46.7% | 0     |
| 1   | hard v easy     | 83.3%         | 35.3 / 30.3 / 34.3 | 54.7 s | 84.6 s  | 1.79 | 48.7% | 0     |
| 2   | hard v hard     |               | 25.6 / 46.5 / 27.9 | 78.6 s | 121.2 s | 1.71 | 52.2% | 3     |
| 2   | medium v medium |               | 44.7 / 18.0 / 37.3 | 55.6 s | 84.3 s  | 2.13 | 55.0% | 0     |
| 2   | easy v easy     |               | 40.3 / 19.0 / 40.7 | 62.2 s | 92.4 s  | 2.29 | 51.3% | 0     |
| 2   | hard v medium   | 84.3%         | 38.3 / 35.7 / 26.0 | 62.5 s | 89.0 s  | 1.84 | 51.7% | 0     |
| 2   | medium v easy   | 75.7%         | 40.7 / 23.7 / 35.7 | 56.4 s | 90.4 s  | 2.07 | 53.0% | 0     |
| 2   | hard v easy     | 95.7%         | 42.0 / 37.7 / 20.3 | 57.4 s | 85.1 s  | 1.81 | 49.7% | 0     |
| 3   | hard v hard     |               | 35.9 / 46.6 / 17.4 | 83.7 s | 126.3 s | 2.31 | 53.4% | 2     |
| 3   | medium v medium |               | 63.3 / 21.7 / 15.0 | 71.2 s | 105.4 s | 2.86 | 47.3% | 0     |
| 3   | easy v easy     |               | 59.0 / 20.3 / 20.7 | 73.7 s | 99.6 s  | 2.91 | 51.7% | 0     |
| 3   | hard v medium   | 87.0%         | 54.3 / 34.3 / 11.3 | 68.1 s | 107.6 s | 2.40 | 51.0% | 0     |
| 3   | medium v easy   | 88.3%         | 56.7 / 33.0 / 10.3 | 64.5 s | 102.7 s | 2.55 | 49.0% | 0     |
| 3   | hard v easy     | 98.7%         | 52.3 / 37.0 / 10.7 | 58.8 s | 88.9 s  | 2.12 | 49.3% | 0     |

The levels are ordered on every map: hard beats medium in 73 to 87%, medium beats easy in 70 to 88%, hard beats easy in 83 to 99%.

## What misses, and what is not shown

- **Military wins are too few and snail wins too many on map 1** (47 / 21 / 32 against 62 / 24 / 14). With sword combat a kill takes a timed attack that connects, and two ready swords glance instead of killing, so Queens die less often than under the old contact rule: 2.5 deaths per game against a target of 3 to 4. Careful bot Queens add to this.
- **Map 1's median is 61 s**, below the 68 to 84 s range.
- **Maps 2 and 3 are economy maps at hard** (46.5% and 46.6% economy). Hard Queens survive (1.7 and 2.3 deaths per game) and hard Workers bank steadily.
- **A few hard games reach the clock on maps 2 and 3**: 3 and 2 of 300. The engine decides those by eggs, berries, then the snail.
- **Weaker levels win almost only by the snail.** On map 1 all 50 of easy's wins against hard, and 51 of medium's 80 against hard, are snail wins. A team that loses fights can still ride.
- **Medium beats easy on map 1 in exactly 70.0%** of 300 games, which is on the line and inside the noise of it.
- **Side balance is not shown at this sample size.** Single rows read 45.7% (map 1 medium) and 55.0% (map 2 medium); with 300 games the 95% range is about 6 points, so neither proves a bias and neither rules one out. The rules and the navigation tables are mirror-symmetric (tested). Earlier rules were checked over 10,000 games per row; this revision was not.
- **Nothing was measured over more than 300 games per row** at this revision, and nothing with people.

## How the rounds compare

Hard against hard. The earlier rows are the figures recorded when each revision was current; their runs were not repeated for this document, and the earliest used other maps.

| Revision                       | Rules                                                            | Map | Mix (military / economy / snail) | Median  | Left wins |
| ------------------------------ | ---------------------------------------------------------------- | --- | -------------------------------- | ------- | --------- |
| Round 3, before Black's values | Contact combat, our own movement values                          | 1   | 60.3 / 25.1 / 14.6               | 78.0 s  | 49.8%     |
| `cbd74362`                     | Black's movement, berries, gates and snail; still contact combat | 1   | 9.3 / 68.0 / 22.7                | 97.5 s  | 52.3%     |
| `cbd74362`                     |                                                                  | 2   | 22.4 / 36.5 / 41.1               | 100.0 s |           |
| `cbd74362`                     |                                                                  | 3   | 10.7 / 80.0 / 9.3                | 69.8 s  |           |
| `cced7bb3`                     | Sword combat with the attack button (`killer-fuse-4`)            | 1   | 47.3 / 20.7 / 32.0               | 61.0 s  | 51.3%     |
| `cced7bb3`                     |                                                                  | 2   | 25.6 / 46.5 / 27.9               | 78.6 s  | 52.2%     |
| `cced7bb3`                     |                                                                  | 3   | 35.9 / 46.6 / 17.4               | 83.7 s  | 53.4%     |

At `cbd74362` hard beat medium in 85.3% and medium beat easy in 77.7% on map 1; now 73.3% and 70.0%.

What the table says: Black's movement with the old contact combat nearly removed military wins, because flight became slow and deliberate while a kill still needed a height advantage at contact. Sword combat brought them back to about half of the target share on map 1.

## Flight: how fast the button must be pressed

A Warrior starting at rest in the air, pressing at a fixed period for 5 s. Positive is height gained.

| Press every | Presses per second | Height gained in 5 s |
| ----------- | ------------------ | -------------------- |
| 30 steps    | 2.0                | -426.6 px (falls)    |
| 22 steps    | 2.7                | -6.8 px (hovers)     |
| 21 steps    | 2.9                | 295.6 px             |
| 20 steps    | 3.0                | 427.2 px             |
| 15 steps    | 4.0                | 517.0 px             |
| 10 steps    | 6.0                | 528.7 px             |
| 6 steps     | 10.0               | 534.2 px             |

Hovering takes about 2.7 presses a second, and pressing faster than about 4 a second gains almost nothing, because the climb is capped at 10 u/s. Holding the button does nothing: only presses flap. The BRIEF's older line asked for sustained flight at 7 to 15 presses a second; Black's values give this instead, and they were kept.

Other measured motion figures: a Worker's jump peaks at 0.86 u for a tap and 3.82 u for a full hold (apex on step 22, landing on step 46); a Warrior's dash lasts 19 steps and covers 5.07 u; a Queen's covers about 4.5 u.
