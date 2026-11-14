# Fuseball

Fuseball is a neon arena ball game for two to six riders, served at `/fuseball/`: a duel, 2v2 or 3v3 (see **Teams**). Knock the ball into the goal in **your own colour** to score and zap the other rider. The first to three points wins, and at 2–2 the last point is sudden death.

## How to play

- **Score in your own colour.** Cyan starts on the left and its goal is on the far right; magenta is the mirror image. The ball entering a goal scores for that goal's colour whoever sent it, so knocking it into the other colour's goal is an own goal.
- **Every point** starts with a 3-2-1 countdown with both riders on their marks, and ends with the loser of the point zapped from the goal.
- **Bubbles.** Every jump made in the air leaves a bubble where you were. It is a bumper: the ball is thrown away from its centre and the bubble pops. You have one bubble at a time. The other rider pops your bubble by touching it, and you pass through your own.
- **Hard bubbles.** Keep the button held after placing a bubble and it hardens: the ball and the other rider bounce off it and it stays. While you hold, you cannot jump again. A hard bubble that wedges the ball into a corner with no way out pops.
- **Nothing buries the ball.** Land or stand on the ball and it squirts out along the floor, away from you; squeeze it against a wall and it pops up.
- **Clouds.** While the ball is inside a cloud the whole arena goes into slow motion: it eases down to half speed at the cloud's rim and about a third at its centre, holds for a moment after the ball is out, then eases back. Only the ball counts; a rider or a bubble in a cloud slows nothing.
- **Goals.** A goal freezes everything for a little over a second, then the loser is zapped in slow motion before the next countdown.
- **Wrap.** Most arenas have no outer edge on at least one axis: what leaves one side comes back on the other, so a rider or the ball that drops through an open floor falls in again from the top. Bounce Rate and Port Forward are closed boxes. Riders fly through goals untouched; only the ball scores.
- **Gadgets.** The newer arenas each have one thing that acts on the ball and only the ball; riders fly through all of them. A **force field** over a goal throws the ball back and breaks after three strikes, until the next point. A **bumper** throws the ball away from its centre and never pops. A **portal** carries a ball flying into it to its twin, at half its speed. A **trapdoor** holds a ball rolled onto it, and opens for three seconds when the ball strikes it hard: drop the ball on it, or stand beside it and lift. **Goo** is thick: a ball in it loses most of its speed and sinks slowly. A **jet** pushes the ball up, so a slow ball is caught and rides on top of it while a fast one hops over. Quad Core, Bitstream and Memory Leak are drawn as outlines on black, after the arcade cabinet's own.
- **Ledges and movers.** These two act on riders as well. A **ledge** is a one-way platform: riders and the ball come up through it from below and land on it from above, a rider holding down drops through, and a hard stamp drives a ball lying on it through. A **mover** is a solid that travels along one axis and waits at each end; whatever stands or lies on it is carried. Movers go by the world's `clock`, which starts at zero with every point and stands still through the countdown and a goal's freeze, so they hold no state of their own and a checkpoint carries only the clock.

| Arena        | Wraps         | Goals                                                                                                                 |
| ------------ | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Gridlock     | sideways      | the gaps in the wall across the seam                                                                                  |
| Downlink     | top to bottom | the two shafts through the floor and the roof                                                                         |
| Halo         | both ways     | two round goals floating high on each side                                                                            |
| Overflow     | both ways     | the gaps in the seam wall; the floor has two holes that are nobody's goal, so what falls in comes back from the top   |
| Firewall     | both ways     | the gaps in the seam wall, each behind a short wall; there is no floor, so everything off a pad falls round and round |
| Corner Case  | top to bottom | the four corner pockets, floor and roof, each behind a kerb                                                           |
| Core Dump    | top to bottom | two pits side by side in the middle of the floor (and the roof above them), with a post between                       |
| Brute Force  | sideways      | the gaps in the seam wall, each behind a force field                                                                  |
| Bounce Rate  | not at all    | a slot in each side wall, each with a bumper in front of it and more bumpers across the middle                        |
| Port Forward | not at all    | a pit at each end of the floor under a low roof; a portal in each bottom corner comes out high on the far side        |
| Backdoor     | sideways      | a pit at each end of the floor, each shut by a trapdoor                                                               |
| Stack Trace  | nothing       | an alcove high in each side wall; a lift beside each waits level with its sill, and a stack of ledges up the middle   |
| Quad Core    | not at all    | a slot high in each side wall, over a notch and a shelf; four grass pads in two tiers                                 |
| Bitstream    | top to bottom | a slot in each side wall; two holes in the floor drop from the roof, and two jets stand under the middle pad          |
| Memory Leak  | top to bottom | a slot in each side wall; no floor in the middle, and a goo pit each side that leaks from the roof                    |
| Random       | seed decides  | mirrored side gaps, floor pits, corner pockets or floating rings                                                      |

## Controls

One stick and one button.

