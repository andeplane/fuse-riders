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

Results below are from engine revision `b7f07916` unless a table says "before", which is revision `815f1943`, the end of the first tuning round. Runs of 200 games use seeds 1 to 200 and runs of 1000 games seeds 5001 to 6000, both through the script above. The runs of 2000 games and more call the script's `playGame` once per seed from a parallel driver that is not in the repository; they skip the second, hash-checking play and give the same result per seed.

With 200 games a share near 50% is uncertain by about 7 points either way (95%), with 1000 games by about 3, with 10,000 by about 1.

## Targets and results on map 1

Hard against hard on map 1, "Twin Hives", is the reference matchup.

| Target                                                               | 200 games        | 1000 games         | 10,000 games       | Met                 |
| -------------------------------------------------------------------- | ---------------- | ------------------ | ------------------ | ------------------- |
| Win mix 62 / 24 / 14 military, economy, snail, each within 10 points | 61 / 22.5 / 16.5 | 62.6 / 20.1 / 17.3 | 61.3 / 22.2 / 16.6 | Yes                 |
| Median game 68 to 84 s (the arcade figure)                           | 69.6 s           | 68.5 s             | 68.7 s             | Yes, at the low end |
| Side balance 47 to 53%                                               | 50.5%            | 50.6%              | 50.0%              | Yes                 |
| 3 to 4 Queen deaths per game                                         | 3.83             | 3.81               | 3.82               | Yes                 |
| Hard beats medium in at least 70%                                    | 91%              |                    | 90.8% (2000 games) | Yes                 |
| Medium beats easy in at least 70%                                    | 84%              |                    | 80.2% (2000 games) | Yes                 |
| No timeouts                                                          | 0                | 0                  | 0                  | Yes                 |

The 90th percentile is 115 to 123 s.

Medium against medium on map 1 has its own target: military at most 75% and a median of at least 50 s.

| Run                            | Mix                | Median | Met      |
| ------------------------------ | ------------------ | ------ | -------- |
| 200 games, seeds 1 to 200      | 52.5 / 21.5 / 26   | 53.9 s | Yes      |
| 1000 games, seeds 5001 to 6000 | 52.1 / 20.6 / 27.3 | 49.7 s | Mix only |
| 10,000 games, seeds 30001 on   | 51.4 / 21.3 / 27.2 | 50.6 s | Yes      |
| 20,000 games, seeds 5001 on    | 51.9 / 21.0 / 27.2 | 50.4 s | Yes      |
| 20,000 games, seeds 200001 on  | 51.4 / 21.2 / 27.4 | 50.4 s | Yes      |

The mix is met with room to spare. The median sits on the line: about 50.4 s over the long runs, so a block of 1000 games lands either side of 50 s.

Full output of the reference runs:

```
Killer Fuse, map 1: 200 games, hard against hard, seeds 1..200
decided 200, timeouts 0
side wins: left (team 0) 101 (50.5%), right (team 1) 99 (49.5%)
win kinds: military 122 (61%), economy 45 (22.5%), snail 33 (16.5%)
length: median 69.6 s, mean 74.4 s, p90 115.4 s
per game: Queen deaths 3.83, other kills 17.61, berries banked 11.82 (kicked in 0.2), gate uses 3.71, snail mounts 2.66, snail meals 0.42
determinism: every seed played twice, final hashes equal
```

```
Killer Fuse, map 1: 200 games, hard against medium, seeds 1..200
decided 200, timeouts 0
side wins: left (team 0) 102 (51%), right (team 1) 98 (49%)
level wins: hard 182 (91%), medium 18 (9%)
win kinds: military 128 (64%), economy 38 (19%), snail 34 (17%)
  hard won by: military 115, economy 37, snail 30
  medium won by: military 13, economy 1, snail 4
length: median 45.5 s, mean 49.7 s, p90 77.2 s
per game: Queen deaths 3.55, other kills 13.3, berries banked 10.5 (kicked in 0.21), gate uses 2.57, snail mounts 1.8, snail meals 0.29
determinism: every seed played twice, final hashes equal
```

```
Killer Fuse, map 1: 200 games, medium against easy, seeds 1..200
decided 200, timeouts 0
side wins: left (team 0) 100 (50%), right (team 1) 100 (50%)
level wins: medium 168 (84%), easy 32 (16%)
win kinds: military 127 (63.5%), economy 36 (18%), snail 37 (18.5%)
  medium won by: military 119, economy 29, snail 20
  easy won by: military 8, economy 7, snail 17
length: median 45 s, mean 46.8 s, p90 70.7 s
per game: Queen deaths 3.21, other kills 11.22, berries banked 11.71 (kicked in 0.12), gate uses 2.1, snail mounts 1.33, snail meals 0.39
determinism: every seed played twice, final hashes equal
```

