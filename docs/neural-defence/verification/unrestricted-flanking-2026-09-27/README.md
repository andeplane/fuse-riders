# Flanking after attrition without an active-gun threshold

Isolated candidate against engine `290c4086` (unchanged through `1eef4ec4`).
Only the `fighting.length >= 2` condition is removed from the existing flanking
planner. Its checkpointed loss thresholds, terrain costs, threat avoidance and
ordinary construction commands remain unchanged. The hypothesis comes from
the Balanced/Economy replay: after heavy losses, only one gun had any target, so
the route planner never ran despite ample resources and a distant enemy brain.

Initial evidence: all 21 single-seat default-map pairings finish at the existing
900-second cap; all eight swapped-seat Skirmish probes also finish, with zero
rejected commands. Balanced/Economy finishes with Economy winning at573 seconds,
Balanced/Relay with Balanced at525, Balanced/Defensive with Defensive at478, and
Pressure/Siege with Siege at509. Paired outcomes, times and statistics agree.

This candidate is **not in production**. The follow-up sweep covers 181 additional
cases of the full 210-match comparison in three independent batches; only Narrow
Front remains in progress. Do not infer
full-map balance from these initial results. Default/probe runners are identical
to those archived in `../support-selection-2026-09-27/`; `matrix.ts.txt` skips
those completed keys and accepts comma-separated map IDs. It uses only the
isolated patched engine; current production simulation remains unchanged.

Completed candidate subsets are now archived: Close Quarters42/42 with no
timeouts, Skirmish24 and Open Front42/42 each with two (Defensive mirrors), and Lean Resources42/42
with six (Pressure, Relay and Defensive mirrors). Every nonmirror pairing in
these subsets finishes. Narrow Front is still running; no full-matrix claim is
made yet.

`regression.test.ts.txt` contains four focused cases: zero/one engaged gun under
both map rotations. All pass with the isolated candidate and fail with the
unchanged engine. They assert the safe next cell, dispatched outcome, replay,
immutability and ordering independence. Copy it beside the isolated `engine/`
directory as `.test.ts` to run it.

The existing exposed-site fixture previously expected a Bastion after repeated
losses. The candidate correctly takes an available safe flank instead. The
unapplied `test-fixture.patch` checks that flank, then closes its side corridor to
retain the original protective fallback and no-duplicate-protection assertions.
All25 focused AI cases pass with that fixture update. Source review found no
blocking issues; this does not replace the pending full comparison.
