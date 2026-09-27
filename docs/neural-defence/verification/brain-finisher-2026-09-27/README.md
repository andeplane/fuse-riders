# Safe finishing shots — AI policy 4

Implementation: `b7ff2e0d`; world rules remain 9, adapter compatibility is
`neural-defence-9-watch-3`. Once an army has a dedicated weapon, the AI prioritizes
an immediately affordable, legal Siege site that can hit a connected enemy brain
without standing in enemy weapon reach. Critical supply counterbattery repairs
retain priority. Home-relative tie breaking preserves the mirrored decision.

## Complete comparison

`full-results.jsonl` contains all 210 cases: five maps, 21 opening pairs including
mirrors, and both seat assignments, each capped at 900 simulated seconds.
The baseline is the previous established-artillery policy. Source and map hashes
are in `matrix-manifest.json`; the integrated engine matches those exact bytes.

- 206 cases finish, four reach the cap; previously 200 finished and ten capped.
- Zero rejected commands, new timeouts, or engine/map hash drift.
- Both Open Front Defensive mirrors now draw at 360 seconds; both Narrow Front
  Relay mirrors draw at 396 seconds and Defensive mirrors at 592 seconds.
- Defensive now beats Economy on Close Quarters and Balanced on Narrow Front,
  in both seat assignments. These are policy matchup changes, not a claim of
  equal human strategy strength.
- The only seat difference is Narrow Front Balanced/Defensive duration: 540
  versus 568 seconds, with Defensive winning both.

Narrow Front Pressure/Relay and Balanced/Balanced remain capped in both seats.
Pressure/Relay finishes at 968 seconds in both extended runs, with replay hashes
`6b55e36a` and `7eed1955`. The original 900-second results remain timeouts.
The Balanced mirror remains stalled at 1,800 seconds because a fragile repair
connection repeatedly dies before its finishing Siege completes. A separate
durable-repair candidate is under investigation; it is not included here.

## Verification and reproduction

Eleven focused regressions cover the recorded 902-second decision in both seats,
reordered structures, checkpoint restoration, unavailable resources/research,
enemy reach, and critical repair precedence. The existing 24 artillery fallback
regressions also pass. All 1,793 repository tests, typecheck, focused lint and build
pass. Independent review found no blocking issue. Both retained command replays
were rerun against the integrated engine and reproduce their final hashes.

Replay and exact-source qualification:

```sh
pnpm exec tsx docs/neural-defence/verification/brain-finisher-2026-09-27/verify.ts
```

Full current-policy comparison (the tournament output format differs from the
compact comparison rows retained here):

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --maps all --seconds 900 --out /tmp/fuse-brain-finisher-reproduction
```

`performance.json` retains a fixed-state microbenchmark: 100 alternating calls
per implementation after 20 warmup pairs on an Apple M4 Max, Node 22.20.0.
Late idle decision median fell from 3.27 to 2.33 ms; late busy from 0.58 to
0.44 ms. These four snapshots do not establish general frame performance.

The change affects AI choices, not rendering or physics. Previously recorded
live browser captures remain separate presentation evidence; no physical-phone
or human visual acceptance is claimed here.
