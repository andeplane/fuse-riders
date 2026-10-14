# Preserving the opening before adapting to artillery

Both variants were isolated experiments against production policy 2. The
specialist variant is now integrated; see the [complete qualification](../established-artillery-2026-09-27/README.md).
Apply the respective patch to the engine at `a5d79796` (engine source
unchanged from `99c820e1`). Each computes Siege attack cells once per candidate
site, avoiding repeated traversal for every enemy.

## Require an existing short-range firing site

`firing-sites.patch` (removed; see git history at `5c0b9be1`) limited the original fallback to an existing firing position
that cannot be admitted safely. It restores Narrow Front Economy/Relay and
Siege/Relay to Relay wins at 382 and 398 seconds from both sides. However,
Pressure/Relay and Balanced/Defensive still time out at 900 seconds.

The Pressure/Relay extension remains unfinished at 1,800 seconds. Both brains
retain 240 HP. Pressure's closest connected approach improves only from 14 to 13
steps; Relay remains nine steps away. Damage increases from 3,250/4,148 to
9,914/9,217, and completed losses from 28/24 to 56/68. This is peripheral
attrition, not meaningful progress toward victory. The original 900-second
qualification remains a timeout. The extension runner, snapshots of statistics
and samples document the distinction.

## Require an existing specialist weapon

`specialist.patch` (removed; see git history at `5c0b9be1`) instead let a force adapt after it has established at least
one specialist weapon; brains and ordinary neurons do not satisfy this guard.
This addresses the observed pre-contact switch before either side had built a
weapon, while allowing a developed army to seek artillery positions.

Eight Narrow Front probes retain the Economy/Relay and Siege/Relay wins above,
finish Balanced/Defensive with Balanced winning at 737/616 seconds, and leave
Pressure/Relay unfinished at 900 seconds. The complete 210-case comparison
subsequently reduced timeouts from 20 to 10 without introducing new timeouts;
the linked qualification records the remaining limitations.

## Regression and timing evidence

Both refinements pass 24 focused cases. Four new cases preserve pre-contact
neuron expansion; all four fail under the original broad fallback. The earlier
20 cases cover successful adaptation, ordinary dispatch/replay, ordering,
research, target connectivity and short-range priority. Tests are archived as
text beside the patches, ready to move into the normal test directory if a
candidate is integrated.

The firing-site refinement's idle-decision diagnostic uses a fixed real world
at tick 18100, hash `f3c1d5d0`, 50 measured calls after five warmups. Policy 2 takes
about 5.69 ms median; the refinement about 6.46 ms, versus 39.73 ms for the
original redundant traversal in the earlier run. Concurrent tournament work and
different sampling times limit the comparison; this is not browser frame-time
qualification or a worst-case bound.
