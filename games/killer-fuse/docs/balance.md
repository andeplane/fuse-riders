# Killer Fuse balance

What the headless runner measures when bots play each other at rules `killer-fuse-5`, against the targets in [BRIEF.md](BRIEF.md). Every number here comes from bots; no person's play has been measured. The rules and values are Killer Queen Black's and were not tuned toward the targets: only the bots were. The targets that are still missed are listed as misses below.

## How to measure

```sh
pnpm exec tsx scripts/killer-fuse-sim.ts --games 300 --level hard [--level-b medium] [--map 1] [--seed 20001] [--max-seconds 300] [--idle-queen] [--json]
```

- Game `i` is seeded `seed + i`, so a run is reproducible.
- With `--level-b` the two teams play at different levels and swap screen sides every game.
- With `--idle-queen` side B's Queen is a seat whose player holds nothing, and side B swaps screen sides every game.
- Every game is played twice and the two final state hashes must match; the run fails otherwise.
- A game undecided after `--max-seconds` is counted as a timeout and left out of the win and length figures. At the default of 300 s that is exactly the games the engine's own clock would decide (by eggs, then berries, then the snail, then a coin flip).

All results below are from revision `c5003446`, 300 games per row, seeds 20001 to 20300, unless a row says otherwise. With 300 games a share near 50% is uncertain by about 6 points either way (95%), and one near 70% by about 5.

## Targets and results on map 1

Hard against hard on map 1, "Day", is the reference matchup. "Before" is revision `89834711` (rules `killer-fuse-4`).

| Target                                                               | Before             | Now                | Met                                           |
| -------------------------------------------------------------------- | ------------------ | ------------------ | --------------------------------------------- |
| Win mix 62 / 24 / 14 military, economy, snail, each within 10 points | 47.3 / 20.7 / 32.0 | 71.7 / 17.7 / 10.7 | Yes at 300 games; military 1.5 over at 10,000 |
| Median game 68 to 84 s                                               | 61.0 s             | 73.2 s             | Yes                                           |
| Side balance 47 to 53% for the left team                             | 51.3%              | 51.7%              | Yes (50.2% over 10,000 games)                 |
| 3 to 4 Queen deaths per game                                         | 2.53               | 3.45               | Yes                                           |
| Hard beats medium in at least 70%                                    | 73.3%              | 86.3%              | Yes                                           |
| Medium beats easy in at least 70%                                    | 70.0%              | 78.7%              | Yes                                           |
| No games reaching the clock                                          | 0 of 300           | 0 of 300           | Yes                                           |
| Hard bots beat a Queen whose player holds nothing, mostly by eggs    | 66.8%, 46% by eggs | 93.0%, 89% by eggs | Yes                                           |

```
Killer Fuse, map 1: 300 games, hard against hard, seeds 20001..20300
decided 300, timeouts 0
side wins: left (team 0) 155 (51.7%), right (team 1) 145 (48.3%)
win kinds: military 215 (71.7%), economy 53 (17.7%), snail 32 (10.7%)
length: median 73.2 s, mean 77.7 s, p90 124.4 s
per game: Queen deaths 3.45, other kills 14.41, berries banked 12.28 (kicked in 0.15), gate uses 3.13, snail mounts 2.3, snail meals 0.26
determinism: every seed played twice, final hashes equal
```

Over 10,000 games (seeds 100001 to 110000, each played once) the same matchup reads 73.5 / 15.2 / 11.3, median 72.5 s, 3.49 Queen deaths, left side 50.2%. The 300-game mix is inside its own noise of that; the larger sample puts the military share 11.5 points above the target, so that one figure is a miss by 1.5 points.

## Every matchup, every map

"Mix" is military / economy / snail in percent, "QD" Queen deaths per game, "Side" the left team's share of wins, "Clock" the games that reached 300 s.

