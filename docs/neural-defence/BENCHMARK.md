# Phase 0 headless benchmark

Run from the repository root:

```sh
pnpm exec tsx scripts/neural-defence-benchmark.ts
```

The script runs a fixed 820-tick (41 simulated seconds) four-owner match on an 8×8 map with two deposits. Its local command policy uses xorshift32 seed `0x4e445030`. It queues adjacent neurons, chooses later expansion and priority destinations from the seed, and starts Excitation research for each owner. The ordinary `createMatch` and `step` paths use default construction and research times. It records all commands, then starts a second match and replays them. It fails if final hashes or outcome counts differ, or if the per-owner particle count exceeds the fixed 128-per-living-owner rule at any tick. The timed first run includes command selection, stepping, outcome counting and particle checks; the replay time is reported separately. There is no browser, network or opponent AI in this workload.

Example measured run on macOS arm64, Node v26.4.0, HEAD `9d3886a3ace43c76ddb69ff91f6e5808ebf00a66` (benchmark files uncommitted), rules version 1 and SHA-256 of `RULES` `d173c7ba792c2fe2de3a32c0295378f3f46b11434d43cc2b1125e6037f14b680`:

| Measure                              |             Result |
| ------------------------------------ | -----------------: |
| Ticks / commands                     |           820 / 60 |
| Timed run                            |           772.6 ms |
| Throughput                           |    1,061.3 ticks/s |
| Replay                               |         1,215.3 ms |
| Final state hash / replay            | `6670eaf7` / equal |
| Peak particles / cap                 |          512 / 512 |
| Completed structures / damage events |            14 / 36 |
| Completed research                   |                  4 |

Wall-clock throughput will vary by machine, load and runtime. The benchmark is a repeatable local engine workload and determinism check, not evidence that multiplayer transport, browser performance, opponent AI or game balance is solved.

Rules-v2 follow-up with Auto expand/placement changes atop `9fcd00971a81d3d819138c7cb0a2321a26dd501c` (uncommitted), Node v22.20.0, same command/seed/workload: rules hash `134ca7fb6c04953125eb70d7738d9bb217760df686d905ca5f3c6e30ba860048`, final/replay hash `0bc38e80`, 867.3 ms first run and 802.4 ms replay. Event counts and the 512-particle peak are unchanged; this workload leaves auto expansion off. Dedicated engine and rollback tests exercise enabled expansion, funding waits and contested targets. The changed state hash includes the new rules version and explicit player toggle field.
