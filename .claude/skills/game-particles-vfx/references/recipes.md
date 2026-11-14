# VFX recipes (layer sheets + code for the non-obvious parts)

Each recipe is a list of layers. Build each layer with whatever system you picked in SKILL.md §1: quarks systems (WebGL), TSL pools or sprites (WebGPU), GPUParticles3D (Godot) or VFX Graph systems (Unity).

Notation:
- **A** = additive, **N** = normal alpha.
- Times are seconds from the trigger.
- Counts are for a mid-range desktop; halve them on mobile.

## Explosion (grenade, barrel)
| t | Layer | Blend | Count / size | Notes |
|---|---|---|---|---|
| 0–0.05 | Flash sprite | A | 1, 4–6 m | HDR colour ×4–8, scale 0.5→1.2 in 2 frames, gone by 0.08 s |
| 0 | Point light from a pool | - | 1 | Intensity spike, then exponential fall-off over 0.25 s, orange |
| 0–0.6 | Fireball flipbook | A, or N with emissive | 3–6 sprites, 2–3 m | 8×8 sheet; random rotation; scale-up with ease-out |
| 0–0.5 | Sparks | A, stretched | 60–120 | Speed 8–18 m/s, gravity, drag 1–2, life 0.25–0.6 |
| 0–0.3 | Shockwave | distortion | 1 ring | Radius 0→6 m over 0.3 s; amplitude fades (below) |
| 0.05–2.5 | Smoke | N (never A) | 8–16, 1.5–3 m | Dark grey, fade in 0.1 then out, grow ×1.5, rise 0.5 m/s, soft particles |
| 0–2 | Debris | opaque mesh | 6–12 | Lit, tumbling, gravity, bounce once, then fade/scale out |
| 0 | Scorch decal | N | 1 | `DecalGeometry` / Godot `Decal`; fade over 10–20 s; pool of 16–32 |
| 0 | Camera | - | - | `trauma += 0.4–0.6` scaled by distance; hit-stop only if the player caused it |

## Fireball / magic projectile
- **Core:** a small additive sphere sprite (HDR) plus a flipbook "boil" layer spinning slowly.
- **Trail:**
  - Continuous emission of small fire sprites in world space (`worldSpace: true`, about 60/s), shrinking over 0.3 s.
  - Plus a ribbon (quarks `Trail`, meshline or `SlashTrail`) of about 12 points.
- **Embers:** a few additive sparks per second, with low gravity and curl noise.
- **Impact:** a small explosion (flash + 30 sparks + smoke puff + decal). Reuse the explosion sheet at 0.5 scale.
- **Muzzle (cast):** a radial burst of 12 sparks plus a quick ring.
- **Rule:** the projectile itself is gameplay. Keep its silhouette readable; layers add to it and never hide it.

## Melee slash (anime style)
- **Ribbon:** `SlashTrail` between the blade base and tip, sampled at 60 Hz for the active frames only.
  - Texture: a soft-edged crescent with a bright rim at the tip edge.
  - Colour HDR ×2–3, fading over 0.12 s after the swing.
- **Hit:**
  - A 2–3 frame white flash on the target (emissive).
  - A **hit spark** (one big additive "star" sprite at a random rotation, 0.08 s).
  - 10–20 stretched sparks along the swing direction.
  - Hit-stop 50–80 ms.
  - An optional impact frame (full-screen inverted/monochrome flash for 2 frames, opt-in only: photosensitivity).
- **Sakuga flavour:** step the slash and spark animation at 12–15 fps (`Math.floor(t*12)/12`) while gameplay runs at 60; use hard-edged shapes; use the kanaworks sheets for slashes and impacts (licence!).

## Heal / buff (rising, soft, readable)
- A ground ring (`HorizontalBillBoard` or a flat quad; additive; scale 0.5→1.5; 0.6 s).
- Rising motes: 20–40 additive, upward 1–2 m/s, slight orbit (`OrbitOverLife` / an angular term in compute), fading out at the top.
- A vertical column (cylinder with an open top, scrolling noise texture, additive, `uv().y` fade) for 0.8 s.
- Colour language: green/gold for heal, blue for mana, red for damage buffs. Keep it consistent across the game.
- **Sustained buff:** a low-rate aura (5–10 motes/s, `worldSpace: false` so it follows the character) plus a rim-light pulse on the character material (`game-materials-shaders`, rim).

## Portal / spawn gate
- A **disc** with swirl: polar UV (`atan(d.y, d.x)`, `length(d)`), scroll the angle by time + radius, sample noise, additive, with an inner dark core (N).
- **Distortion** inside the rim (backdrop offset by swirl noise).
- **Particles** pulled inward: spawn on a ring and move to the centre. In compute: `v = normalize(center - p) * speed + tangent * swirl`. quarks: `GravityForce(center, k)` + `OrbitOverLife`.
- An **opening** animation: scale the disc 0→1 with overshoot (easeOutBack) over 0.4 s, plus a flash.

## Shockwave / heat distortion (WebGPU, tested on the WebGL2 fallback)
```ts
import { uv, uniform, screenUV, viewportSharedTexture, smoothstep } from 'three/tsl';
const uProgress = uniform(0);                                 // animate 0 → 1 over ~0.35 s with ease-out
const d = uv().sub(0.5), r = d.length().mul(2);
const band = smoothstep(uProgress.sub(0.15), uProgress, r).mul(smoothstep(uProgress.add(0.05), uProgress, r));
const strength = band.mul(uProgress.oneMinus()).mul(0.04);
const shockMat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
shockMat.backdropNode = viewportSharedTexture(screenUV.sub(d.normalize().mul(strength)));
const shock = new THREE.Sprite(shockMat); shock.scale.setScalar(4);   // pool it; hide when progress >= 1
```
For a ground-hugging ring, use a flat `Mesh` with the same material, so the wave follows the floor in perspective.

