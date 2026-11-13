# Killer Fuse: brief

Killer Fuse is a 3v3 side-view team arena for up to six players, with bots in every empty seat. It plays like the arcade game Killer Queen (BumbleBear, 2013): three ways to win that all draw on the same few bodies and the same finite berries. It looks like Killer Queen's chunky pixel insects in Fuse Riders' neon-on-navy palette. The name, sprites, maps and sounds are our own; only the mechanics follow the original.

## Pitch and loop

- **30 seconds:** grab a berry, choose between banking it in the hive and spending it at a gate; fight for height; watch the snail.
- **One game (1 to 2 minutes):** one team wins by military (kill the enemy Queen three times), economy (fill every hole in its hive) or snail (ride the snail into its own goal).
- **One match:** a set of games on rotating maps, first to 2 or 3 game wins.

## Teams, seats and roles

- Two teams: **Cyan** (`--fui-cyan`) and **Pink** (`--fui-pink`). `team = slot % 2`.
- Six seats. Slots 0 and 1 are the Queens; slots 2 to 5 are Workers. Every seat without a person is played by a bot, so a game always has six units.
- Bot level is a room setting: `easy`, `medium` or `hard`.

| Unit           | Can                                                                                                    | Cannot                                    |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Worker         | Run, jump (height follows hold time), carry one berry, deposit, use gates, ride the snail, bump others | Kill                                      |
| Speed worker   | The same at 1.35 times run speed, rise speed and snail speed                                           | Kill                                      |
| Warrior        | Fly by tapping (each press is an upward impulse), kill on contact, kick loose berries                  | Carry berries, use gates, ride the snail  |
| Speed warrior  | Warrior at 1.35 times speed (speed gate first, then warrior gate: two berries)                         | The same                                  |
| Queen          | Fly, kill, dive (stick down), claim gates by touching them                                             | Carry berries, use gates, ride the snail  |

## Rules

Values marked _tune_ start here and are settled by headless bot runs against the targets below.

- **Controls:** left, right, down and one button. The button is jump for Workers and flap for Warriors and Queens. There is no attack button.
- **Combat:** contact decides. A military unit (Warrior or Queen) kills an enemy Worker it touches. Between two military units, the one clearly higher at contact kills the lower, and a hit from behind kills; otherwise both bounce apart. A diving Queen kills what she lands on. Workers never kill, but their bumps push military units.
- **Death:** every unit respawns at its hive after a short delay (_tune_, start 3 s) with a brief invulnerability. A Warrior comes back as a plain Worker. A carried berry drops where its carrier died and becomes a loose, kickable object. Only the Queen has limited lives: three eggs, the third death loses the game.
- **Berries:** a finite supply in piles on the map (_tune_, start about 36). A berry is either banked in a hive hole (permanent) or spent at a gate. If the map runs dry, berries regrow after 90 s.
- **Hive:** _tune_, start 6 holes per team. A hole is filled by walking a berry into it or by kicking a loose berry into it.
- **Gates:** warrior gates and speed gates (start 3 and 2, as in the original). A Worker holding a berry stands in a gate for a moment (start 2.5 s) and comes out upgraded and briefly invulnerable. A gate is neutral until a Queen touches it; then only her team may use it until the other Queen touches it.
- **Snail:** one neutral snail on a track. A Worker who mounts it moves it toward that Worker's own goal at 5.6 px/s (1.35 times with a speed rider); it never banks progress. An enemy Worker in front of its mouth is eaten, which halts the snail for 3.67 s. Killing the rider frees a Worker being eaten. Start with a track that takes about 35 s from the centre unopposed (_tune_).
- **Maps:** one screen, 480 by 270 art pixels, with screen wrap. Three maps, each tilting toward one win: hives top-centre with the snail along the bottom (balanced), a short snail track (snail), a central exposed hive and a snail tunnel (military).

## Balance targets (from 6,259 logged games of the original)

| Measure                    | Original                               | Our target with hard bots   |
| -------------------------- | -------------------------------------- | --------------------------- |
| Win mix                    | 62% military, 24% economy, 14% snail   | Each within 10 points       |
| Median game length         | 68 to 84 s (122 s in tournaments)      | 60 to 120 s                 |
| Side balance               | 50.1% for one side                     | 47 to 53%                   |
| Queen deaths per game      | 3.3 to 3.7                             | 3 to 4                      |

Hard bots should beat medium, and medium should beat easy, in at least 70% of games.

## Feel numbers (art pixels, 60 Hz simulation)

- Run speed 62.5 px/s (crosses the 480 px screen in 7.7 s); speed gate 1.35 times; a winged unit walking 0.84 times.
- No jump buffer; one step of coyote time.
- Gravity, flap impulse, dive speed and terminal velocity are not published. Tune them so sustained flight needs 7 to 15 presses a second and a full Worker jump clears one platform level.

## Tech

- `games/killer-fuse/src/engine/`: pure deterministic rules, integer subpixels, three 60 Hz steps per 50 ms log tick, seeded randomness in the round state, no imports from outside the folder.
- Bots run inside the fold on every peer and get no privileged physics.
- `src/online/`: the `RollbackGame` on `fuse-netcode`. Held directions are bits; button presses are edges stamped with their sub-step, so a tap lands on the right 60 Hz step.
- `src/render/`: Phaser 4, drawing supplied state only, with interpolation between ticks.
- `scripts/killer-fuse-sim.ts`: headless bot matches through the real fold, printing win mix, game length and side balance.
- Art: generated with OpenAI image models, prompts and a manifest kept beside the files in `public/killer-fuse/art/`.
- Target: 60 fps on a mid-range laptop and a recent phone.

## Out of scope for the first version

Extra weapons and berry throwing (Killer Queen Black), ranked play, more than three maps, voice chat.

## Steps and acceptance

1. **Engine and headless runner.** All rules above on map 1; unit tests; `killer-fuse-sim` plays 200 bot games with no crash and prints the statistics.
2. **Bots.** Three levels that use all three win conditions; the level ordering target holds.
3. **Online game and page.** Six seats, teams, bot level, keyboard, gamepad and touch; a room plays a full match; golden hash and checkpoint tests.
4. **Rendering and art.** Sprites, HUD with eggs, holes and snail position visible at a glance, effects and sound; screenshots from three moments of play.
5. **Maps 2 and 3 and sets.**
6. **Polish.** A critic compares captures with reference footage; balance targets met on every map.

Each step ends with `docs/PARITY.md` re-scored, a batch of headless games, and a browser playthrough.
