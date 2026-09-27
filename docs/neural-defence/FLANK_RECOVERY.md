# Advancing after the firing front falls quiet

The AI now runs its existing safe-route planner after repeated losses even when
fewer than two guns are engaged. Previously, losses could leave an army with many
weapons but no live targets, disabling the very planner needed to advance again.
The Balanced/Economy diagnostic remained unfinished at 1,800 seconds; the new
policy finishes that pairing at 573 seconds from both starting sides.

Only the active-gun-count prerequisite was removed. Loss thresholds, route costs,
terrain/threat checks, ordinary construction commands, supply and engine rules
remain unchanged. The AI change advances online compatibility to
`neural-defence-9-skirmish-2`; world/checkpoint rules remain 9.

## Complete isolated comparison

All 210 map/opening/seat cases ran to completion or the unchanged 900-second cap.
There were no rejected commands. All 105 swapped-seat pairs agree on outcome,
duration and the recorded player statistics. The isolated engine's files match
the integrated engine after formatting. Reproduction runners, the original
one-condition patch and all results are in
`verification/unrestricted-flanking-2026-09-27/`.

| Map            | Timeouts / 42 |
| -------------- | ------------: |
| Close Quarters |             0 |
| Skirmish 24    |             2 |
| Open Front     |             2 |
| Narrow Front   |            10 |
| Lean Resources |             6 |

Total: 20 timeouts, versus 52 in the earlier complete rules-8 policy-5 baseline.
Sixteen are mirror matches. The four nonmirror timeouts are Narrow Front
Balanced/Defensive and Pressure/Relay, from both starting sides. Compared with
the completed rules-9 Narrow Front baseline, the Balanced and Relay mirrors and
Pressure/Relay newly time out, while many previously stalled pairings finish. This is
a substantial overall improvement with explicit remaining regressions, not full
balance or completion of the broader game goal.

All default-map different-opening records remain: Balanced 3–2, Pressure 1–4,
Economy 3–2, Siege 4–1, Relay 2–3, Defensive 2–3 (counting each pairing once).
Different AI openings are not proof of equally strong human strategies.

Four new regressions cover zero/one engaged gun in both map rotations, accepted
dispatch, replay, input immutability and structure ordering. The exposed-site
fixture tests the safe flank first, then closes the side corridor to retain
protective fallback and no-duplicate-protection checks. Focused AI/network checks
pass all 43 cases; full production verification follows integration.