| Map | Matchup         | Stronger wins | Mix                | Median | p90     | QD   | Side  | Clock |
| --- | --------------- | ------------- | ------------------ | ------ | ------- | ---- | ----- | ----- |
| 1   | hard v hard     |               | 71.7 / 17.7 / 10.7 | 73.2 s | 124.4 s | 3.45 | 51.7% | 0     |
| 1   | medium v medium |               | 49.0 / 17.3 / 33.7 | 53.3 s | 87.7 s  | 2.82 | 49.3% | 0     |
| 1   | easy v easy     |               | 35.7 / 15.7 / 48.7 | 56.1 s | 85.4 s  | 2.31 | 49.3% | 0     |
| 1   | hard v medium   | 86.3%         | 66.3 / 19.7 / 14.0 | 52.2 s | 95.1 s  | 3.10 | 51.0% | 0     |
| 1   | medium v easy   | 78.7%         | 46.0 / 17.7 / 36.3 | 48.6 s | 78.4 s  | 2.46 | 46.7% | 0     |
| 1   | hard v easy     | 98.0%         | 72.7 / 18.7 / 8.7  | 39.1 s | 80.2 s  | 2.76 | 49.3% | 0     |
| 2   | hard v hard     |               | 51.7 / 37.0 / 11.3 | 94.3 s | 137.3 s | 3.02 | 49.3% | 0     |
| 2   | medium v medium |               | 37.7 / 24.7 / 37.7 | 62.0 s | 110.2 s | 2.36 | 55.7% | 0     |
| 2   | easy v easy     |               | 34.0 / 20.3 / 45.7 | 61.1 s | 96.9 s  | 2.12 | 53.3% | 0     |
| 2   | hard v medium   | 90.3%         | 56.0 / 32.3 / 11.7 | 65.8 s | 108.5 s | 2.67 | 51.7% | 0     |
| 2   | medium v easy   | 73.3%         | 40.3 / 23.7 / 36.0 | 56.7 s | 89.8 s  | 2.23 | 51.3% | 0     |
| 2   | hard v easy     | 96.7%         | 66.3 / 20.3 / 13.3 | 43.0 s | 82.7 s  | 2.61 | 51.3% | 0     |
| 3   | hard v hard     |               | 47.3 / 41.7 / 11.0 | 78.8 s | 111.1 s | 2.95 | 53.0% | 0     |
| 3   | medium v medium |               | 58.3 / 20.3 / 21.3 | 67.2 s | 93.5 s  | 3.06 | 47.3% | 0     |
| 3   | easy v easy     |               | 40.7 / 24.7 / 34.7 | 72.2 s | 90.5 s  | 2.55 | 47.0% | 0     |
| 3   | hard v medium   | 90.0%         | 66.3 / 25.7 / 8.0  | 61.4 s | 93.4 s  | 2.99 | 52.0% | 0     |
| 3   | medium v easy   | 93.0%         | 55.3 / 25.7 / 19.0 | 56.9 s | 82.3 s  | 2.63 | 52.3% | 0     |
| 3   | hard v easy     | 99.7%         | 72.3 / 22.7 / 5.0  | 42.2 s | 71.0 s  | 2.68 | 49.7% | 0     |

The levels are ordered on every map: hard beats medium in 86 to 90%, medium beats easy in 73 to 93%, hard beats easy in 97 to 100%.

### A Queen whose player holds nothing

Hard bots on both teams, one team's Queen seat held by a player who presses nothing (`--idle-queen`).

| Map | Bots' team wins | Mix               | Median | QD   | Clock |
| --- | --------------- | ----------------- | ------ | ---- | ----- |
| 1   | 93.0%           | 92.6 / 3.0 / 4.3  | 30.6 s | 3.15 | 1     |
| 2   | 96.3%           | 85.7 / 11.3 / 3.0 | 31.5 s | 2.96 | 0     |
| 3   | 95.0%           | 81.9 / 11.0 / 7.0 | 46.8 s | 2.81 | 1     |

The team with the idle Queen still has two hard Workers, who win the remaining games in all three ways.

### Side balance over 10,000 games

Seeds 100001 to 110000, each game played once. The 95% range at this size is about 1 point either way.

| Map | Matchup         | Left team wins |
| --- | --------------- | -------------- |
| 1   | hard v hard     | 50.2%          |
| 1   | medium v medium | 50.2%          |
| 2   | medium v medium | 50.6%          |

No side bias. The 45.7% and 55.0% that single 300-game rows read at the last revision (and the 55.7% map 2 medium reads in the table above) are noise.

## What misses, and what is not shown

