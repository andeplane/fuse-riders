# Parity with the original

One row per feature of the arcade game. Status is `no`, `partial` or `yes`; re-score it at the end of every step, with a note on any deliberate difference.

Last scored after step 2 (engine and bots, commit `126d70d1`). "Engine" means the rule exists and is tested headless; nothing has been played by a person or drawn yet.

| #   | Feature of the original                                           | Status  | Note                                                                                   |
| --- | ----------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| 1   | Military win: enemy Queen killed three times                      | yes     | Engine                                                                                 |
| 2   | Economic win: every hive hole filled                              | yes     | Engine; 12 holes as in the original                                                    |
| 3   | Snail win: ridden into the rider's own goal                       | yes     | Engine                                                                                 |
| 4   | One stick, one button; no attack button                           | partial | Engine input only; no keyboard, gamepad or touch yet                                   |
| 5   | Worker: run, variable jump, carry one berry                       | yes     | Engine; feel not yet judged by a person                                                |
| 6   | Warrior and Queen flight by repeated presses                      | yes     | Engine; feel not yet judged by a person                                                |
| 7   | Queen dive                                                        | yes     | Engine                                                                                 |
| 8   | Contact combat by height and facing, bounce otherwise             | yes     | Engine                                                                                 |
| 9   | Workers bump military units                                       | partial | Only an invulnerable Worker bumps                                                      |
| 10  | Warrior gate: one berry, short transformation, invulnerable after | yes     | Engine; a Worker inside a gate can still be killed                                     |
| 11  | Speed gate: 1.35 times; speed then warrior makes a speed warrior  | yes     | Engine                                                                                 |
| 12  | Queen claims gates by touch; enemy locked out; re-claimable       | yes     | Engine                                                                                 |
| 13  | Death respawns at the hive; Warrior returns as Worker             | yes     | Engine                                                                                 |
| 14  | Carried berry drops on death; loose berries are kicked            | yes     | Engine                                                                                 |
| 15  | Berry kicked into a hole counts                                   | yes     | Engine; bots never do it on purpose                                                    |
| 16  | Finite berries; regrow 90 s after the map runs dry                | yes     | Engine                                                                                 |
| 17  | Snail moves toward the rider's goal, both ways, nothing banked    | yes     | Engine; mounting is automatic on touch, the button dismounts                           |
| 18  | Snail eats an enemy Worker in front of it and halts 3.67 s        | yes     | Engine                                                                                 |
| 19  | Killing the rider frees the Worker being eaten                    | yes     | Engine                                                                                 |
| 20  | Speed rider moves the snail faster and is eaten faster            | yes     | Engine                                                                                 |
| 21  | Screen wrap                                                       | yes     | Engine                                                                                 |
| 22  | Three maps that favour different wins                             | partial | Three maps exist; only map 1 is tuned, map 3 is not military-heavy                     |
| 23  | Sets of games on rotating maps                                    | no      |                                                                                        |
| 24  | Bots fill empty seats                                             | partial | Engine; not yet in a room                                                              |
| 25  | Eggs, holes and snail position readable at a glance               | no      | Art exists, no renderer yet                                                            |
| 26  | Win mix near 62 / 24 / 14                                         | partial | Map 1, hard bots: 60 / 23 / 17 over 1000 games; medium and easy are about 90% military |
| 27  | Median game 68 to 84 s                                            | partial | Map 1, hard bots: 61 to 64 s; medium and easy 31 to 39 s                               |
| 28  | 5v5                                                               | no      | Deliberate: 3v3, six seats                                                             |
