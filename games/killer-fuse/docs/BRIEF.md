# Killer Fuse: brief

Killer Fuse is a 3v3 side-view team arena for up to six players, with bots in every empty seat. It uses one compact rule set throughout: left, right, down, a jump / flap button and an attack button, sword combat, gates, a snail to ride and berries to bank. Three ways to win draw on the same few bodies and the same finite berries. It looks like chunky pixel insects in Fuse Riders' neon-on-navy palette. The name, sprites, sounds and maps are our own. Engine rules version: `killer-fuse-6` (from `killer-fuse-5` it changed four edge rules: same-step victories of any kinds go to the step's coin, a snail win needs the rider still on it after combat, the snail cannot catch an invulnerable Worker, and kills land in the step's turn order). The rules as built are in [engine.md](engine.md), the bots in [bots.md](bots.md), the measured results in [balance.md](balance.md).

## Loop

- **30 seconds:** grab a berry; bank it in the hive or spend it at a gate; fight with the sword; watch the snail.
- **One game (about 1 to 2 minutes):** a team wins by military (kill the enemy Queen three times), economy (fill all 12 holes of its hive) or snail (ride the snail into its own goal).
- **One set:** first to N game wins (the host picks 1 to 3, default 2), on one map or rotating through all three.

## Teams and units

Two teams, Cyan and Pink (`team = slot % 2`). Slots 0 and 1 are the Queens, slots 2 to 5 the Workers. A seat without a person is played by a bot at the room's level: easy, medium or hard.

| Unit          | Can                                                                                   | Cannot                       |
| ------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| Worker        | Run, jump (height follows hold time), carry one berry, bank it, use gates, ride snail | Attack                       |
| Speed Worker  | The same at 1.3 times run and snail speed                                             | Attack                       |
| Warrior       | Fly by pressing (each press is a flap), sword dash, kick loose berries                | Carry, use gates, ride snail |
| Speed Warrior | Warrior at 1.3 times flight speed, 1.15 times climb (speed gate, then warrior gate)   | The same                     |
| Queen         | Fly, sword dash, dive (Down), claim gates by touch; three lives                       | Carry, use gates, ride snail |

## Controls

Left, right, down, one jump / flap button and one attack button. Up is bound to nothing. Down in the air is the Queen's dive: it starts on the press, so Down already held when she leaves a ledge or ends a dash starts none until it is pressed again. Jump and flap act on the press; holding does nothing, except that a Worker's jump goes higher while held. A device option, "Hold to flap", repeats the press 7.5 times a second while the button is held; it is off by default. Keyboard (arrows or A/D to move, Down or S held to dive, Space to jump and flap, X or Z to attack — Shift and J attack too), gamepad and touch.

## Rules in short

- **Combat:** a sword dash kills an enemy in front of it during its lethal window (Warrior steps 1 to 19, every 44 steps; Queen 1 to 17, every 36). Two lethal swords that meet face to face glance: nobody dies. Landing on a head bounces off; other body contact is a bump that stuns both.
- **Flight:** each press is 0.3 s of upward push; about 2.8 presses a second hold height (the page rounds that to 3; presses 22 steps apart just hold, 21 apart climb), and the climb is capped at 10 u/s (1 u = 11 art pixels).
- **Death:** respawn after 3.2 s, invulnerable for 2.2 s. A Warrior comes back a plain Worker. A Queen hatches from a spare egg; her third death loses the game.
- **Berries:** piles of 6, no regrowth. Banking takes 1.5 s in the hole. A loose berry can be kicked, and one that reaches an open hole of either hive fills it for that hive, whoever sent it; only a berry in the sender's own hive counts in the sender's statistics.
- **Gates:** a Worker with a berry stands still for a 0.5 s offer, then is locked in for 2.0 s and steps out transformed, invulnerable for 2.2 s. A Queen claims a gate by touch.
- **Snail:** moves at 0.8 u/s only while the rider holds toward its goal. A meal takes 5 s (3.5 s with a speed rider); killing the rider frees the victim. An invulnerable Worker cannot be caught. The snail wins only with its rider still on it after that step's combat: a rider killed as it arrives has not brought it home.
- **Ties:** victories reached on the same step, of whatever kinds, go to the step's coin flip from the seed (the same coin that settles a contested pickup, mount or gate); one team's own victories rank military, economy, snail. Two killers of one victim on one step credit the one the step serves first.

