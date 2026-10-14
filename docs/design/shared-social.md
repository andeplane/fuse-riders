# One account and friend graph across games

Every game uses the same lazy Firebase browser adapter, existing Firebase app, username cache,
friends poller and dialogs from `fuse-ui`. Existing sign-in/cache keys are retained so current
players keep their session. The account and friendships remain global; match history and ratings
use each game's `/api/games/:gameId` routes on the same configured API origin.

Room presence is reported only after transport admission and cleared when that transport closes.
Invites carry both game ID and room code, and navigate to the destination game under the site base.
No account credentials cross the gameplay mesh. Result requests attach identity only in the HTTP
header alongside the existing room capability.

The shared account dialog provides common history and leaderboard views; Riders retains its richer
game-specific statistics inside that same dialog. Shared UI renders names as text and never sends
another game's cosmetic avatar IDs to the account backend. The dice template inherits this setup.

There is no new service, push subscription or gameplay relay. Existing polling cadence and backend
deployment game registration remain in effect.
