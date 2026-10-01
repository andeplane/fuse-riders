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

This candidate is now integrated on the open PR branch as AI policy 2. The
follow-up sweep completed 181 additional cases for a full 210-match comparison:
20 timeouts, zero rejected commands, all 105 swapped-seat pairs agreeing on
outcome, duration and recorded statistics. It is not merged or deployed.
Default/probe runners are identical
to those archived in `../support-selection-2026-09-27/`; `matrix.ts.txt` (removed; see git history at `5c0b9be1`) skipped
those completed keys and accepted comma-separated map IDs. It used only the
isolated patched engine, which matched the integrated engine after formatting.

Completed candidate subsets are now archived: Close Quarters42/42 with no
timeouts, Skirmish24 and Open Front42/42 each with two (Defensive mirrors), and Lean Resources42/42
with six (Pressure, Relay and Defensive mirrors). Every nonmirror pairing in
these subsets finishes. Narrow Front is now also complete with ten timeouts:
Balanced, Relay and Defensive mirrors, plus Balanced/Defensive and Pressure/Relay.
See `../../FLANK_RECOVERY.md` for the remaining regressions and verification scope.

`regression.test.ts.txt` (removed; see git history at `5c0b9be1`) contained four focused cases: zero/one engaged gun under
both map rotations. All pass with the isolated candidate and fail with the
unchanged engine. They assert the safe next cell, dispatched outcome, replay,
immutability and ordering independence. It was run by copying it beside the isolated `engine/`
directory as `.test.ts`.

The existing exposed-site fixture previously expected a Bastion after repeated
losses. The candidate correctly takes an available safe flank instead. The
unapplied `test-fixture.patch` (removed; see git history at `5c0b9be1`) checked that flank, then closes its side corridor to
retain the original protective fallback and no-duplicate-protection assertions.
All25 focused AI cases pass with that fixture update. Source review found no
blocking issues. The complete comparison above does not establish human play-feel
or visual-quality acceptance.

A local timing diagnostic (`performance.ts.txt`, removed; see git history at `5c0b9be1`; and `performance.json`) advances the
archived Balanced/Economy world by220 ordinary ticks without commands to an idle
decision, hash`04972e64`, then measures100 calls per implementation. Production
median/p95/max are4.422/4.977/8.623ms; candidate4.617/5.744/11.031ms. This is one
fixed CPU workload under concurrent matrix load, with sequential sampling and no
excluded warmup. Both choose the same action. It is not a worst-case bound or
browser responsiveness qualification. Reproduction paths refer to the original
checkout and isolated candidate directory; reconstruct that candidate from the
archived patch before running it against engine revision`290c4086`.
