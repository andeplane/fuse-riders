# Counterbattery escalation after sustained losses

Immediately building counterbattery artillery for an isolated supply cut caused
the Twin Pass Pressure and Relay mirrors to change from completed games into
900-second timeouts. Extra ammunition for an active Bastion, waiting for
clearance, and target-health-based ammunition ordering did not resolve them.
The active-Bastion experiment also timed out at 1,800 seconds. Those experiments
are not part of the final policy.

The AI now tries its existing durable repair first. It escalates to a safe Siege
position only after losing at least three buildings and at least half as many
buildings as completed construction jobs. Jobs include upgrades, so this ratio
is an attrition heuristic rather than the fraction of buildings destroyed.
The existing public, checkpointed construction
and loss statistics drive this decision; there is no map-name exception, hidden
memory, artificial damage, or extra resource grant. Counterbattery construction
still requires Ballistics, a legal connected site, and ordinary resources.
Existing counterbattery guns retain their ammunition reservation.

Engine rules remain 7. The online AI policy becomes
`neural-defence-7-skirmish-4`, since the generated command sequence changes.
Tests cover the minimum loss count, loss fraction, ordinary repair before
escalation, legal counterbattery dispatch, and finite supply reservation.

Initial diagnostic mirrors with the earlier active-Bastion weighting finished
at 450 seconds (Twin Pass Pressure), 440.5 seconds (Twin Pass Relay), and 452
seconds (Close Quarters Pressure). The final candidate restores the original
ammunition weighting to isolate construction policy. These exploratory results
are not exact-source tournament evidence.

## Completed exact-source comparison

Source `0eeff33363d55065b2a825ff8f4801a199e2fb1d` completed all 210 ordinary
900-second matches: every unordered pair of six strategies, including mirrors,
in both seat assignments on five maps. Both runs had clean simulation sources.
The [matrix](verification/attrition-2026-09-27/matrix.jsonl) and split
[fronts](verification/attrition-2026-09-27/fronts.manifest.json) /
[other maps](verification/attrition-2026-09-27/other.manifest.json) manifests
retain commands, map inputs and source identity. This is rules-7, harness-1
evidence; it predates the rules-8 construction-loss counter.

| Map            | Matches | Timeout at 900 s | Mutual destruction | Winner |
| -------------- | ------: | ---------------: | -----------------: | -----: |
| Close Quarters |      42 |                0 |                 12 |     30 |
| Twin Pass      |      42 |               26 |                 12 |      4 |
| Synaptic Reach |      42 |               14 |                  4 |     24 |
| Open Front     |      42 |               18 |                  4 |     20 |
| Lean Resources |      42 |               12 |                  0 |     30 |

There were no rejected commands. All 105 swapped-seat pairs agree on result,
duration, first contact and per-player metrics. Compared with source `6cce2958`,
only eight rows change outcome or duration: Twin Pass Pressure mirrors now end
in mutual destruction at 442 seconds and Relay mirrors at 438.5 seconds, replacing
four timeouts. Close Quarters Pressure mirrors take 452 seconds and Relay mirrors
287 seconds; both still finish in mutual destruction. All other result/duration
pairs are unchanged. All six strategies have both wins and losses on the default
Close Quarters map.

The remaining 70 timeouts prevent a claim of balanced, complete multi-map play.
Timeout means an unfinished game, not a scored draw. The next diagnostic target
is repeated paid-site destruction; see [construction losses](CONSTRUCTION_LOSSES.md).
