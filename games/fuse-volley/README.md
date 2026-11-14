# Fuse Volley

Fuse Volley is jelly-blob beach volleyball for two, four or six, served at `/fuse-volley/` (locally
**http://localhost:8787/fuse-volley/?mute**). Two blobs, one ball, one net: bounce the ball over to the other side
and keep it off your own sand. Play a friend online, on one TV with phones as the controllers, or a bot.

## How to play

- **The ball must not touch your sand.** Any part of the ball on the sand of your half loses the rally.
- **Three touches at most.** A fourth touch before the ball crosses the net is a fault, and so is carrying the ball
  on your head for more than about a second. The count clears once the ball is over on the other side; the dots under each
  score show how many you have used.
- **Hold jump to jump higher.** A tap is a hop; held, the blob rises about twice as high.
- **Serving.** The server's ball hovers over its half until a blob touches it, or drops by itself after five seconds.
- **The net** is a post with a round top: the ball bounces off it, and a blob cannot cross it.

## Doubles (2 V 2)

Pick **2 V 2** under PLAYERS in the lobby (or on the landing page for solo): two blobs a side on a court 1.75 times
as wide. Seats alternate sides, so seats 1 and 3 play cyan and 2 and 4 pink; START fills empty seats with bots. The
three touches are the side's, however the two teammates split them. Teammates are solid to each other: running into
one shoves it, two pushing stand still, and you get past by jumping over its head (land on the head and you pop off).
A flat hit from the back line only just carries over the net, so the back blob usually passes to the front.

## Three a side (3 V 3)

Pick **3 V 3** under PLAYERS: three blobs a side on one big 2000 px court, the singles net and heights, no lanes.
Seats 1, 3 and 5 play cyan, 2, 4 and 6 pink, and START fills empty seats with bots. It plays like doubles scaled up:
every blob may run its whole half, the three are solid to each other as doubles teammates are, and the side shares
its three touches. Bots take a ball by whoever is nearest; the other two step to the free front, middle or back spot.

## Three teams of two (2 V 2 V 2)

Pick **2 V 2 V 2**: king of the court on the doubles court. Seats 1 and 4 play cyan, 2 and 5 pink, 3 and 6 lime. Two
teams play each rally while the third waits on the NEXT UP bench at the top. The side that wins the rally stays on;
the side that loses walks off when the next serve starts, and the waiting team comes on in its place and serves. A team
keeps its colour on either side.

| Choice      | Rule                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **QUICK**   | Every rally scores a point for the team that wins it. First to 11.                                                       |
| **CLASSIC** | Only the receiving (king) side scores. A serving team that wins the rally takes the king side with no point. First to 7. |

There is no win by two with three teams: first to the target wins, and the other two place second and third by points.

## Scoring

Chosen in the lobby (and on the landing page for a solo match):

| Choice              | Rule                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QUICK · TO 11**   | The default. Every rally scores a point for whoever wins it, whoever served. First to 11, ahead by 2.                                                         |
| **CLASSIC · TO 15** | The old Blobby Volley rule: only the serving side can score. Winning a rally on the other side's serve takes the serve and no point. First to 15, ahead by 2. |

Either way a match stops at 40 points if nobody gets two clear.

## Controls

| Move | Keyboard            | Touch                                     | Gamepad                          |
| ---- | ------------------- | ----------------------------------------- | -------------------------------- |
| Run  | A / D or ← / →      | the left pad: slide your thumb either way | left stick or d-pad              |
| Jump | W, ↑, Space, J or K | JUMP                                      | any face button, a shoulder or ↑ |

The newest direction wins: holding one way and pressing the other turns at once, and letting go goes back to the key
still held. The touch rocker turns as soon as the thumb slides back a few pixels, wherever it has wandered.

On a shared screen (tick **Shared TV** before creating the room, then **OPEN TV SCREEN** in the lobby) the TV shows
the court and each phone becomes a full-screen rocker and jump button that buzzes on your own touches.

## How it is built

- `src/engine/`: integer fixed-point rules at 120 steps a second, six per 50 ms log tick (`tuning.ts` holds every
  number), the serve and both scoring rules, and the bot, which plans by simulating copies of the world and emits
  ordinary held bits. No floats affect play; `RULES` in `src/engine/index.ts` names the rules version.
- `src/online/`: the game behind `fuse-netcode`'s `RollbackGame` and the room runtime, the same stack as Fuseball.
- `src/render/`: the Canvas 2D scene (generated court, blobs and ball from `public/games/fuse-volley/art/v1/`, see
  `docs/design/fuse-volley-art.md`, with a procedural fallback), the jelly springs and cues.
  Everything here is cosmetic and reads views only.
- `src/app/`: the page, controls (keys, touch rocker, gamepads), sounds and the forward run (`forward.ts`, on
  fuse-netcode's shared presentation kit): each frame plays the newest folded world forward on a copy to the clock,
  your own blob on the keys held right now, the others on what they last logged and bots as the fold would ask them,
  so a press shows on the next frame. The run stops short of the end of a rally: points, side-outs and serves show
  when the room has folded them. A rollback, or another player's logged controls changing, is eased in rather than
  snapped; your own blob is never smoothed. Effect counters are latched so a predicted touch is not heard twice.

Developer flags: `?mute`, `?autopilot` (this device plays with the bot's answers), `?lead=off` (draw the old way, a tick
behind the clock and blended, to compare the feel), `?probe` (publishes where your blob was last drawn on
`window.__fuseVolleyProbe`, for `scripts/fuse-volley-input-latency.ts`), `?trace` (keeps drawn positions on
`window.fuseVolleyTrace` for smoothness checks).

Production serves its rooms, like every game registered in `service/history.ts`.

Checks: `pnpm exec tsx --test games/fuse-volley/tests/*.test.ts`.
