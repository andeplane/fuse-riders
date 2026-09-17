# ADR-046: Drunk riders stagger and lurch

- Status: Accepted
- Date: 2026-09-17

## Decision

Replace ADR-024's single two-second sine with a trail that looks drunk, after the Beerworm original: wavy, uneven, and never quite straight. The heading offset is now the sum of two deterministic noise curves, evaluated at the effect's age:

- a **stagger** that leans the opposite way at every knot, about every 5 ticks, by a hashed share (25–100%) of 30 degrees, which draws the jagged side-to-side wave;
- a **lurch** through free hashed values at knots about every 18 ticks, up to 15 degrees, which bends the whole line so a rider holding a course still drifts off it.

Knots sit on a regular grid and each is nudged by up to 25% of the spacing, so no two waves are the same length. Values are joined with smoothstep. Knot values come from integer mixing of the seed, the rider id, a channel constant and the knot index, so every engine agrees and nothing depends on a mutable noise stream.

Everything else in ADR-024 stands. The offset is still an absolute heading offset, never angular velocity: each movement removes the prior offset and adds the new one, so steering stays with the player, the deviation is bounded (now by 45 degrees, the sum of both maxima, rarely reached), and the half-second onset and expiry fades return the rider to the intended heading. Refresh extends the deadline without restarting the curves. Duration, immunity of the collector and the DIZZY feedback are unchanged.

The stagger turns the heading faster than a rider can steer, on purpose: that is what makes the wave jagged. The shortest stagger wave is 2.5 ticks, and the heading moves by up to about 35 degrees in one tick against 8 degrees of steering. It cannot accumulate, so the debuff costs precision near trails and walls rather than control of where the rider is going.

## Consequences

This changes the fold, so `RULES` moves to `fuse-p2p-28`; state shape and checkpoint bounds are unchanged. Bots already forecast with `drunkHeadingOffset` and follow the new curve without changes.

## Verification

Unit tests integrate offset deltas over many seeds and assert the bound, zero residual at expiry and after a late refresh, phase preserved across refresh, and that a rider holding a line changes lean at least a dozen times in nine seconds, in waves of differing length, and strays off the line, by more on average than the stagger alone can account for. Engine tests compare steered headings with the intended heading throughout the effect.
