---
name: game-performance-optimization
description: Load when a game is slow, stutters, loads slowly, crashes or overheats on mobile, or before shipping to mobile web. It gives a profiling-first workflow (stats-gl, renderer.info, Spector.js, WebGPU timestamps, Chrome DevTools MCP) and fixes by bottleneck (instancing/BatchedMesh, LOD with meshoptimizer/gltfpack/glTF-Transform, KTX2, impostors, culling/BVH, shader warm-up, pooling, workers, dynamic resolution), with desktop/mobile budgets and Godot/Unity equivalents.
---

# Game performance optimization ("mesh optimization when performance sucks")

**Rule 0: measure, classify, then fix one bottleneck at a time.** Most "optimisations" an agent applies blind, like merging everything, LOD on everything or lowering shadows, either do nothing or move the cost elsewhere. Every change ships with a before/after number.

The default stack is three.js r18x (r187 current) + Vite + TS, `WebGLRenderer` or `WebGPURenderer` (TSL). Long material lives in `references/`:
- `profiling.md`: tools, HUD and Playwright bench harness;
- `asset-compression.md`: gltfpack, glTF-Transform, KTX2, texture math;
- `runtime-techniques.md`: instancing, LOD, impostors, culling, warm-up, pooling, workers, dynamic resolution;
- `engines.md`: Godot and Unity.

## Workflow (do these in order)

1. **Make it reproducible.** Add a `?bench` URL mode with a fixed seed, a scripted camera path or fixed camera, and a 3 s warm-up. Without it, numbers from two runs can't be compared.
2. **Instrument.** Install `stats-gl` (FPS/CPU/GPU panels). Expose `window.__perf = {calls, tris, textures, programs, cpuMs, frameMs, gpuMs}` from `renderer.info` (code in `references/profiling.md`).
3. **Classify the bottleneck** with the four toggles below. Record a baseline table: p50/p95 frame ms, draw calls, triangles, GPU ms, texture MB and download MB.
4. **Fix** with the decision table for that class only. Re-measure, and keep the change only if the number moved.
5. **Guard.** Add the bench to CI with budget assertions on the deterministic numbers (calls, triangles, texture MB, download MB). Run timings on real hardware.

### Classify in 2 minutes

| Toggle (at runtime, via GUI/URL flag) | If FPS jumps… | You are… |
|---|---|---|
| `renderer.setPixelRatio(0.5)` (or render at ¼ the pixels) | yes | **GPU fill/fragment-bound** (overdraw, heavy materials, post, shadows filtering, transparency) |
| Skip `renderer.render()` and keep updating | yes (and GPU ms was low) | **CPU render-submit bound** (draw calls, state changes, scene-graph traversal) |
| Skip the game update (physics/AI/mixers) and keep rendering | yes | **CPU logic-bound** (JS, GC, physics, animation). Profile it in the DevTools Performance panel |
| Swap all materials to `MeshBasicMaterial` at full res | no | **vertex-bound** (triangles, skinning, shadow passes re-drawing the scene) |
| None helps, but there are periodic spikes | — | **hitches**: shader compiles, GC, texture uploads, asset decode, BVH builds |
| Slow first load / tab crash on mobile | — | **memory/load**: uncompressed textures/meshes, too much VRAM |

Using GPU ms (stats-gl `trackGPU`, or WebGPU `trackTimestamp`) and CPU ms together is the fastest tell. **CPU ≫ GPU** means draw calls or logic. **GPU ≈ frame time** means fill or vertex.

## Decision table by bottleneck

