# Fuse Freight · collect, steal, deliver

Little trains for one to five friends: Snake with cargo and theft. Every train drives itself round a compact depot
floor; you only steer **left or right**. Drive over loose carts to couple them on at the back, cut across a rival's
tail to break its wagons loose, and pull into one of the two **DELIVER** docks to bank every wagon you pull, one point
each. The round lasts 75 seconds; the most wagons delivered wins it (equal scores share the win), and round wins take
the match. Online rooms, solo against AI drivers, and a shared TV with phones as controllers, on the same netcode as
every Fuse game.

Open it at `/fuse-freight/` on a running service (see below), or from the **FUSE FREIGHT — COLLECT, STEAL, DELIVER**
link on the Fuse Riders landing page.

## Controls

| Keys / touch             | Does                                            |
| ------------------------ | ----------------------------------------------- |
| A / ←                    | Steer left (relative to where the train faces)  |
| D / →                    | Steer right                                     |
| Both, or neither         | Straight on: the train never stops              |
| ◀ ▶ buttons (touch)      | The same, held (a phone held sideways)          |
| ◀ LEFT / RIGHT ▶ (phone) | A phone in a shared-screen room is a controller |

There is no action button and nothing to aim. `?mute` silences the page for that load only, without touching the
stored sound choice; `?autopilot` drives this device's train with the AI through the ordinary controls (demos and
smokes). Both carry over from the landing page to the room it opens.

## Rules at a glance

The source is the rulebook (`src/engine/step.ts` holds the order of a step, `src/engine/tuning.ts` the numbers); this
is the shape of it.

- **Driving.** Trains move at a fixed speed, a little slower for every wagon they pull, and turn at a fixed rate while a
  steer is held. Walls mirror a train's heading like a ball off a cushion; two locomotives that touch bounce apart the
  same way. Nobody is ever eliminated.
- **Wagons follow the path.** A locomotive lays a trail as it drives and every wagon sits a fixed distance back along
  it, so wagons go exactly where the locomotive went, through every turn. Nothing about a wagon is stored but its
  cargo.
- **Collecting.** A locomotive's nose over a loose cart couples it at the back, up to **8 wagons**; a full train drives
  over carts. When two noses reach one cart on the same step, the nearer takes it, the lower seat on an exact tie.
- **Stealing.** A nose on a rival's wagon cuts that wagon and everything behind it loose. The rival's front section
  drives on. The cut wagons become neutral carts that scatter a little and **cool for 0.7 s**, during which nobody can
  couple them, so the thief cannot simply take them straight back up. The cut train is **guarded for 0.6 s**, so one
  pass takes one bite. A locomotive never cuts its own wagons.
- **Simultaneous contacts.** Every contact is found against the same positions before anything changes: several noses
  on one tail cut at the wagon nearest its locomotive (credited to the lower seat on a tie), and two trains that cut
  each other on the same step both lose their tails, whatever order they are listed in.
- **Delivering.** A locomotive inside a dock banks every wagon it pulls at once and drives on empty. Cuts come before
  collection, and collection before delivery, in every step, so a wagon is only ever in one train, one cart or one
  score: nothing is counted twice.
- **Cargo** arrives from the round's seed, never in a dock or under a train, topped up to 4 + 2 per train, at most 40
  loose. Every train starts on an ellipse round the middle of the floor, all heading the same way round it, with a cart
  the same distance ahead; the ellipse turns with the seed so no seat keeps the spot by a dock.
- **The match.** First to the room's round wins (1, 2 or 3; default 2) with 60, 75 or 90 second rounds (default 75).
  Level on round wins at the end, the most wagons delivered over the match decides; level on those too, the win is
  shared. Wagons still pulled at the whistle score nothing. Three rounds in a row with no delivery at all end the
  match with no winner, so a room of absent drivers does not run on. The host's LOBBY button mid-match asks for a
  second tap, since it ends the match for everyone; on a shared screen the host's phone gets REMATCH and LOBBY.

## Design notes

- **Engine** (`src/engine/`): deterministic integer simulation, 256 sub-units a pixel, 1024 headings a turn, 60 steps
  a second, three steps per 50 ms log tick. Headings come from a sine table built once from a Taylor series in plain
  arithmetic; there is no `Math.random`, library trigonometry, `**` or clock (the architecture test runs the repo's
  determinism guard over it). Only moving and collectable things are world state; the depot is fixed. `RULES` in
  `src/engine/index.ts` names the rules; `tests/golden.test.ts` replays a recorded five-bot round, so a behaviour
  change must bump `RULES` and re-record it (`GOLDEN_RECORD=1`).
