# Independent final network review

Reviewed 2026-09-14: liveness correction `fba7114`, immutable keyframe receipts `2df3a3b`, direct-only action amendment `0468050` and shot feedback `850d53f`. This is a bounded implementation review, not a declaration that deployed browsers or poor-network acceptance have passed.

## Disposition

The direct-only design does not require restoring gameplay over WSS, seamless host migration or a second terminal fire protocol. Those are explicitly outside the accepted scope. The current implementation can safely cancel a shot during interruption, provided it never claims enqueue equals execution and provides the documented failure/retry feedback. Fifteen focused keyframe, liveness and fire tests passed during this independent review.

No new keyframe safety blocker was found. One concrete RTC callback-lifetime defect was identified and a narrow correction prepared with three additional typed regressions; root independently reviewed and approved that implementation before its scoped commit. Browser outage recovery/freshness and exact-revision CI remain release gates, including the previously recorded failures. Do not replace those failures with the unit-test result.

## Keyframe receipt findings

`KeyframeDelivery` retains one cloned full world envelope per peer, including the matching settings, receive acknowledgement and applied-motion ledger. Attempts are at least 500 ms apart and the retained baseline expires after five seconds. A successful send still waits for an exact generation/stream/sequence/match/round receipt. The runtime does not encode dependent deltas while that baseline is pending, and repeated resync requests do not replace it continuously.

After receipt loss, `AcceptedKeyframe` acknowledges only an identical envelope that was already accepted; it does not reapply the older state. A mismatched payload with matching receipt fields cannot get this shortcut. Five-second expiry or lifecycle scope replacement discards the pending baseline and allocates a newer encoder generation. Old receipts cannot clear that new baseline. Decoder monotonic-tick/generation checks still apply to ordinary frames. Authority/service-connection fencing lives outside these receipt fields in `PeerTransport` and must remain intact.

Operational limits: the retry window is a maximum retained baseline age, not permission to miss the two-second browser recovery goal. Old clients without `worldReceipt` support will not progress to dependent deltas; reload all preview tabs for this protocol-compatible-code change. Public source metadata and actual client bundles must be checked together. The current tests exercise helper/codec boundaries; real-browser evidence must verify their runtime integration.

## Liveness finding and correction

Removing the old relay dwell is appropriate when there is no gameplay relay. Two recent actual probe acknowledgements permit sending; after 600 ms without fresh acknowledgements sending stops. Eight continuously unhealthy seconds triggers forced RTC recreation, so a short blackout can recover on its existing channel. These bounds are distinct from the application snapshot freshness/recovery budgets.

**Found: retired RTC callbacks could affect a replacement link with the same service identity.** `PeerTransport.channel` originally closed over the peer ID and resolved `this.links.get(id)` when a callback eventually ran. A recreated `LinkHealth` starts probe IDs at 1 again. Queued old-channel pongs could therefore match outstanding probes on the new link, and a queued old `ondatachannel` callback could overwrite its channel. Existing authority/connection fields do not distinguish this case because RTC recreation can preserve the service connection ID.

The narrow correction checks current link object identity for peer-connection callbacks and both current link and channel identity for channel callbacks. Retired incoming data channels close themselves. Async SDP completion also verifies its captured link before publishing. Error events are still prevented even on retired channels. New tests reproduce reused probe IDs against delayed old pongs, channel replacement within one link and a stale datachannel event. Together with the four liveness tests, all seven passed; typecheck passed. These regression tests prove the ownership predicate and traced callback scenario, not every browser's native event ordering. The old public WebKit RTC-send page error needs a fresh deployed retest; this correction is not evidence that its unrecorded stack had this cause.

## Direct-only fire scope

The reviewed fire semantics are deliberately best effort with safe cancellation: one ordered/reliable RTC carrier; host-scoped sequence/tick admission; independent ordering of same-step fire edges; duplicate suppression; host-observed charge; ten-tick neutralization; and no replay of old fire edges after interruption. Four controller-to-host boundary tests cover dropped press, dropped release, continued steering after dropped release and delivery outside the allowed tick window. Missing press does not invent charge, and old release does not launch a delayed projectile.

The separate three-second notice fixes known scheduling/send/host-rejection failures without being erased by recurring connection status. It only classifies press/release, avoiding neutral-input spam. Phaser's owner independently reviewed this narrow source path and reported no blocker. Successful enqueue is still not a per-gesture execution receipt; network interruption after enqueue may safely cancel without a terminal action acknowledgement. ADR030 and PROTOCOL now say this explicitly instead of promising the deferred multi-carrier gesture design.

## Remaining release evidence

Run current-head CI, the deployed public gateway smoke using `/api/health` and `/api/ready`, and real Pages Chromium/WebKit acceptance. Re-run the existing poor-direct-network profile without relaxed thresholds, checking affected and unaffected peers, fresh world progression after outage, channel churn and bounded baseline retries. Preserve failed runs and distinguish application-message impairment from IP/SCTP packet loss. Cross-instance provider tests, physical phone testing and operating-permission limits retain their previously documented scope; this review does not certify missing evidence.
