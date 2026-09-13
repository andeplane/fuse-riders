# Browser application-transport impairment harness

`scripts/online-network-benchmark.ts` replaces the obsolete two-player/forced-relay experiment. It is an application-boundary stress tool for ADR 035's direct-only scope. It does not certify ADR 032 release gates.

Run against an isolated local online fixture:

```sh
ONLINE_URL=http://localhost:8787/ BENCH_SECONDS=30 npx tsx scripts/online-network-benchmark.ts
```

`BENCH_PROFILE=direct`, `regional`, or `poor-asymmetric` selects one profile. Duration accepts 10–1800 seconds. Remote origins require explicit `BENCH_ALLOW_REMOTE=1` and an authorized isolated test room. Never point this workload at an occupied match. Each run creates a fresh room and six isolated Chromium browser contexts: five players and a TV view. No creator capability is copied into guest URLs.

After healthy joins, an initialization script intercepts outgoing `RTCDataChannel.send` calls before the real SCTP transport. Seeded delay, jitter, application-message loss, reordering and aggregate sender bandwidth apply to all gameplay and health messages. The host receives four times the per-guest egress budget. The poor profile blackholes one guest's outgoing messages for three seconds. Injection queues are capped at 256 KiB and queued messages expire after 800 ms; these are harness limits, not assertions about the application's own queues. WebSocket sends are inspected for forbidden gameplay `relay` attempts.

The report is `artifacts/online-network-benchmark.json`, including starting revision, served entry-bundle hash, profiles/seeds, raw UI samples, raw animation-frame intervals, payload-byte windows, injected drops/reorders and queue counts. It is written on failure too. Do not commit token-bearing URLs or unredacted WebSocket messages.

## Evidence boundaries and outstanding instrumentation

The real browser's SCTP/DTLS stack still transports messages that survive injection. Dropping or reordering **before** reliable ordered SCTP is not OS packet-loss or congestion emulation: it intentionally probes application behavior under lost sends. Real wire impairment still requires a verified network layer and measured wire counters.

Animation-frame intervals are headless desktop browser samples, not physical-phone performance. Existing UI `inputP95` measures input callback to the next frame, not necessarily a changed predicted pose. Repeated sampling of the latest acknowledgement/correction is not a distribution of acknowledgement/correction events. JSON application bytes exclude wire overhead.

The opt-in `?benchmark=1` application hook now exposes accepted snapshot scope/match/round/tick, rider alive/pose state, leaderboard, local movement results and correction samples. The harness retains at most 20,000 hook events per browser and records truncation. It asserts accepted snapshot ticks do not regress within one authority scope and checks that every guest and the TV has regained a direct link by the end of the run. These are narrow observable invariants, not complete recovery certification. Shot IDs/dispositions, accepted-state age, actual input-to-changed-pose timing, and application queue/resync counters still need instrumentation. Prediction hook events currently mark the first render after a changed control; they do not guarantee that the pose changed. The harness therefore does not claim zero stale actions, duplicate shots, contradictory confirmed outcomes, or a measured recovery deadline.

Controller gestures produce a workload but do not guarantee all five riders survive. A long configured duration alone is not the sustained five-active-rider, increasing-trail/shell soak. The old `browser-network.json` is an exploratory historical two-player baseline with an obsolete relay profile; it must not be used as direct-only release evidence.
