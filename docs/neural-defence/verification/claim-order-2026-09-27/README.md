# Why a swapped starting side can change the outcome

Engine source `290c4086` (unchanged through `2ce780ab`). The ordinary Balanced
versus Defensive Skirmish 24 match times out at 900 seconds with Alpha in slot 0;
Defensive wins at 792 seconds with Alpha in slot 1.

The diagnostic runs both ordinary AI/simulation worlds only until tick 5,441.
It first checks every cell's rotated terrain, neighbors and Siege attack annulus,
plus the two spawn positions. All pass. Rotation-normalized game state is equal
through tick 5,440, including resources, queues, workers, structures and
particles. Outcome order is normalized. Earlier command order differs at 2,760
only for independent priority clears, with no resulting state difference.

At tick 5,441 both players claim the same cell (175, or 304 in the rotated map).
The existing `dispatchConstruction` rule alternates absolute spawn-slot priority
each tick. In orientation 0, Alpha pays for its Tower; in orientation 1, Beta
pays for its Bastion. This is the first meaningful divergence, with state hashes
`fbd91195` and `b6c7eb30`. The nonwinning claim remains unpaid.

This is intended arbitration, covered by the existing construction-claim test,
not an asymmetric map or range calculation. Using player IDs would relocate the
bias and let renaming affect priority. No rule was changed. Balance assessments
must include both starting sides; exact outcome equality is not a universal
invariant when opposing strategies contest the same cell simultaneously.

The reproduction script (`reproduce.ts.txt`, removed; see git history at `5c0b9be1`) was a temporary
`scripts/claim-order-diagnostic.ts` run with `pnpm exec tsx`. `first-divergence.json` contains the compact validated output.
