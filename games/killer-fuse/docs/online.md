# Killer Fuse online

How the game runs over the rollback netcode (`fuse-netcode`): what a device logs, what a room can be set to, how a set of games plays out, and what is reported afterwards. The code is `src/online/`; the page that uses it is `src/app/`.

## The room

Every device folds the same shared log into the same room. One log tick is 50 ms (20 a second) and runs three engine steps, so the engine keeps its 60 steps a second. `runtime.confirmedTick()` is on the game clock: three to a log tick.

A room has six seats (slots 0 to 5) and up to six watchers. Slots alternate teams: even slots are Cyan, odd slots are Pink, and slots 0 and 1 are the Queens. Only people hold seats. A slot nobody sits in, or whose player is away or disconnected, is played by the engine's bot for as long as that lasts. The fold sets the round's `humans` from the connected seats before every tick's steps, so a player who drops or returns hands over or takes back the unit on the same tick on every device.

## Entries

Besides the netcode's management entries (join, spectate, presence, name, settings and the `start`, `rematch` and `lobby` actions), a seated device logs three kinds of its own. `seq` and `tick` are the netcode's.

| Kind    | Entry                                             | Meaning                                                                                                           |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PLAY`  | `[seq, tick, 0, matchId, round, bits]`            | The held controls from this tick on: the engine's `INPUT_LEFT`, `INPUT_RIGHT`, `INPUT_DOWN` and `INPUT_HELD` bits |
| `PRESS` | `[seq, tick, 1, matchId, round, ordinal, offset]` | One press of the button, on step `offset` (0 to 2) of the tick                                                    |
| `SEAT`  | `[seq, tick, 2, slot]`                            | Asks for a slot, outside a running game                                                                           |

- `PLAY` and `PRESS` count only in the match and game they name, so a late entry never moves a unit in the next game. Every game starts with nothing held; the runtime logs the held bits again when a new game starts and after a resync.
- A `PRESS` carries a gesture ordinal that only rises along the device's stream, so a repeated entry is one press. The offset is read from the shared clock, so a tap shorter than a log tick flaps on the step it was made. The fold sets the engine's `pressed` edge on that step alone.
- `SEAT` for a free slot moves the player there. For a slot another player holds it records a wish, and the two swap when the other asks for this player's slot in return. Asking for your own slot withdraws the wish. Wishes that can no longer come true are dropped.
- A bot entry is refused: no bot holds a seat here.

`isEntry` in `src/online/game.ts` is the boundary: anything that is not exactly one of these shapes is not folded.

## Settings

The host sets them in the lobby; a set plays with the settings it started with.

| Setting    | Values                      | Default  | Meaning                                              |
| ---------- | --------------------------- | -------- | ---------------------------------------------------- |
| `botLevel` | `easy`, `medium`, `hard`    | `medium` | How the bots in the free slots play                  |
| `map`      | `0`, or a map id `1` to `3` | `0`      | One map for every game, or `0` to rotate through all |
| `wins`     | `1` to `3`                  | `2`      | Games a team must win to take the set                |
| `display`  | `true`, `false`             | `false`  | One shared screen, with phones as controllers        |

A settings entry carries exactly these four keys. With `map` 0 the rotation starts on a map chosen from the match id, so sets differ and every device agrees.

## Match flow

1. **Lobby.** The first person to join gets the lowest free slot; anyone moves or swaps with `SEAT`. A watcher can take a free seat (JOIN THE GAME). The host changes the settings and presses START. A set needs one seated person; bots take the rest.
2. **Countdown.** Each game shows its arena for 60 ticks (3 s) before the first step; the first game of a set for 160 ticks (8 s), as the original does, while the card shows the three ways to win (`countdownTicks` in `src/online/game.ts`). Its seed is a hash of the match id and the game's number.
3. **Play.** Three engine steps a tick on the pilots' controls, until the engine names a winner by military, economic or snail victory. After 300 s of play the engine's safety clock decides the game: more Queen eggs, then more berries banked, then the snail nearer its goal, then a coin flip from the seed.
4. **Victory.** The arena stays for 60 ticks (3 s), then the game is recorded: map, winning team and kind, steps, who sat in each slot and who was connected.
5. **Between games.** If no team has the wins yet, the next game starts after 100 ticks (5 s).
6. **Over.** The team that reached `wins` takes the set. The host starts a rematch with the same seats, or returns everyone to the lobby.

Seats cannot change while a game runs. A device that joins a running set watches, or takes a free seat and plays from that tick. A refreshed device recovers the room from a peer's checkpoint and takes its seat back.

## Checkpoint and hash

`encode` writes `[matchId, round, stage, settings, play]`, then `[seats, results, startAt, held, asks, roster, stats, world]`. The score, the set's winner and the victory and pause ticks are derived again by `decode`. The round travels as the engine's plain state without its events; `decodeWorld` (`src/online/world.ts`) accepts it only if it has exactly the shape of a fresh round of the same seed, map and bot level, every number a safe integer and every index in range, and the engine can step it. A checkpoint that fails any check is refused whole.

The desync hash covers the whole room and round except the last tick's events.

## Events and the view

The fold returns the engine's events of the tick's three steps, in order. The netcode deduplicates events by match, round, tick and index, so a victory predicted on one tick and moved by a rollback is emitted again. The page therefore draws everything from the view (`Frame<View>`) and uses events only for effects and sound, through the renderer's `advance(view)`, once per new log tick.

## Results

- **Stats.** Kills, deaths and berries (carried or kicked in) are credited to the person piloting the slot on that step. A Queen's death is one death.
- **Per game.** `roundResult` is a rating receipt (`length` 1). The platform rates a free-for-all, so every player of the winning team is placed first and every loser after all of them: teammates tie and each winner beats each loser. The platform takes at most five players in a receipt, so a game six people played has none.
- **Per set.** `matchResult` lists everyone who sat through the end of a game, with their stats. Winners are the people on the winning team of the deciding game. Someone not connected when that game was recorded left early. At most five finishers attest.
- **When.** A device that played reports a game once the confirmed tick has passed the tick it was recorded on, and the set once its last game is confirmed. The service keeps a result once a majority agree. A shared screen, a watcher and a latecomer report nothing.

`src/platform.ts` is the registration `service/history.ts` loads: it validates a player's reported stats and adds a confirmed set to the account totals (`matches`, `wins`, `gameWins`, `kills`, `deaths`, `berries`). It imports only `online/basics.ts`.

## Analytics

The page sends the shared `Seat Taken`, `Match Started` and `Match Ended` events, and its own `Game Ended` per decided game: `round`, `mapId`, `winKind`, `winningTeam`, `durationSeconds`, `humanCount`, `botCount`, `played`, `won` (if it played) and `mode` (`solo`, `online` or `shared`). Names, room codes and invite links are never sent.

## Versioning

`killerFuseGame.rules` is the engine's `RULES`. Two builds with different rules refuse to share a room. `tests/online-golden.test.ts` replays a recorded set and compares hashes, so any change to the engine's behaviour fails it: bump `RULES` and record the hashes again when that change is intended.
