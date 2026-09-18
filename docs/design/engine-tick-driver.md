# One tick driver, required settings, one bomb-input core, one name guard (issue #253, stage A3)

Finding C2 of the architecture review said the tick driver existed twice, LAN and online, and that the two shipped different rules: LAN never set `GameState.settings` and ran on `??` fallbacks, leave semantics differed, and bomb input was folded by two implementations. The LAN server has since been deleted (#271), so there is no second driver to bring into line and nothing here is a visible LAN change. What was left of C2 lived in the engine: a driver that only existed inline in `applyTick`, fallbacks for a state that no longer occurs in play, a second bomb-input state machine, and rider-name rules written four times. This stage removes that residue.

Every commit is `[hash-identical]`: `RULES` (in `src/engine/apply-tick.ts`) is left as `main` has it and `tests/fixtures/golden-hashes.json` is only ever main's own recording. No rules bump was needed; the two places one would have been are listed under "Left for a rules bump" and "Owner decisions".

## The driver contract

`driveGameTick(game, inputs, roomSettings, phases?)` in `src/engine/tick-driver.ts` is one tick of a game, whoever runs it:

1. `step(game, inputs)`, `STEPS_PER_TICK` times (one today).
2. Round progression. When the round-over pause has run out, absent riders lose their seat; if two or more remain, the next round starts. With fewer, the game waits in `roundOver` for the room to act.
3. Settings at the round boundary. The next round plays under `roomSettings`, the room's current choice, except the match format (`match`, `length`), which stays as it was when the match started.
4. Outside play nobody holds a charge or a target.

It returns `{ events, removed, roundStarted }`. The driver knows the game and nothing about a room's log, streams or bots. `applyTick` (`src/engine/apply-tick.ts`) keeps what is the room's: it applies the tick's management entries, folds each rider's entries and the bots into `inputs`, calls the driver, then forgets the folds and bot seats of `removed` riders and clears held gestures if `roundStarted`. Those two follow-ups used to sit between the driver's steps; nothing the driver does reads folds or bot seats, so doing them after is the same fold (the golden, `tests/input-log.test.ts` and the convergence tests agree). `tests/tick-driver.test.ts` holds the contract, and also that `apply-tick.ts` calls neither `step` nor `startNextRound` itself.

Like `step`, the driver is not transactional: a `TickFault` leaves the game part-way through the tick. `phases` is the fault-injection seam of `step`, passed through.

### The seam for #258 N2 (game speed as N steps per tick)

N2 wants the 3× speed of a bots-only endgame to be N `step`s inside one shared tick instead of a faster shared clock. The driver is where that goes, and the loop is already there: in the driver it is one line (`STEPS_PER_TICK`, or a count chosen from the state before the loop). It is not implemented here, and it is not only that line:

- `applyTick` reads the log's tick off the game (`tick = game.tick + 1`). With more than one step per tick the game's clock runs ahead of the log's, so the room needs its own tick counter first (a `RoomState` field, which is a checkpoint and snapshot change).
- A press, release or cancel in `inputs` must reach the first step only; later steps of the same tick get the held controls without the commands.
- The count has to be a pure function of state every replica holds at the start of the tick, or a rollback can change it retroactively, which is the bug N2 exists to remove.
- It is a `[rules]` change.

## `settings` is required

`GameState.settings: RoomSettings` has no `?`, `createGame(matchId, settings, seed?)` takes it, and every `state.settings?.x ?? fallback` is gone: `aimBounce`, `chainReaction`, `map`, match `length`, `bombChargeTicks` (simulation, bots and view) and the pickup draw. `pickupTypeForRoll`, the draw used when there were no settings, is deleted; `roomPickup` over `settings.weights` is the one draw. (With the default weights the two agreed on every roll; `tests/pickup-weights.test.ts` had been asserting that.)

Two of the fallbacks differed from `defaultRoomSettings()`: `aimBounce ?? false` against a default of `true`, and `map ?? "classic"` against `"rotate"`. So the question was whether anything real ran on them. On `main` and on #309:

| Path                                                                                                     | Settings                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Online room, solo, the landing page's attract mode                                                       | Always set: all three build their world with `createRoomState(matchId, settings)`, and every later change is a parsed `SETTINGS` entry or a spread of the room's copy |
| A world received from a peer                                                                             | The sender's game, so always set                                                                                                                                      |
| The golden recording                                                                                     | `createRoomState(…, defaultRoomSettings())`, then `SETTINGS` entries                                                                                                  |
| `src/client/phaser/benchmark-fixture.ts`                                                                 | None. It only calls `toSnapshot` on a lobby for the renderer benchmark; no tick runs. Now `defaultRoomSettings()`                                                     |
| `scripts/ai-league.ts`, `benchmark-bots.ts`, `benchmark-bot-survival.ts`, two browser screenshot scripts | None: developer tools that ran the fallback rules                                                                                                                     |
| About sixty `createGame` calls in tests                                                                  | None, or assigned afterwards                                                                                                                                          |

No player-facing path ran without settings, so removing the fallbacks changes nothing a replica computes, and the golden proves it for the recorded workload. The tools and tests now say what they play under. `tests/fixtures/classic-settings.ts` is exactly the old fallback set (`map: "classic"`, `aimBounce: false`, everything else default), so tests written against the open arena keep their geometry and their random draws: the whole unit suite passed unchanged in behaviour after the switch, which is the evidence that the removal is a refactor. Two tests asserted the fallback itself ("a game with no settings at all still chains", "a game without room settings, as on the LAN, keeps the classic arena"); the first is deleted because the state it built cannot be written any more, the second now says it is about the `classic` map.

### At the boundaries

- **Checkpoint** (`src/engine/codec/checkpoint.ts`). The guard accepted `settings === undefined`. It now requires settings, and requires them whole: every field present, no extra key, and the value must parse. The parser alone is too kind for this boundary, because it fills in flags a browser saved before they existed, while the simulation reads the object that arrived. A same-`RULES` peer cannot legitimately hold a game without settings or with partial ones (table above), so this refuses only damaged or hostile states. A refusal takes the existing path: `decodeSnapshot` returns nothing, the runtime retries on its timer, rotating peers, and after repeated failures says "Could not load the game — reload this page". The healthy world, if there is one, is untouched.
- **Log**. A `SETTINGS` entry was already validated by `parseRoomSettings` in `isEntry` and applied as the parser's complete copy. Unchanged.
- **Browser storage** (`loadRoomSettings`). Still migrates and defaults old preferences; that is the one place a default for a missing field belongs.

## One bomb-input core

`src/engine/bomb-gesture.ts` is the only place a rider's button becomes the ordered `press` / `release` / `cancel` commands `step` reads: `pressGesture`, `releaseGesture`, `cancelGesture`, `aimGesture` over `{ aim, activeGesture, latestGesture }`. `foldPlayerEntries` calls it with the gesture ids the log carries. Its four cases moved verbatim, so what replicas agree on is unchanged.

`BombInputBuffer` (`src/engine/bomb-input.ts`) was the LAN server's per-connection buffer and had its own state machine. Nothing in the app uses it (the client's input capture is `RoomRuntime.input`, which writes log entries, and the local rider is predicted by folding those entries through `applyTick` like everyone else's); two test files do. It is now the same core behind a device's frames: it numbers gestures itself and queues commands until drained. Its API lost the LAN `held` flag: `accept(action?, aim?)`, `cancel()`.

Before unifying, a differential test (`tests/bomb-input-differential.test.ts`, first version in commit `769a2fb`) drove both from one model of a device and recorded where they parted on #309's head:

| #   | Device behaviour                                     | `BombInputBuffer` (LAN)                              | Log fold (online)                                  |
| --- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| 1   | A second press over a held one                       | Ignored                                              | `cancel`, `press`: the charge restarts             |
| 2   | A cancel with nothing held                           | `cancel`                                             | Nothing                                            |
| 3   | An unheld frame with no edge, while holding          | `cancel`                                             | No such entry exists; still holding                |
| 4   | press, release, press, cancel in one tick            | `cancel` only: the queued launch is wiped            | All four commands                                  |
| 5   | An aim while nothing is held                         | Forgotten at once                                    | Kept, and carried by the next press                |
| 6   | A held frame whose press edge was lost, then release | `release`                                            | Nothing (no gesture was opened)                    |
| 7   | More than eight commands queued                      | `cancel`, then presses refused until a neutral frame | No bound in the fold (a stream bounds its entries) |

One act per tick, over 400 seeded streams of 60 acts, the first disagreement was always 1, 2 or 3; with those three acts removed the two agreed on every stream. 4 to 7 need several acts in a tick or state the log cannot express, and were written out by hand.

The shared core has the fold's semantics in every case, because that is what online play does and the golden must not move. The buffer keeps one rule of its own, the bound on its queue (past eight, the tick's commands are dropped for one `cancel` and the held gesture is abandoned), now without the neutral-frame handshake. The differential test stays as a regression: 500 seeded streams with up to four acts a tick must agree command for command, and the seven findings are kept as named cases with their one answer.

