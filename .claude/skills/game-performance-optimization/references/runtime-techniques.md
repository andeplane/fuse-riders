# Runtime techniques (three.js r18x)

Snippets marked **(tested)** ran in Node against `three@0.187.0` / `meshoptimizer@1.3.0`. The others use APIs verified in the r187 sources.

## 1. Instancing & batching

**InstancedMesh:** one geometry and one material, N transforms.
- After writing matrices, set `instanceMatrix.needsUpdate = true` **and** call `computeBoundingSphere()`. Culling uses one sphere for all instances.
- For per-instance colour, call `setColorAt(i, color)` and then `instanceColor.needsUpdate = true`.
- For per-instance custom data (WebGPU/TSL), use `instancedBufferAttribute(new THREE.InstancedBufferAttribute(arr, 1))` in a node material.

**`@three.ez/instanced-mesh`** (InstancedMesh2, MIT, v0.3.16, Oct 2026) adds per-instance frustum culling, a dynamic BVH, LOD, shadow LOD, sorting, opacity, per-instance uniforms and skinning:

```ts
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
const trees = new InstancedMesh2(treeGeoHi, treeMat, { capacity: 50_000 });
trees.addInstances(50_000, (obj, i) => { obj.position.copy(points[i]); obj.rotateY(Math.random() * 6.28); });
trees.addLOD(treeGeoMid, treeMat, 40);      // distance thresholds
trees.addLOD(treeGeoLow, treeMat, 120);
trees.addShadowLOD(treeGeoLow);             // shadows from cheap geometry
trees.computeBVH({ margin: 0 });            // static scatter → fast culling + raycast
```

**BatchedMesh:** different geometries, one material, one multi-draw.

```ts
const batch = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, sharedMaterial);
const ids = geometries.map((g) => batch.addGeometry(g));        // reserve space per geometry
const inst = batch.addInstance(ids[2]); batch.setMatrixAt(inst, matrix); batch.setColorAt(inst, color);
batch.perObjectFrustumCulled = true; batch.sortObjects = true;   // defaults; sorting reduces overdraw for opaque
```

- For LOD + BVH on BatchedMesh, use `@three.ez/batched-mesh-extensions` + `@three.ez/simplify-geometry` + `three-mesh-bvh` (official example `webgl_batch_lod_bvh`). Call `extendBatchedMeshPrototype()`, then `addGeometryLOD(geometryId, lodGeo, screenRatio)`, `computeBVH(THREE.WebGLCoordinateSystem)`.
- Auto-batching an existing scene: `new SceneOptimizer(scene).toBatchedMesh()` from `three/addons/utils/SceneOptimizer.js` is **experimental**. Verify the draw-call drop and the visuals.
- Static scene graph: `obj.matrixAutoUpdate = false; obj.updateMatrix()` for things that never move. It saves CPU on big scenes.

## 2. LOD with meshoptimizer at runtime (tested)

```js
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js'; // or: import { MeshoptSimplifier } from 'meshoptimizer'

/** Build LOD index buffers that share LOD0's vertex buffer. ratios = fraction of triangles to keep.
 *  maxError is relative to mesh extent (0.01 = 1%). lockBorder for terrain chunks / modular pieces. */
export async function buildLODs(geometry, ratios = [0.5, 0.25, 0.1], { maxError = 0.02, lockBorder = false } = {}) {
  await MeshoptSimplifier.ready;
  const src = geometry.index ? geometry : mergeVertices(geometry);       // simplifier needs indexed, welded verts
  const positions = src.attributes.position.array;
  const stride = src.attributes.position.isInterleavedBufferAttribute ? null : 3;
  if (!(positions instanceof Float32Array) || !stride) throw new Error('need non-interleaved float32 positions (dequantize first)');
  const indices = new Uint32Array(src.index.array);
  return ratios.map((r) => {
    const target = Math.floor((indices.length * r) / 3) * 3;
    const [lod, error] = MeshoptSimplifier.simplify(indices, positions, stride, target, maxError, lockBorder ? ['LockBorder'] : []);
    const g = new THREE.BufferGeometry();                  // share LOD0's attribute objects → one GPU vertex buffer
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(lod, 1));
    g.boundingSphere = src.boundingSphere ?? (src.computeBoundingSphere(), src.boundingSphere);
    g.userData.lodError = error;
    return g;
  });
}
export async function makeLOD(mesh, distances = [0, 20, 45, 90], hysteresis = 0.1) {
  const geos = await buildLODs(mesh.geometry, [0.5, 0.25, 0.1]);
  const lod = new THREE.LOD();
  [mesh.geometry, ...geos].forEach((g, i) => lod.addLevel(new THREE.Mesh(g, mesh.material), distances[i], hysteresis));
  lod.position.copy(mesh.position); lod.quaternion.copy(mesh.quaternion); lod.scale.copy(mesh.scale);
  return lod;
}
```

