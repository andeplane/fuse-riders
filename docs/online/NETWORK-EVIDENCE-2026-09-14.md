# Browser impairment evidence: 2026-09-14

The isolated local run completed at 2026-09-13 23:49:20 UTC against `http://localhost:8794/`. It exercised three 30-second workloads, each with five controller/player contexts plus one display context. Other local browser tests were stopped before this run. Starting checkout revision: `9c910c82d67943157a4e27ad0db3c3780239e29d`. The served entry bundle was `/assets/index-_rhp9Jze.js`, SHA-256 `dcd4c9fea04ada84e504760f3752f6a3a785585c1e5348f6694f54c92f08fa99`. See [compressed raw report](network-browser-2026-09-14.json.gz) and [harness method](NETWORK-HARNESS.md).

**The narrow consistency/transport checks passed; performance acceptance did not.** This is application-send impairment over real local WebRTC, not physical-network loss or phone acceptance.

| Profile | Model (per sender; host budget is 4× guest) | Observed frame p95 across contexts | Largest sampled correction |
| --- | --- | --- | --- |
| Direct | 0 delay/loss; 10 Mbps guest budget | 84.1–85.4 ms | 15 units |
| Regional | 40 ms delay, ±10 ms jitter, 1% app-message loss/reorder, 2 Mbps guest | 83.7–84.4 ms | 60 units |
| Poor asymmetric | 75 ms delay, ±30 ms jitter, 3% app-message loss, 5% reorder, 0.5 Mbps guest, 3-second guest outbound blackout | 81.9–83.4 ms | 300 units |

All profiles observed real intercepted RTC sends, no browser errors, zero forbidden WSS gameplay relay attempts, no accepted snapshot tick regression within one authority scope, and healthy direct links for every guest/display at the end. Injection queue peaks were 190,060 / 160,769 / 149,980 bytes respectively, below the harness's 256 KiB bound. No application diagnostic trace was truncated. The poor profile visibly entered failure/retry states and recovered by the final sample, but this run does not prove the required recovery deadline.

The approximately 75 ms median animation-frame interval even without added delay is a serious negative result for this six-context headless fixture. Its cause has not been isolated between shared-machine/browser rendering load and application rendering cost. Do not infer that physical phones have the same frame rate, or dismiss it as merely the harness without measuring. The rendering and local/TV latency release gates remain open.

Correction figures are samples attached to accepted snapshots, including inactive phases, not a complete distribution of each reconciliation event while alive. They show that poor-network presentation can jump substantially. The hook's input-to-render measurement does not verify an actual changed predicted pose; its small reported values are not local responsiveness certification.

The host observed two rounds in each profile, roughly 95–102 playing snapshots, with only 48 snapshots per profile containing five living riders. This is not a sustained five-active-rider soak. Raw accepted-state/ledger samples are preserved, but the harness does not prove shot deduplication, complete outcome agreement, application queue bounds or stale-action rejection. Those remain separate protocol/regression gates.

One UI issue needs triage: the direct profile's first guest displayed “Waiting for direct connection — retrying; check Wi-Fi or network access” throughout the 23 periodic samples, despite receiving snapshots and ending with `direct=1`. Connection status text may be stale or represent a different command condition; healthy transport counts alone do not close that usability issue.

## Reproduction and earlier failed attempt

```sh
ONLINE_URL=http://localhost:8794/ BENCH_SECONDS=30 npx tsx scripts/online-network-benchmark.ts
```

The run requires the opt-in application diagnostics in the served build. The harness adds `benchmark=1`, records the served entry bundle and starting revision, and creates its own room per profile. It writes failures as well as successes to `artifacts/online-network-benchmark.json`.

An earlier exploratory attempt failed because tsx/esbuild's serialized initialization function referenced an unavailable `__name` helper. That was a harness defect, fixed by making the browser initialization lexical environment self-contained. It was not counted as a game failure or successful benchmark. That attempt also overlapped another local smoke and is excluded from the final measurements above.

## Follow-up: isolate rendering contention while retaining six RTC peers

A separate 30-second direct-only run completed at 23:53:32 UTC using the identical served entry bundle. Starting checkout revision was `f035bde653ecfa28003c24d7cc900765c8ae23cf`; newer unbuilt source changes were not part of this served artifact. Command:

```sh
ONLINE_URL=http://localhost:8794/ BENCH_SECONDS=30 BENCH_PROFILE=direct BENCH_RENDER_SINGLE=1 npx tsx scripts/online-network-benchmark.ts
```

[Raw diagnostic report](network-single-view-2026-09-14.json.gz) preserves this run separately. All six RTC peers and host simulation remained active; only guest 1 rendered its arena. Every periodic sample confirmed the other five canvases were hidden with no initialized renderer, and guest 1 used visible Phaser WebGL. All narrow transport/tick assertions again passed.

