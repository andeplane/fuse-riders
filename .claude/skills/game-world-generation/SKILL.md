---
name: game-world-generation
description: Load when generating terrain or open worlds - noise heightmaps, domain warping, hydraulic/thermal erosion, rivers and biomes, vegetation/prop scattering (Poisson, blue noise, InstancedMesh/BatchedMesh), chunk streaming, terrain LOD (geomipmaps, CDLOD, clipmaps), heightfield colliders, or importing World Machine/Gaea/World Creator heightmaps into three.js, Godot (Terrain3D) or Unity. Also load for seeded determinism and golden-hash tests of any worldgen.
---

# Game world generation (terrain + open worlds)

The best browser worlds are procedural *in code*: a seeded height function, a real erosion pass, scattered
instanced vegetation, and a shader that sells it. This skill gives the pipeline, the per-engine choices, and the
traps. Long code lives in `references/`:

- `references/erosion-hydrology-biomes.md`: droplet + thermal erosion (CPU), GPU erosion with TSL compute, priority-flood pit filling, D8 rivers, biome lookup.
- `references/streaming-lod-physics.md`: chunk manager + worker pool, skirts, geomipmap/CDLOD/clipmap, Rapier/Jolt/Godot colliders, floating origin.
- `references/engine-pipelines.md`: Godot (FastNoiseLite, Terrain3D, Gaea, HeightMapShape3D), Unity terrain, and World Machine / Gaea / World Creator export.

## The pipeline (keep this order)

```
seed ─► fields (height, moisture, temperature)        pure functions of (seed, x, z): CPU, deterministic
     ─► erosion (region-level, not per chunk)          non-local: needs a whole tile + apron
     ─► hydrology (pit fill → flow accumulation → rivers/lakes)
     ─► biomes (elevation × moisture × slope lookup)
     ─► scatter (vegetation, rocks, POIs; seeded per cell)
     ─► mesh + LOD (worker) ─► colliders (near player only) ─► materials / sky / water (dressing)
```

Rule 1: **the CPU height function is the source of truth.** GPU displacement (TSL) is for visuals only.
Physics, spawning, AI and saves need the same numbers on the CPU. If heights only exist in a vertex shader,
you'll end up reading the GPU back or the player will fall through the world.

Rule 2: **one seed → many named sub-seeds.** Never share one RNG stream across chunks or features.
`hashSeed(worldSeed, cx, cz, FEATURE_ID)` gives every chunk/feature its own stream, so generation order
(which depends on where the player walks) can't change the world.

## When to use what

