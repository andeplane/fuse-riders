# Network recovery evidence

Source: `7568f1bc3554929ffcc03131ef89f621927abb0a`. The source includes the reviewed protocol/recovery fixes and compact render traces. Later documentation/evidence commits do not change the runtime.

Both Chromium and WebKit ran two real browser contexts through room creation, admission, READY, a 500 ms sender-side input-channel blackout during steering release, and a 100 ms foreground main-thread stall. Each used `?mute&benchmark=1`. The JSON files retain the raw/displayed correction measurements; screenshots show the actual game flow after recovery.

```sh
ONLINE_URL=http://localhost:8796/ pnpm exec tsx scripts/network-recovery-smoke.ts
BROWSER=webkit ONLINE_URL=http://localhost:8796/ pnpm exec tsx scripts/network-recovery-smoke.ts
ONLINE_URL=http://localhost:8796/ MEASURE_SECONDS=15 pnpm exec tsx scripts/p2p-measure.ts
```

The six-peer benchmark used five scripted Chromium players and a TV, once locally and once with seed-7 40–60 ms application-message delay and 2% loss. Per-rider remote applied-control p95 was 45–54 ms locally and 66–72 ms with impairment. The report explicitly counts one missed/superseded response out of 252 eligible observations in the impaired run. It reports data-channel payload bytes, not IP wire bytes.

These are controlled desktop checks on one machine, with other repository verification work also running. They do not establish physical-phone, Wi-Fi/WAN, or touch-to-photon performance, nor the cause of the original two-laptop session. Human playtesting is still required for the feel of the short cosmetic correction.
