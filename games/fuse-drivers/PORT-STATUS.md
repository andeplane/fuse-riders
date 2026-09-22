# Fuse Drivers port: where it stands

Branch `claude/add-fuse-drivers` in a worktree of the Fuse Riders monorepo. The game came from
`~/projects/personal/fuse-man` (its own repo, its own server); this port puts it on the shared input log.
Read `docs/design/fuse-drivers-port.md` first for the decisions, then this for the state.

## Done and green

1. **Registered workspace.** Scaffolded with `npx tsx scripts/new-game.ts fuse-drivers`, then wired into the
   five places a game must appear: `Dockerfile.cloud` copy line, root `package.json` dependency,
   `service/history.ts` GAMES list, `tests/fixtures/source-guards.ts` layer guard, `.c8rc.json` exemption for
   the page's DOM glue.
2. **Simulation** in `src/game/sim/`: truck kernel, items, race step, tracks, bots, series, plus
   `deterministic-math.ts` (the game's own bit-identical trig, built from `+ - * /` and `Math.sqrt`, which
   satisfies this repo's determinism guard without `@stdlib`). Made strict-clean for
   `noUncheckedIndexedAccess` with no behaviour change.
3. **Its own test suite** ported as `tests/sim-*.test.ts`, 86 tests including the recorded replay hash, which
   still holds. `tests/fixtures/defined.ts` is the helper for indexed fixture reads.
4. **Racing rules** in `src/game/rules.ts` with `tests/fold.test.ts` (7 tests).

## Broken right now, and this is the next job

Replacing Pig's `rules.ts` left four files and four tests still written against Pig. `npm run typecheck`
reports 275 errors, all in them:

| File                                                   | What it must become                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/game/checkpoint.ts`                               | `encodeRoom`/`decodeRoom`/`hashRoom` for the racing room. `decode` is the security boundary: validate every field and the relations between them, return `undefined` on anything odd, never a half-built room. `hashRoom` from dice works unchanged for any JSON-shaped room whose only `Map` is `seats`.                                                                                                                              |
| `src/game/game.ts`                                     | The `RollbackGame`. Mostly written for you: `clock: (room) => room.tick`, `steps: (room) => stepsForTick(room.tick + 1)`, `maxSteps: 2`, `scope: (room) => ({ matchId: room.matchId, round: room.round })`, `view` returning truck poses, projectiles, pickups, laps and placements rebuilt fresh, `seating` with `capacity: CAPACITY`, `parseSettings`, `seatName`, `isAvatar`, `botId`, `botName`, `solo: { name: "You", bots: 4 }`. |
| `src/game/result.ts`                                   | `matchResult`/`roundResult` returning `MatchResult<FuseDriversStats>`: placement, laps, kills, deaths, best lap. Freeze the receipt in the fold at the tick the race was decided, so later seat changes cannot alter it.                                                                                                                                                                                                               |
| `src/game/index.ts`                                    | Re-export the four modules.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/{rules,checkpoint,netcode,consistency}.test.ts` | Pig's. Rewrite against the racing rules, keeping each file's purpose: rules behaviour, checkpoint round trip and rejection, netcode mesh replay, cross-peer consistency. `tests/fixtures/mesh.ts` is generic and worth keeping.                                                                                                                                                                                                        |

`tests/app.test.ts` and `src/app/*` are still Pig's page; they compile today and break only when the page is
replaced, which is the step after this one.

## Then, in order

1. **Platform** (`src/platform.ts`): racing stats instead of rolls, holds and busts. Its only import must stay
   `./game/basics.js`, so the room service never loads the netcode.
2. **Page** (`src/app/`): landing, lobby, invite and results from `fuse-ui`; the arena as a lazily imported
   Phaser 4 renderer that the page's own `requestAnimationFrame` loop drives, reading
   `runtime.frameTiming()`. Phaser must not own the loop: Fuse Riders calls `game.loop.stop()` and disables
   Phaser input and audio. **Our renderer is Phaser 3.90 and this repo is on 4.2.1**, so the scenes in
   `~/projects/personal/fuse-man/src/client/scenes/` need migrating, not just copying. Render only from the
   view, never from events, because a rollback rewrites outcomes without re-emitting them.
3. **Art**: `public/assets` and `tracks/` are already copied here. `scripts-build-tracks.mjs` regenerates
   `src/game/tracks-data.ts` after a Tiled edit.
4. **Measure** the rollback budget: three steps per 100 ms across five trucks, and up to 40 ticks of
   re-simulation, is heavier than Pig. Then the browser smoke.
5. **Production** needs the id added to the `EXTRA_GAME_IDS` repository variable. Until then the page must
   offer solo against bots only.

## Things that cost time to learn

- Management entries are `[seq, tick, KIND, id, ...]`: `JOIN` is `[seq, tick, JOIN, id, name, slot, avatar,
generation]` and `PRESENCE` is `[seq, tick, PRESENCE, id, connected, generation]`. The id is in the tuple,
  not taken from the stream key.
- Imports inside the monorepo use the `.js` extension for `.ts` files. The scaffold generator camel-cases the
  game id inside string literals, which produced one wrong storage-key assertion for a hyphenated id.
- The old repo's Cloud Run server (`fuse-drivers-server` in project `andershaf-87`) and its GitHub Pages site
  become redundant once this lands, and should be torn down deliberately rather than left running.
