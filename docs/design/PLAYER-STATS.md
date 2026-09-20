# Player stats and human Elo

Stacked on #249. The stats dialog puts current Elo and its per-entry Elo graph first, followed by four career totals, results, rivalries, combat and records. Detailed counters are collapsible. The dialog has three tabs, STATS, MATCHES and LEADERBOARD, and the landing page's rating and leaderboard buttons open the matching one. MATCHES lists recent finished games, everyone's by default or only your own, grouped by day; opening one shows the post-match results report (standings, awards, full stats) rebuilt from the stored record. Highlight moments are not stored, so a past match has no replays. STATS' recent-finish chips open the same view. The landing page shows the signed-in rider's rating and global rank; the public leaderboard exposes only rider names, avatars, rounded Elo and rated-result counts, never account IDs.

Elo starts at 1000, K=32. It now settles after each individual round from the frozen, confirmed round standings,
comparing signed-in human finishers only. Guests and bots are removed before pairwise calculations, and a lone signed-in human records a zero-change round. Each round's mean pairwise updates use the pre-round ratings simultaneously. A player
can join between rounds or leave before the game ends without losing completed rounds' ratings. A mid-round departure
is excluded from that round. Settlement waits for all frozen human finishers' reports so delivery ordering does not
exclude a signed-in finisher. A missing report can delay settlement. Late sign-in can complete an unsettled round;
once settled, the field is final. Failed token acquisition or verification must not register a guest round vote.

Round receipts reuse the validated result/storage transaction with an explicit `round` discriminator and `length: 1`.
The dedicated `/round-results` endpoint has bounded round-sized quotas independent of full-game reporting. A claim
scoped to room incarnation, match ID and round prevents duplicate or conflicting results from rating twice.
Round receipts never credit career or rivalry totals and are omitted from the career-history index. Full-game reports
continue to credit those totals once but cannot award Elo. Existing Elo, receipts and graph entries are retained;
UI counts show individual rounds separately from earlier full-game ratings. No historical scores are recalculated.

The deterministic decided-round snapshot freezes standings and connected human participants at the decision tick.
Clients wait until that tick is confirmed before reporting, including when the snapshot has advanced into the next
round. The optional checkpoint addition is validated; old checkpoints without it cannot fabricate a round report.
Deploy updated peers and the service together; old services refuse round reports, and old clients cannot produce
round ratings. Rollback stops new round ratings but must retain stored receipts and current Elo.

Match, career credits, rivalry credits and all rating updates commit atomically. Firestore transactions read every affected profile before writing; concurrent matches retry against fresh ratings. Per-round rating receipts make retries idempotent. Graphs retain the latest 100 rating points in the profile and label that window; durable round records retain individual receipts. Existing matches remain readable without fabricated combat detail or retroactive ratings. Detailed recording begins with the new client. Career views separate human-only, mixed and AI/solo games; combat also separates human and AI targets within mixed games.

Career counters are aggregated once per credited match. Rivalry pairs settle once both identities are known, including late sign-in; opaque pair keys never expose Firebase UIDs. Rivalries live in per-opponent documents updated atomically with the match receipt; the page queries just the top three in each direction. The All time view uses career aggregates; Last 20 uses the newest history page. No full-history download on page open.

This is a community leaderboard using #249's peer attestation trust model. Colluding authenticated players can fabricate results; this change does not claim anti-cheat or make the signalling service simulate gameplay. A rider who departs is left out of the rating rather than scored as a loss, because only a reporting device can name its account; this is not a competitive forfeit system.

The additional deterministic combat counters change checkpoint schemas. Deploy client/service together and refresh peers before new matches; do not mix client versions. Rollback restores the previous client/service together; new richer match records need the new parser to display. No physics, collision ordering, timing or LAN authority changes.

## The public match feed (#328)

`GET /api/matches[?before=<endedAt>]` (game-scoped as `/api/games/<id>/matches`) lists everyone's 20 most recent
confirmed whole games, newest first. It is public like the leaderboard, rate limited to 300 reads per address per
hour, and never carries a room code, an account id or a round receipt; a signed-in caller additionally gets `you`,
their own seat, and nobody else's. Guests appear: a game between guests is public once the riders themselves vouch
for it.

Confirmation stamps a whole game with `feedAt`, and only then. A lone guest confirms their own game against bots and
room tokens are free, so a game is published only once **a second rider attests it or an account owns a seat**; a
round receipt never gets a `feedAt` at all, and the storage parser refuses a record that claims one while pending or
while carrying a round. `feedAt` is stamped from `endedAt`, which is what makes a listed `endedAt` a usable page
cursor; the row itself is always dated by `endedAt`, never by when it became public. Games confirmed before this
existed have no `feedAt` and so are not in EVERYONE; they are still in YOURS.

Two known limits, both accepted:

- **Same-millisecond ties.** Paging is `feedAt < before` at millisecond resolution, so two games stamped in the same
  millisecond exactly on a page boundary can cost one of them its listing. A tie-proof cursor would have to page on
  `(feedAt, document id)` with `startAfter` on `__name__`, which nothing in this repo can exercise against Firestore
  (there is no emulator in CI), so it would ship unverified for a one-pair window on a 20-row boundary. The cursor in
  `packages/fuse-platform/src/history.ts` and both implementations say so. The client drops ids it has already
  listed, so a tie can never duplicate a row, only drop one.
- **Unreadable stored records.** A record that fails to parse makes a page come back short, and the client then stops
  offering OLDER. `/api/me/matches` already behaves this way.

Firestore serves the feed from the `(gameId, feedAt desc)` composite index in `firestore.indexes.json`: every game's
history filters on `gameId`, so the feed is one game's, not the database's.

## Deployment dependency (#261)

Apply the `fuse-production-users` ranked/Elo composite indexes (both directions) and wait until ready before the gateway deploys. `firestore.indexes.json` also exempts large stats/graph maps from indexing. No new service or paid infrastructure is required. The new rating-claims collection and users/rivals subcollections stay behind the existing deny-all browser rules. Infrastructure CD in #261 should apply these declarative changes; this PR does not deploy production infrastructure.
