# Durable-repair policy: full strategy comparison

The completed matrix uses engine rules 7 and AI policy
`neural-defence-7-skirmish-2`, source
`2a11758fb71cdeeeda5a2e7ac0a0b08bf29f6746`. Interrupted runs resumed with the same
simulation source; the recovery harness preserved their completed rows. This is
the baseline before the subsequent counterbattery correction, not current-policy
acceptance.

Six strategies, every unordered pairing including mirrors, both starting seats,
five maps, ordinary commands/resources, 900-second cap: 210 matches.

| Map            | Decisive | Both brains destroyed | Timeout |
| -------------- | -------: | --------------------: | ------: |
| Close Quarters |       30 |                    10 |       2 |
| Synaptic Reach |       24 |                     4 |      14 |
| Open Synapse   |       20 |                     4 |      18 |
| Twin Pass      |        4 |                    12 |      26 |
| Scarce Reach   |       30 |                     0 |      12 |
| Total          |      108 |                    30 |      72 |

138/210 matches finish, versus 100/210 in the earlier rules-6 saving-policy
baseline. This comparison includes both supplied Bastion protection and durable
repairs; it does not isolate their individual effects. All 105 swapped-seat
pairs agree on result, duration, contact time and every recorded player metric.
No commands were rejected. Timeouts are unfinished games, not draws or wins.

On Close Quarters all six strategies have a winning and losing non-mirror
matchup. Pressure's mirror still times out; the others finish. Wider maps retain
substantial stalls, especially Twin Pass. This evidence supports improved
completion and counter relationships on the default map, not general balance or
human/physical-device acceptance.

Machine-readable evidence: [all matches](verification/durable-repairs-2026-09-27/matrix.jsonl).
The next comparison tests [counterbattery repair tactics](COUNTERBATTERY_REPAIRS.md).
