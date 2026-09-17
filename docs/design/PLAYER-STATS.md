# Player stats and human Elo

Stacked on #249. The stats dialog puts current Elo and its dated graph first, followed by four career totals, results, rivalries, combat and records. Detailed counters and match rosters are collapsible. The landing page shows the signed-in rider's rating and global rank; the public leaderboard exposes only rider names, avatars, rounded Elo and rated-result counts, never account IDs.

Elo starts at 1000, K=32. It now settles after each individual round from the frozen, confirmed round standings,
comparing signed-in human finishers only. Guests and bots are removed before pairwise calculations, and at least two
distinct accounts are needed. Each round's mean pairwise updates use the pre-round ratings simultaneously. A player
can join between rounds or leave before the game ends without losing completed rounds' ratings. A mid-round departure
is excluded from that round. Settlement waits for all frozen human finishers' reports so delivery ordering does not
exclude a signed-in finisher. A missing report can delay settlement. Late sign-in can complete an unsettled round;
once settled, the field is final. Failed token acquisition or verification must not register a guest round vote.

Round receipts reuse the validated result/storage transaction with an explicit `round` discriminator and `length: 1`.
The dedicated `/round-results` endpoint has bounded round-sized quotas independent of full-game reporting. A claim
scoped to room incarnation, match ID and round prevents duplicate or conflicting results from rating twice.
Round receipts never credit career or rivalry totals and are omitted from the career-history index. Full-game reports
continue to credit those totals once but cannot award Elo. Existing Elo, receipts and graph entries are retained;
UI counts say rated results because old entries represent whole games. No historical scores are recalculated.

The deterministic decided-round snapshot freezes standings and connected human participants at the decision tick.
Clients wait until that tick is confirmed before reporting, including when the snapshot has advanced into the next
round. The optional checkpoint addition is validated; old checkpoints without it cannot fabricate a round report.
Deploy updated peers and the service together; old services refuse round reports, and old clients cannot produce
round ratings. Rollback stops new round ratings but must retain stored receipts and current Elo.

Match, career credits, rivalry credits and all rating updates commit atomically. Firestore transactions read every affected profile before writing; concurrent matches retry against fresh ratings. Per-round rating receipts make retries idempotent. Graphs retain the latest 100 rating points in the profile and label that window; durable round records retain individual receipts. Existing matches remain readable without fabricated combat detail or retroactive ratings. Detailed recording begins with the new client. Career views separate human-only, mixed and AI/solo games; combat also separates human and AI targets within mixed games.

Career counters are aggregated once per credited match. Rivalry pairs settle once both identities are known, including late sign-in; opaque pair keys never expose Firebase UIDs. Rivalries live in per-opponent documents updated atomically with the match receipt; the page queries just the top three in each direction. The All time view uses career aggregates; Last 20 uses the newest history page. No full-history download on page open.

This is a community leaderboard using #249's peer attestation trust model. Colluding authenticated players can fabricate results; this change does not claim anti-cheat or make the signalling service simulate gameplay. A rider who departs is left out of the rating rather than scored as a loss, because only a reporting device can name its account; this is not a competitive forfeit system.

The additional deterministic combat counters change checkpoint schemas. Deploy client/service together and refresh peers before new matches; do not mix client versions. Rollback restores the previous client/service together; new richer match records need the new parser to display. No physics, collision ordering, timing or LAN authority changes.

## Deployment dependency (#261)

Apply the `fuse-production-users` ranked/Elo composite indexes (both directions) and wait until ready before the gateway deploys. `firestore.indexes.json` also exempts large stats/graph maps from indexing. No new service or paid infrastructure is required. The new rating-claims collection and users/rivals subcollections stay behind the existing deny-all browser rules. Infrastructure CD in #261 should apply these declarative changes; this PR does not deploy production infrastructure.