## Before and after the second round

10,000 games per row. "Before" is revision `815f1943` on seeds 20001 on; "after" is `b7f07916` on seeds 30001 on (map 2 hard: 20,000 games). "Mix" is military / economy / snail in percent; "QD" is Queen deaths per game.

| Map | Matchup         | Before: mix        | Median | QD   | After: mix         | Median | QD   | Target for the round                   |
| --- | --------------- | ------------------ | ------ | ---- | ------------------ | ------ | ---- | -------------------------------------- |
| 1   | hard v hard     | 58.6 / 25.3 / 16.1 | 62.2 s | 3.66 | 61.3 / 22.2 / 16.6 | 68.7 s | 3.82 | 62 / 24 / 14, median 68 to 84 s: met   |
| 1   | medium v medium | 88.4 / 9.7 / 1.9   | 39.8 s | 4.12 | 51.4 / 21.3 / 27.2 | 50.6 s | 3.37 | Military at most 75%, median 50 s: met |
| 1   | easy v easy     | 93.8 / 4.8 / 1.5   | 31.9 s | 4.34 | 40.7 / 34.4 / 24.9 | 51.0 s | 2.72 | None set                               |
| 2   | hard v hard     | 15.7 / 20.8 / 63.4 | 41.1 s | 2.62 | 37.6 / 23.1 / 39.3 | 60.3 s | 3.42 | Snail at most 40%, median 55 s: met    |
| 3   | hard v hard     | 41.9 / 21.2 / 36.9 | 62.8 s | 3.42 | 69.8 / 7.4 / 22.8  | 67.2 s | 3.96 | Military at least 65%: met             |

What changed between the two, and what each change did on its own where it was measured:

- **The Queen's body** went from 14 by 14 px to 16 by 22 px to match her sprite. With nothing else changed, map 1 hard moved from 58.6 / 25.3 / 16.1 to 63.7 / 20.6 / 15.7 and the median from 62.2 s to 59.7 s (10,000 games): a bigger Queen is hit more often.
- **The duel line.** A duel used to compare the two bodies' middles. With a 22 px Queen that put her middle 5 px above a Warrior's when both stand on the same ledge, so she would have killed it by walking into it. A duel now compares a line half a Warrior's height above the feet, for a Queen too. On map 1 hard this moved the military share up by about 3 points and shortened the median by about 4 s (2000 games).
- **Bot levels.** See the table in [bots.md](bots.md). A Queen in a lapse now drifts back to her hive instead of charging the nearest enemy; Workers at medium and hard start running from a military unit at 70 px, not 28 and 40; easy lapses less often (35% of decisions, not 60%); medium flyers notice a threat at 36 px, not 30, and hard ones at 38 px, not 40; a team's second Worker plans to ride in 40% of rounds at every level.
- **Regrowth clock.** The piles refill every 120 s of play as well as 90 s after they run dry. Its effect on the mix is inside the noise.
- **Map 2.** Each side's own warrior gate moved from the third ledge level (140, 126) down to the lowest ledge (148, 214), right over the snail's track, and the pile on that ledge moved from x 128 to x 108. The goals moved out from x 128 and 352 to x 104 and 376 (136 px from the start, not 112).
- **Map 3.** The side warrior gates moved from the third ledge level (16, 126) down to the wall ledge (18, 214), over the snail's goals, and swapped places with a pile of 6. The long low ledge (80, 214, 120) that roofed the snail's track shrank to (112, 214, 46).

