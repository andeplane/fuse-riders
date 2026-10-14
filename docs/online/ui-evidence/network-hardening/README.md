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

## Unit coverage

All 3,900 tests in the full unit suite passed under V8 coverage, followed by 10 added transport lifecycle tests under the same collector with `--clean=false`. Their combined report passes the existing coverage thresholds. The frontend network package's 92 tests also pass independently. The retained figures apply to unit-instrumented modules; they do not claim native browser-flow coverage or a passing repository `test:coverage` gate.

| Scope                                          |                Lines |             Branches |        Functions |
| ---------------------------------------------- | -------------------: | -------------------: | ---------------: |
| All configured unit modules                    |               96.29% |               95.31% |           98.07% |
| Network packages plus remote correction helper | 98.05% (9,527/9,716) | 94.01% (3,281/3,490) | 99.17% (479/483) |
| Peer transport adapter                         |               96.64% |               80.25% |           97.95% |

The network scope includes `fuse-netcode`, `fuse-network-fe`, `fuse-network-be`, `fuse-network-protocol`, and `games/fuse-riders/src/render/time/reconcile.ts`. Remaining adapter branches include asynchronous bootstrap cancellation and platform-specific signalling/error variants; the aggregate percentage does not imply exhaustive coverage.

Reproduce the combined unit collection on this branch without native browser-flow collection:

```sh
git rev-parse HEAD
pnpm exec c8 --reporter=text-summary --reporter=json-summary tsx --test --test-concurrency=2 tests/*.test.ts packages/*/tests/*.test.ts games/*/tests/*.test.ts
pnpm exec c8 report --temp-directory=coverage/tmp --reports-dir=/tmp/network-coverage --reporter=text-summary --reporter=json-summary --include='packages/fuse-netcode/src/**' --include='packages/fuse-network-fe/src/**' --include='packages/fuse-network-be/src/**' --include='packages/fuse-network-protocol/src/**' --include='games/fuse-riders/src/render/time/reconcile.ts'
```
