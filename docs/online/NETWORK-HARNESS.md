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

The opt-in `?benchmark=1` application hook now exposes accepted snapshot scope/match/round/tick, rider alive/pose state, leaderboard, local movement results and correction samples. The harness retains the most recent 20,000 hook events per browser (evicting chunks of 1,000) and records truncation. Whole-run snapshot/regression counters are independent of raw-event retention, with at most 256 authority scopes retained for regression comparison. It asserts accepted snapshot ticks do not regress within one authority scope and checks that every guest and the TV has regained a direct link by the end of the run. These are narrow observable invariants, not complete recovery certification. Shot IDs/dispositions, accepted-state age, actual input-to-changed-pose timing, and application queue/resync counters still need instrumentation. Prediction hook events currently mark the first render after a changed control; they do not guarantee that the pose changed. The harness therefore does not claim zero stale actions, duplicate shots, contradictory confirmed outcomes, or a measured recovery deadline.

Controller gestures produce a workload but do not guarantee all five riders survive. A long configured duration alone is not the sustained five-active-rider, increasing-trail/shell soak. The old `browser-network.json` is an exploratory historical two-player baseline with an obsolete relay profile; it must not be used as direct-only release evidence.

## Rendering-isolation diagnostic

`BENCH_RENDER_SINGLE=1` keeps only guest 1's arena visible. A browser-side MutationObserver keeps the other five canvases hidden before lazy renderer startup, while their controls, RTC and host simulation continue. Periodic samples record canvas visibility, renderer kind and available renderer metrics. This is a causal diagnostic for simultaneous rendering contention on the test machine, not a replacement for the six-view workload or physical-device gates.

The final application-recovery assertions require every guest/display's latest accepted snapshot to be at most two seconds old. For the deliberately blackholed guest, the harness also requires a post-outage accepted snapshot and progression beyond its pre-outage tick/scope; it records the first post-outage delay separately. Healthy RTC link counts alone are not sufficient. A failed freshness assertion remains a failure even if rendering and transport connection checks look healthy.

Bounded packet metadata tracing retains at most 12,000 sends per context: local channel ordinal, kind, world generation/sequence/base/tick, byte count and delivered/drop/expiry outcome. No payload content or capabilities are retained. Trace counters explicitly distinguish channel-closed drops from queue-age expiry. The first post-outage accepted snapshot must also arrive within two seconds, independently of the end-of-run freshness requirement.

## Repeated-match duration runs

For a 30-minute local six-RTC-peer workload with one visible renderer:

```sh
ONLINE_URL=http://localhost:8794/ BENCH_SECONDS=1800 BENCH_PROFILE=direct BENCH_RENDER_SINGLE=1 npx tsx scripts/online-network-benchmark.ts
```

The harness detects the host's visible MATCH COMPLETE notice, releases controls, dismisses recap dialogs with Escape, and clicks MAIN MENU followed by START RACE. It reports `matchRestarts`. This uses public UI commands, not simulation mutation. Eliminated riders remain connected and resume next round; do not label this as uninterrupted five-alive gameplay. Recent raw diagnostic events are bounded, while frame samples (120,000 per view), byte windows (3,600), counters and periodic UI samples cover the configured 30 minutes. Packet traces retain the first 12,000 packets and report omitted counts. The unchanged final-world freshness and accepted-tick regression assertions remain required; a completed duration alone does not imply acceptance.
