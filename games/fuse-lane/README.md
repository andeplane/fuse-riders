# Fusetown

_Game id and routes: `fuse-lane`._

You live a week against the clock in Fusetown, a little harbour town with 14 places. You work, study, shop and invest in a town whose economy reacts to what you do. The first player to reach all four goals (wealth, happiness, education and career) in the same week wins; when several get there the same Monday, the one furthest past the goals wins (then the richest). The game is played on **one device**:

- **Solo against 1–3 AI opponents.** Their level is easy, normal or hard.
- **Pass and play.** 1–4 people share the phone, with or without AI.

Online rooms still work through a link (`?room=CODE`), but the menu does not offer them for now.

## The town

Fusetown's streets wind round a town square with a clock tower, past a canal with a footbridge, down to the bay. The places, with where they stand:

- **Roomshare** (where everyone starts and lives at first), **KeyNest** (rent and moving) and **The Tower** along the main road north of the square;
- **FreshCo**, **Neobank**, **Gadget Garage** and **Threads** on the shopping street to the west;
- **Second Life**, **MegaMart** and **Mono Burger** round the market corner in the north-east;
- **Gigafactory** and the **Job Hub** round the square's east side, **City College** above the quay;
- **Fusetown Docks** on the waterfront: the workplace of Fusetown Port, a listed company like the other eight. Its four jobs (Deckhand, Forklift Driver, Crane Operator, Harbour Master) can be applied for at the docks or at the Job Hub, and the Gigafactory also hires at its gate.

## The screen

The town is the picture: the city's map fills the screen, and the game is drawn over it: every player walking the streets (or waiting in front of the place they are in), a glow on the place you are in, walking to or pointing at, and the places' name labels (tap a label or a building to walk there; hovering shows how many hours the walk and the door cost). A slim glass HUD sits on the edges and shows only the hours left with the real seconds left, cash and bank, the four goals, **CALL IT A WEEK**, pause and menu. Everything else opens in the middle of the screen: a place's panel when you walk in (its shopkeeper and its building sticker in the head), the **you** panel (tap the clock: food, clothes, rent, job and this week's private news), the Monday briefing, the **Pass the device** card and the result.

- **Phone (portrait):** the map is as tall as the screen and pans sideways. The camera follows you while you walk; drag to look around (a new walk picks you up again). The clock, money and buttons sit at the top, the goals and CALL IT A WEEK at the bottom. The rivals are on the streets but not on the HUD: their standings (portrait, four goal bars, what they are doing) head every place panel.
- **Wide screen:** the map covers the screen, centred, with one HUD bar along the top and the rivals in the corners (they step aside while a panel is open). A short screen (a phone on its side) pans up and down and shows the rivals in the panels instead.

The town is alive while you play (`src/app/ambience.ts`, looks only): the sun glints on the bay, cloud shadows drift over the roofs, and the light turns golden and then dusky over the last 40 % of your hours. While you walk, a dotted line in your colour shows the rest of the way to the door, and a ring bursts when anyone walks into a place. The cash counts to its new value with a "+$40" rising out of it, a goal ring bumps with "+2" when it grows, and the toast drops in just above the tip. With reduced motion the clouds, glints, pops and bumps stay still.

![The way to the Job Hub](docs/screenshots/phone-route.png) ![Cash counting up after a gig](docs/screenshots/phone-cash-pop.png) ![The evening light at the end of a week](docs/screenshots/desktop-evening.png)

The map never shows an empty edge. `?debug-roads` draws the street graph, the doors and the tap outlines over it.

Cities are data: `src/game/data/cities/fusetown.ts` holds the map's size, the street graph traced over the picture (nodes and bending edges in map pixels), each place's door, tap outline and label, and the parts of the picture that stand in front of the streets. `src/game/streets.ts` cuts the graph into unit steps for the rules, and `src/app/layout.ts` (pure and unit-tested) does the camera, the hit tests and where each player stands. The other city concepts wait in [docs/cities/](docs/cities/) as future city types.

![Menu on a phone](docs/screenshots/phone-menu.png) ![A week on a phone](docs/screenshots/phone-week.png) ![Walking on a phone, the camera following](docs/screenshots/phone-walking.png) ![The docks on a phone, rivals on top](docs/screenshots/phone-docks.png) ![The you panel](docs/screenshots/phone-you.png) ![The Monday briefing](docs/screenshots/phone-briefing.png) ![The handoff between players](docs/screenshots/phone-handoff.png)

![A week on a desktop](docs/screenshots/desktop-week.png)

![The docks on a desktop](docs/screenshots/desktop-docks.png)

