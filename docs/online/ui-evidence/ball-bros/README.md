# Ball Bros phases 0–1

Real solo flow, muted, through the Fuse Riders landing link. Captured with `pnpm exec tsx games/ball-bros/smoke.ts` against the local built service at port 8792, source `b44654c9` (octagon and radial-control iteration).

- [Desktop](desktop.png): 1440×1000, after launching and observing block damage.
- [Phone viewport](phone.png): 390×844, touch-capable browser emulation, no horizontal overflow. This is not physical-phone evidence.

The same run completed a round, used PLAY AGAIN, and checked that all 48 armor blocks reset. It also exercised combined A/D and W/S inputs, Space launch, five touch buttons and an explicit round restart. The smoke observes launch/damage/results; precise radial displacement and cancellation are asserted by engine/runtime tests. No injected game state or accelerated clock was used.
