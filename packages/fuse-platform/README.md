# fuse-platform

The backend every game shares: accounts, match history and its settlement, Elo, ratings and leaderboards. One service
and one Firestore database serve every game; everything a game stores carries its `gameId`. A game supplies a
`GameRegistration` (its stats, totals and rivalries) and the platform does the rest.

```ts
import { createDevRoomService } from "fuse-network-be";
import {
  HistoryStore,
  MemoryHistoryDatabase,
  Platform,
  createHistoryHttp,
} from "fuse-platform";
import { FirestoreHistoryDatabase } from "fuse-platform/firestore"; // Cloud Run
import { newRating, type Rating } from "fuse-platform/rating"; // browser-safe

const platform = new Platform(accountRules, [myGame, otherGame]);
createDevRoomService({
  gameIds: platform.gameIds,
  // The history reads the service's own room store: a report is admitted by its seat in that room.
  httpExtension: (store) =>
    createHistoryHttp(
      new HistoryStore(
        platform,
        new MemoryHistoryDatabase(platform),
        store,
        Date.now,
      ),
      verifier,
    ),
});
```

What the platform owns and keeps the same for every game: a result is kept once a majority of its finishers report
the same one; a round is rated once every player who stayed has reported, and only the signed-in ones on distinct accounts
are rated (guests are left out), once per rating scope; early leavers are never rated; Elo is `calculateElo` over humans only. Rate-limit budgets are per game (the legacy game keeps its keys), except the username's, which is the account's.
What a game owns: the
`PlayerResult` fields it reports beside its own stats (`parseStats`, the storage and wire boundary), which ids are
bots, what a confirmed match adds to an account (`credit`, `addTotals`, `parseTotals`) and, optionally, rivalries.

| Route (`/api/games/:gameId` prefix, or none for `fuse-riders`) |                                                   |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `POST /rooms/:code/results`, `/rooms/:code/round-results`      | a player's report, room token as bearer           |
| `POST /me/round-results`                                       | a signed-in solo round                            |
| `GET /leaderboard`                                             | the game's top 50                                 |
| `GET /me`, `PUT /me`                                           | the account with this game's rating; the username |
| `GET /me/matches?before=`                                      | the account's confirmed matches in this game      |

The account (username, name, avatar) is one per sign-in across every game. Storage: `${prefix}-matches` holds every
game's records (a record without `gameId` is `fuse-riders`), `${prefix}-users` the shared account plus Fuse Riders'
rating and totals as they were before games, and `${prefix}-ratings` every other game's, one document per
`gameId:uid`. The package must not import from `service/` or `games/`; see
[the multi-game design](../../docs/design/multi-game.md).
