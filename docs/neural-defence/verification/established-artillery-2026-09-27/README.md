# Established armies can open safe artillery positions

Integrated source `2a3524d3` exactly matches the isolated specialist-guard
candidate. An army that already has a specialist weapon can choose a legal Siege
position when its short-range build cannot be admitted. The position must have
a connected enemy target at Siege range and lie outside enemy weapon reach.
Normal construction priorities run first; research, costs, travel and supply
remain unchanged. Requiring an established weapon preserves pre-contact
expansion instead of prematurely replacing an opening with artillery.

This is AI policy 3. Adapter compatibility is `neural-defence-9-watch-2`;
world/checkpoint rules remain 9 because deterministic command application and
state format are unchanged.

## Full comparison against policy 2

All 210 unique map/opening/seat cases finished or reached the unchanged
900-second cap, with zero rejected commands. Candidate engine hashes and reused
probe hashes remained unchanged. Integrated engine hashes match; all five maps
match the matrix base revision. The original runner and patch are archived in
the adjacent `artillery-refinements-2026-09-27` directory.

| Map            | Policy 2 timeouts | Policy 3 timeouts |
| -------------- | ----------------: | ----------------: |
| Close Quarters |                 0 |                 0 |
| Skirmish 24    |                 2 |                 0 |
| Open Front     |                 2 |                 2 |
| Narrow Front   |                10 |                 8 |
| Lean Resources |                 6 |                 0 |
| Total          |                20 |                10 |

No previously finishing case becomes a timeout. Narrow Balanced/Defensive now
ends with Balanced winning at 737/616 seconds. Skirmish Defensive mirrors and
Lean Pressure, Relay and Defensive mirrors finish as mutual-destruction draws.
Open Pressure/Defensive changes from Pressure to Defensive wins; Narrow
Economy/Defensive changes from Economy to Defensive wins, in both seats.
All default-map outcomes remain unchanged.

Ten timeouts remain: Narrow Pressure/Relay, Open Defensive mirrors, and Narrow
Balanced, Relay and Defensive mirrors, each from both starting sides. This is
progress on AI adaptation, not proof of universal strategy balance.

## Seat-dependent finish time

All 105 swapped-seat pairs agree on the winner/draw/timeout outcome. Only Narrow
Balanced/Defensive differs in duration. A trace using the exact candidate checks
map, neighbors and Siege ranges under rotation. Normalized state first differs
at tick 5661 when both players dispatch construction to the same hex (246, or
233 after rotation). Existing rotating slot arbitration awards the claim to a
different player. This explains the duration difference; it is not a range or
map asymmetry. The trace and first divergence are retained here.

## Safety and performance evidence

The 24 regression cases include accepted dispatch and replay, input immutability,
structure ordering, pre-contact expansion, required research, short-range build
priority, disconnected targets and unsafe positions. Review caught a threatened
position fixture that lacked the new established-weapon prerequisite. The
corrected fixture uses a rear Tower; removing just the threat check fails both
rotation cases. The normal cases pass.

On the same real idle-front world (`f3c1d5d0`, tick 18100), 50 calls after five
warmups measured policy 2 at 5.15 ms median / 5.38 ms p95, and policy 3 at
6.19 ms / 6.76 ms. The snapshot was advanced without commands to an idle builder
before measurement. This is a fixed diagnostic, not a browser frame-time or
worst-case guarantee. The earlier broad candidate's repeated range traversal
took about 40 ms; this implementation computes the range once per candidate cell.

## Integrated verification

Source `2a3524d3` passes all 1,778 repository tests, typecheck, focused ESLint and
build. Six Narrow Front matches from this committed source exactly match the
isolated matrix on final hash, outcome, duration and rejected commands. The
Balanced/Defensive slot-0 match additionally passed command-only replay
verification in the tournament runner. The qualification manifest retains the
command and source. Chromium and WebKit pass the real watch-mode flow on desktop,
phone portrait and phone landscape, including both AIs building and restart.

Independent review found no blocking source defect. Its threat-test finding was
fixed and mutation-checked before integration.

The Pressure/Relay slot-0 match was extended with ordinary AI commands beyond
the original cap: Pressure wins at 1,056 seconds, hash `de119234`, with its brain
at 240 HP. The continuation was independently replay-verified. It is a slow
finish rather than a permanent stall; the original 900-second result remains a
timeout. At 902 seconds the AI chooses another flank neuron despite a safe
Siege position that reaches the enemy brain. It eventually builds that gun at
991 seconds. Giving such finishing opportunities priority is a possible future
improvement, not part of this policy.