| Move                       | Keyboard                    | Touch             |
| -------------------------- | --------------------------- | ----------------- |
| Run, and steer in the air  | A / D or ← / →              | stick             |
| Jump (lifts a nearby ball) | Space, J or K               | JUMP              |
| Air-jump, leaving a bubble | the button again in the air | JUMP in the air   |
| Harden your bubble         | keep the button held        | keep JUMP held    |
| Quick drop (in the air)    | S or ↓ with the button      | stick down + JUMP |
| Power slide (on the floor) | S or ↓ with the button      | stick down + JUMP |

A slide is the fastest way along the floor; it ends in a small hop when its time runs out, the button comes up or the floor does.

## Ways to play

- **Solo**: `/fuseball/?solo=1` plays one match against the bot on the arena chosen on the landing page (`&map=` with `gridlock`, `downlink`, `halo`, `overflow`, `firewall`, `cornercase`, `coredump`, `bruteforce`, `bouncerate`, `portforward`, `backdoor`, `stacktrace`, `quadcore`, `bitstream` or `memoryleak` overrides it). No room service is involved.
- **Online room**: CREATE ROOM, share the code, link or QR, pick the arena in the lobby, add a bot if nobody joins, and START MATCH. The host starts rematches and returns the room to the lobby. A third visitor watches.
- **Shared TV**: the host ticks "Shared TV" in the room and presses OPEN TV SCREEN (or opens `?room=CODE&display=1`) on the big screen. It shows the arena only; each rider's phone becomes a controller with a stick and a JUMP button.
- `?mute` on any URL silences the page for that load without storing a choice.

## Teams

Pick **2 v 2** or **3 v 3** under MODE, on the landing page or in the lobby (the host). Teams play on their own, bigger arenas (960×540 against a duel's 640×360), each with walls and marks for three riders a side: **Mainframe** (a closed stadium with a goal in each end wall), **Backbone** (wraps sideways, a post in front of each goal), **Multiplex** (four levels, roofed pits) and **Uplink** (wraps top to bottom, two long shafts). They live in `src/engine/team-maps.ts` and pass the same `levelFaults` checks as every other arena. `/fuseball/?solo=1&map=mainframe&size=3&mute` plays a 3v3 with five bots.

- **Sides.** A room seats six. A seat's number is its side: even seats ride for cyan on the left, odd for magenta on the right. SWITCH SIDE in the lobby moves this device's seat to the other side's lowest free place (a `SIDE` log entry, lobby only).
- **Bots fill in.** START seats a bot in every empty place of the match, in a duel too, so one rider is enough. A team match is as big as the lobby asked for, or bigger when a fifth or sixth rider is seated. In a duel with more than two seated the two lowest seats play and the rest watch.
- **Scoring.** The rules are the duel's: the ball in a colour's goal is that side's point, first to three. Every rider of the other side is zapped. The rider who last sent the ball is credited with the goal, or with the own goal.
- **The bot.** With mates on its side, the bot furthest from the ball minds the goal the other side scores in and the rest go for the ball (`keeps` and `guard` in `src/engine/bot.ts`).
- **The camera.** A desktop or TV shows the whole arena. On a phone, where that would leave riders under 16 CSS pixels across, the view closes in on this device's rider and the ball and opens up as they part (`cameraFor` in `src/render/scene.ts`). The camera is presentation only.
- **The contract.** Settings are `{ display, mapId, seed, size }` with `size` 1 on duel and Random arenas and 2 or 3 on team arenas. A world holds two, four or six riders, the sides taking turns down the list; checkpoint version 5 carries the riders and bubbles as lists and a team arena as index 128 plus its place in `TEAM_MAP_IDS`. `RULES = "fuseball-9"`: old and new clients must reload to play together. A result reports each rider's place in the match as `slot`; the service checks that a side wins and scores as one (`validFuseballField`).

## Random arenas

Pick **Random**, type a **Seed** and APPLY, or RE-ROLL for another arena. The landing page previews that exact level; in a room only the host edits it, and everyone sees the seed. Share `/fuseball/?solo=1&map=random&seed=5&mute` to play the same layout against the bot. Seeds are decimal integers from 0 through 4294967295, including zero. `?map=random&seed=N` also preselects it on the landing page.

The integer PRNG in `src/engine/generate.ts` decides wrap independently per axis, the wall structure, zero to three pairs of ledges, a centre perch or pillar, one of four goal families, and clouds. Every layout is mirrored across the middle, with goals and spawns swapped. A seed's last rolls then give the level one kind of gadget where it fits, or none (about a third stay bare): force fields over side-wall goals, trapdoors over pits that have a bottom, one or two pairs of bumpers, a portal pair, its shelves turned into ledges, or a pair of movers (lifts or sideways shuttles). Each placement must pass `gadgetFaults` (even pixels, mirrored, clear of solids, goals, marks and each other, and a mover leaves a rider's room past each end of its travel), and a level whose gadgets make it fail the full check falls back to the same layout without them before the seed advances.

