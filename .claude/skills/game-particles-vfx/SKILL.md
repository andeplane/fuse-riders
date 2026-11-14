---
name: game-particles-vfx
description: "Load when adding particles or VFX: explosions, magic, hit sparks, muzzle flashes, trails and ribbons, smoke and fire, weather (rain/snow), heat haze and shockwaves, dissolves, impact frames. Also load when choosing between three.quarks, three-nebula, TSL compute particles, Effekseer, sprite-sheet packs (kanaworks sakuga), Godot GPUParticles3D or Unity VFX Graph, or when particles tank the frame rate (overdraw)."
---

# Game particles and VFX

Default stack: three.js r187 + Vite + TS. All snippets were type-checked, and the core ones were also run: three.quarks burst/restart and three-nebula in Node; the TSL compute pool in headless Chrome on **both** the WebGPU and WebGL2 backends.
Related skills: `game-materials-shaders` (bloom, dissolve, distortion shaders, post), `game-design-fun` (hit feedback/juice), `game-performance-optimization` (budgets, KTX2), `game-art-review` (critique loop), `game-2d` (Phaser/Pixi particles).

## 1. Pick the system

| Need | three.js WebGPU | three.js WebGL | Godot 4 | Unity 6 | Not when |
|---|---|---|---|---|---|
| Gameplay VFX authored with curves/bursts/sub-emitters (hits, explosions, pickups, spells) | three-nebula `GPURenderer` from `three-nebula/webgpu`, or TSL sprites/compute (§4) | **three.quarks** (+ visual editor quarks.art) | `GPUParticles3D` (`CPUParticles3D` on very old GPUs) | Shuriken (CPU, works on WebGL); VFX Graph (GPU) | Over ~20k live particles on the CPU libs |
| 10k–1M particles: sparks, swarms, rain, snow, dust | **TSL compute** (`instancedArray` + `Fn().compute()`) | `GPUComputationRenderer` ping-pong, or `Points` + vertex-shader animation | GPUParticles3D + collision/attractors | **VFX Graph** (needs compute: not on WebGL2; WebGPU builds in 6.6+) | You need per-particle CPU logic (gameplay hits): use the CPU side |
| Premade anime/stylised effects from a library or VFX artist | Effekseer: EffekseerForWeb (preview, WebGL + WebGPU) | **EffekseerForWebGL 1.80.8** | EffekseerForGodot4 (needs Godot 4.6+) | EffekseerForUnity | You can't ship the runtime (1.4 MB WASM + 168 KB JS; asm.js fallback 2.9 MB), you need bloom on them without extra wiring, or you need deep gameplay coupling |
| Hand-drawn sakuga flipbooks (fire, water, thunder…) | **kanaworks-sakuga-vfx** sheets + `spritesheetUV` | same, via quarks `uTileCount/vTileCount` or `SpriteMaterial` UV offset | its Godot 4.3+ addon | its Unity 6 URP package | Studio ≥ $1M revenue (needs a licence) |
| Trails / ribbons / slashes | custom ribbon from a history buffer, or `Line2` + `Line2NodeMaterial` | **three.meshline 2.0** (`advance()`), quarks `RenderMode.Trail`, nebula `RibbonRenderer` | trails + `RibbonTrailMesh` (Forward+/Mobile only) | Trail Renderer / VFX Graph strips | Static lines: `Line2` is enough |
| Heat haze / shockwave / portal distortion | `backdropNode = viewportSharedTexture(screenUV + offset)` | postprocessing `ShockWaveEffect` or a refraction pass | `hint_screen_texture` in a spatial shader | Shader Graph Scene Color / Full Screen Pass | Mobile at full res: distort at half res |
| Big fire/smoke hero shots | flipbook soft particles; volumetric `webgpu_volume_fire` | flipbooks | GPUParticles + flipbook, FogVolume | VFX Graph flipbooks | Fill-rate-bound scenes |
| 2D web | (see `game-2d`) Phaser 4 particle emitter, PixiJS v8 `ParticleContainer` | | GPUParticles2D | | |

Library facts (verified 2026-10-31):
- **three.quarks**: 0.17.1 (May 2026), MIT, ~1.0k★, peer `three>=0.182`. Uses `ShaderMaterial`, so it is **WebGLRenderer-only**. WebGPU is on its roadmap, and `quarks.nodes` is stale (2024).
- **three-nebula**: 13.3.0 (Sep 2026), MIT, 1.2k★, revived. WebGL `SpriteRenderer` makes **one `THREE.Sprite` per particle** (one draw call each), so use `GPURenderer` (batched) instead. Use `system.tick(realDt)`, not `update()` per frame (2× speed on 120 Hz).
- **Effekseer**: MIT, 1.8k★ editor+runtime. The EffekseerForWebGL zip is downloaded, not on npm.
- **kanaworks-sakuga-vfx** (2026-10-29): 90 effects, 9 elements × 9 forms, PNG sheets + `.flipbook.json`. Its code is MIT; **its assets are not open source** (see §6).