| Bottleneck | three.js fix (first choice → next) | Why | Don't when | Godot / Unity |
|---|---|---|---|---|
| Draw calls (same mesh many times) | **`InstancedMesh`** → `@three.ez/instanced-mesh` (per-instance culling, BVH, LOD, shadow LOD, sorting) | One call for N copies | Instances move every frame **and** you need per-instance culling of 100k+ (BVH updates cost) | MultiMeshInstance3D / GPU Resident Drawer + GPU instancing |
| Draw calls (many different static meshes, one material) | **`BatchedMesh`** (multi-draw; per-object culling and sorting) → `SceneOptimizer.toBatchedMesh()` (addons, experimental) → `BufferGeometryUtils.mergeGeometries` for truly static clutter | Keeps per-object transforms and visibility | Objects need different materials (atlas them first) | Static batching / SRP Batcher, GPU Resident Drawer |
| Draw calls from materials | Texture **atlas / array textures** + one shared material; `gltf-transform palette` for flat-colour kits | Batching needs one material | Unique hero materials | Same |
| Too many shadow casters | Fewer casters (`castShadow=false` on small props), tighter shadow camera, CSM 2–3 cascades, bake static shadows | Each cascade/point light re-renders the scene (a point light is ×6) | — | Shadow distance, cascades, baked lightmaps |
| Vertex-bound | **LOD** (`THREE.LOD` with hysteresis, or InstancedMesh2/BatchedMesh LODs), generated with **meshoptimizer** (offline `gltf-transform simplify` / `gltfpack -si`, or runtime `MeshoptSimplifier`) → **impostors** for far vegetation | Triangles you can't see cost the same | Silhouette-critical hero assets (check error) | Godot auto mesh LOD on import + visibility ranges (HLOD); Unity 6.2 Mesh LOD / LOD Group |
| Off-screen work | Frustum culling (on by default, but **fix bounds**), BVH culling for instances, WebGPU **occlusion queries** (`obj.occlusionTest = true; renderer.isOccluded(obj)`), portal/room culling for interiors | Don't submit what isn't seen | Open fields with nothing to occlude | OccluderInstance3D bake; Unity GPU occlusion culling |
| Fill/overdraw | Cap **DPR ≤ 2** (mobile ≤ 1.5), **dynamic resolution**, alphaTest/alphaHash instead of blending for foliage, cheaper materials far away (Lambert/unlit/baked), half-res post (SSAO, bloom), FSR1/TAAU upscaling (`three/addons/tsl/display/FSR1Node.js`, `TAAUNode.js`) | Pixels × shader cost dominate on phones and 4K | — | Godot scaling_3d (FSR), Unity Render Scale / STP |
| CPU logic / GC | Pre-allocate temps, **object pools**, no per-frame closures/arrays, throttle far AI/mixers, physics/pathfinding in a **Worker** | GC pauses = 5–50 ms hitches | Premature: profile first | Same ideas; Jobs/Burst in Unity |
| Shader-compile hitches | **`await renderer.compileAsync(scene, camera)`** behind the loading screen; pre-instantiate effects off-screen; keep the light count constant | First use of a material/light combo compiles a program | — | Godot 4.4+ ubershader + pipeline precompile; Unity ShaderVariantCollection warmup |
| Download / load time | **Meshopt** (`EXT_meshopt_compression`) + quantization, **KTX2** textures, gzip/brotli on the server, progressive LOD (`@needle-tools/gltf-progressive`) | 5–20× smaller GLBs | — | Import compression; Addressables |
| VRAM / mobile crashes | **KTX2 (ETC1S for colour, UASTC for normals)**, `--texture-size 1024–2048`, dispose unused (`geometry.dispose()`, `texture.dispose()`), fewer render targets | A PNG decompresses to w×h×4×1.33 bytes in VRAM | — | ASTC/ETC2 import settings |
| Raycasts slow | **`three-mesh-bvh`** (`computeBoundsTree`, `acceleratedRaycast`, `firstHitOnly`) or physics-engine queries | Ray vs BVH instead of every triangle | Skinned/morphing meshes (use proxy colliders) | Physics raycasts |

## Recipes (short; full code in references)

### 1. Perf HUD + agent-readable numbers

```ts
import Stats from 'stats-gl';                         // MIT, v4.x
const stats = new Stats({ trackGPU: true, horizontal: false }); document.body.appendChild(stats.dom);
stats.init(renderer);                                 // WebGL or WebGPU renderer (WebGPU: after `await renderer.init()`)
renderer.info.autoReset = false;                      // count shadow + post passes too
renderer.setAnimationLoop(() => { renderer.info.reset(); update(); renderer.render(scene, camera); publishPerf(); stats.update(); });
```

`publishPerf()` writes `renderer.info.render.calls/triangles`, `info.memory.*` and `info.programs.length` to `window.__perf` (`references/profiling.md`).
- WebGPU: `new WebGPURenderer({ trackTimestamp: true })` → `await renderer.resolveTimestampsAsync('render')` returns GPU ms. `info.render.drawCalls` is the per-frame count.
- Or set `renderer.inspector = new Inspector()` from `three/addons/inspector/Inspector.js` for a built-in panel.

### 2. Offline asset optimisation (do this before any runtime trick)

```bash
npx @gltf-transform/cli inspect in.glb                  # read: draw calls, VRAM per texture, vertex count, animations
npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress ktx2 --texture-size 2048
#   keep named nodes for gameplay:  --join-named false --flatten false   (defaults join/flatten everything)
#   ktx2 needs KTX-Software (`ktx`/`toktx`) on PATH. Or use --texture-compress webp (smaller download, NOT smaller VRAM)
npx gltfpack -i in.glb -o out.glb -cc -tc -si 0.5 -kn   # meshopt + KTX2 + 50% simplify, keep named nodes (native binary recommended for -tc)
```

