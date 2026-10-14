# Repairing threatened supply gaps

A rules-7 Twin Pass Balanced mirror repeatedly rebuilt the same 60-HP neuron at cell 126 (rotated cell 353). Both networks reactivated their dormant Siege guns at the same time, severed each other's supply again, and repeated the cycle until the 900-second limit. At timeout each player held 6,708.2 Biomass, so lack of resources was not the cause.

Repair planning now accounts for disconnected enemy weapons that cover the gap. It chooses a Bastion when unlocked, otherwise a Pulse tower, through the ordinary catalog availability rules. Safe gaps still use neurons. Sites covered by currently active enemy guns remain excluded by the existing repair safety check. This is a policy correction, not privileged construction: all costs, waiting, travel, vulnerability and supply rules are unchanged.

The public policy version is `neural-defence-7-skirmish-2`. Engine rules remain 7. The focused ordinary-rules Twin Pass mirror now finishes at 784 seconds with both brains destroyed; both starting positions agree. Broader comparisons are still required before calling the policy balanced. This does not solve every possible stalemate.

Regression coverage checks the same isolated investment with no dormant threat, then with a dormant Siege covering its repair gap, with and without Growth. It verifies normal commands are accepted. Independent review found no actionable issues. The full repository suite passed 1,721 tests; build/typecheck and lint passed.

A separate within-tick route-cache experiment preserved the recorded combat hash but showed less than 1% median CPU improvement on that replay. It was removed; no performance gain is claimed.