| Problem | three.js / web (default) | Godot 4.4+ | Unity 6 | Why | When NOT |
|---|---|---|---|---|---|
| CPU noise | `simplex-noise` 4.x + `alea` (tiny, 2D-4D). `fastnoise-lite` when you need cellular/Voronoi, domain warp, built-in fractals | Built-in `FastNoiseLite` resource | `Unity.Mathematics.noise.snoise`, or FastNoiseLite C# | Deterministic. ~20 M raw noise calls/s in Node; Recipe 1 (13 calls) ≈ 1.8 M heights/s, so a 65² chunk takes ~2-3 ms | Don't call noise per-vertex per-frame on the main thread |
| GPU noise | TSL `mx_noise_float` / `mx_fractal_noise_float` (see three.js `webgpu_tsl_procedural_terrain`) | `NoiseTexture2D` or shader noise | Shader Graph | Huge vertex counts, animated, visual-only detail | Anything gameplay reads, and anything that must match the CPU |
| Native/C++/WASM engine | **FastNoise2** (C++17 SIMD node graph, WASM SIMD, MIT) | via godot_voxel (module build) | C# bindings | SIMD (SSE2…AVX512, NEON, WASM SIMD), much faster than scalar ports | Plain three.js; the JS ports are simpler |
| Erosion, ≤1024² | Droplet erosion in a worker (`references/erosion…`) | Same in GDScript/C# or GDExtension, or bake offline | Same in Burst job | Gullies and alluvial fans in seconds of worker time | Infinite worlds (erosion is non-local) |
| Erosion, ≥2048² or interactive | WebGPU compute: pipe model (Mei et al. 2007) or atomic droplets, TSL `instancedArray` + `atomicAdd` | Compute shader (RenderingDevice) | Compute shader (e.g. bshishov/UnityTerrainErosionGPU) | Orders of magnitude more cells/droplets per second | WebGL-only targets; you need determinism (GPU float order varies) |
| Erosion, art-directed | World Machine / Gaea / World Creator → 16-bit/32-bit export | Terrain3D importer | Terrain import | Best quality per artist hour | Runtime-random worlds |
| Rivers / lakes | Priority-flood pit fill → D8 flow accumulation → threshold | same code | same code | Rivers always flow downhill and connect | Tiny maps: paint them |
| Biomes | Whittaker-style table: elevation × moisture (+ latitude/temperature), slope overrides rock, waterline → beach | same | same | Coherent, debuggable | Noise-per-biome without a table produces mush |
| Scatter, bounded area | `fast-2d-poisson-disk-sampling` (seeded rng arg) | `MultiMeshInstance3D` + same algorithm; Terrain3D instancer | Terrain details / GPU instancing | Natural spacing | Infinite chunked worlds (border seams) |
| Scatter, infinite | Hash-jittered grid per cell, or tiled blue-noise texture threshold × density mask | same | same | Seamless and O(1) per cell | n/a |
| Draw many copies | `InstancedMesh` (1 geometry), `BatchedMesh` (many geometries, 1 material, 1 draw), `@three.ez/instanced-mesh` (per-instance culling + LOD + BVH) | `MultiMesh`, Terrain3D foliage | GPU Resident Drawer / instancing | 1 draw call per type | <50 objects: plain meshes are fine |
| Terrain mesh <1 km² | One `PlaneGeometry` displaced on CPU | `Terrain3D` or `MeshInstance3D` | Terrain | Simple | Bigger worlds |
| Terrain 1-16 km | Chunk grid + geomipmap LOD + skirts, built in workers | **Terrain3D** (clipmap mesh, up to 65 km, 32 textures, foliage instancer) | Unity Terrain (tiles) | Proven, simple | Planet scale |
| Terrain huge/infinite | CDLOD quadtree or geometry clipmaps sampling a height texture in the vertex shader | Terrain3D regions, or godot_voxel `VoxelLodTerrain` for overhangs/caves | Terrain + streaming | Constant vertex budget | Overhangs/caves → use voxels (`game-voxels`) |
| Colliders | Rapier `ColliderDesc.heightfield` per near chunk (see transpose gotcha) | `HeightMapShape3D` (Terrain3D makes its own) | `TerrainCollider` | Cheap, exact | Don't use trimesh for heightfields |
| Sky / atmosphere | `SkyMesh` (WebGPU) / `Sky` (WebGL) addons; `@takram/three-atmosphere` for physically based | `ProceduralSkyMaterial` / `PhysicalSkyMaterial` | HDRP/URP sky | Cheap dressing | See `game-materials-shaders` for depth |
| Water | `WaterMesh` (WebGPU) / `Water` (WebGL), `webgpu_ocean` example; FFT ocean for hero water | Shader on a plane | Water system | Dressing | Gameplay water needs its own physics |

## Recipe 1: seeded fields (three.js r18x + Vite + TS)

```bash
npm i three simplex-noise alea fast-2d-poisson-disk-sampling @dimforge/rapier3d-compat
npm i -D vitest @types/three
```

```ts
// src/world/rng.ts: no Math.random anywhere in worldgen
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(...parts: number[]): number { // stable sub-seed from ints
  let h = 0x811c9dc5;
  for (const p of parts) { h ^= p | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
  return h >>> 0;
}
```

