# Counterbattery policy comparison

Completed 210 matches at source `6cce29586d8aa4c875a06408bf8e5081b0247a1c`,
engine rules 7, public AI policy `neural-defence-7-skirmish-3`. Six strategies,
all unordered pairings including mirrors, both seats, five maps, ordinary rules
and a 900-second cap. This includes the reviewed supply reservation correction.

| Map            | Decisive | Both brains destroyed | Timeout |
| -------------- | -------: | --------------------: | ------: |
| Close Quarters |       30 |                    12 |       0 |
| Synaptic Reach |       24 |                     4 |      14 |
| Open Synapse   |       20 |                     4 |      18 |
| Twin Pass      |        4 |                     8 |      30 |
| Scarce Reach   |       30 |                     0 |      12 |
| Total          |      108 |                    28 |      74 |

All 105 swapped-seat pairs agree on result, duration, first contact and every
player metric. No commands were rejected. All six strategies have wins and
losses on Close Quarters, and all its mirrors finish. Pressure's mirror improves
from a 900-second timeout to simultaneous brain destruction at 220 seconds.

The correction is **not an overall balance improvement yet**. Across five maps,
136 matches finish versus 138 under the prior durable-repair policy. Twin Pass
Pressure mirrors regress from 442 seconds to timeout; Relay mirrors regress from
438.5 seconds to timeout. Other Twin Pass results and durations are unchanged.
The other maps retain their previous result counts. Prioritizing clearance can
therefore improve one battlefield and stall another; those two regressions are
the next diagnostic targets. Do not conceal timeouts as draws or use the default
map alone to claim broad balance.

Evidence: [complete matrix](verification/counterbattery-2026-09-27/matrix.jsonl).
Compare [prior policy](DURABLE_REPAIR_BALANCE.md) and [tactic](COUNTERBATTERY_REPAIRS.md).