![The street graph, doors and tap outlines over the map (?debug-roads)](docs/screenshots/desktop-debug.png)

![A phone on its side](docs/screenshots/landscape-week.png) ![The docks on a phone on its side](docs/screenshots/landscape-docks.png)

![The menu on a desktop](docs/screenshots/desktop-menu.png) ![The Monday briefing on a desktop](docs/screenshots/desktop-briefing.png) ![The handoff on a desktop](docs/screenshots/desktop-handoff.png)

**A static preview:** `pnpm exec vite build --base ./ --outDir /tmp/fuse-preview`, then serve that folder from any path (for example `cd /tmp && python3 -m http.server 8000` and open `http://localhost:8000/fuse-preview/fuse-lane/?mute`). Art and links resolve from where the built script sits, so a relative base works.

## How to play

1. **Menu.** Add the people who will play on this device. Tap a face to change character. Then choose:
   - how many AI opponents, and their level;
   - the goals: Quick 30, Standard 50 or Long 80;
   - the turn length: 45, 60 or 90 real seconds.

   The device remembers your choices. A game in progress is saved on the device, and the menu offers **Continue** next time.

2. **A week** has 60 hours. Tap a building on the board to walk there (keyboards can Tab to a hidden list of the places). You walk the streets the shortest way; it costs 1 hour per 15 steps (the longest walk across town is 86 steps, under 6 hours), and entering a place costs 2 hours. Inside, the place's cards are what you can do there:
   - work a shift: 6 hours, paid as 8;
   - apply for a job: 4 hours;
   - attend a class: 6 hours;
   - relax at home: 6 hours;
   - buy food, clothes and goods;
   - pay rent;
   - save, or trade shares, bonds, gold and crypto: 1 hour per order. A big order moves the price as it fills, so it pays the average of the price before and after it, plus the spread.

   Each card shows its price, its hours and why it is greyed out. **Call it a week** when you are done. Hours you don't use become sleep, which adds to your rest. The real-time clock ends your turn if you forget.

3. **Taking turns.** Everyone plays the same week, one after another:
   - The first player changes every week. The match decides who opens week 1.
   - AI players play their whole week at once when their turn comes.
   - Between people, a full-screen **Pass the device to …** card hides the last player's week. The next player's clock starts only when they tap.
   - Jobs, shelves and market prices are shared. Whoever plays earlier in the week gets first pick: if they take a job, it is gone for everyone after them.
4. **Monday briefing.** You see the economy ticker, the City500 chart and the week's headlines. On a shared device, each player's private news (sleep, hunger, rent, break-ins) opens in their **you** panel on their own next turn. Tap **Start the week**, or the next week starts by itself after 8 s.
5. **Pause** stops the clock. Locking the phone pauses the game too. **Menu** saves the game and quits.
6. **The tour.** The first game on a device opens with a short tour, with the clock stopped, once the first week is on screen. Its cards point at the clock, the goals, the checklist and the tip, and the camera glides to the Job Hub, the Gigafactory, City College, FreshCo, Roomshare and KeyNest, then Neobank and Gadget Garage, saying what each is for (jobs, clothes, study, food, rent, rest and sleep, money). **Skip** ends it. **How to play** on the paused card shows it again.
7. **Tips.** Whenever no place's panel is open, the most pressing next step floats at the bottom of the board (get a job, pay the rent, eat, dress for work, work a shift, apply for a better job, rest, study, treat yourself, save); a tap walks you there. Tap the clock for the first three.
8. **Getting started.** A checklist of first steps sits in a corner of the board: find a job, work a shift, buy food for the week, enroll in a course, go to a class, rest at home, save money at Neobank, buy something nice. Each ticks itself off the first time you do it and stays ticked. A tap on a step walks you there, a tap on the title folds it (it starts folded on a phone held upright), and once all eight are done it says **All set!**. The **×** hides it at any time, and **Show the checklist** in your panel (tap the clock) brings it back. It is kept on the device, per match and player.

Weekly upkeep (food, clothes wearing out, rent every 4 weeks, garnishment) and the economy follow the design docs:

- a business cycle;
- a central-bank rate;
- category prices that react to what players spend;
- nine listed companies (Fusetown Port among them) whose health sets wages, hiring freezes and layoffs;
- share prices from earnings;
- spreads and market impact;
- dividends every 12 weeks.

Every coefficient lives in `src/game/data/economy.ts`.

## Layout

