# Killer Fuse balance

What the headless runner measures when bots play each other, against the targets taken from the arcade game. Every number here comes from bots; no person has played yet, so this says the rules and maps can produce the right shape of game, not that it feels right.

## How to measure

```sh
pnpm exec tsx scripts/killer-fuse-sim.ts --games 200 --level hard [--level-b medium] [--map 1] [--seed 1] [--max-seconds 300] [--json]
```

- Game `i` is seeded `seed + i`, so a run is reproducible.
- With `--level-b` the two teams play at different levels and swap screen sides every game.
- Every game is played twice and the two final state hashes must match; the run fails otherwise.
- A game undecided after `--max-seconds` is a timeout. Timeouts are counted on their own and left out of the length figures.

All results below are from engine revision `815f1943` (rules `killer-fuse-1`). Runs of 200 games use seeds 1 to 200; runs of 1000 games use seeds 5001 to 6000. With 200 games a share near 50% is uncertain by about 7 points either way (95%), with 1000 games by about 3.

## Targets and results on map 1

Hard against hard on map 1, "Twin Hives", is the reference matchup.

| Target                                                               | 200 games        | 1000 games         | Met                 |
| -------------------------------------------------------------------- | ---------------- | ------------------ | ------------------- |
| Win mix 62 / 24 / 14 military, economy, snail, each within 10 points | 58.5 / 27 / 14.5 | 59.7 / 23.2 / 17.1 | Yes                 |
| Median game 60 to 120 s                                              | 61.3 s           | 64.3 s             | Yes, at the low end |
| Side balance 47 to 53%                                               | 52.5 / 47.5      | 47.6 / 52.4        | Yes                 |
| 3 to 4 Queen deaths per game                                         | 3.69             | 3.67               | Yes                 |
| Hard beats medium in at least 70%                                    | 88.5%            | not run            | Yes                 |
| Medium beats easy in at least 70%                                    | 80.5%            | not run            | Yes                 |
| No timeouts                                                          | 0                | 0                  | Yes                 |

PARITY row 27 asks for a median of 68 to 84 s, the arcade figure. At 61 to 64 s map 1 is below it. The mean is 65 to 67 s and the 90th percentile 102 to 107 s.

Full output of the reference run:

```
Killer Fuse, map 1: 200 games, hard against hard, seeds 1..200
decided 200, timeouts 0
side wins: left (team 0) 105 (52.5%), right (team 1) 95 (47.5%)
win kinds: military 117 (58.5%), economy 54 (27%), snail 29 (14.5%)
length: median 61.3 s, mean 65.3 s, p90 102.3 s
per game: Queen deaths 3.69, other kills 19.67, berries banked 11.64 (kicked in 0.29), gate uses 3.53, snail mounts 3.13, snail meals 0.56
determinism: every seed played twice, final hashes equal
```

```
Killer Fuse, map 1: 200 games, hard against medium, seeds 1..200
decided 200, timeouts 0
side wins: left (team 0) 95 (47.5%), right (team 1) 105 (52.5%)
level wins: hard 177 (88.5%), medium 23 (11.5%)
win kinds: military 180 (90%), economy 17 (8.5%), snail 3 (1.5%)
  hard won by: military 161, economy 15, snail 1
  medium won by: military 19, economy 2, snail 2
length: median 32.8 s, mean 38.4 s, p90 64.7 s
per game: Queen deaths 3.76, other kills 13.3, berries banked 8.39 (kicked in 0.18), gate uses 2.22, snail mounts 2.27, snail meals 0.39
determinism: every seed played twice, final hashes equal
```

```
Killer Fuse, map 1: 200 games, medium against easy, seeds 1..200
decided 200, timeouts 0
side wins: left (team 0) 101 (50.5%), right (team 1) 99 (49.5%)
level wins: medium 161 (80.5%), easy 39 (19.5%)
win kinds: military 187 (93.5%), economy 10 (5%), snail 3 (1.5%)
  medium won by: military 148, economy 10, snail 3
  easy won by: military 39, economy 0, snail 0
length: median 34.2 s, mean 35.1 s, p90 51.6 s
per game: Queen deaths 4.26, other kills 12.33, berries banked 9.89 (kicked in 0.14), gate uses 1.66, snail mounts 1.41, snail meals 0.14
determinism: every seed played twice, final hashes equal
```

## Every matchup, every map

200 games each, seeds 1 to 200. "Mix" is military / economy / snail in percent; "QD" is Queen deaths per game; "Side" is the left team's share of wins.

