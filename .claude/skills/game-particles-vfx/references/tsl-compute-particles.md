# GPU particles with TSL compute (WebGPURenderer, r187)

`import * as THREE from 'three/webgpu'` and `from 'three/tsl'`. One code path runs on WebGPU and on the WebGL2 fallback, provided you follow the gather rule below.

**What we tested (headless Chrome, SwiftShader, r187):**
- The SKILL.md §4 pool ran on both backends.
- The variant below (curl turbulence + ground bounce + velocity-stretched sprites + soft particles + per-particle flipbook) gave **identical** results on both backends: 3000 spawned, 2937 alive after 50 fixed steps, 0 below the ground, no NaN.
- The WebGL2 render was screenshot-checked: the stretched sparks were aligned to their motion.

## Building blocks
| Thing | API |
|---|---|
| Per-particle storage | `instancedArray(count, 'vec3' \| 'vec4' \| 'vec2' \| 'float' \| 'uint')` → `.element(instanceIndex)` in compute, `.toAttribute()` in materials |
| Compute kernel | `Fn(() => { ... })().compute(count)` → `renderer.compute(node)` (call after `await renderer.init()`; sync `computeAsync` is deprecated since r181) |
| Branch | `If(cond, () => {...}).Else(() => {...})`, `cond.select(a, b)` |
| Random | `hash(uintOrFloatSeed)` → [0,1). Seed with `instanceIndex` + a per-dispatch uniform seed |
| Time | `deltaTime`, `time` (from the renderer clock); for determinism, use your own `uniform(1/60)` |
| Noise | `mx_noise_float/vec3`, `mx_fractal_noise_*`, `curlNoise(p)` from `three/addons/tsl/math/curlNoise.js` |
| Draw everything | `new THREE.Sprite(SpriteNodeMaterial)` with `sprite.count = N`, or `new THREE.Mesh(geo, nodeMat)` with `mesh.count = N`; set `frustumCulled = false` |
| Sprite controls | `positionNode`, `scaleNode` (float or vec2), `rotationNode` (radians), `colorNode`, `opacityNode`, `sprite.center` (pivot) |
| Read back (tests, debug) | `await renderer.getArrayBufferAsync(buffer.value)`. Async and slow, so never use it in the frame loop |

## The two rules that bite
1. **Gather, don't scatter.** On the WebGL2 fallback, compute is emulated with transform feedback: thread *i* can only write element *i*. `buf.element(someOtherIndex).assign(...)` compiles, works on WebGPU, and silently corrupts on WebGL2. Spawning is therefore "every thread checks whether it is inside the new ring range" (SKILL.md §4). It costs a full-pool dispatch per burst, which is cheap (100k threads that mostly exit).
2. **Readback stride.** `vec3` storage reads back with a **stride of 4 floats on WebGPU** and 3 on WebGL2. Index with `const st = renderer.backend.isWebGPUBackend ? 4 : 3`, or store `vec4`.

Also:
- Clamp `deltaTime` (`deltaTime.min(1/30)`).
- Several `renderer.compute(spawn)` calls in one frame are fine: they are submitted in order.
- Uniform changes between dispatches are picked up per dispatch.

## Variant: sparks that bounce, curl-noise drift, stretched along velocity, soft
```ts
import { Fn, If, instancedArray, instanceIndex, uniform, uint, float, vec2, vec3, vec4, hash, uv, mix, color, atan, cameraViewMatrix, PI } from 'three/tsl';
import { softParticles } from 'three/addons/tsl/utils/SoftParticles.js';
import { curlNoise } from 'three/addons/tsl/math/curlNoise.js';
// pos/vel/age/uDt/spawn as in SKILL.md §4 (spawn dir biased upward: y = hash*0.8+0.2)
const update = Fn(() => {
  const a = age.element(instanceIndex);
  If(a.x.lessThan(a.y), () => {
    const p = pos.element(instanceIndex), v = vel.element(instanceIndex);
    v.addAssign(curlNoise(p.mul(0.4)).mul(uDt).mul(2));   // turbulence (curl = divergence-free, swirly)
    v.y.subAssign(uDt.mul(9.8));
    p.addAssign(v.mul(uDt));
    If(p.y.lessThan(0), () => {                           // ground plane bounce (see heightmap below for terrain)
      p.y.assign(0); v.y.assign(v.y.negate().mul(0.35)); v.x.mulAssign(0.7); v.z.mulAssign(0.7);
    });
    a.x.addAssign(uDt);
  });
})().compute(MAX);

const a = age.element(instanceIndex), t = a.x.div(a.y.max(1e-3)).clamp();
const vView = cameraViewMatrix.mul(vec4(vel.toAttribute(), 0)).xy;             // screen-ish velocity
const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
mat.positionNode = pos.toAttribute();
mat.rotationNode = atan(vView.y, vView.x).sub(PI.div(2));                       // long axis = motion
const w = float(0.05);
mat.scaleNode = a.x.lessThan(a.y).select(vec2(w, w.add(vView.length().mul(0.04))), vec2(0));
mat.colorNode = mix(color(0xfff0c0), color(0xff4400), t).mul(3);                 // HDR: bloom picks it up
const disc = uv().sub(0.5).mul(2).length().oneMinus().clamp();
mat.opacityNode = softParticles({ opacity: disc.mul(t.oneMinus()), distance: 0.5 });
```