- **Bots** (`src/engine/bot.ts`) read the world as a player could and answer with ordinary left/right bits once per log
  tick: the cheapest cart by distance and turn, a rival's tail worth cutting, or the nearest dock when full, greedy
  enough, chased or short of time. A temperament from the seed makes some greedier and some bolder thieves.
- **Netcode** (`src/online/`): the game behind fuse-netcode's `RollbackGame`. A seat's log entry is its held steering
  bits for a match and round; a tap shorter than a tick still steers the tick's first step. The room keeps round wins
  and results; seats, bots, settings and start/rematch/lobby are the shared management entries. The checkpoint
  validates every field, and that the parts agree (wins are the results' winners counted, places follow from the
  scores, the round keeps its match's length), before a world is installed.
- **Rendering** (`src/render/`): Canvas 2D at a 960×540 logical size, interpolated between log ticks. Locomotives,
  wagons, carts and the depot backdrop are painted once in code; steam, sparks, pop-ups and the wagons that fly into
  a dock are cosmetic and keyed by what happened (kind, seat, moment and place), so a rollback that renumbers effects
  does not replay them. The renderer imports only the engine's `view.ts` and `view-kit.ts`. `illustrations.ts` draws
  the lobby's loading bays and the four how-to-play panels from the same sprites.
- **App** (`src/app/`): the splash runs a live five-bot round behind the menu on the real rules; landing, lobby,
  invite and roster come from fuse-ui. `presenter.ts` decides what shows and is unit-tested; `main.ts` is the glue.
- **Sound** (`src/app/audio.ts`): every effect and the chiptune soundtrack (a chugging rhythm, oom-pah bass and a
  tune that speeds up for the last ten seconds) are synthesised with Web Audio: no audio files, nothing to license.
  Music and effects follow the mute and volume every Fuse page shares (`fuse-riders-audio` in `localStorage`, with
  music off on a phone's first visit as in Fuse Riders), and the MUSIC / FX toggles write that shared choice. Sound
  starts on the first gesture a browser accepts (a touch's end, a click or a key: iOS does not count a touch's start);
  the shared TV screen shows a TAP FOR SOUND button until then. `?mute` never opens an audio context.
- **Look.** The four concept sketches (splash and lobby, arena, late-round action, illustrated rules) set the
  direction: a night-time loading depot, brass and rivets, numbered loading bays, two side docks, framed clock and
  seat cards. Two deliberate differences: seats keep the portfolio's colours (cyan, magenta, lime, orange, violet)
  rather than the sketches' red/yellow/purple/green, so a player is the same colour in every Fuse game and no train
  is the colour of the golden cargo; and the text is English like the rest of the portfolio.
- `src/platform.ts` registers the game with the room service for admission only; it reports no results yet.

## Run, test, preview

```bash
pnpm build
pnpm exec tsx service/dev.ts --port 8787
```

Open `http://localhost:8787/fuse-freight/?mute` (solo: `?solo=1&mute`).

```bash
pnpm exec tsx --test games/fuse-freight/tests/*.test.ts
node games/fuse-freight/preview/smoke.mjs http://localhost:8787/ path/to/screenshots
pnpm exec tsx games/fuse-freight/preview/balance.ts 1 2 3
```

The smoke is run by hand; it is not in CI. It covers the splash, a solo round that banks cargo, a two-browser room
(settings, a guest reloading mid-round, both pages agreeing on the round, the result, REMATCH and LOBBY), a shared TV
with a phone controller, a phone driving solo with touch buttons, and a room that does not exist. It needs Chrome for
Playwright and writes screenshots only where told. `balance.ts` plays whole bot rounds for tuning and prints each
train's banked score, collections, deliveries and wagons stolen and lost.

## Not yet

Match history, ratings and leaderboards (the registration is admission-only), local multiplayer on one keyboard, a
second arena, authored art assets (every sprite is painted in code), and balance from real playtests: tune it in
`src/engine/tuning.ts`. With five bots a 75-second round sees about 75 cuts and 30 deliveries (`balance.ts`), most of
the cuts from trains crossing tails on a crowded floor; humans will play it differently.