Guest 1's 1,827 animation frames had median 16.7 ms, p95 **17.2 ms**, p99 **19.4 ms**, maximum **30.1 ms**. Periodically sampled Phaser render duration ranged 0.1–0.7 ms, with automatic Phaser loop disabled. This strongly implicates simultaneous local rendering load in the earlier six-view frame failure. It does not replace that failure, certify distributed physical phones, or isolate exact CPU versus GPU contention: utilization was not measured. The old served bundle still showed the stale connection-status label.

### Correction measurement follow-up

Splitting preserved raw snapshots by phase exposed an instrumentation defect: countdown snapshots reported roughly 15-unit corrections because reconciliation replay advanced an inactive rider, although rendering bypassed inactive movement. This finding was sent for a focused regression/fix. Original raw aggregate measurements are retained above.

Filtering **only playing snapshots where the local rider is alive**, and pooling the five player contexts (excluding display), gives:

| Run/profile | Samples | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Six views/direct | 358 | 0 | 0 | 2.093 |
| Six views/regional | 339 | 0 | 30 | 60 |
| Six views/poor | 270 | 0 | 15 | 300 |
| Single view/direct | 639 | 0 | 1.049 | 2.098 |

These are reconciliation values sampled on accepted snapshots, with many zero-correction samples, not hardware-response measurements. Poor-profile outliers remain real recorded presentation deviations and are not erased by the inactive-phase correction finding. Whether an outlier reflects loss/resync, a previously unknown obstacle or another transition requires causal traces; this run does not establish that distinction.

## Stronger world-recovery check: failure preserved

A subsequent single-render, six-RTC-peer poor-profile run completed at 2026-09-14 00:00:24 UTC against revision `2ff884388cfd0930088bade0bc849bc936d46bb7`, served entry `/assets/index-WzaVZ4xd.js`, SHA-256 `b47aee145e1eddba462734a1fb5cd1e59549e1cf0ee8826cd02519a36df89ab4`. The [failed raw report](network-poor-freshness-failed-2026-09-14.json.gz) is retained separately.

The harness now requires every guest and display to have accepted a world snapshot in the final two seconds. It additionally measures the deliberately blackholed guest's first accepted post-outage snapshot and requires world progression beyond its pre-outage tick/scope. These measurements use each browser's monotonic clock.

**The stronger freshness assertion failed.** End-of-run accepted-world ages were:

| View | Age |
| --- | ---: |
| Host | 59.9 ms |
| Guest 1 (deliberate outbound blackout) | 85.4 ms |
| Guest 2 | 1,907.7 ms |
| Guest 3 | **2,089.3 ms** |
| Guest 4 | 1,938.6 ms |
| Display | **2,305.7 ms** |

The deliberately affected guest accepted a progressing world **751.5 ms** after its three-second outbound blackout ended. Other peers still had stale worlds while reporting healthy direct links and permitted authority in the last periodic metrics. Therefore healthy RTC connection counts alone are insufficient recovery evidence. The exact cause of these stale streams has not been proven; chained delta loss/resync behavior is a hypothesis requiring instrumentation, not an established diagnosis.

No page errors occurred and the visible guest's frame p95 was 17.7 ms, so this failure is distinct from the six-renderer frame contention. The later healthy-link assertion was not reached because the freshness assertion failed. The threshold was not relaxed or retried until a passing sample appeared.

Browser traces still do not establish shot deduplication or rejection of all stale controls. Those invariants have separate typed ledger regressions in `tests/online-input-ledger.test.ts`, covering same-tick press/release, duplicate sequences, ten-tick input expiry, old-scope release rejection, disconnect/restore neutralization and bounded queues. Such unit evidence complements rather than replaces the failed browser world-freshness gate.

## Traced investigation before liveness fix

A further diagnostic repeated the unchanged poor single-render profile with bounded outgoing message metadata. [Raw pre-fix trace](network-poor-traced-before-fix-2026-09-14.json.gz) preserves send time, local channel ordinal, message kind, world generation/sequence/base/tick, bytes and delivery/drop outcome; no capability or packet content is captured. Injection randomness is seeded; game-room randomness is not fixed by this harness, so repeated rounds are not identical deterministic replays.

That run happened to pass final freshness, but its affected guest's first post-outage accepted world arrived **2,688.2 ms** after connectivity returned. This still misses the two-second recovery target and does not erase the prior failure.

The trace recorded **17 host RTC channels for five peers** during 30 seconds, with **91 queued messages discarded because their channel closed**. Of 1,189 attempted world messages, 94 were full keyframes. Keyframes accounted for 1.893 MB of 4.135 MB attempted world payload (about 46%), with sizes from 4,345 to 37,656 bytes. Guest resync requests numbered 18/14/15/18/10. This run had no age-expired host messages; the preceding failed run had 94 combined expired/closed host messages without that distinction. The initial bandwidth-expiry hypothesis was therefore insufficient on its own.

