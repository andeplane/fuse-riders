# Parity with Killer Queen Black

One row per feature of Killer Queen Black (the Steam version). Status is `no`, `partial` or `yes`. "Deliberate" marks a difference we chose; the full list is in [BRIEF.md](BRIEF.md) and [engine.md](engine.md).

Scored at commit `1e116a61`, rules `killer-fuse-5` (which changed only the bots and the lesson berry from `killer-fuse-4`; no rule or value of Black's). "Engine" means the rule is in `src/engine` and covered by headless tests. Values were taken from the figures we had of Black and checked against our code, not against the running game frame by frame.

Nothing has been playtested by a person yet. No physical gamepad or phone has been used; gamepad and touch are covered by unit tests only.

## Rules

| #   | Feature                                                                                       | Status  | Note                                                                                  |
| --- | --------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| 1   | Military win: enemy Queen killed three times                                                  | yes     | Engine                                                                                |
| 2   | Economic win: every hive hole filled                                                          | yes     | Engine; 12 holes per hive                                                             |
| 3   | Snail win: ridden into the rider's own goal                                                   | yes     | Engine                                                                                |
| 4   | Controls: stick, one jump / flap button, attack button                                        | yes     | Keyboard, gamepad and touch                                                           |
| 5   | Up bound to nothing; dive on Down                                                             | yes     |                                                                                       |
| 6   | "Hold to flap" option                                                                         | yes     | Off by default; repeats the press 7.5 times a second. Black's repeat rate not checked |
| 7   | Input buffers: jump / flap 3 steps, attack 6 steps, 3 steps of ledge grace                    | yes     | Engine                                                                                |
| 8   | Worker: runs 7 u/s, stops dead, variable jump from 0.86 u to 3.8 u                            | partial | Jump apex and landing steps differ slightly; see "Not verified"                       |
| 9   | Flight: each press 0.3 s of push, up to five at once, climb and fall capped at 10 u/s         | yes     | Hover at about 2.7 presses a second                                                   |
| 10  | Queen dive at 20 u/s while Down is held, lethal from every side                               | yes     | Engine                                                                                |
| 11  | Warrior sword dash: lethal steps 1 to 19, 5.07 u, every 44 steps                              | yes     | A flap during the dash bends it                                                       |
| 12  | Queen sword dash: lethal steps 1 to 17, flat 16 u/s, every 36 steps                           | yes     | Engine                                                                                |
| 13  | Glance when two lethal swords meet face to face: stun 0.35 s, thrown apart                    | partial | Throw scaling differs; see "Not verified"                                             |
| 14  | Head bounce: landing on a head springs off, nobody hurt                                       | yes     | Engine                                                                                |
| 15  | Body bump: other contact stuns both and throws them apart at 10 u/s                           | yes     | Engine                                                                                |
| 16  | Gate offer 0.5 s (cancelled by moving, jumping or enemy Queen tag), lock 2.0 s                | yes     | Engine                                                                                |
| 17  | Invulnerable 2.2 s after a gate                                                               | yes     | Engine                                                                                |
| 18  | Queen claims a gate by touch; enemy locked out until re-claimed; tag ends her invulnerability | yes     | Engine                                                                                |
| 19  | Speed gate: 1.3 times run, flight and snail speed; Warrior climb 1.15 times                   | yes     | Engine                                                                                |
| 20  | Snail: 0.8 u/s, moves only while the rider holds toward the goal                              | yes     | Engine                                                                                |
| 21  | Snail meal 5 s (3.5 s with a speed rider); killing the rider frees the victim                 | yes     | Engine                                                                                |
| 22  | Berries: 6 per pile, no regrowth                                                              | yes     | Engine                                                                                |
| 23  | Loose berries kicked; one that reaches an open hole scores                                    | yes     | Engine; bots never kick one in on purpose                                             |
| 24  | Deposit: 1.5 s in the hole, untouchable                                                       | yes     | Engine                                                                                |
| 25  | Respawn after 3.2 s, invulnerable 2.2 s; Warrior returns as Worker; Queen from a spare egg    | yes     | Engine                                                                                |
| 26  | Screen wrap                                                                                   | yes     | Except where a map has walls                                                          |
| 27  | Other weapons, shield, berry throwing, upgrade choices                                        | no      | Deliberate: sword only                                                                |
| 28  | No game clock                                                                                 | partial | Deliberate: 300 s safety clock, decided by eggs, berries, snail, then a coin flip     |

## Game around the rules

| #   | Feature                                                                 | Status  | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29  | Maps                                                                    | partial | Deliberate: the arcade's Day, Dusk and Night, ported to 480 by 270, not Black's maps. Platforms do not dip when landed on                                                                                                                                                                                                                                                                                                                             |
| 30  | Sets of games                                                           | partial | Deliberate: first to N wins, N from 1 to 3 (default 2), one map or rotating                                                                                                                                                                                                                                                                                                                                                                           |
| 31  | Bots in empty seats                                                     | partial | Deliberate: three levels of our own (easy, medium, hard). Medium and hard bot Queens attack an enemy Queen that cannot answer (sword cooling down, standing on a floor, or facing away) and press harder once the enemy hive holds 8 berries; their flyers hunt a snail rider ahead of everything and berry carriers first from 4 filled enemy holes. Hard bots beat a Queen whose player holds nothing in 93 to 96% of games. See [bots.md](bots.md) |
| 32  | Countdown: 8 s before the first game with a "three ways to win" overlay | yes     | Later games count down 3 s; our card also shows the seat's controls                                                                                                                                                                                                                                                                                                                                                                                   |
| 33  | Rotating tips while waiting                                             | yes     | Lobby turns a tip every 15 s; the first shows the device's controls                                                                                                                                                                                                                                                                                                                                                                                   |
| 34  | Tutorial                                                                | partial | Four short solo lessons (berries, Warrior, snail, Queen) against passive bots, not Black's episodes. On map 2 (Dusk), whose spawn ledge is too short, the lesson berry rests on the platform below the ledge                                                                                                                                                                                                                                          |
| 35  | "Highlight me" outline on spawn, respawn and gate exit                  | yes     | 3 s                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 36  | Visuals and animation timings                                           | partial | Own art. Wing beat 0.1 s (Queen) and 0.08 s (Warrior), glide pose after 0.27 s, invulnerability blink at 1/6 s, taken from the arcade. Dive particle stream not judged with a dive of human length                                                                                                                                                                                                                                                    |
| 37  | Online multiplayer                                                      | partial | Rollback netcode, six seats, up to six watchers, shared screen with phones as controllers. No ranked play or matchmaking                                                                                                                                                                                                                                                                                                                              |
| 38  | Player count                                                            | no      | Deliberate: 3v3 on six seats, not 4v4 on eight                                                                                                                                                                                                                                                                                                                                                                                                        |

## Balance

From [balance.md](balance.md), revision `c5003446` (rules `killer-fuse-5`), hard against hard on map 1 ("Day"), 300 games, unless a row says otherwise. Every figure comes from bots. The bots may still be tuned, so these numbers may move.

| #   | Measure                         | Target                              | Measured                                                                          | Status  |
| --- | ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- | ------- |
| 39  | Win mix (mil/eco/snail), map 1  | 62 / 24 / 14, each within 10 points | 71.7 / 17.7 / 10.7; over 10,000 games 73.5 / 15.2 / 11.3                          | partial |
| 40  | Median game, map 1              | 68 to 84 s                          | 73.2 s (72.5 s over 10,000 games)                                                 | yes     |
| 41  | Left team's wins, map 1         | 47 to 53%                           | 51.7% (50.2% over 10,000 games)                                                   | yes     |
| 42  | Queen deaths per game, map 1    | 3 to 4                              | 3.45 (3.49 over 10,000 games)                                                     | yes     |
| 43  | Hard beats medium, map 1        | at least 70%                        | 86.3%                                                                             | yes     |
| 44  | Medium beats easy, map 1        | at least 70%                        | 78.7%                                                                             | yes     |
| 45  | Games reaching the clock, map 1 | none                                | 0 of 300                                                                          | yes     |
| 46  | Win mix on maps 2 and 3         | 62 / 24 / 14, each within 10 points | Dusk 51.7 / 37.0 / 11.3 (median 94.3 s); Night 47.3 / 41.7 / 11.0 (median 78.8 s) | no      |

Row 39 is inside the bands at 300 games, but over 10,000 games the military share is 73.5%, 1.5 points above the band. Maps 2 and 3 stay economy-heavy, and Dusk's median is above 84 s; balance.md says fixing them would take changes to the ported maps. The level ordering holds on every map (hard beats medium in 86 to 90%, medium beats easy in 73 to 93%).

## Not verified against the original

These follow the figures we had but could not be checked frame by frame:

- A full Worker jump tops out on step 22 and lands on step 46; the figures suggested 24 and 50.
- The glance throw is normalised on the longer axis of the line between the two units and capped at 10 u/s per axis.
- The snap of a loose berry into a hole, and the Queen's guard against standing up under a ceiling, test squares, not circles.
- A flying berry bounces off the snail's whole box.
- A Warrior comes out of a gate standing on the gate's floor.
- The branch where a dash ends on a floor or ceiling is unreachable here.
- The rule that lets a body slip under a wall when its lower quarter is below the wall's middle only matters for walls thinner than 6.3 px, which no map has.
- Platforms do not dip when landed on.
- The dive particle stream has not been judged with a dive of human length.
