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