| Path                                                            | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/game/`                                                     | The rules: pure, deterministic and DOM-free. `foldTick` folds one 50 ms tick, with the seeded RNG kept in the room. It has two week modes: hot-seat turns (`settings.turns`) and simultaneous play for online rooms.                                                                                                                                                                                                                                                                                        |
| `src/game/data/`                                                | The 14 places, the 41 jobs and 11 courses, the 30 items, and the economy table. These are our reskinned names and our own lines. `data/cities/` holds the cities as data (only Fusetown for now).                                                                                                                                                                                                                                                                                                           |
| `src/game/streets.ts`                                           | The city's street graph cut into unit steps: a player's position is a step, and every step knows the distance and the next step to each place's door (built once, deterministically, scaled so the longest trip between two places is about 85 steps).                                                                                                                                                                                                                                                      |
| `src/game/economy.ts`, `week.ts`, `actions.ts`, `bot.ts`        | The economy step, the end of a week, what each action does, and the bot with its three levels.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/game/checkpoint.ts`                                        | Encode and fully validate a room. Saves and netcode snapshots both use it.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/app/local.ts`, `local-runtime.ts`                          | A match on one device. It runs the same fold with one stream per person, in real time, with pause and save/resume.                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/app/presenter.ts`                                          | A pure view model built from a frame: HUD, panels as cards, scores, briefing, handoff, result.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/app/tour.ts`                                               | The first-play tour: its cards, what each points at (a HUD piece or places on the map, framed with their labels) and whether this device still owes it. The screen draws it.                                                                                                                                                                                                                                                                                                                                |
| `src/app/tips.ts`                                               | Tips: what to do next, read from your situation in the bots' order of priorities, each with the place it sends you to.                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/app/checklist.ts`                                          | The Getting started checklist: its steps, when the player's state shows each done, where each is done, and its save on the device.                                                                                                                                                                                                                                                                                                                                                                          |
| `src/app/layout.ts`                                             | The board's geometry, pure and tested: how the map covers the screen and how far the camera pans, where panels open, what a tap hits, and where each player walks or stands, for any screen shape.                                                                                                                                                                                                                                                                                                          |
| `src/app/screen.ts`, `board.ts`, `art.ts`, `menu.ts`, `main.ts` | The page: a full-screen Canvas 2D board (the map scaled once per layout into an offscreen canvas; walkers, glows and labels drawn each animation frame between the two newest frames, with drag to pan and a camera that follows you), the glass HUD, the panels in the middle, the menu and routing.                                                                                                                                                                                                       |
| `src/app/runtime.ts`, `reports.ts`, `session.ts`                | The online room on fuse-netcode, kept working but not in the menu.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `art/assets.ts` → `art/manifest.json`, `art/prompts.md`         | Every raster image the game draws (PNG stickers, and the city map as a JPEG), each with its path under `public/fuse-lane/`, size, anchor, transparency and a generation prompt. Regenerate the two files with `pnpm exec tsx scripts/fuse-lane-art.ts`; `--check` fails when they are stale. Any missing PNG is drawn as a coloured placeholder with a label, so the game is fully playable before the art exists. All 94 images are generated from these prompts and checked in under `public/fuse-lane/`. |
| `tests/`                                                        | Rules, the streets (connected, every door reachable, next steps, trip lengths), economy determinism, checkpoint round trips, rollback over lossy links, hot-seat turns and saves, the board geometry, the presenter and the menu.                                                                                                                                                                                                                                                                           |
| `scripts/fuse-lane-sim.ts` (repo root)                          | A headless balance simulation: `pnpm exec tsx scripts/fuse-lane-sim.ts [games] [players] [goal] [turns\|together] [level]`.                                                                                                                                                                                                                                                                                                                                                                                 |

With four hard bots and goals of 50, a game takes 24–31 weeks (median 26) in both week modes. Two normal bots take about 31 weeks; two easy bots take 41–56 weeks (median 42) with goals of 30.

## Design

The design lives in [andeplane/modern-jones](https://github.com/andeplane/modern-jones/tree/claude/jones-analysis-uhxfts) on branch `claude/jones-analysis-uhxfts`:

- [docs/design/modern-game.md](https://github.com/andeplane/modern-jones/blob/claude/jones-analysis-uhxfts/docs/design/modern-game.md): the game, its places and its milestones.
- [docs/design/economy-sim.md](https://github.com/andeplane/modern-jones/blob/claude/jones-analysis-uhxfts/docs/design/economy-sim.md): the economy model.
- [docs/design/original/](https://github.com/andeplane/modern-jones/tree/claude/jones-analysis-uhxfts/docs/design/original): notes on the original game's numbers. They supplied the hours, wages, prices and requirements; none of the original's text is used.