```ts
// src/world/height.ts: fBm + domain warp + ridged mountains (metres)
import { createNoise2D } from 'simplex-noise';
import alea from 'alea';

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t);
};

export function makeHeightFn(seed: string) {
  const n = createNoise2D(alea(seed + ':base'));   // a fresh alea per field
  const wx = createNoise2D(alea(seed + ':warpx'));
  const wz = createNoise2D(alea(seed + ':warpz'));
  const fbm = (x: number, z: number, oct: number) => {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * n(x * f, z * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;                               // ≈ [-1, 1]
  };
  const P = 1 / 1200;                                // base wavelength ≈ 1.2 km
  return (x: number, z: number): number => {
    const qx = x + 150 * wx(x * P * 3, z * P * 3);   // domain warp: bend coordinates, not heights
    const qz = z + 150 * wz(x * P * 3 + 17.1, z * P * 3 - 4.7);
    const base = fbm(qx * P, qz * P, 6);
    const r = 1 - Math.abs(fbm(qx * P * 0.6 + 91.3, qz * P * 0.6, 5)); // ridged
    return 30 * base + 320 * smoothstep(0.05, 0.55, base) * r * r;
  };
}
```

Godot equivalent: `FastNoiseLite` with `domain_warp_enabled = true` (see `references/engine-pipelines.md`).

## Recipe 2: chunk heights in a worker, mesh on the main thread

```ts
// src/world/chunk.worker.ts
import { makeHeightFn } from './height';
let height: (x: number, z: number) => number;
self.onmessage = (e: MessageEvent) => {
  const { seed, cx, cz, size, res, lod } = e.data; // res = quads per side (e.g. 64)
  height ??= makeHeightFn(seed);
  const n = res + 1, m = n + 2, step = size / res, x0 = cx * size, z0 = cz * size;
  const a = new Float32Array(m * m);               // 1-sample apron so border normals match neighbours
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) a[i + j * m] = height(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const h = new Float32Array(n * n), nrm = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = i + 1 + (j + 1) * m, k = i + j * n;  // x fastest, rows along +z
    h[k] = a[c];
    const dx = a[c + 1] - a[c - 1], dz = a[c + m] - a[c - m], len = Math.hypot(dx, 2 * step, dz);
    nrm[k * 3] = -dx / len; nrm[k * 3 + 1] = (2 * step) / len; nrm[k * 3 + 2] = -dz / len;
  }
  (self as unknown as Worker).postMessage({ cx, cz, lod, res, h, nrm }, [h.buffer, nrm.buffer]); // transfer
};
```

```ts
// main thread
const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
function chunkGeometry(h: Float32Array, nrm: Float32Array, size: number, res: number) {
  const g = new THREE.PlaneGeometry(size, size, res, res);
  g.rotateX(-Math.PI / 2);           // after rotation: vertex k = i + j*n, x fastest, j=0 at z = -size/2
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) pos.setY(k, h[k]);
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.computeBoundingSphere();         // frustum culling needs the displaced bounds
  return g;                           // mesh.position = (cx*size + size/2, 0, cz*size + size/2)
}
```

Keep vertex positions **chunk-local** and put the offset in `mesh.position`: three.js builds `modelViewMatrix`
in float64 on the CPU, so local vertices avoid float32 jitter far from the origin. Physics still needs a floating
origin past ~5-10 km (`references/streaming-lod-physics.md`). Seams between LOD levels: add skirts (same file).

## Recipe 3: Rapier heightfield collider (the transpose gotcha)

Rapier's heightfield is **column-major with rows along Z** (index = `iz + ix * nRowsPlus1`). The grid above
(and three.js `PlaneGeometry`) is **x-fastest**. Passing it straight through gives a collider mirrored across
the diagonal. The official three.js `physics_rapier_terrain` example hides this because its heightmap is
radially symmetric.

```ts
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();                                  // compat build: must await init once
function heightfieldCollider(world: RAPIER.World, h: Float32Array, res: number, size: number, cx: number, cz: number) {
  const n = res + 1, t = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t[j + i * n] = h[i + j * n]; // rows=z, cols=x
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
    .setTranslation(cx * size + size / 2, 0, cz * size + size / 2));    // centred like PlaneGeometry
  // nrows/ncols are CELL counts (n-1); scale = full extents; heights multiply by scale.y
  return world.createCollider(RAPIER.ColliderDesc.heightfield(res, res, t, { x: size, y: 1, z: size }), body);
}
```

Checked against Rapier 0.21 with a sloped, asymmetric field: 200 down-rays gave max error 0.0001 m transposed
and 11 m un-transposed. Repeat that ray test in your project (see Verification); `hit.timeOfImpact` is the distance.
Godot: `HeightMapShape3D.update_map_data_from_image(image, min, max)`. Unity: `TerrainData.SetHeights` takes
`float[z, x]` normalised 0..1. Same transpose trap.