## 2. What makes VFX read as "pro"
- **Layer it.** Anticipation (charge-up, 0.1–0.3 s), then a **flash** (1–3 frames, big, additive, HDR > 1 so bloom catches it), the **core** shape (flipbook or mesh), **sparks/debris** (stretched billboards with gravity, 0.2–0.6 s), **smoke/dust** (alpha-blended, slower, 1–3 s), **residue** (scorch decal, embers, a light that fades), plus camera shake, hit-stop and sound.
- **Timing:** fast in, slow out. Size-over-life curves that pop up and then ease. For anime/sakuga style, use held frames at 12 fps ("on twos"), sharp shapes and stepped motion, not smooth fades.
- **Blend modes:** additive for energy (fire core, magic, sparks); alpha for matter (smoke, dust, debris). Never put dark smoke in an additive material.
- **Colour:** only the hot core goes above 1.0. Keep the palette to 2–3 hues and tint from the element (fire: white→yellow→orange→red→dark smoke). Gameplay telegraphs must read on every background.
- **Light:** a short-lived `PointLight` from a pool of 2–4 (never create lights at runtime: it recompiles shaders), or an emissive ground decal.

## 3. Recipe: three.quarks (WebGLRenderer)
```ts
import { BatchedRenderer, ParticleSystem, RenderMode, ConstantValue, IntervalValue, ConstantColor, SphereEmitter,
  ApplyForce, ColorOverLife, Gradient, Vector3 as QV3, Vector4 as QV4 } from 'three.quarks'; // npm i three.quarks
const batch = new BatchedRenderer(); scene.add(batch);           // ONE per scene; it batches all systems
const sparks = new ParticleSystem({
  duration: 0.3, looping: false, autoDestroy: false, worldSpace: true,
  startLife: new IntervalValue(0.25, 0.6), startSpeed: new IntervalValue(8, 18), startSize: new IntervalValue(0.05, 0.15),
  startColor: new ConstantColor(new QV4(4, 2.2, 0.8, 1)),        // HDR → bloom
  emissionOverTime: new ConstantValue(0),
  emissionBursts: [{ time: 0, count: new ConstantValue(80), cycle: 1, interval: 0.01, probability: 1 }],
  shape: new SphereEmitter({ radius: 0.2 }),
  material: new THREE.MeshBasicMaterial({ map: sparkTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
  renderMode: RenderMode.StretchedBillBoard, rendererEmitterSettings: { speedFactor: 0.04 },
  behaviors: [ new ApplyForce(new QV3(0, -1, 0), new ConstantValue(9.8)),
    new ColorOverLife(new Gradient([[new QV3(1, 0.8, 0.4), 0], [new QV3(1, 0.2, 0), 1]], [[1, 0], [0, 1]])) ],
});
scene.add(sparks.emitter); batch.addSystem(sparks);
// loop: batch.update(dt); renderer.render(scene, camera)        — replay a pooled effect: sparks.restart()
```
**Use quarks' own `Vector3`/`Vector4`** (from `quarks.core`, re-exported), not `THREE.Vector3`, in colours, gradients and forces. tsc rejects THREE's. Smoke flipbook, sub-emitters, JSON from the editor, pooling and soft particles: `references/three-quarks.md`.

