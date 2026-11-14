# Fuse Volley

Fuse Volley is jelly-blob beach volleyball for two, served at `/fuse-volley/` (locally
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
  `docs/design/fuse-volley-art.md`, with a procedural fallback), the jelly springs, cues and rollback smoothing.
  Everything here is cosmetic and reads views only.
- `src/app/`: the page, controls (keys, touch rocker, gamepads), sounds and the forward run: each frame plays the
  newest folded world forward on a copy to the clock, so a press shows within one log tick.

Developer flags: `?mute`, `?autopilot` (this device plays with the bot's answers), `?lead=local` (draw your own blob
with the keys held right now rather than the ones last logged), `?trace` (keeps drawn positions on
`window.fuseVolleyTrace` for smoothness checks).

Production serves its rooms only once `fuse-volley` is in `EXTRA_GAME_IDS`
([GCP deploy](../../docs/online/GCP-DEPLOY.md)).

Checks: `pnpm exec tsx --test games/fuse-volley/tests/*.test.ts`.
