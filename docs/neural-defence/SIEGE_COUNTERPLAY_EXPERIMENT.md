# Siege counterplay experiment and implementation design

The selected candidate is now implemented as rules 9 on this branch; see
`SIEGE_COUNTERPLAY.md` for current behavior and production verification. The
experiments below remain historical evidence, not deployed or full-map results.

The following experiments ran in isolated
copies of the engine from `0e0cd8e8`; none of these rule changes is shipped yet.
After these trials, the completed policy-6 matrix showed a regression (56 versus
52 timeouts), so production rolled back its fortification heuristic under policy 7. The selected prototype was then rechecked on that restored policy-5 behavior
from `e7d2ec2e`: all 21 default pairings retain their exact outcomes, durations,
builds and player statistics. All four paired probes retain their outcomes and
durations; only the still-stalled Narrow Balanced/Relay statistics change. All
four restored seat pairs agree, and no commands are rejected.

## Selected candidate pending production migration

Siege attacks at exactly three traversable hex steps. Its inner two-step area is
a blind spot. Tower, Relay and Bastion retain their existing reach. When the AI
would choose Siege but its closest connected enemy is inside that blind spot,
it instead chooses its opening's short-range weapon (Tower for Siege/Economy).
This permits mixed armies to defend artillery and lets a close assault exploit
unsupported guns. Resources, health, cadence, build times and particle rules stay
unchanged in the experiment.

Range remains the existing terrain-aware graph reach, not Euclidean distance or
line of sight. A nearby cell behind an obstacle can have a longer traversable
shot route. The implementation and UI must explain this consistently; subtracting
an inner reachable set must not silently change general `weaponCells` semantics.

## Controlled results

Each row below includes both starting sides. Every pair agrees on outcome,
duration, build counts and player statistics, with no rejected commands.

| Variant                                    | Close Pressure/Siege | Narrow Pressure/Siege | Close Balanced/Relay | Narrow Balanced/Relay |
| ------------------------------------------ | -------------------- | --------------------- | -------------------- | --------------------- |
| Policy 6 baseline                          | Siege 156s           | Timeout               | Balanced 188s        | Timeout               |
| One-step blind spot                        | Siege 156s           | Timeout               | Balanced 188s        | Timeout               |
| Two-step blind spot only                   | Siege 160s           | Timeout               | Balanced 200s        | Timeout               |
| Keep Pressure/Relay weapons only           | Siege 156s           | Siege 688s            | Relay 151s           | Relay 392.5s          |
| Two-step blind spot + keep weapons         | Siege 168s           | Pressure 372s         | Relay 151s           | Relay 345s            |
| Two-step blind spot + adapt at close range | Siege 142s           | Pressure 423s         | Balanced 186s        | Timeout               |

The fixed-weapon combination was rejected after a full 21-pairing single-seat
Close Quarters run: Balanced lost every mixed pairing and the Pressure mirror
timed out. The adaptive candidate completes all 21 default pairings, and every
strategy has both wins and losses. Its narrow-front counterplay is promising,
but it does not resolve every stalled pairing or prove general balance.

A supplied combat fixture verifies Siege skips targets one and two steps away,
hits a target three steps away, and takes damage from an adjacent Tower. State
remains unchanged by stepping the source snapshot, and replay produces the same
result hash. These are isolated experimental rules, not a production checkpoint.

## Evidence and promotion requirements

`verification/siege-counterplay-2026-09-27/` retains result rows, per-variant
patches against `0e0cd8e8`, the ordinary-command runner and the controlled fixture.
`runner.ts.txt` runs the four paired probes; `default-runner.ts.txt` runs all 21
single-seat Close Quarters pairings without editing a case list.
The `.ts.txt` files are reproduction sources intended to sit beside an isolated
`engine/` copy. `restored.patch` is the selected prototype against `e7d2ec2e`, with
`restored-default.jsonl` and `restored-results.jsonl` retaining its recheck.
The earlier `adaptive.patch` targets the withdrawn policy-6 source. The prototype deliberately does
not include production version, UI or validation migration and must not be
applied as a complete release.

Before promotion:

- Add catalog minimum range and a shared `attackCells` helper; keep generic reach
  and Bastion protection unchanged. Combat targeting, retaliation priority, AI
  reach caches, counterbattery sites and ordinary firing sites must use it.
- Bump rules/checkpoint and online compatibility. Update card explanations and
  current documentation. Historical reports retain their original rules.
- Cover distances one/two/three, terrain detours, retaliation priority, legal
  construction, state validation and late-input replay. Move existing adjacent
  Siege test targets to legal range while preserving their original assertions.
- Run relevant browser flows, the full test/build checks, source-pinned matched
  seats and the broader map comparison. Regenerate current visual replay evidence
  for the new rules instead of loading old snapshots into the new engine.

This design selects a candidate for implementation; it does not establish game
completion, a merge decision or human visual/playtesting acceptance.