## Recipe 4: scatter vegetation (deterministic, seamless)

```ts
// One jittered sample per cell (cell = min spacing). Seamless across chunks, O(1), deterministic.
function scatterCell(seed: number, gx: number, gz: number, cell: number, kind: number) {
  const r = mulberry32(hashSeed(seed, gx, gz, kind));
  return { x: (gx + r()) * cell, z: (gz + r()) * cell, rot: r() * Math.PI * 2, s: 0.8 + 0.4 * r(), keep: r() };
}
// keep the sample if keep < density(biome, slope, height); reject slope > 35°, underwater, on roads.

const trees = new THREE.InstancedMesh(treeGeo, treeMat, maxCount);
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
let count = 0;
for (const c of samples) {
  p.set(c.x, height(c.x, c.z) - 0.1, c.z);             // sink slightly so roots don't float on slopes
  trees.setMatrixAt(count++, m.compose(p, q.setFromAxisAngle(UP, c.rot), s.setScalar(c.s)));
}
trees.count = count;
trees.instanceMatrix.needsUpdate = true;
trees.computeBoundingSphere();                        // recompute after moving instances, or culling breaks
```

- Bounded areas (an island, a town square): `new FastPoissonDiskSampling({ shape: [w, h], radius: 4 }, rng).fill()`.
  Per-chunk Poisson leaves gaps/clumps at chunk borders, so use the jittered grid for infinite worlds.
- Several rock/prop meshes in one draw: `BatchedMesh(maxInstances, maxVerts, maxIndices, material)` →
  `addGeometry(g)` → `addInstance(geoId)` → `setMatrixAt(id, m)`. One shared material.
- Thousands of trees with LODs/impostors: `@three.ez/instanced-mesh` (`InstancedMesh2`, `addLOD`,
  `addShadowLOD`, per-instance frustum culling). Code-generated trees: `@dgreenheck/ez-tree` (seeded).
  Impostors and LOD generation: see `game-performance-optimization`.

## Recipe 5: GPU detail (visual only)

Base heights come from the CPU grid. Add sub-metre detail in TSL on top, following the three.js example
`webgpu_tsl_procedural_terrain` (`material.positionNode = Fn(() => { … position.y.addAssign(elev) … })()`,
normals from two neighbour samples, `material.normalNode = transformNormalToView(vNormal)`).
Keep GPU detail amplitude below what gameplay notices (< 0.3 m), or feet will float or sink.

## Pitfalls the model gets wrong

- **8-bit heightmaps terrace.** Browsers decode PNGs to 8 bits per channel in `TextureLoader`/`ImageBitmap`.
  Load 16-bit PNG with `fast-png` (`decode(buf).data` is a `Uint16Array`), R16 raw via `fetch` → `Uint16Array`,
  or EXR via `EXRLoader` (`setDataType(THREE.FloatType)`). Godot `Noise.get_image()` returns 8-bit `FORMAT_L8` too.
- **Erosion per chunk = visible seams.** Erode whole regions (e.g. 1024² + 64-cell apron, keep the centre), or for
  infinite worlds fake it: derivative-damped fBm (IQ style), ridged noise, and a cheap thermal pass.
- **Droplet erosion holes/spikes**: never erode more than the height drop; use a radius brush and bilinear reads.
  Some popular ports update speed as `sqrt(v² + Δh·g)` with Δh<0 downhill, which slows droplets and can go NaN.
  Use `sqrt(max(0, v² − Δh·g))`.
- **`simplex-noise` 4.x removed built-in seeding.** Pass a PRNG: `createNoise2D(alea('seed'))`, a fresh `alea` per field.
- **`fastnoise-lite` npm 1.1.1 only has `DomainWrap(vec)`** (the README says `DomainWarp`, which is `undefined`).
  It warps the `{x, y[, z]}` object in place: `const v = { x, y: z }; noise.DomainWrap(v); noise.GetNoise(v.x, v.y)`.
