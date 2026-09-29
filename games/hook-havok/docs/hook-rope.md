# Hook 2.0: winch rope and standard defaults (10A)

Rules are now **`hook-havok-10`**. Refresh every client and create a fresh room.

## Why

Playtesting found the hook "just lets go" and that falling keepers sank far below a hook before it did anything. A probe of the previous engine on Crossroads (4,000 seeded mid-air shots at ledge undersides, fire held) measured:

|                                                  | `hook-havok-9` pull |                        `hook-havok-10` rope |
| ------------------------------------------------ | ------------------: | ------------------------------------------: |
| Held hooks that let go                           |                 51% | 0% (other than landing on the hooked ledge) |
| …because another ledge crossed the line of sight |           86 of 120 |                                       never |
| …because the rope crossed its own ledge          |           34 of 120 |                                       never |
| Sag below the catch, 90th percentile / worst     |      96 / 262 units |                               20 / 88 units |

Both causes were structural. Every ledge is one-way for keepers, yet the tether was cut whenever any ledge crossed the line from chest to anchor, including the ledge the pull was carrying the keeper through. The pull itself was a constant 2800 units/s² force against 1800 gravity. Nothing caught a falling keeper, so downward momentum at the 1000 units/s cap needed about 500 units to stop.

## Rules

- **Rope.** When the hook bites, the rope length is the current distance (at most the range). It does not stretch: outward motion stops the tick the rope goes taut, so keepers swing instead of sinking. The only exception is at the 1000 units/s speed cap, where the rope gives to the actual distance rather than yanking the keeper on the next tick.
- **Winch.** Holding the hook reels in toward a 40-unit minimum. The reel's radial speed approaches the **Reel** tuning (default 850 units/s, workshop range 300–1800) at 10,800 units/s², and eases over its last stretch. Within 12 units of the minimum, velocity is damped so the keeper settles into a hang. Swing velocity (gravity, steering, momentum) is otherwise free.
- **Steering** while hooked and airborne pumps the swing tangentially at 1100 units/s² instead of normal air control.
- **Rope jump.** A fresh jump while hooked lets go with a jump launch that keeps any stronger upward swing, and restores the air jump in double-jump mode. A held hook does not refire; press again.
- **Momentum.** After letting go, air steering never brakes a keeper already moving faster than running speed in the held direction. Steering the other way still brakes.
- **Release** happens when the hook is released, on a rope jump, on dropping, on respawn or reset, when a Lift fires, and when the keeper lands on top of the ledge they hooked (arrival). The rope may pass through one-way stone on the way. Rope wrapping remains out of scope.
- **Hook flight** is 32 units per tick (was 20), so a full-range shot lands in about 20 ticks.
- Checkpoints reject hook velocities above the new flight speed, and attached ropes shorter than the minimum or longer than the range.

## Defaults and controls

New rooms start on **Crossroads** with **double jump** and **gentle arena ricochets**. `CLASSIC_TUNING` (Belfry, single jump, no balls) keeps the older fixtures pinned.

(Since [11B](bombs.md#controls), Space alone jumps, J hooks and K throws a bomb; Down + Space drops. The paragraph below describes 10A.)

**Keyboard + mouse** is the standard control scheme. J / Space jump. WASD / arrows aim in eight directions, and K hooks along that direction. A left click hooks where the mouse points. Whichever hook button was used last owns the aim. Down alone aims down; **Down + Jump** (or Shift + Down) drops through a ledge. **Classic mouse** keeps S / Down alone as drop.

Upward keyboard shots have aim assist: when an eight-way ray aimed up or diagonally up would miss every ledge in range, the aim bends by up to 15° (5° steps, nearest first) onto the closest ledge. Level and downward shots, the ones used against rivals and orbs, fly exactly as aimed. This is local intent computed in the app. The bent aim travels through ordinary replicated input, and the engine is unchanged by it.

## Verification

`tests/rope.test.ts` covers held catches in a seeded Crossroads sweep (no stretch below the speed cap, releases only on arrival, bounded sag), reel-in to the hang, rope jump and no refire, landing release versus swinging beneath, pump and momentum, checkpoint bounds, defaults and Down+Jump drop, and aim-assist bounds. The ordinary-input traversal fixture now reels to the high anchor and rope-jumps up through it. Feel and balance still need a playtest.