- **Map 1's military share is slightly high**: 73.5% over 10,000 games against a band that ends at 72%. Economy (15.2%) and snail (11.3%) are inside their bands. The 300-game row (71.7%) is inside.
- **Maps 2 and 3 are still short of military wins at hard**: 51.7 / 37.0 / 11.3 and 47.3 / 41.7 / 11.0 against 62 / 24 / 14. Military is 10 and 15 points low and economy 13 and 18 points high. Before this round they read 25.6 / 46.5 / 27.9 and 35.9 / 46.6 / 17.4. Both maps put the piles close to the hives, and hard Workers bank faster than Warriors can stop them.
- **Map 2's median is 94 s**, above the 68 to 84 s range; map 3's is 78.8 s, inside it.
- **Queen deaths on map 3 are 2.95 per game**, just under 3; map 2 reads 3.02.
- **Weaker levels still win mostly by the snail among themselves**: medium against medium on map 1 is 49 / 17 / 34 and easy against easy 36 / 16 / 49. Easy bots do not contest the snail at all, and medium ones start later than hard ones. Against hard, the snail is no longer the way through: easy's 6 wins of 300 on map 1 are all by snail, where it was 50.
- **One idle-Queen game in 300 reaches the clock** on maps 1 and 3.
- **The lever settings trade map 1 against maps 2 and 3.** More early Warriors on hard (`soldier`, `muster`) raise the military share on every map together. The values kept (`soldier` 60, `muster` 10) put map 1 at the top of its band to bring maps 2 and 3 as close as they come. With `soldier` 50 and no muster rule map 1 read 62.7 / 26.3 / 11.0, nearly on target, and maps 2 and 3 read 40.3 / 49.7 / 10.0 and 37.7 / 51.7 / 10.7. Getting all three maps inside the bands would take a change to the maps (pile distance, hive holes), which are the ported arcade maps and were left alone.
- **Nothing was measured with people.**

## How the rounds compare

Hard against hard. The earlier rows are the figures recorded when each revision was current; their runs were not repeated for this document, and the earliest used other maps.

| Revision                       | Rules                                                            | Map | Mix (military / economy / snail) | Median  | QD   | Left wins |
| ------------------------------ | ---------------------------------------------------------------- | --- | -------------------------------- | ------- | ---- | --------- |
| Round 3, before Black's values | Contact combat, our own movement values                          | 1   | 60.3 / 25.1 / 14.6               | 78.0 s  |      | 49.8%     |
| `cbd74362`                     | Black's movement, berries, gates and snail; still contact combat | 1   | 9.3 / 68.0 / 22.7                | 97.5 s  |      | 52.3%     |
| `cbd74362`                     |                                                                  | 2   | 22.4 / 36.5 / 41.1               | 100.0 s |      |           |
| `cbd74362`                     |                                                                  | 3   | 10.7 / 80.0 / 9.3                | 69.8 s  |      |           |
| `89834711`                     | Sword combat with the attack button (`killer-fuse-4`)            | 1   | 47.3 / 20.7 / 32.0               | 61.0 s  | 2.53 | 51.3%     |
| `89834711`                     |                                                                  | 2   | 25.6 / 46.5 / 27.9               | 78.6 s  | 1.71 | 52.2%     |
| `89834711`                     |                                                                  | 3   | 35.9 / 46.6 / 17.4               | 83.7 s  | 2.31 | 53.4%     |
| `c5003446`                     | Same rules, better bots (`killer-fuse-5`)                        | 1   | 71.7 / 17.7 / 10.7               | 73.2 s  | 3.45 | 51.7%     |
| `c5003446`                     |                                                                  | 2   | 51.7 / 37.0 / 11.3               | 94.3 s  | 3.02 | 49.3%     |
| `c5003446`                     |                                                                  | 3   | 47.3 / 41.7 / 11.0               | 78.8 s  | 2.95 | 53.0%     |

What changed in the bots between the last two revisions, in the order it mattered:

1. **Snail defence.** A free snail standing a fifth of the way toward the enemy's goal (three tenths for medium) is ridden back by the nearest free Worker, and hard teams plan a rider less often (15% of rounds, from 30%). Snail wins on map 1 fell from 32% to 11%.
2. **Queens fight.** A Queen with every egg goes for an enemy Queen that cannot answer: one standing on a floor, facing away, or with her sword cooling down. A Queen with a life to spare drops her caution once the enemy hive has 8 berries. Queen deaths rose from 2.5 to 3.5 per game, and a Queen whose player holds nothing now dies in nearly every game.
3. **Economy defence.** From 4 berries in the enemy hive, flyers hunt carriers first. A hard team with no Warrior buys one with its next berry once the enemy hive has 10; hard first Workers plan to be Warriors in 60% of rounds, from 50%.
4. **Bots that got stuck.** Games against an idle Queen that ran to the clock led to five navigation faults, all fixed: Workers going back and forth across the screen seam between two platforms, Workers walking into a block that splits a platform, a Warrior hovering on top of a standing target its sword could not reach, a Queen standing on a ledge directly over her next point, and a Queen pressed against the underside of a platform. A detector for a bot that keeps one goal within 12 px for 12 s finds none in 200 games per map.

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