- **Determinism across machines**: `+ − × ÷`, `Math.floor`, `Math.imul` are exact; `Math.sin/exp/pow` are
  "implementation-approximated" by the spec and may differ across engines. Run golden tests in Node, quantise
  before hashing, and never golden-hash GPU output bit-for-bit.
- **Rivers that stop in pits**: always pit-fill (priority-flood + epsilon) before D8 accumulation.
- **InstancedMesh culled wrongly or invisible**: stale `boundingSphere` → call `computeBoundingSphere()` after updates.
- **Main-thread hitches**: generation, meshing and normals in workers; upload ≤2-4 chunk geometries per frame.
  `geometry.dispose()` on unload, or GPU memory leaks.
- **Physics radius = render radius** wastes CPU. Colliders only within ~150-300 m of dynamic bodies.
- **Unity `heightmapResolution`** must be 2ⁿ+1 (513, 1025, 2049…); Terrain3D regions are 2ⁿ (64…2048).
- **Licences**: World Machine/Gaea/World Creator outputs are yours, but the free tiers are resolution-capped
  (Gaea Community: 1024²). `ProbableTrain/MapGenerator` is LGPL/GPL, so use it as reference only in closed games.

## Verification (do all four before claiming done)

1. **Golden hash** (Vitest, Node): generate chunk (0,0) and (17,-4) for seed `"golden"`, quantise to mm, hash.
   ```ts
   import { createHash } from 'node:crypto';
   export const hashField = (f: Float32Array, q = 1e-3) =>
     createHash('sha256').update(new Uint8Array(Int32Array.from(f, v => Math.round(v / q)).buffer)).digest('hex').slice(0, 16);
   test('worldgen is deterministic', () => {
     expect(hashField(genChunk('golden', 0, 0).h)).toMatchSnapshot();
     expect(hashField(genChunk('golden', 0, 0).h)).toBe(hashField(genChunk('golden', 0, 0).h));
   });
   ```
   Also assert that generating chunks in a different order gives identical hashes (catches shared RNG streams).
2. **Seed sweep**: 256 seeds, assert stats in range: land fraction 35-75 %, max height < limit, spawn point
   on land with slope < 20°, at least one river reaching the sea, no NaN. Print a table and fail on outliers.
3. **Collider check**: 1 000 random rays down onto loaded chunks; `|hit.y − height(x,z)| < 0.05 m`.
4. **Visual**: Playwright screenshot from 3 fixed cameras (top-down ortho with chunk borders + LOD colours;
   horizon; ground level). A debug overlay (see `game-debug-tools`) showing chunk coords, queued jobs, draw
   calls and triangles. Hand the screenshots to `game-art-review`.

## Install instead of reinventing

- Noise: `simplex-noise` (MIT), `fastnoise-lite` (MIT), Auburn/FastNoise2 (MIT, C++ SIMD + node editor).
- three.js examples worth reading: `webgpu_tsl_procedural_terrain`, `physics_rapier_terrain`, `webgl_instancing_scatter`,
  `webgl_batch_lod_bvh`, `webgpu_ocean`, `webgpu_sky`, `webgpu_compute_texture_pingpong`.
- Atmosphere: takram-design-engineering/three-geospatial (`@takram/three-atmosphere`, `@takram/three-clouds`; MIT).
- Godot: TokisanGames/Terrain3D (MIT, 1.0.2 for Godot 4.4-4.6), gaea-godot/gaea (MIT, graph-based 2D/3D grid gen, 2.0 is early).
- Erosion references: SebLague/Hydraulic-Erosion (Unity, MIT), LanLou123/Webgl-Erosion (MIT, live demo),
  dandrino/terrain-erosion-3-ways (Python, MIT), bshishov/UnityTerrainErosionGPU (MIT).
- Agent skills: `gamedev-skills/awesome-gamedev-agent-skills` → `procedural-gen` (basics), `jame581/GodotPrompter`
  → `procedural-generation`, `dgreenheck/webgpu-claude-skill` (TSL/WebGPU), `CloudAI-X/threejs-skills`.
- Related skills here: `game-voxels` (overhangs/caves), `game-building-generation` (towns/POIs),
  `game-physics`, `game-performance-optimization`, `game-debug-tools`.