Result on a 16k-triangle torus knot: 8192/4096/1638 tris at relative errors 0.0010/0.0022/0.0049. All levels share LOD0's GPU vertex buffer.

**Notes:**
- `THREE.LOD` picks levels by camera distance. Use `hysteresis` (0.1 = 10 %) to stop flicker at the boundaries. `lod.autoUpdate` is true by default.
- The simplifier needs float32 non-interleaved positions. Meshopt/quantized GLBs come in as normalized int16 attributes, so build LODs **offline** for those, or dequantize first.
- `BufferGeometry.clone()` shares `userData` by reference. Don't store per-LOD data there on clones.
- For far LODs that may break topology, `MeshoptSimplifier.simplifySloppy` gets there faster. `simplifyWithAttributes` preserves UV and normal seams better (attribute weights ~0.5–1).
- **Progressive streaming:** `@needle-tools/gltf-progressive` (MIT) loads low LODs and textures first, then upgrades. three.js example `webgl_loader_gltf_progressive_lod`.
- **Meshlets / cluster LOD (experimental, WebGPU):** three.js r18x examples `webgpu_meshlets*` use `MeshletDrawingPipeline` / `VisibilityBufferDrawingPipeline` (`three/addons/pipelines/`) with `MeshletGeometryUtils` (64-triangle clusters + simplified chains, using meshopt clusterizer). It's Nanite-like but new. Prototype only, and check the docs.

## 3. Impostors & dithered LOD fades

- **Ladder for vegetation:** full mesh (0–15 m) → simplified (15–100 m) → octahedral impostor quad (100 m+). Cross-fade with screen-door dithering, not alpha blending, so there's no sorting and no double-transparency.
- **WebGL library:** `agargaro/octahedral-impostor` (MIT, WIP, ~66★, not on npm: install from GitHub). Its API from the source:

