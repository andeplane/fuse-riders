# Several games, one set of libraries

Status: steps 1 to 3 are built and step 4 has a first cut: the netcode (`packages/fuse-netcode`), the backend (`packages/fuse-platform`), the dice game (`games/dice`: rules, page and service registration) and the menus and styles (`packages/fuse-ui`). Step 5 is built too: Fuse Riders lives in `games/fuse-riders` and the room service in `service/`. Production serves the dice game only once `EXTRA_GAME_IDS` names it ([GCP deploy](../online/GCP-DEPLOY.md)).

The repo holds two games: Fuse Riders (`games/fuse-riders`) and Pig, a small dice game (`games/dice`). They share six packages: the networking (`packages/fuse-network-fe`, `-be`, `-protocol`), the rollback netcode (`fuse-netcode`), the account, history and Elo backend (`fuse-platform`) and the menus and styles (`fuse-ui`). Pig proves that the contract really is game-agnostic. What is still Fuse Riders' own: its account panel, recap, room settings dialog and phone layout (planned for `fuse-ui`). This note sets out the layout, the contract a game implements and the order of the work.

## Decisions

- **One backend for all games.** One Cloud Run room service and one Firestore database. Rooms, match records, ratings and leaderboards carry a `gameId`. An account is shared across games; each game has its own rating. Sharing infrastructure avoids a separate service per game; cost still depends on usage.
- **Libraries stay inside this repo** as npm workspaces. They are not published to npm until a game outside the repo needs them.
- **The template game is a dice game**, described under [The dice game](#the-dice-game).

## Target layout

```text
games/
  fuse-riders/        src/: engine/, render/, client/, online/, shared/; tests/ with the golden hashes (built); its page is
                      the root index.html, and its service registration is src/platform.ts
  dice/               the template game (built): rules in src/game/, the page in src/app/ and index.html, the service
                      registration in src/platform.ts, tests; scripts/new-game.ts copies it to start a new game
packages/
  fuse-network-fe/        WebRTC mesh, room client
  fuse-network-be/        room admission (one game per room), signalling
  fuse-network-protocol/  their wire contract, game ids
  fuse-netcode/           input log, lockstep and rollback, snapshot recovery, clock, room runtime (built)
  fuse-ui/                landing, name entry, lobby and QR, dialogs, controller row, neon CSS tokens (first cut built); browser helpers
                          (analytics, safe storage, audio unlock, voice chat) until they need a package of their own
  fuse-platform/          identity, match history and settlement, Elo and ratings, leaderboards, storage adapters (built)
service/                  the one deployed entry: composes fuse-network-be and fuse-platform with every game's registration (built)
```

The folder stays `packages/` because the workspaces already point there. **Names** (there is no npm scope): the three network packages keep their names, because renaming them touches every open branch for no change in behaviour. New packages take plain names (`fuse-netcode`, `fuse-platform`, `fuse-ui`) and the same `package.json` shape as the existing ones: private, `type: module`, `"exports": {".": "./src/index.ts"}` plus any subpath a browser or an optional peer needs. Packages must not import `service/` or `games/`. A game may import any package. Games must not import one another.

## The game contract

The boundary sits at the room's tick (`applyTick`), not the game's (`step`). A game owns its whole room state: the game, held controls (`folds`), bots and settings. Two reasons: permission to issue a management entry depends on game state (who is connected), and folds are part of the hashed state. `packages/fuse-netcode` owns everything around that: streams and their ordering, clocks, rollback, event deduplication, snapshot transfer, the hash schedule and the room runtime.

This is the contract as built (`packages/fuse-netcode/src/game.ts`). Each member replaces something `games/fuse-riders/src/online/` used to read from Fuse Riders' engine; `games/fuse-riders/src/online/fuse-game.ts` is Fuse Riders' implementation.

```ts
interface RollbackGame<
  Room extends { tick: number },
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
> {
  id: string; // "fuse-riders"; log prefixes now, the gameId later
  rules: string; // `<prefix>-<n>`: peers on other rules refuse each other; `n` says which side is newer (was RULES/rulesAge)
  isEntry(raw: unknown): raw is Entry; // the wire boundary for packets, snapshots and own entries (was isEntry)
  ordinal?(entry: Entry): number | undefined; // must strictly increase along a stream (was the PRESS gesture id in StreamLog)
  createRoom(matchId: string, settings: Settings): Room; // was createRoomState
  createTicker(): (room, creatorId, streams) => Event[]; // stateful fold of one log tick (was applyTick plus its BotController)
  scope(room): { matchId: string; round: number }; // event dedupe key (was game.matchId, game.round)
  clock(room): number; // the game's clock, stamped on frames and events (was game.tick)
  steps(room): number; // steps the next log tick runs; catch-up and re-runs are paced by steps (was stepsPerTick)
  maxSteps: number; // was MAX_STEPS_PER_TICK
  view(room): View; // was toView, plus Fuse Riders' watching list
  hash(room): string; // was hashRoomState
  checkpoint: {
    leading: number; // how many fields precede the streams and hash; the rest follow the hash
    encode(room): unknown[];
    decode(fields, tick): Room | undefined;
  }; // the snapshot's game fields (was game, settings, folds, bots; spectators after the hash)
  members(room): Iterable<Seat>;
  seat(room, id): Seat | undefined; // id, name, slot, connected, bot, watcher, generation (was game.players, bots, folds, spectators)
  stage(room): "lobby" | "running" | "between" | "over"; // was game.phase and reclaimable()
  settings(room): Settings;
  matchSettings?(room): Settings; // was state.settings and game.settings
  seating: Seating; // seat and watcher capacity, name normaliser, avatars, settings parser, solo settings, shared-screen test, bot ids and names, solo seats
  text: RuntimeText; // every status line, so a game names its players (Fuse Riders says "riders"); defaultText is neutral
}
```

Changes from the first cut: the bots moved inside the ticker (`createBots` was a separate stateful object the netcode only passed back to `applyTick`); `parseEntry` became a type guard, because the netcode never rewrites an entry; `follows` became `ordinal`, the one ordering rule `StreamLog` had; `predict` and `result` were dropped, since nothing in the runtime reads them; `members`, `seat`, `stage`, `settings`, `steps`, `seating` and `text` were added for what the runtime read directly. A `Room` must be `structuredClone`-able (the snapshot ring clones it). The ticker must advance `room.tick` by one and the game's clock by `steps(room)` as read before the tick, because the step budget is charged in clock steps. Events are deduplicated by position (`matchId`, `round`, log tick, index), not content: a rollback that changes an outcome does not re-emit it, so Pig renders outcomes from `view`. Commands (start, rematch, lobby, settings, bots) stay the creator's, as in Fuse Riders; a successor keeps the room running (presence, joins) while the creator is away.

The room runtime is `RoomRuntime` in the package. A game subclasses it for its own controls, as Fuse Riders does for steering and the bomb gesture (`games/fuse-riders/src/online/room-runtime.ts`): the subclass logs entries with `append`, releases held controls in `releaseControls` when the page is hidden, and resets them in `resetControls` and `absentControls`. `frameTiming()` gives the two newest frames, the fractional tick and the lead; Fuse Riders adds its held steer in `presentation()`.

**Management entries are generic in the package; applying them stays with the game.** Join, leave, presence, settings, start/rematch/lobby, bots and spectators (kinds 10–16) have one wire format (`management.ts`). The runtime logs them, reads them for the stall rule and seat claims, and runs host succession and presence duties over `members`, `successionOrder`, `actingCreator` and `permitted`. Fuse Riders' engine keeps its own reducer for them, because `games/fuse-riders/src/engine/` cannot import a package and moving its reducer would change the hashed state; `games/fuse-riders/tests/fuse-netcode-management.test.ts` checks that the engine and the package accept the same entries and grant the same permissions. A new game applies them with `applyManagementTick` over a `ManagedRoom` (seats, settings) and lifecycle hooks, with Fuse Riders' semantics: a departure frees a seat when seats are reclaimable and holds it otherwise; start runs from the lobby; rematch from a finished match; both drop absent seats first when seats are reclaimable; watchers hold no seat, rank last in succession and are never waited on.

The netcode keeps what `games/fuse-riders/src/online/` already owned and must not lose: entry tick and sequence, member generation and retired streams, gaps and repair, bounded history, rollback within its bound, snapshot transfer validated at the boundary and installed atomically, the stall rule and the desync hash ([ADR 047](../adr/047-p2p-input-log-lockstep-rollback.md)). Its windows (`ROLLBACK_TICKS`, `STALL_TICKS`, `FUTURE_TICKS`) stay counted in 50 ms ticks, so every game uses a fixed 50 ms log clock. Game speed belongs inside the game's fold, which may run multiple simulation steps per log tick; it must not change the netcode clock rate (see [the fixed-clock design](fixed-clock-game-speed.md)).

The extraction is `[hash-identical]`: `RULES` did not move, `games/fuse-riders/tests/golden-hash.test.ts` passes on main's recording, and the packet and snapshot bytes are the same as before for the same world, so a peer on this build and one on the previous build with the same `RULES` share a room. The snapshot message is still `[rules, room, tick, game, settings, folds, bots, streams, hash, spectators]`: the package writes `[rules, room, tick, ...leading fields, streams, hash, ...trailing fields]`.

## Backend

Built in `packages/fuse-platform` ([README](../../packages/fuse-platform/README.md)); Fuse Riders' registration is `games/fuse-riders/src/platform.ts`; `service/history.ts` composes every game's registration into the service's `Platform`.

- **What the platform owns, the same for every game.** Pending results and attestation by a majority of finishers, settlement, early exits, rating scope and claims, per-round Elo (`calculateElo` over humans, with the game's bot rule), leaderboards and rank, match history, identity (Firebase ID tokens), the history routes and the memory and Firestore adapters. These rules moved unchanged, except that the bot rule is now the game's `isBot`. Rate-limit budgets are per game; Fuse Riders keeps its keys, and the username's budget is the account's.
- **What a game registers.** A `GameRegistration` has `id`, `isBot`, `parseStats(raw, rounds)` (the wire and storage boundary for one player, rebuilt in a fixed key order so equal results hash equally), optional `validField` (checks across players, such as kills naming riders of the match), `emptyTotals`, `credit` and `addTotals` (what a confirmed whole match adds to an account), `parseTotals` (the storage boundary for those totals) and optional `rivals`. The platform reads eight fields of every player itself: `playerId`, `name`, `slot`, `roundsPlayed`, `roundWins`, `matchScoreUnits`, `matchPlacement` and `earlyExits`; everything else is the game's. It re-checks those fields whatever the game's parser accepts.
- **The account is shared.** Username, rider name and avatar live on the user document for every game. The name and avatar rules are the platform's `AccountRules`; today they are Fuse Riders' rider-name rule and avatars, because the account predates games.
- **Fuse Riders is the legacy game** (`LEGACY_GAME_ID`). What an absent `gameId` means everywhere; its rating (`rating`, `ranked`, `elo`), totals, career and `rivals` stay on the user document and its leaderboard query is unchanged, so nothing live changes. Every other game stores its standing in `${prefix}-ratings`, one document per `gameId:uid` (`gameId`, `uid`, `rating`, `ranked`, `elo` and the game's totals spread beside them; totals may not use those names), with its own `rivals` subcollection, and ranks by the composite index `(gameId, ranked, elo)`. The memory adapter mirrors this: one account record, one standing per `gameId:uid`. Moving Fuse Riders' fields into `${prefix}-ratings` is a later migration, not part of this step.
- **Match records carry `gameId`.** New records of every game have it, and production's records from before games were backfilled with `gameId: "fuse-riders"` (`scripts/backfill-match-game-id.ts`). Every game's history query, Fuse Riders' included, filters on `gameId` (index `(gameId, participantUids, endedAt desc)`), so another game's matches never shorten a page. A stored record without `gameId` (a dev or preview database may still hold one) still parses as Fuse Riders', but no history query finds it; a record naming an unregistered game does not parse. Solo rounds of other games use the incarnation `solo:<gameId>:<uid>`, so their record ids and rating scopes never meet Fuse Riders' `solo:<uid>`.
- **Routes.** The existing `/api/...` history routes are Fuse Riders'. `/api/games/<gameId>/...` addresses any registered game with the same routes. `/api/me` and its `PUT` (the username) are the shared account under either form; the profile it returns carries that game's rating and totals. An unregistered `gameId` is `404 Unknown game`.
- **Rooms carry `gameId`** (`fuse-network-be`, `fuse-network-protocol`). Creation takes `?gameId=`, the room stores it, and a socket whose `auth` frame names another game is closed as a missing room; a history report for a room of another game is refused the same way. The service is configured with the registered ids and refuses others. Room codes stay one namespace, so a code never means two games at once. Absent means `fuse-riders` in both directions, so clients and services from before games keep working ([protocol](../online/PROTOCOL.md#games-on-one-room-service-gameid)).

## Menus and styles

`packages/fuse-ui` owns, today: the neon/pixel tokens (colours, font, spacing, z-index scale), the element factory, and the landing card, join by code, name entry, lobby with its QR invite and roster, status line and toast, dialog shell and controller row. Planned, and still Fuse Riders' own until then: the avatar picker, room settings dialog, account panel, recap frame and the shared-screen/phone-controller layout switch. A game supplies its settings fields, its table or arena and its recap content. See [its README](../../packages/fuse-ui/README.md); Pig's page is built from it alone.

- **Tokens.** `tokens.css` defines the neon palette, the Press Start 2P stack, spacing, borders and glow, and a named z-index scale as `--fui-*` custom properties. The values are the ones Fuse Riders already drew. Fuse imports the file first (`games/fuse-riders/src/client/main.ts`); its own `--cyan`, `--ui-*` names are now aliases of the tokens, and its stylesheets read the tokens wherever the value was identical. Before and after screenshots of the landing, the settings dialog and the lobby match pixel for pixel.
- **DOM.** One element factory, `el(tag, text, className, document?)`, replaces the four local copies #255 found (with different argument orders); text goes in through `textContent` only. `copyText` and `closeOnBackdrop` moved in with it.
- **Components.** Small functions that return elements: `createLandingCard` (title, CREATE ROOM, join by code, SOLO), `createJoinByCode`, `createLobby` (invite card with QR, code and COPY LINK; roster with name, avatar, status and HOST; START for whoever may start), `createInviteCard`, `createRoster`, `createNameEntry`, `createNotice` (status line or toast), `createDialog` (title bar, CLOSE, body) and `createControllerRow` (big touch buttons). Each takes an optional `document`, so the package tests run on `linkedom`. Default classes are `fui-*`, styled by `components.css`; a `classes` option renames any part, which is how Fuse keeps its own class names and stylesheet.
- **What Fuse Riders uses.** The factory in most of its DOM (`join-form.ts`, `mobile-play-layout.ts`, `analytics-setting.ts`, `avatar-heads.ts` and `powerup-guide-view.ts` still call `createElement` directly), the join-by-code row on its landing page, both dialogs (landing SETTINGS and the in-room menu), the lobby invite card and rider list, and the controller row. Its landing page, lobby shell (copy, footer, host actions), join form (avatar picker, account name), standings and status line stay in `games/fuse-riders/src/online/ui.ts`.

Still to do: move Fuse's copies of the component rules from `online.css` into `components.css` so both games load one stylesheet; adopt `createNameEntry` in `join-form.ts` once the avatar picker is a slot; the account panel, recap frame and room settings shell; and the shared-screen/phone layout switch (`room-screen.ts`, `mobile-play-layout.css`).

## The dice game

The dice game is **Pig**, for 2–5 players plus bots, first to 50. On your turn you roll a d6 as often as you like, adding each roll to the turn's total. Rolling a 1 loses the turn's total and passes the turn. **Hold** banks the total and passes the turn. One race to 50 is one round, and the first player to win two rounds wins the match, so ratings settle per round as they do for Fuse Riders.

It is small on purpose. It proves the parts of the contract Fuse Riders never exercises:

- **Turn-based play on a tick log.** Entries are `roll` and `hold`. `applyTick` ignores entries from anyone whose turn it is not. A turn timer, counted in ticks, auto-holds so one idle player cannot stall the room.
- **Rollback of discrete outcomes.** A `hold` that arrives late but was stamped before the timer ran out undoes a speculative auto-hold and the next player's roll. The dice UI renders from `view`, not from a stream of events, so the corrected roll shows. Any event it does use must not be deduplicated away when rollback changes its content. This is the case the template exists to test.
- **Shared randomness.** Dice come from the seeded RNG in the room state, so every replica rolls the same number. That also means any member can compute upcoming rolls. This fits the trust model (every member is trusted with the shared log), and the template documents it.
- **The whole stack.** Solo against bots, an online room, shared screen with the TV at `?room=CODE&display=1` and phones as roll/hold buttons, a refreshed device recovering from a peer, and rated rounds.

It renders with DOM and CSS from `packages/fuse-ui`, not Phaser, which shows a game can skip Phaser entirely. `scripts/new-game.ts <id>` copies `games/dice` to start a new game ([its README](../../games/dice/README.md)).

As built:

- **Rules** (`games/dice/src/game/`): `diceGame` is the `RollbackGame` (`rules: "dice-1"`), with the management entries applied by `applyManagementTick`. Each match keeps every player's rolls, holds, busts and best turn, and each round record its decision tick, so a device reports a round only once its confirmed tick reaches it.
- **Page** (`games/dice/index.html`, `src/app/`): Vite builds every `games/<id>/index.html` to `dist/<id>/index.html`, and the dev service serves a directory's page, so Pig is at `/dice/` beside Fuse Riders (GitHub Pages: `/fuse-riders/dice/`). `presenter.ts` turns each frame's view into the screen (lobby, table, controller, result) as a pure function; `session.ts` reads the query and storage; `reports.ts` sends confirmed round receipts and match results with the room token; `runtime.ts` adds ROLL and HOLD to `RoomRuntime`; `main.ts` is the DOM glue. The page links the transport exactly as Fuse Riders does, creating rooms with `gameId: "dice"`. Fuse Riders' landing page links to it (MORE GAMES: PIG).
- **Backend** (`games/dice/src/platform.ts`): the dice `GameRegistration` stores points, rolls, holds, busts and best turn per player and totals per account; `service/history.ts` registers it beside Fuse Riders. The dev service serves both games; Cloud Run serves the dice game only when `EXTRA_GAME_IDS=dice`, after the match-record backfill. Until then CREATE ROOM on the page says online rooms are not open yet, and solo against bots runs with no service. The page has no sign-in yet, so its reports go in as a guest's: they settle guest history and rate nobody. Rated rounds need the account panel in `fuse-ui` (planned); `tests/dice-service.test.ts` shows signed-in dice reports moving dice ratings and not Fuse Riders'.
- **Checks:** `games/dice/tests/` (rules, checkpoint, netcode over lossy links, presenter, reports, session, runtime), `tests/dice-service.test.ts` (admission by game, ratings per game, the `EXTRA_GAME_IDS` switch) and `scripts/dice-smoke.ts` (two devices to a round result with a refresh that recovers from the peer, then a shared screen with a phone controller, in Chromium and WebKit).

## Order of work

| #   | Step                                                                                              | Size         | Depends on                 |
| --- | ------------------------------------------------------------------------------------------------- | ------------ | -------------------------- |
| 1   | `packages/fuse-netcode` behind `RollbackGame`, hash-identical (built)                             | 2–3 sessions | —                          |
| 2   | `packages/fuse-platform`: history and Elo keyed by `gameId`; Fuse Riders stats registered (built) | 2 sessions   | —                          |
| 3   | `games/dice` against netcode and backend, with its page on `fuse-ui` (built)                      | 1–2 sessions | 1, 2                       |
| 4   | `packages/fuse-ui` and CSS tokens; dice and Fuse Riders both use it (first cut built)             | 2–3 sessions | #255                       |
| 5   | Fuse Riders into `games/fuse-riders`, the service into `service/`, one mechanical PR (built)      | 1 session    | a quiet pull-request queue |

The network packages keep their names, so the rename step of the first draft is gone.

The dice game was planned before the UI package so the contract would be proven early; in the end both landed together, and Pig's page is the first built on `fuse-ui` alone. The folder move is last because it conflicts with every open branch. Extracting packages while the game stayed in `src/` kept each diff small and lets this run alongside epic #259.

## Risks

- **Hidden coupling in `room-runtime.ts`.** It read rider names, avatars, bots, room settings, `game.players` and the phase directly. Step 1 turned each read into a contract member (above).
- **Per-game `rules` in one service.** Rooms of different games never mix, and a game's `rules` is only compared within that game. The "newer or older" message parses the number out of the `rules` string, so every game uses the `<id>-<n>` form.
- **Idle ticks.** Pig runs at the same 50 ms tick as Fuse Riders and sends mostly empty packets. That is cheap on a direct mesh. A slower tick needs the netcode windows to become time-based first.
