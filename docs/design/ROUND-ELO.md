# Individual-round Elo

Continue the unfinished guest/partial-participation fix by changing the settlement unit to an individual round.
Use the existing peer-confirmed decided-round state to freeze the standings and finishers, and send only after its
tick is confirmed. Guest and AI standings are removed before Elo comparisons. Participation in other rounds is
irrelevant. Mid-round leavers do not rate, matching the existing account-binding constraint.

Keep career accounting on the full-game recap. Round receipts reuse the existing atomic history transaction,
with a validated round discriminator, their own endpoint/quotas and a room/match/round claim. They do not enter the
career history index or increment career/rivalry totals. Full-game reports cease rating, so the final round cannot
rate twice. Preserve existing Elo and graph points; show individual-round counts separately from earlier full-game rating counts.

Tradeoffs: one durable receipt and claim per rated round increases writes compared with one per game. Quotas remain
bounded and no gameplay relay or running simulation service is added. Settlement waits for frozen human finishers
to report so a slower signed-in reporter is not silently omitted; missing reports still prevent settlement. Reports
are best effort with three bounded attempts, and the retained decision only covers the latest finished round.
No retroactive catch-up for every round missed while a device is disconnected is promised. Existing peer attestation
is community trust, not anti-cheat. Service and client rollout must be coordinated; deployment is a separate action.

Signed-in solo play posts to `/api/me/round-results` without creating a room or transport. The authenticated endpoint
accepts exactly one human plus optional bots, binds the report to the caller's account, and scopes idempotency by
account/match/round. It can record participation but never change Elo. Guests playing solo send no report.
Rating profiles retain total settlement count in `games`, separate new round count in `rounds`, and optional `round`
and signed-in `opponents` per graph point; missing metadata identifies earlier full-game ratings. History and career
totals continue to mean full games. The leaderboard displays rounds, including zero-change rounds.