What did not work, so it is not repeated: on map 2 the goal distance alone barely matters (moving the goals from x 128 out to x 48 took the snail share from 57% to 39%, and only at the far end, where the leash is as long as map 1's), and taking the roof off the track did nothing. On map 3 a shorter roof alone raised the snail share. On both maps what decides the snail share is whether Warriors are made near the track.

## Every matchup, every map

200 games each, seeds 1 to 200. "Side" is the left team's share of wins.

| Map | Matchup         | Stronger wins | Mix              | Median | Side  | Timeouts |
| --- | --------------- | ------------- | ---------------- | ------ | ----- | -------- |
| 1   | hard v hard     |               | 61 / 22.5 / 16.5 | 69.6 s | 50.5% | 0        |
| 1   | hard v medium   | 91%           | 64 / 19 / 17     | 45.5 s | 51%   | 0        |
| 1   | medium v easy   | 84%           | 63.5 / 18 / 18.5 | 45 s   | 50%   | 0        |
| 1   | hard v easy     | 99.5%         | 77 / 14 / 9      | 31.1 s | 50.5% | 0        |
| 1   | medium v medium |               | 52.5 / 21.5 / 26 | 53.9 s | 51.5% | 0        |
| 1   | easy v easy     |               | 39.5 / 32 / 28.5 | 52.9 s | 49.5% | 0        |
| 2   | hard v hard     |               | 37.5 / 22.5 / 40 | 62.5 s | 50.5% | 0        |
| 2   | hard v medium   | 92%           | 55.5 / 10.5 / 34 | 37 s   | 51%   | 0        |
| 2   | medium v easy   | 81%           | 47.5 / 13.5 / 39 | 36.7 s | 52%   | 0        |
| 2   | hard v easy     | 99%           | 72 / 8.5 / 19.5  | 27.4 s | 50%   | 0        |
| 2   | medium v medium |               | 32 / 19 / 49     | 39.7 s | 52%   | 0        |
| 2   | easy v easy     |               | 30 / 19 / 51     | 40.7 s | 45%   | 0        |
| 3   | hard v hard     |               | 67.5 / 5.5 / 27  | 66.3 s | 51.5% | 0        |
| 3   | hard v medium   | 86%           | 72.5 / 7 / 20.5  | 48.1 s | 46%   | 0        |
| 3   | medium v easy   | 70.5%         | 56.5 / 9.5 / 34  | 49.7 s | 51.5% | 0        |
| 3   | hard v easy     | 95.5%         | 87.5 / 4.5 / 8   | 37.2 s | 49.5% | 0        |
| 3   | medium v medium |               | 52 / 9.5 / 38.5  | 51.9 s | 54%   | 0        |
| 3   | easy v easy     |               | 37.5 / 17.5 / 45 | 54.3 s | 45%   | 0        |

The level ladder over 2000 games per matchup (seeds 1 to 2000): hard beats medium in 90.8%, 88.5% and 86.8% on maps 1, 2 and 3; medium beats easy in 80.2%, 77.5% and 76.8%.

Hard against hard over 1000 games, seeds 5001 to 6000:

| Map | Mix                | Median | Mean   | p90     | QD   | Side        | Timeouts |
| --- | ------------------ | ------ | ------ | ------- | ---- | ----------- | -------- |
| 1   | 62.6 / 20.1 / 17.3 | 68.5 s | 72.9 s | 122.6 s | 3.81 | 50.6 / 49.4 | 0        |
| 2   | 37.6 / 24.6 / 37.8 | 59.9 s | 64.8 s | 102 s   | 3.42 | 49.3 / 50.7 | 0        |
| 3   | 71.7 / 7.7 / 20.6  | 70.1 s | 76.3 s | 135.1 s | 4.02 | 48.5 / 51.5 | 0        |

## Side balance

The target is 47 to 53% for the left team. A 200-game run cannot show that: its 95% range is 7 points either way, and single runs in the table above read 45%, 46% and 54%.

| Map | Level  | Games  | Left wins | Note                                                   |
| --- | ------ | ------ | --------- | ------------------------------------------------------ |
| 1   | hard   | 10,000 | 50.0%     | 1000 games on seeds 9001 to 10000: 51.2%               |
| 1   | medium | 50,000 | 50.0%     | 50.5%, 49.5% and 50.3% in three runs                   |
| 1   | easy   | 10,000 | 51.0%     |                                                        |
| 2   | hard   | 20,000 | 50.8%     | 50.5% over 50,000 games with the goals 2 px further in |
| 2   | medium | 10,000 | 50.4%     |                                                        |
| 2   | easy   | 10,000 | 51.6%     |                                                        |
| 3   | hard   | 10,000 | 50.4%     |                                                        |
| 3   | medium | 10,000 | 49.9%     |                                                        |
| 3   | easy   | 10,000 | 50.0%     |                                                        |

- Every row is inside 47 to 53%.
- **The 56.5 / 43.5 seen on 200 hard games from seed 9001 was sampling noise.** At the revision that run used, 10,000 games each gave the left team 49.8% (map 1 hard), 50.6% (map 1 medium), 50.3% (map 1 easy), 50.2% (map 2 hard) and 49.9% (map 3 hard), and seeds 9001 to 10000 gave 52.5%.
- One block of 1000 medium games (seeds 5001 to 6000) reads 44.9% left. The 20,000 games starting at the same seed read 49.5%, and the next two blocks of 1000 read 50.6% and 49.9%, so that block is an outlier, not a bias.
- **A small left lean on map 2 is not ruled out.** Easy reads 51.6% over 10,000 games, which is three standard errors from 50%, and hard reads 50.5 to 50.8% over 20,000 to 50,000. If it is real it is about one point. Its cause was not looked for; the rules and the navigation tables are mirror-symmetric (tested), so it would be in a bot tie-break.

## Games that do not end

The engine has no round clock: a game ends only by a victory. The runner's 300 s limit is a measuring device.

Before this round one or two hard games in 10,000 reached 300 s. In the ones traced, both Queens were on their last egg and playing carefully, and the hives were filling slowly from piles that had been picked down to a berry or two. The original regrows berries only when the map is dry, and a pile with one berry nobody fetches keeps the map from ever being dry.

The piles now also refill every 120 s of play, whatever is left in them (`REGROW_CLOCK`), so berries cannot run out for good. Filled holes never empty, so with berries always on the map a hive can only move toward full.

Measured at this revision with the limit raised to 30 minutes: 112,000 games across the three maps and levels all ended, the longest after 279 s. Under the 300 s limit there were no timeouts in any run listed in this document.

This is evidence, not a proof. Nothing forces a Worker to carry a berry home, so two teams that both refused to bank, ride or fight could still play forever. Bots do not behave that way, and people who do are choosing a draw.

## What misses, and what is not shown

- **The medium median is on the line.** About 50.4 s against a target of at least 50 s; see above. Raising medium's awareness from 36 to 40 px moved it by 0.3 s, so more careful flyers no longer buy length. It was left where it is.
- **Map 1's hard median is at the bottom of the arcade range** (68.5 to 69.6 s against 68 to 84 s).
- **Map 2 is a snail map only narrowly at hard.** Snail wins 39.3% against 37.6% military over 20,000 games, and in the 1000-game run the two are level (37.8% and 37.6%). At medium and easy the snail wins 46 to 48%, above the 40% line that was set for hard, and those games are short (median 40 to 42 s).
- **Map 3 has almost no economy wins at hard** (7.4%), and its Queen deaths per game (3.96 to 4.02) touch the top of the 3 to 4 range. At medium and easy it is not a military map: 50.8 / 10.9 / 38.3 and 36.0 / 21.5 / 42.5 over 10,000 games. Weaker bots lose the snail race before they lose their Queen.
- **Easy against easy has no military lean at all** (40.7 / 34.4 / 24.9 on map 1). Easy Queens now go home when they lapse, and easy Warriors are too inaccurate to catch them.
- **Hard against easy is 95.5 to 99.5%.** The spread between levels is wide; easy may be too weak to be fun to beat.
- **Medium beats easy on map 3 in 70.5% of 200 games**, right at the 70% line; over 2000 games it is 76.8%.
- **A Worker that is not invulnerable still does not bump.** In this engine a military unit kills an ordinary Worker on contact, so there is no contact left over to turn into a bump without changing who dies. Making Workers survive some contacts would change every number here; it was not tried.
- Maps 2 and 3 were tuned at hard only, by moving gates, piles, one ledge and the goals. Their ledges were not redrawn.

## How map 1 got here

Each change in the first round was measured over 200 hard games before it was kept.

- **Hive size.** The first version had 6 holes per hive, and economy wins came too quickly. The hive went to 12 holes in two staggered rows, the arcade count, although the game is 3v3.
- **Berry placement.** A pile of 3 one level below each hive was removed and the centre pile doubled from 6 to 12. Now no pile is near a hive: the nearest are three ledge levels down, and the largest (12 of 36) sits in the contested centre under the middle warrior gate.
- **Snail goals.** Goals at x 44 and 436, 196 px from the start, make an unopposed ride 35 s. They were not changed during tuning.
- **Bot levels.** Medium first beat easy in only 68% of games. Easy was weakened (slower reactions, worse aim, less regular flapping, more and longer blunders) until the ladder held on all three maps. The distance at which flyers notice a threat was also roughly halved at every level.
- **Side bias.** Over 1000 games the left side won 45.9% on map 1 and 58.5% on map 2. The cause was not the rules, which are mirror-symmetric, but the bots' navigation tables, built left to right. Making both tables their own mirror image, and replacing the step-parity tie-break with a coin flip from the seed and the step, brought every map inside 47 to 53%.

In the second round the constants were tried first and found to matter little: on map 1 at hard, changing the respawn time, the gate time, the height a duel needs or the respawn invulnerability each moved the mix by a point or two. What moves it is how the bots play. The distance at which a flyer notices a threat sets the military share (25 px gives 84% military, 60 px gives 25%), the distance at which Workers run lengthens the game, and the soldier and rider plans trade economy against snail.