Nothing here is observable online, so there is no rules change.

## One name guard

Four rules disagreed (review of #281): `validRiderName` (18 code points, trimmed, no control characters, no half surrogate pairs), the LAN-era `parseClientMessage` (18 code points after trim, no surrogate check), the log's `isEntry` (20 UTF-16 units, untrimmed allowed) and the room runtime's join (`.trim().slice(0, 20)` in UTF-16 units). A fifth, the checkpoint guard, was 20 units with no control-character check. The join's slice could cut a surrogate pair in half and seat nineteen letters and half an emoji: a name `validRiderName` refuses, and with it the history service refused the whole match report. The join form allows 20 units, so a 19-letter name did the same.

`src/engine/rider-name.ts` (moved from `src/shared/`, because the log and the checkpoint guard are engine code and the engine's outward imports may only shrink) is now the only place a name rule is written:

| Export                  | Is                                                                                                                                                                                                                                                                                             | Used by                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `validRiderName`        | The guard: a name as it is stored anywhere                                                                                                                                                                                                                                                     | Accounts, the history service, reports                                                                            |
| `seatRiderName(raw)`    | The normaliser: trimmed, half pairs dropped, cut by code point to at most 18 code points and at most 20 UTF-16 units, never through a pair, no dangling joiner or space at the cut. A control character inside the name refuses it, as before. Always a valid name the log accepts, or nothing | The runtime's join (peer and solo) and the join form                                                              |
| `trimmedRiderName(raw)` | A valid name with padding around it, or nothing; not repaired                                                                                                                                                                                                                                  | `parseClientMessage` (now also refuses half pairs)                                                                |
| `loggedRiderName`       | What a replica accepts in a JOIN or BOT entry and in a checkpoint: the log's old predicate, character for character                                                                                                                                                                            | `isEntry`, the checkpoint guard (which now also refuses control characters, which the log never let into a state) |

Why the log keeps its own bound: replicas on one `RULES` must accept exactly the same entries. A replica that accepted more (an 18-emoji name is 36 units) would fold entries an older tab on the same rules drops, and one that accepted less would drop entries others fold. So `isEntry` accepts precisely what it did, a JOIN still folds to the trimmed name and a BOT to the name as written, and every name accepted before folds to the same stored name (`tests/rider-name.test.ts` applies such entries and round-trips the checkpoint). What changed is only what a manager writes into the log, which replicas never had to agree on in advance: from now on, always a valid rider name. Visible differences: a 19 or 20 letter name is seated as its first 18; a name cut at an emoji keeps whole emoji; the join error says 1–18 characters.

### Left for a rules bump

Narrowing `loggedRiderName` to `validRiderName` (and with it letting an 18-emoji account name be seated whole) changes which entries fold, so it is a `[rules]` commit. It is one line plus the bound's removal, and belongs in the next bump (A4 has one): then there is one predicate, not a guard and a wire bound.

## Owner decisions

**Explicit leave.** Today a `LEAVE` entry during a countdown or a round marks the rider absent and neutralises its controls: it coasts straight ahead, can still kill and be killed, keeps its place in the round ranking when it dies, and loses its seat at the next round boundary (at once in the lobby, round-over and match-over). A lost connection (`PRESENCE false`) does the same, which is what lets a device that comes back take its seat again mid-round. The plan proposed that an explicit leave eliminates the rider at once, as the LAN server did: the rider dies on the tick of the `LEAVE`, the round can end sooner, and its statistics book an early exit (`eliminatePlayer` already does all of this). A dropped connection would keep coasting. That changes outcomes, so it needs a `RULES` bump and a new golden, and whether leaving mid-round should cost the round is a product call. Not implemented.

## What is left of #253

A4: the effect, pickup and weapon registries, with its rules bump. Candidates to ride that bump, all noted in the design notes: `loggedRiderName` → `validRiderName` (above); the instant-death commit order and the shot rule (`engine-pipeline.md`); explicit leave if the owner wants it. `InputIntent.bomb` is still written by `intentOf` and read by nothing (C9's dead fields are A4's). N2 is #258's and has its seam here.