Flags, LOD-chain scripts and texture maths are in `references/asset-compression.md`.

### 3. Loader setup (required for compressed GLBs)

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer); // copy three/examples/jsm/libs/basis → public/basis
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2); // + setDRACOLoader if any Draco assets
```

### 4. Instancing and batching

```ts
const trees = new THREE.InstancedMesh(treeGeo, treeMat, N);
for (let i = 0; i < N; i++) trees.setMatrixAt(i, m.compose(p[i], q[i], s[i]));
trees.instanceMatrix.needsUpdate = true; trees.computeBoundingSphere();      // stale bounds = the whole forest vanishes/culls wrong
const batch = new THREE.BatchedMesh(maxInstances, maxVerts, maxIndices, sharedMat);
const rockId = batch.addGeometry(rockGeo); const id = batch.addInstance(rockId); batch.setMatrixAt(id, m);
```

### 5. LOD from meshoptimizer at runtime

Use `buildLODs(geometry, [0.5, 0.25, 0.1])`, which welds, simplifies with `MeshoptSimplifier.simplify` and returns geometries that share one vertex buffer. Then `lod.addLevel(mesh, distance, hysteresis)`. The code was tested on three r187 + meshoptimizer 1.3 and lives in `references/runtime-techniques.md`. For thousands of objects, use the LOD support built into InstancedMesh2 (`addLOD(geo, mat, dist)`, `addShadowLOD`) or BatchedMesh + `@three.ez/batched-mesh-extensions` (`addGeometryLOD`). three.js's own `webgl_batch_lod_bvh` example shows the latter.

### 6. Impostors for far vegetation

The chain is mesh, then a simplified mesh (~15–100 m), then an **octahedral impostor** (100 m+), with a **dithered cross-fade** between levels. That's the approach in Fortnite and in dgreenheck/tidewater. For three.js WebGL use `agargaro/octahedral-impostor` (MIT, WIP, ~66★; 200k-tree demo with InstancedMesh2). For WebGPU, bake your own atlas and fade with `material.maskNode` + `bayer16(screenCoordinate)` (see `references/runtime-techniques.md`).

### 7. Hitch killers

- **Shaders:** `await renderer.compileAsync(scene, camera)` after loading and before un-hiding. Add every material variant (shadows on, fog, skinned) to the scene for the call, including effects you'll spawn later.
- **Textures:** `renderer.initTexture(tex)` during loading so the GPU upload doesn't happen mid-game.
- **GC:** module-level `_v = new Vector3()` temps, pools for bullets/particles/decals (InstancedMesh + swap-remove), no `array.map/filter` in hot loops.
- **Lights:** adding or removing a light, or toggling `castShadow`, recompiles every lit material. Pre-create the lights and use `intensity = 0`.

### 8. Dynamic resolution

The `DynamicResolution` class feeds on GPU ms when available, otherwise rAF ms with upward probing, since vsync hides headroom. It drops 0.1 when over 115 % of the target and changes at most once per second. Simulated: 1.4 at heavy load, recovers to 2.0 when the scene gets cheaper. Code is in `references/runtime-techniques.md`.

## Budgets (rules of thumb at 60 fps, verify on target devices)

| Per frame | Desktop web (mid GPU, 1080p–1440p) | Mobile web (mid-range phone) |
|---|---|---|
| Frame time | 16.6 ms; aim ≤ 12 ms of work (120 Hz: 8.3) | aim ≤ 12 ms (thermal throttling), or lock 30 fps for heavy 3D |
| Draw calls (all passes) | ≤ 500–1,000 (WebGL); WebGPU + render bundles more | **≤ 100–200** (PlayCanvas guideline) |
| Visible triangles (incl. shadow passes) | 1–3 M | 100–300 k ("<100 k vertices if you can", McCurdy) |
| Full-mixer skinned characters | 30–100 | 5–20 |
| Texture VRAM | ≤ 0.5–1 GB, KTX2 strongly advised | **≤ 128–256 MB, KTX2 mandatory** |
| Max texture size | 2048 (4096 hero only) | 1024–2048 |
| Shadows | 2048 map, 3–4 cascades | 1024 map, 1–2 cascades, one shadowed light |
| Device pixel ratio | ≤ 2 | ≤ 1.5, dynamic 0.6–1.5 |
| Initial download | ≤ 20–50 MB | ≤ 10–20 MB, stream the rest |
| Shader programs (`info.programs.length`) | < 100 | < 30–50 |

These are reference points, not standards. dgreenheck/tidewater targets 60 fps at 2560×1267 on an M5 Pro and scales resolution down on slower machines.

## Pitfalls the model usually gets wrong

1. **Optimising without a baseline.** Always print the before/after table.
2. **`renderer.info` lies with post-processing.** It auto-resets on every `render()`. Set `autoReset = false` and `reset()` once per frame.
3. **Headless Chrome = SwiftShader.** GPU timings in CI are meaningless. Assert counts in CI and measure ms on real devices, headed or with GPU flags.
4. **WebP/AVIF textures reduce download, not VRAM.** Only KTX2 (Basis → BCn/ETC/ASTC) shrinks GPU memory.
5. **`gltf-transform optimize` defaults join and flatten nodes.** Gameplay that looks up named nodes, and animated hierarchies, can break. Pass `--join-named false` / `--flatten false` or run individual commands. `simplify` needs `weld` first (optimize does it).
6. **Simplifying skinned or UV-seamed meshes:** weld first, keep the error small (`--simplify-error 0.001`), and check silhouettes. Never simplify below the point where the skin weights break.
7. **InstancedMesh culling** uses one bounding sphere for all instances. Call `computeBoundingSphere()` after moving instances, or use InstancedMesh2 for per-instance culling.
8. **Skinned meshes** have bind-pose bounds, so they pop out at screen edges. Pad the bounds; don't simply disable culling for 100 NPCs.
9. **`setPixelRatio` every frame** reallocates the canvas and render targets. Change it ≤ 1×/s with hysteresis.
10. **`renderAsync()` is deprecated (r181+).** For WebGPU: `await renderer.init()` once, then `render()`. `Clock` is deprecated (r183) in favour of `THREE.Timer`.
11. **KTX2 `detectSupport` before `renderer.init()`** (WebGPU) gives wrong formats. Forgetting the transcoder path shows black textures.
12. **Transparent foliage.** Blending + depth sorting is slow and wrong. Use `alphaTest` or `alphaHash` (with TAA) instead.
13. **Merging everything into one mesh** kills frustum culling and LOD. Merge per spatial cell (e.g. 32 m chunks), or use BatchedMesh.
14. **Measuring in dev mode with DevTools open, an HMR overlay, or `console.log` in the loop.** Bench a `vite build && vite preview` build.

## Verification

- **Bench script (Playwright):** open `/?bench=scene&seed=1` on the `vite preview` build, wait for `__perf.calls > 0` plus 3 s of warm-up, then sample `window.__perf` every 50 ms for 6 s. Report p50/p95 `frameMs`, max `calls`, max `tris`, `gpuMs` and texture MB. Fail CI when the deterministic budgets are exceeded. Code is in `references/profiling.md`.
- **Before/after table** in the PR or commit for every optimisation. A change with no measurable gain gets reverted.
- **Chrome DevTools MCP:** `performance_start_trace` (reload + autoStop) → `performance_analyze_insight`. Use `emulate { cpuThrottlingRate: 4, viewport: "390x844x3,mobile,touch" }` for a phone-like CPU, then check long tasks and GC.
- **Visual regression:** screenshot the bench view before and after LOD or impostor changes. Pixel-diff against a threshold, and eyeball popping at the LOD distances by flying the camera path.
- **Asset gate:** `gltf-transform inspect` output in CI. Assert no PNG/JPEG textures in shipped GLBs (all KTX2), that the meshopt extension is present, and that the file size is under budget.

## Install instead of reinventing

- `CloudAI-X/threejs-skills` → `threejs-performance` (MIT, ~3.7k★). `majidmanzarpour/threejs-game-skills` → `threejs-debug-profiler`.
- `ChromeDevTools/chrome-devtools-mcp` (Apache-2.0, ~53k★): `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`, or its plugin (`/plugin marketplace add ChromeDevTools/chrome-devtools-mcp`) which also ships skills.
- `zeux/meshoptimizer` (MIT, ~8.3k★; npm `meshoptimizer` 1.3, `gltfpack` 1.3); `donmccurdy/glTF-Transform` (`@gltf-transform/cli` 4.5).
- `gkjohnson/three-mesh-bvh` (MIT, ~3.5k★); `agargaro/instanced-mesh` (MIT); `RenaudRohlinger/stats-gl` (MIT); `BabylonJS/Spector.js` (MIT, WebGL capture); `brendan-duncan/webgpu_inspector` (MIT).
- `dgreenheck/webgpu-claude-skill` for WebGPU/TSL specifics. `dgreenheck/tidewater` is a reference for dynamic resolution, impostor vegetation and dithered LOD fades.
- Related skills: `game-debug-tools` (overlays), `game-asset-pipeline` (sourcing), `game-characters-animation` (crowds).