## 4. Recipe: GPU particle pool in TSL compute (WebGPURenderer)
```ts
import { Fn, If, instancedArray, instanceIndex, uniform, uint, float, vec2, vec3, hash, deltaTime, uv, mix, color } from 'three/tsl';
const MAX = 100_000;                                   // pool size = hard budget
const pos = instancedArray(MAX, 'vec3'), vel = instancedArray(MAX, 'vec3'), age = instancedArray(MAX, 'vec2'); // age.x / life.y
const uHead = uniform(0, 'uint'), uCount = uniform(0, 'uint'), uSeed = uniform(0, 'uint');
const uOrigin = uniform(new THREE.Vector3()), uSpeed = uniform(10);
const killAll = Fn(() => { age.element(instanceIndex).assign(vec2(1, 0)); })().compute(MAX);
// GATHER-style ring spawn: each thread writes only ITS element. Never element(otherIndex) — see pitfalls.
const spawn = Fn(() => {
  const i = instanceIndex, rel = i.add(uint(MAX)).sub(uHead).mod(uint(MAX));
  If(rel.lessThan(uCount), () => {
    const s = rel.add(uSeed);
    const dir = vec3(hash(s), hash(s.add(1)), hash(s.add(2))).mul(2).sub(1).normalize();
    pos.element(i).assign(uOrigin);
    vel.element(i).assign(dir.mul(uSpeed.mul(hash(s.add(3)).mul(0.7).add(0.3))));
    age.element(i).assign(vec2(0, hash(s.add(4)).mul(0.8).add(0.4)));
  });
})().compute(MAX);
const dt = deltaTime.min(1 / 30);                      // clamp: a hitch must not explode the sim
const update = Fn(() => {
  const a = age.element(instanceIndex);
  If(a.x.lessThan(a.y), () => {
    const v = vel.element(instanceIndex);
    v.y.subAssign(dt.mul(9.8)); v.mulAssign(float(1).sub(dt.mul(1.5)));
    pos.element(instanceIndex).addAssign(v.mul(dt)); a.x.addAssign(dt);
  });
})().compute(MAX);
const a = age.element(instanceIndex), t = a.x.div(a.y.max(1e-3)).clamp();
const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
mat.positionNode = pos.toAttribute();
mat.scaleNode = a.x.lessThan(a.y).select(float(0.15).mul(t.oneMinus()), float(0));   // dead = zero area
mat.colorNode = mix(color(0xffd27a), color(0xff3300), t).mul(2);
mat.opacityNode = uv().distance(vec2(0.5)).mul(2).oneMinus().clamp().mul(t.oneMinus());
const sprites = new THREE.Sprite(mat); sprites.count = MAX; sprites.frustumCulled = false; scene.add(sprites);
let head = 0, seed = 1;
renderer.compute(killAll);                              // after await renderer.init()
function burst(at: THREE.Vector3, n: number) {          // several bursts per frame are fine (verified)
  uOrigin.value.copy(at); uHead.value = head; uCount.value = n;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; uSeed.value = seed & 0xffffff;
  renderer.compute(spawn); head = (head + n) % MAX;
}
// each frame: renderer.compute(update); then pipeline.render() / renderer.render(scene, camera)
```
The ring buffer *is* the pool: no allocation, and the oldest particles are recycled when you are over budget. Variants (stretched sparks, flipbook smoke, soft particles, collisions against a depth heightmap, rain/snow) are in `references/tsl-compute-particles.md`.

## 5. Flipbooks, soft particles, distortion (TSL)
```ts
import { spritesheetUV, texture, uv, vec2, uniform, screenUV, viewportSharedTexture, mx_fractal_noise_float, vec3, time } from 'three/tsl';
import { softParticles } from 'three/addons/tsl/utils/SoftParticles.js';
const uFrame = uniform(0);                       // drive from JS so hit-stop/time-scale pauses it too
fx.colorNode = texture(sheet, spritesheetUV(vec2(8, 8), uv(), uFrame));  // frame 0 = top-left, row-major
fx.opacityNode = softParticles({ opacity: texture(sheet, spritesheetUV(vec2(8, 8), uv(), uFrame)).a, distance: 1, contrast: 2 });
// heat haze / shockwave: a quad whose offset fades to 0 at its edges, so the borders are invisible
const wob = mx_fractal_noise_float(vec3(uv().mul(4), time.mul(0.8)), 2), edge = uv().distance(vec2(0.5)).mul(2).oneMinus().clamp();
haze.backdropNode = viewportSharedTexture(screenUV.add(vec2(wob, wob.mul(0.5)).mul(0.03).mul(edge)));  // MeshBasicNodeMaterial, transparent, depthWrite:false
```
Soft particles fade where a sprite intersects geometry: they remove the hard "card cutting into the floor" line. quarks: `softParticles: true, softNearFade, softFarFade` + `batch.setDepthTexture(depthTex)`. Don't set `backdropAlphaNode` on a haze quad: it mixes in the material colour and shows the quad.

