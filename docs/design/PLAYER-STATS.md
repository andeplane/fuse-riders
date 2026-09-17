# Player stats and human Elo

Stacked on #249. The stats dialog puts current Elo and its dated graph first, followed by four career totals, results, rivalries, combat and records. Detailed counters and match rosters are collapsible. The landing page shows the signed-in rider's rating and global rank; the public leaderboard exposes only rider names, avatars, rounded Elo and rated-match counts, never account IDs.

Elo starts at 1000, K=32. Each human is compared with each other human by match score and round wins; equal scores/wins are ties. Average pairwise updates use all pre-match ratings simultaneously. Bots are excluded completely. A match rates once every human participant has reported and linked a distinct account, completed every round and stayed to the finish. Incomplete, guest and AI-only games remain career history without Elo. Late verified reports can complete eligibility. Ratings settle in transaction order, with a server settlement timestamp, not a claimed client time. A separate room-incarnation/match-id claim prevents conflicting result variants from rating twice.

Match, career credits, rivalry credits and all rating updates commit atomically. Firestore transactions read every affected profile before writing; concurrent matches retry against fresh ratings. Per-match rating receipts make retries idempotent. Graphs retain the latest 100 rating points in the profile and label that window; match history retains individual receipts. Existing matches remain readable without fabricated combat detail or retroactive ratings. Detailed recording begins with the new client. Career views separate human-only, mixed and AI/solo games; combat also separates human and AI targets within mixed games.

Career counters are aggregated once per credited match. Rivalry pairs settle once both identities are known, including late sign-in; opaque pair keys never expose Firebase UIDs. Rivalries live in per-opponent documents updated atomically with the match receipt; the page queries just the top three in each direction. The All time view uses career aggregates; Last 20 uses the newest history page. No full-history download on page open.

This is a community leaderboard using #249's peer attestation trust model. Colluding authenticated players can fabricate results; this change does not claim anti-cheat or make the signalling service simulate gameplay. Ranked eligibility deliberately excludes matches with departures; this is not a competitive forfeit system.

The additional deterministic combat counters change checkpoint schemas. Deploy client/service together and refresh peers before new matches; do not mix client versions. Rollback restores the previous client/service together; new richer match records need the new parser to display. No physics, collision ordering, timing or LAN authority changes.

## Deployment dependency (#261)

Apply the `fuse-production-users` ranked/Elo composite indexes (both directions) and wait until ready before the gateway deploys. `firestore.indexes.json` also exempts large stats/graph maps from indexing. No new service or paid infrastructure is required. The new rating-claims collection and users/rivals subcollections stay behind the existing deny-all browser rules. Infrastructure CD in #261 should apply these declarative changes; this PR does not deploy production infrastructure.