Candidates pass `levelFaults`, also tested against all handmade arenas: even-pixel solids and mirrored geometry, free supported spawns and ball anchor, goals on the far side with ball clearance, free-space reachability, rider-wide wrap openings and a ball-drop grid (20 × 30 pixel spacing, three horizontal launch speeds). The drop check uses the engine's ball flight for up to 4920 micro-steps and rejects rest positions without room for a rider beside or above the ball. A rejected candidate advances the seed by a fixed uint32 increment; after eight failures generation returns an independently tested original fallback. The requested seed stays the level's identity even after retries.

Room settings are exactly `{ display, mapId, seed, size }` (see **Teams** for `size`), with a uint32 seed for Random and zero for handmade maps. Match settings freeze the seed at start. The checkpoint stores Random as map index 255 and appends its seed; checkpoint recovery checks that the world agrees with the match settings. No geometry or generator state travels over the mesh: peers, late joiners and bots reconstruct the same arena under the current `RULES`. This changes the rules and checkpoint contract; mixed old/new clients must reload to play together.

`tests/generate.test.ts` sweeps 34 seeds including both uint32 extremes, exercises rejection and cache eviction, and checks bot scoring from both slots across all four goal families. Generated layouts also have replay goldens, codec and render tests, and a lossy-mesh/late-join regression in `tests/runtime.test.ts`.

Production serves Fuseball's rooms, like every game registered in `service/history.ts`.

## Run it locally

```sh
pnpm dev:online                       # builds, then serves every game and the room service
# http://localhost:8787/fuseball/?mute
```

To work on the page with hot reload, run the room service and Vite side by side:

```sh
pnpm exec tsx service/dev.ts --port 8787 --allow-origin http://localhost:5173
VITE_API_ORIGIN=http://localhost:8787 pnpm exec vite --port 5173
# http://localhost:5173/fuseball/?mute
```

Both pick the next free port when theirs is taken and print the one they got; pass the printed ports to each other.

## Layout

| Path              | What it is                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/`     | The rules: integer physics at 120 micro-steps a second, the maps as data, the checkpoint codec, the view and the bot (`bot.ts`). It imports nothing from outside the folder                            |
| `src/online/`     | Fuseball behind `fuse-netcode`'s `RollbackGame` (`game.ts`: seats, map and seed settings, the fold, the checkpoint), the runtime with this device's held controls (`runtime.ts`), and the match result |
| `src/render/`     | The Canvas 2D scene: arena, riders, bubbles, ball, effects and the HUD, plus the wrap-aware blend between two views. It reads only the engine's view (`view.ts`, `view-kit.ts`)                        |
| `src/app/`        | The page: `main.ts` (composition root), `presenter.ts` (what the page shows, pure), `controls.ts` (keyboard, touch stick and button), `audio.ts` (synthesized sounds), sessions and result reports     |
| `src/basics.ts`   | Constants and id rules with no imports, for the service                                                                                                                                                |
| `src/platform.ts` | The `GameRegistration` for `fuse-platform`, exported as `fuseball/platform`                                                                                                                            |
| `tests/`          | Engine, bubble, match, map, codec, golden, bot, room, runtime, render, app and controls tests; run one with `pnpm exec tsx --test games/fuseball/tests/engine.test.ts`                                 |

## How it fits together

- **One log, every device simulates.** A device logs only the bits it holds (`runtime.input`), each 50 ms log tick folds every rider's bits and runs the micro-steps the arena's speed allows (six at full speed, fewer in slow motion: the speed and the leftover fraction of a step are checkpointed world state, set once per tick by `paceTick`), and rollback re-folds when a late input arrives. The room service coordinates the room; it does not simulate or relay play.
- **Determinism.** The engine uses integers only: no floats, clocks, `Math.random` or trigonometry. A change to what it does must bump `RULES` in `src/engine/index.ts` and re-record the golden in the same commit (`GOLDEN_RECORD=1 pnpm exec tsx --test games/fuseball/tests/golden.test.ts` rewrites `tests/fixtures/golden.json`).
- **The bot** (`src/engine/bot.ts`) reads the world and answers with ordinary held bits once per log tick, so it has no physics a player lacks. It is part of the rules, since every device folds bot seats with it.
- **Drawing.** The page's one `requestAnimationFrame` loop blends the runtime's two newest views and hands the result to `scene.draw`. Nothing in the app or the renderer simulates; effects and sounds come from counters changing between views.
- **Results.** In an online room every rider still seated at the end reports the match once the deciding tick is confirmed (`app/reports.ts`); solo reports nothing.
- **Analytics.** `fuse.App Opened`, `Seat Taken`, `Match Started` and `Match Ended` come from `fuse-ui/play-metrics`, and `fuse.Goal Scored` (`mapId`, `ownGoal`, `suddenDeath`, `mine`) from `createGoalWatch` in `app/presenter.ts`: once per point, after it can no longer be rolled back, from the device whose rider won it (or lost it to a bot). No names, room codes or invite links are sent. See `docs/ANALYTICS.md`.
