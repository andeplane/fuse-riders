# Paid construction losses

Repeated AI Siege attempts on Synaptic Reach exposed a missing contract: combat
could destroy paid construction without recording a destruction outcome or a
checkpointed loss. Completed-building `lost` cannot identify that waste.

Rules 8 adds `Player.statistics.sitesLost`, initialized to zero and validated as
a required nonnegative safe integer. Combat increments it once for each destroyed
paid new-construction site and emits the existing owner-scoped `destroyed`
outcome. Existing debris, smoke and audio now also report these losses.
The builder retains its existing return behavior. Cancellation, unpaid plans,
elimination cleanup and the loss of an upgrade's existing structure do not count
as destroyed sites; the last case still increments completed-building `lost`.

The online contract is `neural-defence-8-skirmish-4`. Older checkpoints are rejected;
historical rules-7 recordings require their recorded source revision. This change
adds evidence and feedback, not a new AI tactic or combat rebalance. It stores no
history outside authoritative state and does not alter damage or build timing.

Tournament harness 2 reports authoritative `sitesLost`. Its previous approximate
queue-disappearance diagnostic is now `unfinishedPaidJobsRemoved` with
`biomassOnRemovedJobs`; those include upgrade-source loss and elimination cleanup
and must not be interpreted as combat destruction alone. Historical harness-1
results retain their original fields and meanings.

An exploratory policy that built Bastions before exposed guns reduced some
construction loops but caused Balanced to lose every completed default-map
matchup and created a Balanced/Economy timeout. It was rejected. Any future
response to construction losses must preserve distinct openings and pass matched
seat, ordinary-resource AI comparisons before being called balanced.

## Verification

At `e20d4fbe`, all **1,733 tests**, typecheck, build and focused lint passed.
The initial full-suite attempt failed only the tournament resume test because
the simulation source was uncommitted; the clean-source rerun passed. Review
identified the obsolete rules-7 default effects recording; it was replaced by
the accompanying [rules-8 recording](verification/construction-losses-2026-09-27/README.md).
Final independent review reported no remaining findings.

Chromium and WebKit passed the site-destruction replay rendering and ordinary
menu/game flows at desktop, portrait and landscape sizes. These are emulated
viewports, not physical-phone acceptance.

A repeated ordinary 900-second Synaptic Reach Balanced/Pressure match recorded
38 Alpha and 34 Beta site losses. Comparing its complete end state against the
rules-7 diagnostic produced identical state after removing only `rulesVersion`
and `statistics.sitesLost`. This confirms unchanged gameplay for that case;
the game still timed out. Reproduce the current run with:

```sh
ND_OPPONENT=pressure ND_SLOT=0 ND_DUMP=1 pnpm exec tsx scripts/neural-defence-skirmish.ts
```