| Map | Matchup         | Stronger wins | Mix              | Median | QD   | Side  | Timeouts |
| --- | --------------- | ------------- | ---------------- | ------ | ---- | ----- | -------- |
| 1   | hard v hard     |               | 58.5 / 27 / 14.5 | 61.3 s | 3.69 | 52.5% | 0        |
| 1   | hard v medium   | 88.5%         | 90 / 8.5 / 1.5   | 32.8 s | 3.76 | 47.5% | 0        |
| 1   | medium v easy   | 80.5%         | 93.5 / 5 / 1.5   | 34.2 s | 4.26 | 50.5% | 0        |
| 1   | hard v easy     | 98%           | 94 / 5.5 / 0.5   | 25.6 s | 3.65 | 50%   | 0        |
| 1   | medium v medium |               | 91.5 / 7 / 1.5   | 39.1 s | 4.13 | 52.5% | 0        |
| 1   | easy v easy     |               | 90 / 7 / 3       | 31.1 s | 4.22 | 46%   | 0        |
| 2   | hard v hard     |               | 16.5 / 21 / 62.5 | 43.2 s | 2.77 | 46.5% | 0        |
| 2   | hard v medium   | 82.5%         | 53 / 8 / 39      | 35.6 s | 3.12 | 54.5% | 0        |
| 2   | medium v easy   | 80%           | 44 / 11 / 45     | 32.9 s | 3.16 | 50%   | 0        |
| 2   | hard v easy     | 97%           | 63.5 / 4.5 / 32  | 31.5 s | 2.93 | 51%   | 0        |
| 2   | medium v medium |               | 48.5 / 9.5 / 42  | 37.8 s | 3.23 | 52.5% | 0        |
| 2   | easy v easy     |               | 58 / 4.5 / 37.5  | 31.2 s | 3.59 | 48.5% | 0        |
| 3   | hard v hard     |               | 43.5 / 14.5 / 42 | 62.9 s | 3.49 | 52%   | 0        |
| 3   | hard v medium   | 87.5%         | 83 / 8.5 / 8.5   | 39.4 s | 3.79 | 49.5% | 0        |
| 3   | medium v easy   | 81%           | 89.5 / 6 / 4.5   | 31.1 s | 4.06 | 51%   | 0        |
| 3   | hard v easy     | 98%           | 94 / 3.5 / 2.5   | 26.6 s | 3.69 | 49%   | 0        |
| 3   | medium v medium |               | 74.5 / 13 / 12.5 | 47.5 s | 3.9  | 51.5% | 0        |
| 3   | easy v easy     |               | 92 / 4.5 / 3.5   | 33.4 s | 4.28 | 48%   | 0        |

Hard against hard over 1000 games, seeds 5001 to 6000:

| Map | Mix                | Median | Mean   | p90     | QD   | Side        | Timeouts |
| --- | ------------------ | ------ | ------ | ------- | ---- | ----------- | -------- |
| 1   | 59.7 / 23.2 / 17.1 | 64.3 s | 67.4 s | 106.7 s | 3.67 | 47.6 / 52.4 | 0        |
| 2   | 16.8 / 22.3 / 60.9 | 41.5 s | 47.6 s | 73.8 s  | 2.66 | 52.2 / 47.8 | 0        |
| 3   | 42 / 22.1 / 35.8   | 63.8 s | 65.6 s | 99.9 s  | 3.43 | 51.7 / 48.3 | 1        |

## What misses, and what is not shown

- **Medium and easy games are too short and too military.** Outside hard against hard, nine games in ten on map 1 end with a dead Queen after 31 to 39 s. Weaker Queen bots fly into fights they lose before the hive or the snail matters. The targets were set for hard against hard and are met only there. A person playing with medium bots will see mostly military endings.
- **Map 1's median is at the bottom of the range** (61 to 64 s against 60 to 120 s) and below the arcade's 68 to 84 s.
- **Map 2 games are short.** A median of 42 s and 2.7 Queen deaths at hard are below the 60 s and 3 to 4 targets. That is the price of a snail map whose goals are 112 px from the start, and it has not been tuned further.
- **Map 3 is not a military map.** It was drawn to favour military wins, yet at hard its mix is 42 / 22 / 36 with more snail wins than map 1. The likely cause, not verified, is that the tunnel roof over the floor protects the rider more than the open hives expose the Workers.
- **Side balance on single 200-game runs strays outside 47 to 53%** (46% on map 1 easy, 46.5% on map 2 hard, 54.5% on map 2 hard v medium). These are within sampling noise for 200 games, and the 1000-game runs are inside the range on every map, but no 1000-game run exists for medium or easy.
- **One timeout in 3000 hard games** (map 3, seed 5653): both Queens down to their last egg turn careful, the berries nearly run out with the hives at 5 and 10 of 12, and the snail is ridden back and forth for 300 s. Nothing forces an ending in that state.
- **Hard against easy is 97 to 98%.** The spread between levels is wide; easy may be too weak to be fun to beat, and medium may be closer to easy than to hard (hard beats medium 88.5%, medium beats easy 80.5%).
- Maps 2 and 3 were measured, not tuned. Only map 1 went through tuning rounds.

## How map 1 got here

Each change was measured over 200 hard games before it was kept.

- **Hive size.** The first version had 6 holes per hive, and economy wins came too quickly. The hive went to 12 holes in two staggered rows, the arcade count, although the game is 3v3.
- **Berry placement.** A pile of 3 one level below each hive was removed and the centre pile doubled from 6 to 12. Now no pile is near a hive: the nearest are three ledge levels down, and the largest (12 of 36) sits in the contested centre under the middle warrior gate.
- **Snail goals.** Goals at x 44 and 436, 196 px from the start, make an unopposed ride 35 s. They were not changed during tuning.
- **Bot levels.** Medium first beat easy in only 68% of games. Easy was weakened (slower reactions, worse aim, less regular flapping, more and longer blunders) until the ladder held on all three maps. The distance at which flyers notice a threat was also roughly halved at every level.
- **Side bias.** Over 1000 games the left side won 45.9% on map 1 and 58.5% on map 2. The cause was not the rules, which are mirror-symmetric, but the bots' navigation tables, built left to right. Making both tables their own mirror image, and replacing the step-parity tie-break with a coin flip from the seed and the step, brought every map inside 47 to 53% over 1000 games.
