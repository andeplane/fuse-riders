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

This candidate is **not in production**. The remaining 181 cases of the full
210-match comparison are running in three independent batches. Do not infer
full-map balance from these initial results. Default/probe runners are identical
to those archived in `../support-selection-2026-09-27/`; `matrix.ts.txt` skips
those completed keys and accepts comma-separated map IDs. It uses only the
isolated patched engine; current production simulation remains unchanged.
