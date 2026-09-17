# Browser impairment evidence: 2026-09-14

The isolated local run completed at 2026-09-13 23:49:20 UTC against `http://localhost:8794/`. It exercised three 30-second workloads, each with five controller/player contexts plus one display context. Other local browser tests were stopped before this run. Starting checkout revision: `9c910c82d67943157a4e27ad0db3c3780239e29d`. The served entry bundle was `/assets/index-_rhp9Jze.js`, SHA-256 `dcd4c9fea04ada84e504760f3752f6a3a785585c1e5348f6694f54c92f08fa99`. See [compressed raw report](network-browser-2026-09-14.json.gz) and [harness method](NETWORK-HARNESS.md).

**The narrow consistency/transport checks passed; performance acceptance did not.** This is application-send impairment over real local WebRTC, not physical-network loss or phone acceptance.

| Profile         | Model (per sender; host budget is 4× guest)                                                                   | Observed frame p95 across contexts | Largest sampled correction |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------- |
| Direct          | 0 delay/loss; 10 Mbps guest budget                                                                            | 84.1–85.4 ms                       | 15 units                   |
| Regional        | 40 ms delay, ±10 ms jitter, 1% app-message loss/reorder, 2 Mbps guest                                         | 83.7–84.4 ms                       | 60 units                   |
| Poor asymmetric | 75 ms delay, ±30 ms jitter, 3% app-message loss, 5% reorder, 0.5 Mbps guest, 3-second guest outbound blackout | 81.9–83.4 ms                       | 300 units                  |

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

| Run/profile        | Samples | p95 |   p99 | Maximum |
| ------------------ | ------: | --: | ----: | ------: |
| Six views/direct   |     358 |   0 |     0 |   2.093 |
| Six views/regional |     339 |   0 |    30 |      60 |
| Six views/poor     |     270 |   0 |    15 |     300 |
| Single view/direct |     639 |   0 | 1.049 |   2.098 |

These are reconciliation values sampled on accepted snapshots, with many zero-correction samples, not hardware-response measurements. Poor-profile outliers remain real recorded presentation deviations and are not erased by the inactive-phase correction finding. Whether an outlier reflects loss/resync, a previously unknown obstacle or another transition requires causal traces; this run does not establish that distinction.

## Stronger world-recovery check: failure preserved

A subsequent single-render, six-RTC-peer poor-profile run completed at 2026-09-14 00:00:24 UTC against revision `2ff884388cfd0930088bade0bc849bc936d46bb7`, served entry `/assets/index-WzaVZ4xd.js`, SHA-256 `b47aee145e1eddba462734a1fb5cd1e59549e1cf0ee8826cd02519a36df89ab4`. The [failed raw report](network-poor-freshness-failed-2026-09-14.json.gz) is retained separately.

The harness now requires every guest and display to have accepted a world snapshot in the final two seconds. It additionally measures the deliberately blackholed guest's first accepted post-outage snapshot and requires world progression beyond its pre-outage tick/scope. These measurements use each browser's monotonic clock.

**The stronger freshness assertion failed.** End-of-run accepted-world ages were:

| View                                   |            Age |
| -------------------------------------- | -------------: |
| Host                                   |        59.9 ms |
| Guest 1 (deliberate outbound blackout) |        85.4 ms |
| Guest 2                                |     1,907.7 ms |
| Guest 3                                | **2,089.3 ms** |
| Guest 4                                |     1,938.6 ms |
| Display                                | **2,305.7 ms** |

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

## Thirty-minute repeated-match runtime soak

The local direct profile completed **1,800 seconds and passed** the unchanged application assertions, with five controller contexts plus TV, one visible guest renderer, and **three completed-match UI restarts**. [Raw soak report](network-soak-direct-2026-09-14.json.gz) records source `66f67bd0fb1f751f0d2a8a9f2ec8b0a9bc4d32d5` and served `/assets/index-B6L8AYyc.js`, SHA-256 `3e1feda6b9eac49a4bb0b2b873dd363389aecae6ded710c13244e9302fbf63b3`. This includes the reviewed retired-RTC-callback guards. There were no other browser workloads; a separate coverage command briefly used CPU around **00:54:52–00:54:59 UTC** during the soak. No measurements were removed for that overlap.

Each context accepted 18,005 snapshots; whole-run counters recorded zero accepted-tick regressions, with no browser errors or gameplay relay attempts. Final remote accepted-world ages were **79.6–91.0 ms** and the largest injection queue was **229,462 bytes**. The visible guest recorded 107,921 frame intervals: p50 **16.7 ms**, p95 **17.4 ms**, p99 **18.4 ms**, maximum **86.7 ms**. The run exercised lobby, countdown, playing, round-over and match-over phases through real UI controls. Eliminated riders waited for later rounds. It does not prove uninterrupted five-alive play or that target aiming, gun impacts, persistent shells and shrinking-field extremes were all exercised.

