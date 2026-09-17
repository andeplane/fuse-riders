# Fractional presentation

> Superseded in part: the LAN server was removed in #271, so the LAN rows and the LAN projection described below no longer exist; the online behaviour still applies.

## Held-bomb preview — issue #84

The charge marker previously called the authoritative `bombLaunchDistance`, which floors charge age. Its 100–400 unit range over 24 ticks therefore extended in 12.5-unit steps every 50 ms, even when the frame supplied fractional time.

Both Phaser and the original Canvas renderer now use [`bombPreviewDistance`](../../src/client/bomb-preview.ts), interpolating between the two adjacent authoritative distances. At whole ticks the distances agree exactly. The shared simulation and release calculation are unchanged.

Subsequent balance tuning in [issue #86](https://github.com/andeplane/fuse-riders/issues/86) makes full-charge time configurable, defaulting to eight ticks (0.4 seconds). The shared distance advances 37.5 units per tick at that default. Both renderers use the active snapshot's `bombChargeTicks`, with this same interpolation keeping the marker smooth between ticks; pending room preferences do not change an active preview.

[`ViewPlayer.presentationTick`](../../src/client/snapshot-stream.ts) is optional presentation metadata created locally after receiving a snapshot; it is absent from the wire protocol and authoritative game state. Its current consumer is the charge marker:

- Online local riders use the same fractional tick as their predicted pose, with the existing four-tick lead cap. A lost clock freezes the pose and its presentation tick together. Confirmed charge start, release/cancellation, death and lifecycle boundaries remain authoritative.
- Online remote riders and spectators use the existing buffered world tick, with no extrapolation past available snapshots.
- LAN riders use the existing projected snapshot pair, at most 50 ms beyond the newest snapshot. Match/round/phase transitions, death, and portal transit retain the existing projection guards. The world tick and all discrete state remain unchanged.

This smooths extension after a confirmed press; it does not introduce speculative charge starts or remove the initial input/confirmation delay. A stalled connection still reaches its existing visual prediction limit.

## Related rendering audit

| Surface                                               | Current behavior                                                                                                                                                                                                                                           | Opportunity                                                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rider position, heading and trail tips                | Online prediction/interpolation and bounded LAN projection already use fractional movement.                                                                                                                                                                | Preserve the current lifecycle and discontinuity guards.                                                                                                                                |
| Flying bombs, fuse arcs and blast fades               | Their drawing math accepts fractional world ticks; online supplies them. LAN keeps its world tick integral. See [`effects.ts`](../../src/client/phaser/effects.ts), [`arena.ts`](../../src/client/phaser/arena.ts), [`main.ts`](../../src/client/main.ts). | A bounded, separate LAN visual world time could smooth these while retaining authoritative explosion and expiry events. Not changed here.                                               |
| Special target-bomb cursor                            | LAN projects `bombTarget` for at most one tick. Online [`interpolateWorld`](../../src/online/prediction.ts) interpolates rider transforms but retains the earlier target coordinates; local prediction also retains confirmed target coordinates.          | Interpolate target coordinates only within the same active charge and lifecycle. Local target prediction would also need explicit confirmation/cancellation handling. Not changed here. |
| Shrinking arena boundary                              | Both renderers use the snapshot's `boundaryInset`, which the online world buffer retains as discrete state.                                                                                                                                                | Cosmetic edge interpolation could smooth motion, but collision/clipping geometry must stay consistent and the visible edge must not imply extra safe space. Not changed here.           |
| LAN controller charge fill                            | Updated with snapshots and rounded to a whole percentage in [`main.ts`](../../src/client/main.ts).                                                                                                                                                         | Animate the cosmetic fill between confirmed snapshots with a bounded visual age; keep readiness and button enablement authoritative. Not changed here.                                  |
| Ink movement and pickup fades                         | Accept the supplied tick, so online can sample fractional time while LAN remains tick-stepped.                                                                                                                                                             | Could share a bounded LAN visual world time after separating visual progress from expiry decisions. Not changed here.                                                                   |
| Pulses, rotations, sparks and shield orbit decoration | Already use the frame's `now` value. Some deliberately quantize for the pixel aesthetic.                                                                                                                                                                   | No general fractional-tick change needed.                                                                                                                                               |

## Validation

`tests/bomb-preview.test.ts` checks per-frame extension at 30/60/120 Hz, agreement with authoritative distances at whole ticks, unchanged authoritative rounding, and charge bounds. `tests/client.test.ts` and `tests/prediction.test.ts` cover time selection, prediction caps, clock loss, lifecycle resets, release/cancellation and snapshot immutability.

`scripts/bomb-preview-smoke.ts` supplies four consecutive 60 Hz frames to isolated Phaser WebGL, Phaser Canvas and original Canvas renderers, then reads actual pixels from the marker. It checks both a fractional world tick and a per-rider tick with the world held fixed. It also renders the bouncing ramp across its fold — ages 7.5 to 9 at a window of 8, where the marker walks out to full reach and back while a clamped ramp would sit still — because a new room bounces by default (#175), and paired against a clamped control so the flag is what moves the marker. CI runs it in both engines in the browser matrix. This is a rendering regression, not network or physical-phone qualification.

```sh
node --import tsx scripts/bomb-preview-smoke.ts
BROWSER=webkit node --import tsx scripts/bomb-preview-smoke.ts
npm run typecheck
npm run test:coverage
npm run build
```