## Deliberate differences

- 3v3 on six seats, not 4v4 on eight.
- Three bot levels (easy, medium, hard) fill every empty seat. Medium and hard bot Queens attack an enemy Queen that cannot answer and press harder once the enemy hive holds 8 berries; their flyers hunt a snail rider ahead of everything, and berry carriers first from 4 filled enemy holes. Hard bots beat a Queen whose player holds nothing in 93 to 96% of games.
- Three maps (Day, Dusk, Night) on a 480 by 270 screen, with our own layouts.
- A 300 s safety clock: an undecided game goes to the team with more Queen eggs, then more berries banked, then the snail nearer its goal, then a coin flip from the seed.
- The sword is the only weapon.
- A set is first to N game wins, N from 1 to 3.

Out of scope: other weapons, the shield, berry throwing, upgrade choices, other maps, 4v4, ranked play, voice chat.

## Balance targets

| Measure               | Reference figure                     | Source of the reference   | Our target, hard bots on map 1                        |
| --------------------- | ------------------------------------ | ------------------------- | ----------------------------------------------------- |
| Win mix               | 62% military, 24% economy, 14% snail | 6,259 logged arcade games | Each within 10 points                                 |
| Median game length    | 68 to 84 s (122 s in tournaments)    | The same logs             | 68 to 84 s                                            |
| Side balance          | 50.1% for one side                   | The same logs             | 47 to 53%                                             |
| Queen deaths per game | 3.3 to 3.7                           | The same logs             | 3 to 4                                                |
| Level ordering        | None                                 | Ours                      | Hard beats medium, medium beats easy, in at least 70% |

No reference figure is taken from another game's play. At rules `killer-fuse-5` map 1 met every target at 300 games, but over 10,000 games its military share was 73.5%, 1.5 points above the band; maps 2 and 3 stay economy-heavy. The `killer-fuse-6` edge rules did not move the 300-game figures beyond their noise. See [balance.md](balance.md).

## Tech

- `src/engine/`: pure deterministic rules, integer subpixels, 60 steps a second, seeded randomness in the state, no imports from outside the folder. Bots run inside it.
- `src/online/`: the rollback game on `fuse-netcode`, three engine steps per 50 ms log tick; presses are edges stamped with their step.
- `src/render/`: Canvas 2D, drawing supplied views only, with interpolation between ticks. Sound is synthesised with WebAudio.
- `src/app/`: the page, controls, countdown card, tips, tutorial and highlight.
- `scripts/killer-fuse-sim.ts`: headless bot games through the real engine, with win mix, length and side balance.

## Steps and acceptance

1. **Engine and headless runner.** Done: all rules on all three maps, unit tests, 300-game runs with a determinism check.
2. **Bots.** Done: three levels that use all three win conditions; the level ordering holds on every map (hard over medium 86 to 90%, medium over easy 73 to 93%).
3. **Online game and page.** Done: six seats, bot level, keyboard, gamepad and touch, sets, golden hash and checkpoint tests. No physical gamepad or phone has been tried.
4. **Rendering and art.** Done: sprites, HUD, effects and sound.
5. **Maps 2 and 3, and sets.** Done.
6. **Polish.** Open: map 1's military share is slightly high, maps 2 and 3 miss the win mix (see [balance.md](balance.md)), and nobody has played it yet.

Each step ends with [PARITY.md](PARITY.md) re-scored and a batch of headless games. A playthrough by a person is still to come.