Source inspection identified a concrete lifecycle defect: the direct-only transport retained a legacy two-second relay recovery quarantine. After a link's initial eight-second creation deadline passed, any later temporary unhealthy probe state could immediately force a new RTC connection, incur another quarantine, discard queued messages, and reset the world encoder. This is a mechanism for repeated connection/keyframe churn; it does not establish that every individual stale snapshot had that sole cause.

The reviewed minimum fix removes relay quarantine, retains two fresh probe acknowledgements for gameplay, and requires eight **continuously** unhealthy seconds before forced renegotiation of an existing channel. Healthy recovery resets that retry interval. This eight-second renegotiation budget is distinct from the requirement to resume promptly on a surviving direct path after connectivity returns. Codec redesign and weaker freshness thresholds were not included.

## After reviewed liveness correction: partial improvement, freshness still failed

Revision `fba711412ef6e040e5b1e0c0091f897cc37097e8`, served entry `/assets/index-Dd_qnwrq.js` SHA-256 `e4a5ddc7818adbf25a94b9ee8dcbd92ae3c4067d63a138153e6761eded9abb4d`, was tested with the same poor single-render profile. [Raw post-liveness report](network-poor-after-liveness-2026-09-14.json.gz) preserves the outcome.

Exactly **five** host channels were observed, with **zero channel-closed discards**, versus 17 channels and 91 such discards in the pre-fix trace. The deliberately blackholed guest accepted a progressing world **469.3 ms** after connectivity returned. The specific liveness correction therefore removed the observed channel churn and improved that recovery.

The overall freshness gate nevertheless **failed**: guest 3's final accepted world was **2,105.5 ms** old. Other remote views were 32.8–565 ms old. Host keyframes still represented 2.441 MB of 4.802 MB attempted world payload (114 keyframes / 1,388 world frames), with 17 age-expired sends and a 241,306-byte peak injection queue. Visible-guest frame p95 was 16.9 ms.

The remaining trace shows a concrete chain-loss sequence on edge 3: generation 49 sequence 6 (tick 672) was delivered before sequence 5 (tick 670), which the exact-previous-base decoder cannot immediately apply. Replacement keyframes generation 50/tick 680 and generation 51/tick 688 were then application-dropped, followed by a dropped guest resync request. The sender has no accepted-keyframe acknowledgement or explicit pending-baseline retry; intervening deltas depend on a baseline the receiver never obtained. Delivery metadata establishes these send/order/drop facts; the accepted-state hook establishes the stale view. This remains an application-level adversarial ordering test, not a claim that reliable ordered SCTP delivers IP-loss packets out of order.

A scoped pending-keyframe acknowledgement/retry design was proposed for independent review; it was not silently added to this liveness change. The two-second freshness threshold remains unchanged. The harness now also explicitly asserts the two-second first post-outage acceptance deadline, rather than only recording that number; the failed freshness check prevented reaching that later assertion in this run.

## After reviewed keyframe acknowledgement: short poor-profile recovery passes

The exclusive 30-second single-render poor profile passed the unchanged final-world freshness and post-outage recovery assertions. [Raw report](network-poor-after-keyframe-ack-2026-09-14.json.gz) records source HEAD `81939f3426a7a64e3ecb8421cba5a62aa65442f6`, serving the ACK implementation built after `2df3a3b`: `/assets/index-D5WJhStV.js`, SHA-256 `533cefa92a6b33bc31d413f52b23d72eef6503de5112bbbd8f6fde4661dd9e2d`. All other local browser checks had finished before this run.

The affected guest accepted a progressing world **1,459.5 ms** after the three-second outgoing blackout ended. Final accepted-world ages across the four guests and display were **24.3, 418.6, 2.3, 277.5 and 21.2 ms**. There were five host channels, no channel-closed discards, eight age-expired host messages, and a peak injection queue of **237,056 bytes**, below its 256 KiB bound. All remote links were healthy at completion, with no WSS gameplay relay attempts, browser errors or accepted-tick regressions.

The visible guest recorded 1,832 animation-frame intervals: p50 **16.7 ms**, p95 **17.7 ms**, p99 **19.8 ms**, maximum **26.1 ms**. This is one desktop WebGL view with the other five renderers hidden, not physical-phone or six-view rendering acceptance. A preceding exploratory ACK-fixed run also passed but overlapped a possible public-check window; its frame measurements are not used here.

This validates the narrow recovery regression in one seeded application-message impairment run. It does not certify real SCTP packet-loss behavior, a sustained five-alive game, shot deduplication, all correction budgets or every random round. The earlier failed traces remain preserved. The reviewed implementation received full validation: 299 tests passed; coverage was 99.45% lines/statements, 93.64% branches and 99.27% functions, with the new keyframe-delivery module at 100% under its focused tests. Build and typecheck passed.
