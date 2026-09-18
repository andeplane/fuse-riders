# Several games, one set of libraries

Status: proposed. The backend (step 3, `packages/fuse-platform`) is built; the rest is not.

Today the repo holds one game, Fuse Riders. Its networking is already split into three game-agnostic packages (`packages/fuse-network-fe`, `-be`, `-protocol`). The rest of what a second game would need is still tied to Fuse Riders: the rollback netcode, the menus and styles, and the account, history and Elo backend. This note sets out the target layout, the contract a game implements and the order of the work. A small dice game proves that the contract really is game-agnostic.

## Decisions

- **One backend for all games.** One Cloud Run room service and one Firestore database. Rooms, match records, ratings and leaderboards carry a `gameId`. An account is shared across games; each game has its own rating. Sharing infrastructure avoids a separate service per game; cost still depends on usage.
- **Libraries stay inside this repo** as npm workspaces. They are not published to npm until a game outside the repo needs them.
- **The template game is a dice game**, described under [The dice game](#the-dice-game).

## Target layout

```text
games/
  fuse-riders/        engine/, render/, app/, service entry, tests, golden hashes
  dice/               the template game; copied to start a new game
packages/
  fuse-network-fe/        WebRTC mesh, room client
  fuse-network-be/        room admission (one game per room), signalling
  fuse-network-protocol/  their wire contract, game ids
  fuse-netcode/           input log, lockstep and rollback, snapshot recovery, clock
  fuse-ui/                landing, join form, lobby and QR, dialogs, settings shell, neon CSS tokens
  fuse-platform/          identity, match history and settlement, Elo and ratings, leaderboards, storage adapters
  platform-web/           analytics, safe storage, audio unlock, voice chat (not scheduled; named when it is)
service/                the one deployed entry: composes fuse-network-be and fuse-platform with every game's registration
```

The folder stays `packages/` because the workspaces already point there. **Names:** the three network packages keep their names, because renaming them touches every open branch for no change in behaviour. New packages take plain names (`fuse-netcode`, `fuse-platform`, `fuse-ui`) and the same `package.json` shape as the existing ones: private, `type: module`, `"exports": {".": "./src/index.ts"}` plus any subpath a browser or an optional peer needs. Packages must not import `games/`. A game may import any package. Games must not import one another.

## The game contract

The boundary sits at the room's tick (`applyTick`), not the game's (`step`). A game owns its whole room state: the game, held controls (`folds`), bots and settings. Two reasons: permission to issue a management entry depends on game state (`successionOrder` and `permitted` in `src/engine/apply-tick.ts` read `game.players[].connected`), and folds are part of the hashed state. `packages/fuse-netcode` owns everything around that: streams and their ordering, clocks, rollback, event deduplication, snapshot transfer and the hash schedule.

```ts
interface RollbackGame<Room, Entry, View, Event> {
  id: string; // "fuse-riders", "dice"; the gameId everywhere
  rules: string; // the game's RULES identifier; peers on different rules refuse each other
  // Entries: the netcode's envelope carries tick, sequence and generation; the game owns the payload.
  parseEntry(raw: unknown): Entry | undefined; // the wire boundary (today isEntry)
  follows?(previous: Entry | undefined, next: Entry): boolean; // stream order rule (today PRESS order in StreamLog)
  createRoom(matchId: string, settings: unknown): Room; // seats arrive later as JOIN entries
  applyTick(
    room: Room,
    creatorId: string,
    streams: ReadonlyMap<string, StreamEntries<Entry>>,
    bots: Bots<Room, Entry>,
  ): Event[]; // applies permitted management, folds entries and bots, drives the game
  scope(room: Room): { matchId: string; round: number }; // event dedupe and stale-message fencing
  members(room: Room): readonly MemberView[]; // what the runtime reads today from game.players and phase
  view(room: Room): View; // today toView
  predict?(view: View, local: string, pending: readonly Entry[]): View; // optional game-specific prediction; presentation currently lives in render/time/present.ts
  checkpoint: {
    encode(room: Room): unknown; // folds, bots, settings and game, as snapshot.ts sends them
    decode(raw: unknown): Room | undefined; // validated, never partial
  };
  hash(room: Room): string; // today 16 hex characters
  createBots(): Bots<Room, Entry>; // stateful, like BotController; emits ordinary entries
  result(room: Room): MatchResult | undefined;
}
```

Management entries (join with name, slot and avatar; leave; settings; start; rematch with a new match id) keep one generic envelope in the netcode, so every game gets rooms, seats and rematch for free. The game applies them, because only the game knows who may issue one. The netcode keeps what `src/online/` already owns and must not lose: entry tick and sequence, member generation and retired streams, gaps and repair, bounded history, rollback within its bound, snapshot transfer validated at the boundary and installed atomically, the stall rule and the desync hash ([ADR 047](../adr/047-p2p-input-log-lockstep-rollback.md)). Its windows (`ROLLBACK_TICKS`, `STALL_TICKS`, `FUTURE_TICKS`) stay counted in 50 ms ticks, so every game uses a fixed 50 ms log clock. Game speed belongs inside `applyTick`, which may run multiple simulation steps per log tick; it must not change the netcode clock rate (see [the fixed-clock design](fixed-clock-game-speed.md)).

Extracting Fuse Riders behind the contract must be `[hash-identical]`: `RULES` does not move and `tests/golden-hash.test.ts` passes on main's recording. The interface above is a first cut; step 2 will find what else the runtime reads, and the interface follows the code, not the other way round.

## Backend

Built in `packages/fuse-platform` ([README](../../packages/fuse-platform/README.md)); `src/service/history.ts` is Fuse Riders' registration and the service's `Platform`.

- **What the platform owns, the same for every game.** Pending results and attestation by a majority of finishers, settlement, early exits, rating scope and claims, per-round Elo (`calculateElo` over humans, with the game's bot rule), leaderboards and rank, match history, identity (Firebase ID tokens), the history routes and the memory and Firestore adapters. These rules moved unchanged.
- **What a game registers.** A `GameRegistration` has `id`, `isBot`, `parseStats(raw, rounds)` (the wire and storage boundary for one player, rebuilt in a fixed key order so equal results hash equally), optional `validField` (checks across players, such as kills naming riders of the match), `emptyTotals`, `credit` and `addTotals` (what a confirmed whole match adds to an account), `parseTotals` (the storage boundary for those totals) and optional `rivals`. The platform reads eight fields of every player itself: `playerId`, `name`, `slot`, `roundsPlayed`, `roundWins`, `matchScoreUnits`, `matchPlacement` and `earlyExits`; everything else is the game's. It re-checks those fields whatever the game's parser accepts.
- **The account is shared.** Username, rider name and avatar live on the user document for every game. The name and avatar rules are the platform's `AccountRules`; today they are Fuse Riders' rider-name rule and avatars, because the account predates games.
- **Fuse Riders is the legacy game** (`LEGACY_GAME_ID`). What an absent `gameId` means everywhere; its rating (`rating`, `ranked`, `elo`), totals, career and `rivals` stay on the user document and its leaderboard query is unchanged, so nothing live changes. Every other game stores its standing in `${prefix}-ratings`, one document per `gameId:uid` (`gameId`, `uid`, `rating`, `ranked`, `elo` and the game's totals spread beside them; totals may not use those names), with its own `rivals` subcollection, and ranks by the composite index `(gameId, ranked, elo)`. The memory adapter mirrors this: one account record, one standing per `gameId:uid`. Moving Fuse Riders' fields into `${prefix}-ratings` is a later migration, not part of this step.
- **Match records carry `gameId`.** New records of every game have it; a stored record without one is Fuse Riders', with no backfill, and a record naming an unregistered game does not parse. Other games' history queries filter on `gameId` (index `(gameId, participantUids, endedAt desc)`); Fuse Riders' query cannot match a missing field, so it reads every game's page and keeps its own, reading up to five pages to fill one. Solo rounds of other games use the incarnation `solo:<gameId>:<uid>`, so their record ids and rating scopes never meet Fuse Riders' `solo:<uid>`.
- **Routes.** The existing `/api/...` history routes are Fuse Riders'. `/api/games/<gameId>/...` addresses any registered game with the same routes. `/api/me` and its `PUT` (the username) are the shared account under either form; the profile it returns carries that game's rating and totals. An unregistered `gameId` is `404 Unknown game`.
- **Rooms carry `gameId`** (`fuse-network-be`, `fuse-network-protocol`). Creation takes `?gameId=`, the room stores it, and a socket whose `auth` frame names another game is closed as a missing room; a history report for a room of another game is refused the same way. The service is configured with the registered ids and refuses others. Room codes stay one namespace, so a code never means two games at once. Absent means `fuse-riders` in both directions, so clients and services from before games keep working ([protocol](../online/PROTOCOL.md#games-on-one-room-service-gameid)).

## Menus and styles

`packages/fuse-ui` owns the screens every game has: landing, join form, avatar, lobby with a QR code, room settings dialog shell, account panel, recap frame, status notices, the neon/pixel tokens (colours, font, z-index scale) and the shared-screen/phone-controller layout switch. A game supplies its settings fields, its arena view and its recap content.

The prerequisite from #255 landed in #350: `RoomScreen` and the room presenter now make screen state explicit. Extract the shared UI from those boundaries; the remaining `src/online/ui.ts` wiring and CSS still need to be separated from arena-specific behavior.

## The dice game

The dice game is **Pig**, for 2–5 players plus bots, first to 50. On your turn you roll a d6 as often as you like, adding each roll to the turn's total. Rolling a 1 loses the turn's total and passes the turn. **Hold** banks the total and passes the turn. One race to 50 is one round, and the first player to win two rounds wins the match, so ratings settle per round as they do for Fuse Riders.

It is small on purpose. It proves the parts of the contract Fuse Riders never exercises:

- **Turn-based play on a tick log.** Entries are `roll` and `hold`. `applyTick` ignores entries from anyone whose turn it is not. A turn timer, counted in ticks, auto-holds so one idle player cannot stall the room.
- **Rollback of discrete outcomes.** A `hold` that arrives late but was stamped before the timer ran out undoes a speculative auto-hold and the next player's roll. The dice UI renders from `view`, not from a stream of events, so the corrected roll shows. Any event it does use must not be deduplicated away when rollback changes its content. This is the case the template exists to test.
- **Shared randomness.** Dice come from the seeded RNG in the room state, so every replica rolls the same number. That also means any member can compute upcoming rolls. This fits the trust model (every member is trusted with the shared log), and the template documents it.
- **The whole stack.** Solo against bots, an online room, shared screen with the TV at `?room=CODE&display=1` and phones as roll/hold buttons, a refreshed device recovering from a peer, and rated rounds.

It renders with DOM and CSS from `packages/fuse-ui`, not Phaser, which shows a game can skip Phaser entirely. `scripts/new-game.ts <id>` copies `games/dice` to start a new game.

## Order of work

| #   | Step                                                                                                  | Size         | Depends on                   |
| --- | ----------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| 1   | ~~Rename and scope the three network packages~~ dropped: they keep their names (see **Names** above)  | —            | —                            |
| 2   | `packages/fuse-netcode` behind `RollbackGame`, hash-identical                                         | 2–3 sessions | #254 view contract (PR #332) |
| 3   | `packages/fuse-platform`: history and Elo keyed by `gameId`; Fuse Riders stats registered. **Built.** | 2 sessions   | —                            |
| 4   | `games/dice` against netcode and backend, with a minimal UI                                           | 1–2 sessions | 2, 3                         |
| 5   | `packages/fuse-ui` and CSS tokens; dice and Fuse Riders both use it                                   | 2–3 sessions | #255                         |
| 6   | `git mv src games/fuse-riders`, one mechanical PR                                                     | 1 session    | a quiet pull-request queue   |

The dice game comes before the UI package so the contract is proven early, with a plain UI for now. The folder move is last because it conflicts with every open branch. Extracting packages while the game stays in `src/` keeps each diff small and lets this run alongside epic #259.

## Risks

- **Hidden coupling in `room-runtime.ts`.** It reads rider names, avatars, bots, room settings, `game.players` and the phase directly. Each read becomes either a contract method or a generic management entry. Step 2 is where this shows up, and it is why step 2 is sized larger.
- **Per-game `rules` in one service.** Rooms of different games never mix, and a game's `rules` is only compared within that game. The "newer or older" message parses the number out of the `rules` string, so every game uses the `<id>-<n>` form.
- **Idle ticks.** Pig runs at the same 50 ms tick as Fuse Riders and sends mostly empty packets. That is cheap on a direct mesh. A slower tick needs the netcode windows to become time-based first.