## Variant: per-particle flipbook smoke (alpha-blended)
```ts
import { texture, spritesheetUV, floor } from 'three/tsl';
const frame = floor(t.mul(63));                                 // 8x8 sheet, frame 0 = top-left
const s = texture(smokeSheet, spritesheetUV(vec2(8, 8), uv(), frame));
smokeMat.colorNode = s.rgb.mul(lightTint);                     // NormalBlending, depthWrite false
smokeMat.opacityNode = softParticles({ opacity: s.a.mul(t.oneMinus()).mul(0.6), distance: 1 });
smokeMat.scaleNode = a.x.lessThan(a.y).select(t.mul(2).add(0.5), float(0));        // grow while fading = cheap overdraw
smokeMat.rotationNode = hash(instanceIndex).mul(6.283).add(t.mul(0.5));            // random start angle + slow spin
```
Give each particle a random start frame or spin (`hash(instanceIndex)`) so neighbours don't animate in lockstep. Sort is not needed for a single alpha layer of similar smoke. For mixed layers, use separate meshes with `renderOrder`.

## Variant: collide with terrain/roofs via a top-down height map
This is the three example `webgpu_compute_particles_rain`:
1. Use an `OrthographicCamera` looking straight down over the play area, with `layers` restricted to colliders.
2. `scene.overrideMaterial = new MeshBasicNodeMaterial({ colorNode: positionWorld })`, rendered into a `HalfFloatType` `RenderTarget` with `NearestFilter`.
3. In compute: `const ground = texture(rt.texture, p.xz.add(50).div(100)).y`, then `If(p.y.lessThan(ground), ...)`.
4. Re-render the height map only when colliders move, and centre it on the player for large worlds.

Sampling a texture inside compute on the WebGL2 fallback was not tested (unverified).

## Variant: stateless ambient particles (no compute at all)
For dust motes, embers in a forge or fireflies, you need no buffers: build positions from `instanceIndex` and `time`, e.g. `range(minVec3, maxVec3)` + `time.mul(speed).mul(range(.1,1)).mod(1)` (the three example `webgpu_particles`). These particles loop forever, cost nothing on the CPU, and work on WebGL2. They cannot react to the world.

## Continuous emission (trails of smoke behind a projectile)
```ts
let carry = 0;
function emitContinuous(at: THREE.Vector3, ratePerSec: number, dt: number) {
  carry += ratePerSec * dt; const n = Math.floor(carry); carry -= n;
  if (n > 0) burst(at, n);                      // one dispatch per emitter per frame; batch emitters if you have dozens
}
```
For many emitters, upload an emitter table (`instancedArray(maxEmitters, 'vec4')` with `array` filled from JS and `needsUpdate`) and let the spawn kernel pick its emitter from `rel` (unverified pattern; the gather rule still holds).

## Pool sizing and cost
- `MAX` is the budget. A ring buffer recycles the oldest particles, so a 100k pool never allocates. Keep one pool per blend mode (additive sparks, alpha smoke): each is one draw call.
- The update kernel runs over all `MAX` every frame, including dead particles. On integrated GPUs, 100k is about 0.2–0.5 ms (rule of thumb). It is the **fill rate** of big sprites that costs, not the kernel.
- Dead particles have `scaleNode = 0`, which gives degenerate triangles and zero fragments. Indirect draws with a live count (`IndirectStorageBufferAttribute`, example `webgpu_particles`) save the vertex work on huge pools (WebGPU only (unverified on the fallback)).

## Tests
```ts
const st = renderer.backend.isWebGPUBackend ? 4 : 3;
const P = new Float32Array(await renderer.getArrayBufferAsync(pos.value)), A = new Float32Array(await renderer.getArrayBufferAsync(age.value));
let alive = 0; for (let i = 0; i < MAX; i++) if (A[i*2] < A[i*2+1]) { alive++; if (!Number.isFinite(P[i*st+1])) throw new Error('NaN particle'); }
```
Run the page twice, with `new WebGPURenderer()` and with `{ forceWebGL: true }`, and with a fixed `uDt`. The counts must match. If WebGL2 shows fewer live particles, you wrote a scatter.

## Examples to copy from (threejs.org/examples)
- `webgpu_compute_particles`: 1M particles, click to push.
- `_rain` and `_snow`: height-map collision and ripples.
- `_fluid`: MLS-MPM.
- `webgpu_tsl_compute_attractors_particles`: orbits.
- `webgpu_compute_points`.
- `webgpu_tsl_vfx_flames`, `_tornado`, `_linkedparticles`: stylised shader VFX.
- `webgpu_particles_soft`.
- dgreenheck/webgpu-claude-skill ships more TSL compute particle templates (MIT).