## 6. kanaworks-sakuga-vfx (licence first)
`github.com/kanaworksai-hue/kanaworks-sakuga-vfx` (Oct 2026, very new, few stars). The effects are 2048 px straight-alpha PNG sheets with transparent gutters, plus 1024 and additive-on-black variants. Each `.flipbook.json` gives `grid [cols,rows]`, `cell`, `frames`, `fps` (30), `loop`, `blend` (`alpha|additive`), `pivot` (0–1 from the top-left) and `bottom_inset`; releases add TexturePacker `.atlas.json`. It also ships a Unity 6 URP package, a Godot 4.3+ addon and a 4 KB Canvas2D player with PixiJS/Phaser/three examples.
**KanaWorks_AI VFX Asset License 1.0** (the Japanese text governs):
- Free, including commercial use, only if your annual gross revenue (with affiliates) is **under USD 1M**. At or above that you need a separate licence.
- **Credit is required:** `VFX: KanaWorks_AI (@KanaWorks_AI)`.
- You may modify the effects and train AI on them.
- You may **not** redistribute or sell them as an asset pack, or claim you made them.
- Code under `tools/`, `unity/`, `godot/` and `web/` is MIT.

Add the credit to `CREDITS.md` and the in-game credits the moment you import one. In three.js: `colorSpace = SRGBColorSpace`, `NormalBlending` for `alpha` sheets (straight alpha, `premultipliedAlpha` stays false), `AdditiveBlending` for the additive variant. `Sprite.center.set(pivot[0], 1 - pivot[1])`. Code is in `references/effekseer-and-flipbooks.md`.