Delivered JSON payload traffic, using complete recorded one-second windows and excluding each sender's first/last partial windows, was:

| Sender                                 | Average Mbps | p95 one-second Mbps |
| -------------------------------------- | -----------: | ------------------: |
| Host, all five outgoing edges combined |        0.994 |               1.640 |
| Guest 1 uplink                         |       0.0352 |              0.0613 |
| Guest 2 uplink                         |       0.0368 |              0.0646 |
| Guest 3 uplink                         |       0.0361 |              0.0643 |
| Guest 4 uplink                         |       0.0368 |              0.0646 |
| TV uplink                              |       0.0215 |              0.0240 |

These exclude SCTP/DTLS/IP overhead and are delivered, not attempted bytes. Whole-run per-view downlink is **unavailable** because bounded per-edge packet traces retain only the first 12,000 sends; host aggregate must not be divided by five as proof of each view's traffic. Recent raw guest-1 hook events evicted 18,000 earlier events; whole-run snapshot/regression counters were preserved separately. Packet omissions are explicit in the report.

[Late-run resource samples](network-soak-tail-resources-2026-09-14.json) cover only **00:51:55–00:59:56 UTC**, every 30 seconds, for the benchmark process and its descendants. Combined RSS was **1.535–1.591 GiB** until the final sample, which reached **5.975 GiB** while the benchmark runner alone reached 1.506 GiB. This coincides with collecting the approximately 365 MB uncompressed report, suggesting harness serialization overhead; it is not evidence that normal game memory grew to that size. The aggregate can double-count shared pages and is not JavaScript heap. Cumulative process CPU increased 3,915 seconds over 481 wall seconds across the process tree, so this headless test is not low-CPU certification. The data is tail-only, not a full-run leak test. Future long-run collection should stream or reduce duplicated raw-event extraction before claiming a low-footprint harness.

## Regional 80 ms RTT profile

The following exclusive 30-second run also **passed** the unchanged assertions. [Raw regional report](network-regional-2026-09-14.json.gz) records checkout `d715642ebd4d0cc63c5e5639a0adee6c3f4ab05d`, but the served asset was still the exact **66f67bd bundle/hash above**; later source changes were not bundled into this test. Profile: nominal 40 ms each-way delay, 10 ms jitter, 1% application-message loss, 1% application reordering, 2 Mbps guest send budget, seed 12345 plus context index. This is pre-SCTP adversarial injection, not measured WAN RTT or IP loss.

Alive-player correction samples only include accepted snapshots where phase is playing and the local rider is alive. Rider radius is 7 units. Every guest's p95 was below that proposed radius budget in this run; large tails remain visible:

| Local player | Samples | Nonzero corrections (>1e-6) | p95 units | p99 units | Maximum units |
| ------------ | ------: | --------------------------: | --------: | --------: | ------------: |
| Host         |      99 |                           0 |         0 |         0 |             0 |
| Guest 1      |     102 |                          23 |     2.098 |     3.141 |        27.923 |
| Guest 2      |     128 |                          25 |     2.093 |     2.098 |        15.856 |
| Guest 3      |     139 |                          31 |     2.098 |    15.541 |        30.000 |
| Guest 4      |     128 |                          31 |     3.141 |    30.000 |        31.928 |

The visible guest's frame p95/p99/max were **17.1/17.4/21.7 ms**. Final remote snapshot ages were **31.9–59.5 ms**. Complete, untruncated delivered host packet traces yield these downlink figures over **29 complete one-second windows**, excluding partial boundary windows and including zero-byte windows:

| Host destination edge | Average Mbps | p95 one-second Mbps |
| --------------------- | -----------: | ------------------: |
| Edge 1                |        0.229 |               0.449 |
| Edge 2                |        0.214 |               0.312 |
| Edge 3                |        0.222 |               0.406 |
| Edge 4                |        0.220 |               0.427 |
| Edge 5                |        0.182 |               0.272 |
| Host total            |        1.067 |               1.660 |

Edges are local trace ordinals, not asserted player identities. These are application payload figures; all five per-view averages and p95 windows satisfy the proposed payload budgets in this **short regional** run, but wire overhead and sustained per-view downlink are still unmeasured. This evidence complements the soak and earlier negative reports; it does not close physical-phone, real packet-loss, true changed-pose response or full outcome-consistency acceptance.

