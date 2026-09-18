# Several games, one set of libraries

Status: steps 1 and 2 are built: the netcode (`packages/fuse-netcode`) and the backend (`packages/fuse-platform`). The rest is proposed.

Today the repo holds one game, Fuse Riders. Its networking is split into three game-agnostic packages (`packages/fuse-network-fe`, `-be`, `-protocol`), and its rollback netcode into a fourth (`packages/fuse-netcode`). The rest of what a second game would need is still tied to Fuse Riders: the menus and styles, and the account, history and Elo backend. This note sets out the target layout, the contract a game implements and the order of the work. A small dice game proves that the contract really is game-agnostic.

## Decisions

- **One backend for all games.** One Cloud Run room service and one Firestore database. Rooms, match records, ratings and leaderboards carry a `gameId`. An account is shared across games; each game has its own rating. Sharing infrastructure avoids a separate service per game; cost still depends on usage.
- **Libraries stay inside this repo** as npm workspaces. They are not published to npm until a game outside the repo needs them.
- **The template game is a dice game**, described under [The dice game](#the-dice-game).
- **Plain package names.** The three network packages keep their names (renaming them would touch every open branch for no behaviour). New packages are `fuse-netcode`, `fuse-platform` (backend) and `fuse-ui`, each with the same `package.json` shape as the existing ones (private, `type: module`, `"exports": {".": "./src/index.ts"}`). There is no npm scope.

## Target layout

```text
games/
  fuse-riders/        engine/, render/, app/, service entry, tests, golden hashes
  dice/               the template game; copied to start a new game
packages/
  fuse-network-fe/        WebRTC mesh, room client
  fuse-network-be/        room admission (one game per room), signalling
  fuse-network-protocol/  their wire contract, game ids
  fuse-netcode/           input log, lockstep and rollback, snapshot recovery, clock, room runtime (built)
  fuse-ui/                landing, name entry, lobby and QR, dialogs, controller row, neon CSS tokens (first cut built); browser helpers
                          (analytics, safe storage, audio unlock, voice chat) until they need a package of their own
  fuse-platform/          identity, match history and settlement, Elo and ratings, leaderboards, storage adapters (built)
service/                  the one deployed entry: composes fuse-network-be and fuse-platform with every game's registration
```

The folder stays `packages/` because the workspaces already point there. **Names:** the three network packages keep their names, because renaming them touches every open branch for no change in behaviour. New packages take plain names (`fuse-netcode`, `fuse-platform`, `fuse-ui`) and the same `package.json` shape as the existing ones: private, `type: module`, `"exports": {".": "./src/index.ts"}` plus any subpath a browser or an optional peer needs. Packages must not import `src/` or `games/`. A game may import any package. Games must not import one another.

## The game contract

The boundary sits at the room's tick (`applyTick`), not the game's (`step`). A game owns its whole room state: the game, held controls (`folds`), bots and settings. Two reasons: permission to issue a management entry depends on game state (who is connected), and folds are part of the hashed state. `packages/fuse-netcode` owns everything around that: streams and their ordering, clocks, rollback, event deduplication, snapshot transfer, the hash schedule and the room runtime.

This is the contract as built (`packages/fuse-netcode/src/game.ts`). Each member replaces something `src/online/` used to read from Fuse Riders' engine; `src/online/fuse-game.ts` is Fuse Riders' implementation.

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

The room runtime is `RoomRuntime` in the package. A game subclasses it for its own controls, as Fuse Riders does for steering and the bomb gesture (`src/online/room-runtime.ts`): the subclass logs entries with `append`, releases held controls in `releaseControls` when the page is hidden, and resets them in `resetControls` and `absentControls`. `frameTiming()` gives the two newest frames, the fractional tick and the lead; Fuse Riders adds its held steer in `presentation()`.

**Management entries are generic in the package; applying them stays with the game.** Join, leave, presence, settings, start/rematch/lobby, bots and spectators (kinds 10–16) have one wire format (`management.ts`). The runtime logs them, reads them for the stall rule and seat claims, and runs host succession and presence duties over `members`, `successionOrder`, `actingCreator` and `permitted`. Fuse Riders' engine keeps its own reducer for them, because `src/engine/` cannot import a package and moving its reducer would change the hashed state; `tests/fuse-netcode-management.test.ts` checks that the engine and the package accept the same entries and grant the same permissions. A new game applies them with `applyManagementTick` over a `ManagedRoom` (seats, settings) and lifecycle hooks, with Fuse Riders' semantics: a departure frees a seat when seats are reclaimable and holds it otherwise; start runs from the lobby; rematch from a finished match; both drop absent seats first when seats are reclaimable; watchers hold no seat, rank last in succession and are never waited on.

The netcode keeps what `src/online/` already owned and must not lose: entry tick and sequence, member generation and retired streams, gaps and repair, bounded history, rollback within its bound, snapshot transfer validated at the boundary and installed atomically, the stall rule and the desync hash ([ADR 047](../adr/047-p2p-input-log-lockstep-rollback.md)). Its windows (`ROLLBACK_TICKS`, `STALL_TICKS`, `FUTURE_TICKS`) stay counted in 50 ms ticks, so every game uses a fixed 50 ms log clock. Game speed belongs inside the game's fold, which may run multiple simulation steps per log tick; it must not change the netcode clock rate (see [the fixed-clock design](fixed-clock-game-speed.md)).

The extraction is `[hash-identical]`: `RULES` did not move, `tests/golden-hash.test.ts` passes on main's recording, and the packet and snapshot bytes are the same as before for the same world, so a peer on this build and one on the previous build with the same `RULES` share a room. The snapshot message is still `[rules, room, tick, game, settings, folds, bots, streams, hash, spectators]`: the package writes `[rules, room, tick, ...leading fields, streams, hash, ...trailing fields]`.

## Backend

Built in `packages/fuse-platform` ([README](../../packages/fuse-platform/README.md)); `src/service/history.ts` is Fuse Riders' registration and the service's `Platform`.

- **What the platform owns, the same for every game.** Pending results and attestation by a majority of finishers, settlement, early exits, rating scope and claims, per-round Elo (`calculateElo` over humans, with the game's bot rule), leaderboards and rank, match history, identity (Firebase ID tokens), the history routes and the memory and Firestore adapters. These rules moved unchanged, except that the bot rule is now the game's `isBot`. Rate-limit budgets are per game; Fuse Riders keeps its keys, and the username's budget is the account's.
- **What a game registers.** A `GameRegistration` has `id`, `isBot`, `parseStats(raw, rounds)` (the wire and storage boundary for one player, rebuilt in a fixed key order so equal results hash equally), optional `validField` (checks across players, such as kills naming riders of the match), `emptyTotals`, `credit` and `addTotals` (what a confirmed whole match adds to an account), `parseTotals` (the storage boundary for those totals) and optional `rivals`. The platform reads eight fields of every player itself: `playerId`, `name`, `slot`, `roundsPlayed`, `roundWins`, `matchScoreUnits`, `matchPlacement` and `earlyExits`; everything else is the game's. It re-checks those fields whatever the game's parser accepts.
- **The account is shared.** Username, rider name and avatar live on the user document for every game. The name and avatar rules are the platform's `AccountRules`; today they are Fuse Riders' rider-name rule and avatars, because the account predates games.
- **Fuse Riders is the legacy game** (`LEGACY_GAME_ID`). What an absent `gameId` means everywhere; its rating (`rating`, `ranked`, `elo`), totals, career and `rivals` stay on the user document and its leaderboard query is unchanged, so nothing live changes. Every other game stores its standing in `${prefix}-ratings`, one document per `gameId:uid` (`gameId`, `uid`, `rating`, `ranked`, `elo` and the game's totals spread beside them; totals may not use those names), with its own `rivals` subcollection, and ranks by the composite index `(gameId, ranked, elo)`. The memory adapter mirrors this: one account record, one standing per `gameId:uid`. Moving Fuse Riders' fields into `${prefix}-ratings` is a later migration, not part of this step.
- **Match records carry `gameId`.** New records of every game have it; a stored record without one is Fuse Riders', with no backfill, and a record naming an unregistered game does not parse. Other games' history queries filter on `gameId` (index `(gameId, participantUids, endedAt desc)`); Fuse Riders' query cannot match a missing field, so it reads every game's page and keeps its own, reading up to five pages to fill one. An account with many newer matches of other games can therefore get a short Fuse Riders page, which the client reads as the end of its history: backfill `gameId` onto Fuse Riders' old records before the dice game (step 3) ships, then filter like any other game. Solo rounds of other games use the incarnation `solo:<gameId>:<uid>`, so their record ids and rating scopes never meet Fuse Riders' `solo:<uid>`.
- **Routes.** The existing `/api/...` history routes are Fuse Riders'. `/api/games/<gameId>/...` addresses any registered game with the same routes. `/api/me` and its `PUT` (the username) are the shared account under either form; the profile it returns carries that game's rating and totals. An unregistered `gameId` is `404 Unknown game`.
- **Rooms carry `gameId`** (`fuse-network-be`, `fuse-network-protocol`). Creation takes `?gameId=`, the room stores it, and a socket whose `auth` frame names another game is closed as a missing room; a history report for a room of another game is refused the same way. The service is configured with the registered ids and refuses others. Room codes stay one namespace, so a code never means two games at once. Absent means `fuse-riders` in both directions, so clients and services from before games keep working ([protocol](../online/PROTOCOL.md#games-on-one-room-service-gameid)).

## Menus and styles

`packages/fuse-ui` owns the screens every game has: landing, join form, avatar, lobby with a QR code, room settings dialog shell, account panel, recap frame, status notices, the neon/pixel tokens (colours, font, z-index scale) and the shared-screen/phone-controller layout switch. A game supplies its settings fields, its arena view and its recap content. The first cut is built; see [its README](../../packages/fuse-ui/README.md).

- **Tokens.** `tokens.css` defines the neon palette, the Press Start 2P stack, spacing, borders and glow, and a named z-index scale as `--fui-*` custom properties. The values are the ones Fuse Riders already drew. Fuse imports the file first (`src/client/main.ts`); its own `--cyan`, `--ui-*` names are now aliases of the tokens, and its stylesheets read the tokens wherever the value was identical. Before and after screenshots of the landing, the settings dialog and the lobby match pixel for pixel.
- **DOM.** One element factory, `el(tag, text, className, document?)`, replaces the eight local copies #255 found; text goes in through `textContent` only. `copyText` and `closeOnBackdrop` moved in with it.
- **Components.** Small functions that return elements: `createLandingCard` (title, CREATE ROOM, join by code, SOLO), `createJoinByCode`, `createLobby` (invite card with QR, code and COPY LINK; roster with name, avatar, status and HOST; START for whoever may start), `createInviteCard`, `createRoster`, `createNameEntry`, `createNotice` (status line or toast), `createDialog` (title bar, CLOSE, body) and `createControllerRow` (big touch buttons). Each takes an optional `document`, so the package tests run on `linkedom`. Default classes are `fui-*`, styled by `components.css`; a `classes` option renames any part, which is how Fuse keeps its own class names and stylesheet.
- **What Fuse Riders uses.** The factory everywhere, the join-by-code row on its landing page, both dialogs (landing SETTINGS and the in-room menu), the lobby invite card and rider list, and the controller row. Its landing page, lobby shell (copy, footer, host actions), join form (avatar picker, account name), standings and status line stay in `src/online/ui.ts`.

Still to do: move Fuse's copies of the component rules from `online.css` into `components.css` so both games load one stylesheet; adopt `createNameEntry` in `join-form.ts` once the avatar picker is a slot; the account panel, recap frame and room settings shell; and the shared-screen/phone layout switch (`room-screen.ts`, `mobile-play-layout.css`).

## The dice game

The dice game is **Pig**, for 2–5 players plus bots, first to 50. On your turn you roll a d6 as often as you like, adding each roll to the turn's total. Rolling a 1 loses the turn's total and passes the turn. **Hold** banks the total and passes the turn. One race to 50 is one round, and the first player to win two rounds wins the match, so ratings settle per round as they do for Fuse Riders.

It is small on purpose. It proves the parts of the contract Fuse Riders never exercises:

- **Turn-based play on a tick log.** Entries are `roll` and `hold`. `applyTick` ignores entries from anyone whose turn it is not. A turn timer, counted in ticks, auto-holds so one idle player cannot stall the room.
- **Rollback of discrete outcomes.** A `hold` that arrives late but was stamped before the timer ran out undoes a speculative auto-hold and the next player's roll. The dice UI renders from `view`, not from a stream of events, so the corrected roll shows. Any event it does use must not be deduplicated away when rollback changes its content. This is the case the template exists to test.
- **Shared randomness.** Dice come from the seeded RNG in the room state, so every replica rolls the same number. That also means any member can compute upcoming rolls. This fits the trust model (every member is trusted with the shared log), and the template documents it.
- **The whole stack.** Solo against bots, an online room, shared screen with the TV at `?room=CODE&display=1` and phones as roll/hold buttons, a refreshed device recovering from a peer, and rated rounds.

It renders with DOM and CSS from `packages/fuse-ui`, not Phaser, which shows a game can skip Phaser entirely. `scripts/new-game.ts <id>` copies `games/dice` to start a new game.

## Order of work

| #   | Step                                                                                              | Size         | Depends on                 |
| --- | ------------------------------------------------------------------------------------------------- | ------------ | -------------------------- |
| 1   | `packages/fuse-netcode` behind `RollbackGame`, hash-identical (built)                             | 2–3 sessions | —                          |
| 2   | `packages/fuse-platform`: history and Elo keyed by `gameId`; Fuse Riders stats registered (built) | 2 sessions   | —                          |
| 3   | `games/dice` against netcode and backend, with a minimal UI                                       | 1–2 sessions | 1, 2                       |
| 4   | `packages/fuse-ui` and CSS tokens; dice and Fuse Riders both use it (first cut built)             | 2–3 sessions | #255                       |
| 5   | `git mv src games/fuse-riders`, one mechanical PR                                                 | 1 session    | a quiet pull-request queue |

The network packages keep their names, so the rename step of the first draft is gone.

The dice game comes before the UI package so the contract is proven early, with a plain UI for now. The folder move is last because it conflicts with every open branch. Extracting packages while the game stays in `src/` keeps each diff small and lets this run alongside epic #259.

## Risks

- **Hidden coupling in `room-runtime.ts`.** It read rider names, avatars, bots, room settings, `game.players` and the phase directly. Step 1 turned each read into a contract member (above).
- **Per-game `rules` in one service.** Rooms of different games never mix, and a game's `rules` is only compared within that game. The "newer or older" message parses the number out of the `rules` string, so every game uses the `<id>-<n>` form.
- **Idle ticks.** Pig runs at the same 50 ms tick as Fuse Riders and sends mostly empty packets. That is cheap on a direct mesh. A slower tick needs the netcode windows to become time-based first.