## 7. Effekseer (premade or artist-made effects)
- Authoring: the Effekseer editor (Win/Mac/Linux, MIT) produces `.efkefc`. For an agent workflow, `kanaworksai-hue/effekseer-vfx-skill` (MIT, brand new) writes effects as Python recipes, builds them with EffekseerCore 1.80.7 and reviews Godot 4.7 renders. It only runs on macOS ARM or Windows x64.
- Web (WebGL): download `EffekseerForWebGL1.80.8.zip` (global script + `effekseer.d.ts`, not on npm). Then `effekseer.initRuntime('effekseer.wasm', cb)` → `ctx = effekseer.createContext(); ctx.init(renderer.getContext())`. Each frame: `ctx.update(dt*60)`, `renderer.render()`, set matrices, `ctx.draw()`, `renderer.resetState()`. It draws after three, so it skips tone mapping and bloom unless you wire it into the post input. Full type-checked code: `references/effekseer-and-flipbooks.md`.
- EffekseerForWeb (new repo, WebGL **and** WebGPU, `drawToRenderPass`, `setCameraFromThree`) has no releases yet: treat it as a preview.
- Godot: EffekseerForGodot4 (GDExtension, MIT; version 1.80.2+ needs Godot 4.6+; includes web export; in 2D, soft particles and depth don't work). Unity: EffekseerForUnity via the UPM git URL `https://github.com/effekseer/EffekseerForUnity_Release.git?path=Assets/Effekseer`.

## 8. Game-feel tie-in: shake, hit-stop, flash
```ts
let trauma = 0, hitStop = 0;                                   // add on hit: trauma += 0.3; hitStop = 0.06
function frame(realDt: number) {
  const simDt = hitStop > 0 ? 0 : realDt; hitStop = Math.max(0, hitStop - realDt);
  world.step(simDt); batch.update(simDt);                      // VFX freeze with the world during hit-stop
  trauma = Math.max(0, trauma - realDt * 1.5);
  const s = trauma * trauma, k = performance.now() / 1000 * 25;  // shake = trauma², smooth noise not Math.random
  shakeRig.position.set(noise(k) * 0.3 * s, noise(k + 100) * 0.3 * s, 0);
  shakeRig.rotation.z = noise(k + 200) * 0.05 * s;             // shakeRig = child of the camera rig, so aim is untouched
}
```
Hit-stop 40–80 ms on heavy hits only. Flash the target's emissive for 1–2 frames (`game-materials-shaders`, hit flash). Keep shake decaying, add a "reduce screen shake" option, and never shake the UI. Reference: Squirrel Eiserloh, "Juicing Your Cameras With Math" (GDC 2016).

## 9. Weather
Rain/snow = TSL compute in a **camera-following volume** (wrap particles around the camera instead of filling the world). The three examples `webgpu_compute_particles_rain` / `_snow` render a top-down orthographic "height/position" target and sample it in compute to stop drops at roofs and spawn splash ripples. Stretch raindrops along velocity, use about 10–30k drops, and draw splashes as a second instanced pool. Add wet-surface roughness darkening in materials and a fog density bump. Snow is slower, with a curl-noise drift (`three/addons/tsl/math/curlNoise.js`) and accumulation as a world-space mask in the terrain shader.

## 10. Perf budgets (overdraw is the killer)
- **Fill rate, not particle count, dominates.** A few hundred large, overlapping, screen-filling smoke sprites cost more than 100k tiny sparks. Budget "screens of overdraw" for VFX: about 2–4 full-screen layers on desktop, about 1 on mobile and integrated GPUs (rule of thumb; measure).
- Tricks:
  - Shrink big sprites and fade them out as they grow.
  - Use fewer, better flipbook frames instead of many overlapping sprites.
  - Trim sprite geometry to the opaque area (an octagon card instead of a quad for round textures).
  - Render particles to a half-res target and composite (GPU Gems 3 ch. 23).
  - Cut emission with distance (LOD) and cap simultaneous effects per type.
- CPU libraries (quarks/nebula): roughly 5–20k live particles. GPU compute: 100k–1M. Every distinct material or texture is another batch, so **atlas the VFX textures** and share materials.
- Pool everything: particle systems, lights, decals, audio. Pre-warm shaders at load (`renderer.compileAsync(scene, camera)`) by spawning each effect once off-screen. First-use stutter is the most common VFX bug.

## 11. Pitfalls
1. **WebGL2 fallback + scatter writes:** `WebGPURenderer` without WebGPU emulates compute with transform feedback. `element(otherIndex).assign(...)` silently writes to the wrong slot (it worked on WebGPU and failed on WebGL2 in our r187 test). Write gather-style: each thread writes `element(instanceIndex)`.
2. **vec3 storage readback** is padded to 4 floats on the WebGPU backend (`getArrayBufferAsync` returns stride 4) and to 3 on WebGL2. Index by backend, or use `vec4` buffers.
3. **Unclamped `deltaTime`** after a tab switch or hitch makes Euler drag negative and particles fly to infinity. Clamp it to 1/30.
4. three.quarks, three.meshline and pmndrs postprocessing on `WebGPURenderer` don't work (ShaderMaterial). Decide the renderer first.
5. Creating `new ParticleSystem`/materials/lights per hit causes GC and shader-compile hitches. Pool and `restart()`.
6. `depthWrite: true` on transparent particles gives black boxes and sorting holes. Use `depthWrite: false`; sort alpha-blended layers by `renderOrder`.
7. sRGB: flipbook colour textures need `SRGBColorSpace`; distortion and noise textures `NoColorSpace`.
8. Godot: particles vanish when the emitter's **Visibility AABB** is off-screen, so regenerate it (GPUParticles3D → Generate Visibility AABB). Trails and SDF collision are not available in the Compatibility renderer (web export).
9. Licences: kanaworks ≥ $1M revenue needs a licence and credit is always required. Effekseer sample effects carry their own terms; check each pack.

## 12. Verification
- **Deterministic capture:** seed the RNG (`uSeed`, nebula `setSeed`), step fixed `dt`s (nebula `update()` × N; quarks `batch.update(1/60)` × N; TSL: drive a uniform dt instead of `deltaTime` in tests), then screenshot **frame strips** at t = 0.05, 0.15, 0.4 and 1.0 s with Playwright. Hand them to `game-art-review`.
- **Numbers:** live-particle count (quarks `system.particleNum`; TSL: `await renderer.getArrayBufferAsync(age.value)` and count `x < y`). Assert the burst count, that everything dies by `maxLife`, and that the pool doesn't grow.
- **Overdraw heatmap:** a `?overdraw` flag swaps every particle material to additive white at 1/16 intensity with `depthWrite:false`. Read pixels and assert the 95th percentile is ≤ budget × 16/255.
- **GPU time:** `new WebGPURenderer({ trackTimestamp: true })` + `await renderer.resolveTimestampsAsync()`, or the Inspector. Measure the worst case: 10 explosions at once, in the camera's face.
- **No hitch on first use:** log frame time when each effect first spawns; it must stay under 2× the median.

## 13. Install instead of reinventing
- `three.quarks` editor: quarks.art/create (exports JSON → `QuarksLoader`). It also imports Unity Shuriken. Docs: quarks.art.
- `kanaworksai-hue/effekseer-vfx-skill` (Claude Code plugin: `/plugin marketplace add kanaworksai-hue/effekseer-vfx-skill`).
- `dgreenheck/webgpu-claude-skill` (TSL compute particle examples), `CloudAI-X/threejs-skills`.
- three.js examples to copy from: `webgpu_compute_particles`, `_rain`, `_snow`, `_fluid`, `webgpu_tsl_compute_attractors_particles`, `webgpu_particles_soft`, `webgpu_tsl_vfx_flames`, `webgpu_tsl_vfx_tornado`, `webgpu_tsl_vfx_linkedparticles`, `webgpu_volume_fire`.
- Engines: `references/godot-unity.md`. Recipes (explosion, fireball, slash, heal, portal, shockwave, muzzle flash): `references/recipes.md`.
