# Look and feel pass (10B–10D)

Presentation only. Rules, geometry, timing and player identity are unchanged by these phases (the rules change in 10A is separate). Everything here reads the engine view or feedback bursts and never feeds input.

## 10B: sharp rendering and a full-screen arena

**Density.** The scene used to render into a fixed 1600×900 canvas that the browser stretched. It now renders at the display's density, capped at 2×: `renderScale()` rounds `devicePixelRatio × screen width / 1600` to quarter steps. The camera zooms by that factor, so all world coordinates, collision drawing and input mapping are unchanged, and labels render at the same density. `?res=1`, `?res=1.5` or `?res=2` pins it for comparisons. A 1440-wide 2× laptop renders 2800×1575; a 4K TV renders 3200×1800.

**Texture reduction.** Phaser only builds mipmaps for power-of-two textures, and these sources are not. The keeper, hook, lantern, ledge and shrine sources were drawn at 5–25% of their size with plain bilinear sampling, which aliases ink lines into the crunchy look. At load, each sheet is cropped at full resolution (so frame alignment and alpha checks are unchanged) and then reduced once with stepped high-quality canvas downscaling to 1.3× its largest on-screen size at the current density. Backgrounds (1672 px) are left as they are.

**Full-screen focus.** On screens wider than 900 px without touch controls, **Focus arena** fills the viewport with the arena, letterboxed on a dark vignette. The match HUD (mode, roster, clock) floats in a slim band above the highest ledge, and **Show controls** stays top right. Touch layouts are unchanged because their pads sit outside the arena.

**Foreground frame.** `render/frame.ts` draws inked edge pillars, hanging corner chains and bells that sway slowly (redrawn at 20 fps), low ivy, and a vignette. The pillars sit behind keepers so a keeper at the wall stays readable. The bells and chains stay above y 130 at the corners, and nothing enters any ledge's space on either map.

## 10C: hand-drawn pass

- **Ink rope.** The tether is a tapered brush stroke (heavy at the keeper, fine at the hook) with an ink outline, highlight ticks and a slight 12 fps line wobble. A flying hook's rope ripples as it pays out. The spiked wire stays straight so the drawn line matches its lethal segment.
- **Light.** `render/light.ts` adds shafts from Crossroads' rose window (Belfry: the moon) with drifting motes, redrawn at 10 fps. Lantern and candle glows use additive blending, and each keeper carries a flickering lantern halo in their colour.
- **Paper grain.** A static fibrous paper texture is multiplied over the scene at low strength.
- **Stone keels.** Every ledge gets a painted stone keel baked once into a canvas: one of three silhouettes, gradient shading from upper-left light, brush-dab texture, joints, drips and an ink outline. It sits behind the ledge art and hangs at most about 32 units below it, clear of the row beneath.

## 10D: effects

`render/juice.ts` turns feedback bursts into longer-lived particles (capped at 220) and camera feedback:

| Event                                      | Effect                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook bites stone                           | Amber sparks and an inked crack that fades over 1.4 s                                                                                                         |
| Keeper or target hit                       | White ring, sparks in the attacker's colour, one-to-two-frame white flash on the victim, screen shake and a 1–2.5% zoom punch, stronger when you are involved |
| Orb pops                                   | Spinning confetti in the orb's colour and a ring                                                                                                              |
| Keeper knocked out                         | A light column rising from the fall point, sparks, a shake and (for your own keeper) a 3% zoom punch                                                          |
| Fast swing (over 450 units/s while hooked) | A tapered additive ribbon trail in the keeper's colour                                                                                                        |

Reduced motion drops shake, zoom punch, trails, the new sparks, rings, confetti and knockout column, the white hit flash, line wobble, sway and motes. It keeps the static crack decal and the existing action silhouettes. The **Atmosphere** toggle continues to stop environmental motion. In full-screen focus mode the floating HUD steps behind the arena while a countdown or result card shows.

## Verification

- `preview/look-check.mjs` opens a real room on a 1440×900 2× screen, asserts the 2800×1575 backing canvas and the full-screen arena, hooks and rope-jumps with the keyboard, and saves full-frame and 1:1 close-up screenshots.
- `preview/effects-check.mjs` hooks the Belfry knockback target with a keyboard shot and captures the impact frames.
- The existing Hook Havok smokes were rerun against these changes; the pull request lists the results.

These checks show the page renders without errors and the layout holds. They are not a frame-rate claim: rendering at 2× is about four times the fill of the old canvas. `?res=1` restores the old cost if a device struggles, and physical-phone and TV performance still need checking. Artistic acceptance needs a playtest.