```ts
const impostor = new OctahedralImpostor({
  renderer, target: treeMesh, useHemiOctahedron: true, baseType: THREE.MeshStandardMaterial,
  spritesPerSide: 16, textureSize: 2048, /* alphaClamp, transparent… */ });   // bakes the atlas, returns a Mesh
```

  Its demo uses InstancedMesh2 with 200k trees: LOD1 is meshopt-simplified at 15–100 m, the impostor beyond 100 m. Check the source for the current parameters (it's unstable).
- **Bake your own** (any renderer):
  1. Pick N×N view directions on a (hemi-)octahedron. Cell centre uv → `octDecode` → direction.
  2. For each direction, render the object with an `OrthographicCamera` fitted to its bounding sphere into tile (i, j) of one render target (`setViewport` + `setScissor` + `setScissorTest(true)`). Write albedo+alpha in one target and normal+depth in a second for relit impostors.
  3. At runtime draw a camera-facing quad. In the shader, convert the view direction to object space, `octEncode` → grid uv, then sample the nearest frame (cheap) or blend 3 frames (smooth). Use alpha-test.
- **Dithered cross-fade (WebGPU/TSL)**, using the `maskNode` + `bayer16` pattern from three.js `webgpu_tsl_occlusion_dither`:

```ts
import { uniform, screenCoordinate } from 'three/tsl';
import { bayer16 } from 'three/addons/tsl/math/Bayer.js';
const fade = uniform(1);                                    // 1 = mesh fully shown, 0 = impostor fully shown
const threshold = bayer16(screenCoordinate).r.mul(255 / 256);
meshMaterial.maskNode = threshold.lessThan(fade);           // complementary masks: no holes, no overlap
impostorMaterial.maskNode = threshold.greaterThanEqual(fade);
// per-instance fade: replace the uniform with instancedBufferAttribute(fadeAttr) (check TSL docs)
```

  For WebGL classic materials, use `material.alphaHash = true` with `opacity` as the fade (stochastic, best with TAA), or a custom `onBeforeCompile` discard against a Bayer matrix.

## 4. Culling

- **Frustum culling** is automatic per `Object3D`, but only as good as its bounds. Fix them for instanced meshes (`computeBoundingSphere`), skinned meshes (padded sphere) and shader-displaced geometry (manual `boundingSphere`, or `frustumCulled = false` only for a few objects).
- **Per-instance culling:** InstancedMesh2 or BatchedMesh `perObjectFrustumCulled`. Use a BVH (`computeBVH`) when there are more than ~10k static instances.
- **Occlusion (WebGPU):** `mesh.occlusionTest = true`, then `renderer.isOccluded(mesh)` on the next frame (example `webgpu_occlusion`). The query result lags a frame. Use it for big occluders and expensive occludees (buildings, interiors), not for grass.
- **Cells/portals:** for interiors and dungeons, keep a room graph and toggle `visible` per room from the camera's room + portal frustum tests. This is cheap and deterministic, and it beats generic occlusion indoors.
- **Shadow culling:** `castShadow = false` on small props and grass. Use `shadow.camera` bounds that hug the view, and a cheaper `customDepthMaterial` for alpha-tested foliage.

## 5. Raycasts and spatial queries: three-mesh-bvh (MIT, ~3.5k★, v0.9.17)

```ts
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, computeBatchedBoundsTree } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
terrain.geometry.computeBoundsTree();
raycaster.firstHitOnly = true;                 // big win for picking / ground probes
// big meshes: build off-thread (geometry buffers are transferred while it runs)
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
const bvhWorker = new GenerateMeshBVHWorker();
geometry.boundsTree = await bvhWorker.generate(geometry);
```

- BVHs are static. For skinned or morphing meshes, raycast against proxy capsules on bones.
- `three-mesh-bvh/webgpu` now ships WGSL/TSL BVH functions for GPU queries (check docs).

## 6. Hitches: shaders, uploads, GC

```ts
// loading screen
await renderer.compileAsync(scene, camera);            // compiles every material×light×fog×shadow combo in the scene
for (const t of allTextures) renderer.initTexture(t);  // upload now, not on first sight
// pre-warm effects that spawn later: add them to a hidden group in `scene` during compileAsync, then remove
```

- Keep the **light count and shadow flags constant** after warm-up. Use `intensity = 0` instead of add/remove, which would recompile all lit materials.
- WebGL compiles in parallel only with `KHR_parallel_shader_compile`. WebGPU `compileAsync` doesn't block rendering (r184+). dgreenheck/tidewater still needs about 1 min on first load for hundreds of WGSL pipelines, so show progress.
- **GC:** module-scope temporaries (`const _v = new THREE.Vector3()`), no `new` in `update()`, no `array.map/filter/forEach` closures in hot loops, `for` loops over typed arrays. Check the DevTools Memory/Performance panel for a sawtooth heap and "Minor GC" every few frames.

### Object pool on one InstancedMesh (tested)

```js
import * as THREE from 'three';
/** Fixed-capacity pool on one InstancedMesh: O(1) spawn/despawn, zero allocations, one draw call. */
export class InstancePool {
  constructor(mesh, onMove = (from, to) => {}) {
    this.mesh = mesh; this.onMove = onMove; this.count = 0; this._m = new THREE.Matrix4();
    mesh.count = 0; mesh.frustumCulled = false;            // instances spread out: one sphere is useless
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  spawn(pos, quat, scale) {
    if (this.count >= this.mesh.instanceMatrix.count) return -1;  // full: caller decides (drop / recycle oldest)
    const i = this.count++;
    this.mesh.setMatrixAt(i, this._m.compose(pos, quat, scale));
    this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }
  despawn(i) {                                              // swap-remove: last instance moves into slot i
    const last = --this.count;
    if (i !== last) { this.mesh.getMatrixAt(last, this._m); this.mesh.setMatrixAt(i, this._m); this.onMove(last, i); }
    this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
```

Keep an `entity ↔ slot` map and update it in `onMove`. The same pattern works for decals, projectiles and pickups.

## 7. Workers & OffscreenCanvas

- **Render in a worker** when the main thread is busy with UI or framework work:
  - main thread: `const off = canvas.transferControlToOffscreen(); worker.postMessage({ canvas: off, w, h, dpr }, [off])`;
  - worker: `new THREE.WebGLRenderer({ canvas })` (or `WebGPURenderer`; `navigator.gpu` exists in workers in Chrome), then `renderer.setSize(w, h, false)` (no CSS in workers).
  - Forward pointer and keyboard events with `postMessage`. Use `ImageBitmapLoader`, since there is no DOM `Image`. Example: `webgl_worker_offscreencanvas`. stats-gl has a worker mode (`StatsProfiler`).
- **Simulation in a worker** (physics, pathfinding, procgen) is usually the bigger win. For zero-copy transforms via `SharedArrayBuffer`, add COOP/COEP headers:

```ts
// vite.config.ts
export default { server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
                 preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } } };
```

  COEP blocks cross-origin assets without CORP/CORS headers, so test your CDN.
- **Not when** the frame is GPU-bound. Workers don't make the GPU faster.

## 8. Dynamic resolution (tested in a frame-cost simulation)

```js
/** Dynamic resolution with hysteresis. Feed GPU ms when you have it (WebGPU timestamps / stats-gl),
 *  otherwise rAF frame ms (then upscaling is probed, because vsync hides headroom). */
export class DynamicResolution {
  constructor(apply, { targetMs = 1000 / 60, min = 0.5, max = 2, step = 0.1, haveGpuTime = false } = {}) {
    Object.assign(this, { apply, targetMs, min, max, step, haveGpuTime });
    this.scale = max; this.ema = targetMs; this.cool = 0; this.calm = 0; this.probeWait = 3000; this.probing = false;
    apply(this.scale);
  }
  update(ms) {
    this.ema += (ms - this.ema) * 0.1;
    this.cool -= ms; if (this.cool > 0) return this.scale;
    if (this.ema > this.targetMs * 1.15) {                                    // too slow: drop
      if (this.probing) this.probeWait = Math.min(this.probeWait * 2, 60000); // failed probe: back off
      this.probing = false; this.calm = 0;
      this.set(this.scale - this.step);
    } else if (this.haveGpuTime ? this.ema < this.targetMs * 0.7 : (this.calm += ms) > this.probeWait) {
      this.probing = !this.haveGpuTime; this.calm = 0;                         // rAF-only: probe upward
      this.set(this.scale + this.step);
    } else if (this.probing && this.cool < -2000) { this.probing = false; this.probeWait = 3000; } // probe held 2 s: keep
    return this.scale;
  }
  set(s) {
    const n = Math.round(Math.min(this.max, Math.max(this.min, s)) * 100) / 100;
    if (n !== this.scale) { this.scale = n; this.apply(n); this.cool = 1000; } // ≤1 change/s (resizes render targets)
  }
}
```

Usage:

```ts
const baseDpr = Math.min(devicePixelRatio, isMobile ? 1.5 : 2);
const dr = new DynamicResolution((s) => { renderer.setPixelRatio(s); composer?.setPixelRatio?.(s); },
  { max: baseDpr, min: 0.5, haveGpuTime: !!perf.gpuMs });
// each frame: dr.update(perf.gpuMs ?? perf.frameMs)
```

**Simulation** (GPU cost ∝ pixels; the scene gets 2.25× cheaper at 20 s):
- with GPU timing: settles at 1.4, then rises to 1.8;
- with rAF only (probing): 1.4, then recovers to 2.0;
- at most one change per second.

**Alternatives:**
- Render the scene into a lower-res target and upscale with `FSR1Node` / `TAAUNode` (TSL addons). The HUD stays sharp. dgreenheck/tidewater uses this TAAU approach.
- On a stable 120 Hz display, target 8.3 ms or cap at 60.

## 9. Materials & fill

- Far objects can use `MeshLambertMaterial` (IBL via `scene.environment` since r183) or unlit instead of Standard/Physical.
- Use `alphaTest` for foliage. Avoid `transparent` on large surfaces.
- Turn off `antialias` when you use TAA/FXAA/SMAA post. Run SSAO/bloom at half resolution.
- Bake ambient occlusion and lighting into textures or vertex colours for static scenes (Blender bake via blender-mcp).