WebGL with pmndrs postprocessing:
```ts
const fx = new ShockWaveEffect(camera, pos, { speed: 1.25, maxRadius: 0.5, waveSize: 0.2, amplitude: 0.05 });
// put fx in an EffectPass, then fx.explode() on trigger
```

## Muzzle flash
- 1–2 frames only (0.03–0.05 s), not more.
- Three crossed additive quads: one facing the camera (a star) and two along the barrel (side flames), with random rotation and scale ±20% per shot.
- A point light from the pool for 1 frame.
- A smoke puff (2–3 N sprites) lingering 0.5 s.
- Brass: mesh debris with a pool of 32.
- First-person: render it in the weapon layer so it never clips into walls.

## Lightning / beam
- **Bolt:** midpoint displacement between start and end (5–6 subdivisions), regenerated every 2–3 frames. Draw with `Line2` (`LineMaterial` / `Line2NodeMaterial`), an additive HDR core plus a wider dim glow pass. Add branches at random midpoints, shorter and thinner.
- **Beam:** a cylinder or quad strip along the ray; UV-scroll a noise texture; additive; impact sparks and a decal at the hit point, plus a ring at the muzzle.
- **Light:** flicker a pooled point light at the midpoint.

## Pickup / loot sparkle
- An idle loop: 2–4 twinkle sprites (scale 0→1→0 in 0.4 s, random positions on the item bounds) and a slow bob/rotate of the item itself.
- A rarity colour beam (vertical additive quad, `uv().y` fade) that is visible from far away. This is gameplay information.
- On collect: 15 sparks flying to the HUD or player, and a quick flash on the item before it disappears.

## Footstep dust / landing
- On landing above a velocity threshold: 6–10 N sprites in a ring at the feet, moving outward along the ground with fast decay, lit colour sampled from the ground material. No sparks.
- Running: a puff every other step, at 30% opacity. Disable on clean floors (use a surface-type lookup).

## Death / dissolve
- The material dissolve (noise threshold + emissive edge band; `game-materials-shaders`, dissolve) over 0.6–1.0 s.
- Embers emitted from the edge: use `MeshSurfaceEmitter(geometry)` in quarks, or in compute sample random triangles of the mesh at spawn (`instancedArray` of triangle positions).
- Ground scorch or soul wisp rising last.

## Weather details
- **Rain:**
  - 15–30k stretched sprites in a box around the camera (about 30 × 20 × 30 m), wrapped (`p = mod(p - cam + half, size) + cam - half`), slightly tilted by wind.
  - Splashes: a second pool spawned at the height-map hit point (see `tsl-compute-particles.md`).
  - Also: ripple normal-map on puddles, darker and glossier ground (`roughness *= 0.4` where wet), denser fog, an ambient audio loop.
  - Lightning flashes come from the sky colour plus a directional light pulse, not from particles.
- **Snow:** 5–15k sprites, slow fall of 0.5–1.5 m/s, curl-noise sway, random size, `NormalBlending` (white additive snow glows wrongly at night). Accumulation goes in the terrain shader (world-up normal mask × snow amount).
- **Dust motes / pollen:** the stateless `range()` approach (no compute) within 10 m of the camera, catching light in god rays.
- **Indoors:** weather stops at roofs. Use the top-down height map, or volumes that kill particles.

## Screen shake (trauma model) + hit-stop
```ts
// Smooth 1D value noise in [-1, 1]: shake must be continuous, never Math.random() per frame.
function noise(x: number) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
  return h(i) * (1 - u) + h(i + 1) * u;
}
let trauma = 0, hitStop = 0, t = 0;
export function addTrauma(amount: number, distance = 0) { trauma = Math.min(1, trauma + amount / (1 + distance * 0.2)); }
export function addHitStop(seconds: number) { hitStop = Math.max(hitStop, seconds); }   // max, don't stack
export function frame(realDt: number) {
  const simDt = hitStop > 0 ? 0 : realDt; hitStop = Math.max(0, hitStop - realDt);
  t += realDt; trauma = Math.max(0, trauma - realDt * 1.5);
  const s = trauma * trauma * settings.shakeScale;            // user option 0..1 ("reduce screen shake")
  shakeRig.position.set(noise(t * 25) * 0.3 * s, noise(t * 25 + 100) * 0.3 * s, 0);
  shakeRig.rotation.z = noise(t * 25 + 200) * 0.05 * s;
  return simDt;                                               // feed physics, animation mixers and VFX with simDt
}
```
- Godot: `Engine.time_scale = 0.0` for the hit-stop, restored by `get_tree().create_timer(0.06, true, false, true)` (the last argument ignores time scale). Shake with `Camera3D.h_offset/v_offset` + `FastNoiseLite`.
- Unity: Cinemachine Impulse (shake), and `Time.timeScale = 0` + `WaitForSecondsRealtime` (hit-stop).

## Telegraphs (enemy attacks)
- A ground decal that fills from the centre or along the cone over the wind-up time (`uProgress` uniform), in the hostile colour.
- High contrast with an outline. Must read on every terrain colour, so test on the brightest and darkest ground.
- Never hide them under smoke: render telegraphs last (`renderOrder`) with `depthTest: false` if needed.
