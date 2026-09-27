# Strategic diversity: remaining work

Current AI policy 2 removes the active-gun prerequisite from loss-triggered
flanking. Its complete isolated 210-match comparison has 20 timeouts, down from
the earlier rules-8 baseline's 52; remaining nonmirror stalls are two Narrow
Front pairings. See `FLANK_RECOVERY.md` for integration, tradeoffs and limits.

The game has economic, protective and supply choices, but six AI opening policies
do not prove six durable late-game strategies. Research is cumulative. Siege alone
reaches three hexes, and the AI selects Siege against artillery and in several
late-front fallbacks. Other weapons need a useful role after artillery arrives.

## Implemented counterplay: minimum Siege range

Rules 9 implements a two-step blind spot: Siege attacks exactly three traversable
hex steps away, while Tower, Relay and Bastion retain adjacent fire. The one-step
variant did not change the diagnostic outcomes. The selected two-step variant
also gives AI artillery close-range support. See `SIEGE_COUNTERPLAY.md` for the
current contract and qualification, and `SIEGE_COUNTERPLAY_EXPERIMENT.md` for
rejected variants. This creates positional counterplay; it does not yet establish
balanced play across all maps or six durable late-game strategies.

Combat, AI threat assessment and target selection share the same attack-cell
contract. The command card explains the actual range, and selecting a structure
renders its firing cells on the ground from that same contract.

Before promoting the experiment, verify adjacent exclusion, distance-two/three
fire, short-range retaliation, terrain behavior and swapped-seat replay. Compare
a close-front and narrow-front matchup first. The committed policy-6 evidence
originally covered only Pressure/Economy and their mirrors. The full comparison
is now archived in `verification/secure-approach-full-2026-09-27/` and caused its
rollback: 56 timeouts versus policy 5's 52. Policy 7 restores policy-5 behavior.
The full reactive-approach matrix is policy 5. A rules change requires a new engine
version and checkpoint/online compatibility update.

## Current-policy construction diagnosis

For current rules 9, `verification/claim-order-2026-09-27/` proves the first
Balanced/Defensive seat divergence at simultaneous construction dispatch, and
`verification/support-selection-2026-09-27/` records a rejected safe-artillery AI
variant. It improved two Skirmish pairings but introduced a default-map timeout.
The completed rules-9 Skirmish matrix has 17 timeouts; the full wider run remains
active. The policy-6 observations below are historical context.

An ordinary Balanced/Siege Skirmish 24 match from policy 6 (`0eea3347`) reaches
tick 18,000 unfinished. At that point Alpha's rear Bastion 252 has 32 particles
and protects ten friendly structures, none under active weapon coverage. But no
completed Alpha gun reaches a connected enemy or paid site either. Removing a
rear reserve only while fighting therefore cannot fix that particular snapshot.

The construction sequence exposes another limitation:

- Beta queues a Siege upgrade at 427 on tick 17,661.
- Alpha queues Siege 475 on tick 17,821, before that upgrade completes.
- Beta completes 427 on tick 17,943, exposing 475 and its only anchor, neuron 474.
- At tick 18,000, the new Siege needs 181 ticks; its anchor has 40 HP and dies
  160 ticks later in continuation.

The approach reinforcement policy sees only completed weapon threats when it
chooses a job. Visible paid enemy construction could provide an earlier warning.
This needs a controlled experiment; predicting danger does not establish that
the resulting build decision improves match outcomes.

## Rejected supply experiment

A temporary policy-6 candidate added `!fighting.length` to the protective reserve
filter, removing inactive reserves whenever fighting destinations existed. This
was tested with ordinary commands on all 21 single-seat Close Quarters pairings
and seven wider-map diagnostic cases, with no rejected commands. It is rejected:

- Balanced/Siege and Economy/Relay still time out in Skirmish 24.
- The previously finishing Skirmish 24 Balanced mirror now times out.
- Close Quarters Economy/Defensive flips from Defensive winning at 144 seconds
  to Economy winning at 268 seconds.
- All default-map matches finish, but that alone does not justify promotion.

Diagnostic result rows are retained in
`verification/strategy-diagnostics-2026-09-27/inactive-reserve-*.jsonl`. These are
temporary-policy trials, not a committed-source tournament or a production change.

## Rejected construction-warning experiment

A second temporary candidate extended only the approach-reinforcement threat
check to include paid enemy weapon jobs. All 21 default-map results and durations
were unchanged. In wider-map probes it finished Economy/Relay at 736 seconds and
Narrow Front Balanced/Pressure at 772 seconds, while Pressure/Economy finished at
744 seconds. But Skirmish 24 Balanced/Pressure regressed from a 696-second win to
a timeout. Balanced/Siege remained unfinished. Restricting the warning to jobs
whose progress was already positive retained that new timeout.

The broad warning candidate's rows are saved as `planned-weapon-*.jsonl` in the
same diagnostic directory; `started-weapon-probes.jsonl` records the progress
restriction. `rejected-warning.patch` retains the unshipped broad candidate and
its focused regression against `e6075eaf` for reproduction, not application to
production. These trials used ordinary simulation and accepted
commands, but only one seat. The draft production changes and regression were
removed; those experiments did not change policy 6. Its later full comparison
withdrew it under policy 7, as recorded in `REACTIVE_APPROACH.md`. Do not mistake the observed construction
hazard for evidence that this heuristic is ready to ship. The next experiment
should examine positional counterplay rather than accumulating more thresholds.