## ADR 037: 20 Hz regional and poor profiles

Both exclusive 30-second profiles passed the unchanged freshness, recovery, queue, monotonicity and error assertions. Raw reports: [regional 20 Hz](network-regional-20hz-2026-09-14.json.gz), [poor 20 Hz](network-poor-20hz-2026-09-14.json.gz). Checkout was `630f5584b6acdcc1332573496f59496364d1d85f`; served implementation built at `e1dcc6f` was `/assets/index-CADTdQmF.js`, SHA-256 `957dbf7e43782d09767df1102c338a07e7469e48e4f1298b7f40889f45b10703`. Same profiles/seeds and single-render isolation as above. This does not reverse the separately preserved nearby-TV response failure after ADR 037.

Regional host playing snapshots had 311 same-scope successive increments, all exactly **one tick**, confirming every-tick publication in that observed window. All remote playing snapshots selected **two-tick delay**: regional counts 269/281/268/250/292 and poor 67/95/96/113/112; none selected one tick. Host zero-RTT samples selected one tick 305/314 regional and 294/303 poor. Thus nearby classification did not incorrectly shorten the impaired remote buffer.

| Profile  | Visible frame p95 / p99 / max ms | Final remote accepted-world ages ms | Post-blackout world ms | Maximum injection queue bytes |
| -------- | -------------------------------- | ----------------------------------- | ---------------------: | ----------------------------: |
| Regional | 17.1 / 18.2 / 26.4               | 2.9–54.2                            |            No blackout |                        201435 |
| Poor     | 16.9 / 17.2 / 21.0               | 469.4–1319.6                        |                 1418.5 |                        261863 |

Poor-profile queue occupancy approached its 262,144-byte cap and corrections remain substantial. Passing safe recovery does not establish smooth play under this adversarial pre-SCTP loss/reorder profile.

Alive-and-playing local correction samples (nonzero means >1e-6):

| Profile/player   | Samples | Nonzero | p95 units | p99 units | Max units |
| ---------------- | ------: | ------: | --------: | --------: | --------: |
| regional/host    |     259 |       0 |     0.000 |     0.000 |     0.000 |
| regional/guest 1 |     237 |      31 |     1.049 |     1.049 |    67.500 |
| regional/guest 2 |     281 |      30 |     1.049 |     2.093 |     7.500 |
| regional/guest 3 |     221 |      28 |     1.049 |     1.049 |    67.500 |
| regional/guest 4 |     200 |      25 |     1.049 |     8.847 |    75.000 |
| poor/host        |     241 |       0 |     0.000 |     0.000 |     0.000 |
| poor/guest 1     |      53 |      10 |    37.500 |    45.000 |   112.500 |
| poor/guest 2     |      75 |      19 |    45.000 |    52.500 |   135.000 |
| poor/guest 3     |      96 |      28 |    37.500 |    60.000 |    75.000 |
| poor/guest 4     |      85 |      15 |    29.634 |    37.500 |    45.000 |

Regional guest p95 values remain below the seven-unit rider radius; max corrections reach 75 units. Poor guest p95 values 29.6–45 units and maximum 135 units are reported without applying the 80 ms regional target to a different profile or hiding tails.

Delivered host JSON payload, using untruncated traces and complete one-second windows (30 regional, 29 poor; zero windows included, partial boundaries excluded):

| Profile/destination | Average Mbps | p95 one-second Mbps |
| ------------------- | -----------: | ------------------: |
| regional/host total |        1.809 |               2.630 |
| regional/edge 1     |        0.374 |               0.640 |
| regional/edge 2     |        0.367 |               0.590 |
| regional/edge 3     |        0.376 |               0.603 |
| regional/edge 4     |        0.386 |               0.600 |
| regional/edge 5     |        0.306 |               0.516 |
| poor/host total     |        1.583 |               2.053 |
| poor/edge 1         |        0.273 |               0.488 |
| poor/edge 2         |        0.312 |               0.461 |
| poor/edge 3         |        0.337 |               0.636 |
| poor/edge 4         |        0.350 |               0.617 |
| poor/edge 5         |        0.310 |               0.567 |

All per-edge averages/p95 windows remained below the proposed 0.5/1 Mbps payload limits in these short runs. Host aggregate regional average increased from 1.067 Mbps in the prior 10 Hz run to 1.809 Mbps here; these independently randomized rounds are not an identical simulation replay, so the ratio is observational rather than an isolated encoding-cost estimate. No SCTP/DTLS/IP overhead is included. The regional result protects the conservative buffering/traffic contract; it does not prove that the nearby one-tick policy activated on the TV response benchmark or that its latency target passed.
