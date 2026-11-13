---
name: game-voxels
description: Load when building a voxel game or engine - Minecraft-like blocky worlds or smooth/destructible SDF terrain. Covers chunk storage, culled vs greedy meshing, per-vertex AO, sunlight/blocklight flood fill, worker meshing, voxel LOD, surface nets/marching cubes/transvoxel, MagicaVoxel .vox import, voxel physics and raycasts, destructible terrain, and choosing Zylann/godot_voxel, voxelize, noa or a custom three.js engine. Includes performance budgets.
---

# Voxel engines (blocky and smooth)

A browser voxel engine is ~1-2k lines you can own: **sparse chunk store → padded copy → mesher in a worker
→ BufferGeometry**, with light and AO baked into vertex colours, a DDA raycast for picking, and Rapier voxel
colliders. All code below was run and checked in Node 22 (numbers are from that run).

References (tested code):
- `references/meshing.md`: greedy mesher (AO-aware), vertex packing to 4-8 bytes, shared index buffer trick, texture arrays, transparency/water, LOD for blocky terrain.
- `references/lighting.md`: sun + block light BFS with removal (matched a brute-force recompute on 400 random edits), cross-chunk rules, smooth lighting, day/night without remeshing.
- `references/smooth-voxels.md`: SDF storage, surface nets (watertight, tested), marching cubes / dual contouring / transvoxel trade-offs, godot_voxel smooth setup and digging.

## Blocky or smooth?

| Pick | When | Cost |
|---|---|---|
| **Blocky** (Minecraft, Teardown-ish look) | Building/crafting, per-block identity, simple physics and lighting, mobile | Cheap meshing (1-3 ms/chunk), trivial collision, easy saves |
| **Smooth SDF** (Astroneer, No Man's Sky) | Digging/terraforming, natural caves/overhangs on otherwise realistic terrain | Harder meshing, LOD seams (transvoxel), materials blending, trimesh/SDF physics |
| **Heightfield + a few voxel features** | Open worlds that only need caves in places | Use `game-world-generation` terrain, and voxels only for cave volumes |
| **Voxel *art* only** (MagicaVoxel props, characters) | Look without simulation | `VOXLoader` → meshes, no engine needed |

## When to use what

| Problem | three.js / web (default) | Godot 4.4+ | Unity 6 | Why | When NOT |
|---|---|---|---|---|---|
| Engine | **Custom** (this skill) for full control. `voxelize` (MIT, three.js client + Rust authoritative server, multiplayer, lighting) if you need multiplayer now | **Zylann/godot_voxel** (MIT, ~3.9k★): blocky + transvoxel LOD, VoxelTool, instancer, SQLite streams | Own engine with Jobs + Burst (assets exist; unverified) | godot_voxel is the most complete free voxel engine | `noa` and DivineVoxelEngine are **Babylon.js**, so don't pick them for a three.js game |
| Chunk shape | 32³ (`Uint16Array`, 64 KB) cubic chunks; 16×16×H columns if the world has a fixed height | `mesh_block_size` 16 or 32 | 32³ | 32³ balances mesh size vs remesh cost | 64³ remeshes too much on every edit |
| Meshing | **Culled faces + AO** (1.0 ms terrain chunk, 2.5 ms cave chunk) | `VoxelMesherBlocky` (baked AO) | same algorithms | Simple, AO-friendly | n/a |
| Fewer triangles | **Greedy** (merge equal id + equal AO): 6.2× fewer quads on flat/built terrain, only 1.3× on noisy natural terrain | built in | binary greedy (cgerikj/binary-greedy-meshing, C++, 64³ bitmasks, 50-200 µs/chunk) | Big flat surfaces | Noisy terrain with AO: our unoptimised greedy took 26 ms vs 1.0 ms for fast culled, so not worth it. Atlases need texture arrays to tile |
| Lighting | 4-bit sun + 4-bit block per voxel, BFS add/remove | built in (blocky) | same | Correct caves, torches, cheap | Fully dynamic GI: out of scope |
| Workers | Mesher + generator in a worker pool, transfer `ArrayBuffer`s | built in (threaded) | Jobs | Main thread stays < 2 ms | SharedArrayBuffer only with COOP/COEP headers |
| Picking / editing | **DDA raycast** on the grid | `VoxelTool.raycast` | same | Exact, O(distance) | three.js `Raycaster` on chunk meshes is slower and less exact |
| Physics | **Rapier `ColliderDesc.voxels`** (≥ 0.16, `setVoxel` O(1), `combineVoxelStates` across chunks) or trimesh per chunk | built-in collision (`generate_collisions`) + Jolt | MeshCollider per chunk | Voxel colliders edit in O(1) with no rebuild | Smooth terrain: trimesh per chunk |
| Smooth meshing | **Surface nets** (watertight, 2.3 ms for a 34³ SDF) | `VoxelMesherTransvoxel` + `VoxelLodTerrain` | Transvoxel port | Simplest watertight SDF mesher | Sharp edges → dual contouring |
| LOD | Blocky: 2× downsampled chunk meshes in far rings + skirts. Smooth: transvoxel transition cells | `VoxelLodTerrain` (smooth) | same | Render distance × 4 for the same triangle budget | Blocky LOD in godot_voxel is still a roadmap item |
| `.vox` import | three.js `VOXLoader` (r182+: `{ chunks, scene }`, `buildMesh(chunk)`); `vox-reader` (MIT) for raw data | godot_voxel `VoxelVoxLoader` (check docs) / importer | MagicaVoxel importers | Art pipeline | `parse-magica-voxel` is **GPLv3** |

## Recipe 1: chunk store (power-of-two chunks, negative coords safe)

```ts
// src/voxel/store.ts
export const S = 32, P = S + 2, PP = P * P;                    // P = padded edge (1-voxel apron)
export const at = (x: number, y: number, z: number) => (x + 1) + P * (y + 1) + PP * (z + 1); // x ∈ [-1, S]
const SH = Math.log2(S), M = S - 1;

export class VoxelStore {
  chunks = new Map<string, Uint16Array>();                     // "cx,cy,cz" → S³ ids, lx + S*(ly + S*lz)
  dirty = new Set<string>();
  static key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
  get(x: number, y: number, z: number) {                        // >> and & are correct for negatives
    const c = this.chunks.get(VoxelStore.key(x >> SH, y >> SH, z >> SH));
    return c ? c[(x & M) + S * ((y & M) + S * (z & M))] : 0;
  }
  set(x: number, y: number, z: number, id: number) {
    const cx = x >> SH, cy = y >> SH, cz = z >> SH, k = VoxelStore.key(cx, cy, cz);
    let c = this.chunks.get(k); if (!c) this.chunks.set(k, (c = new Uint16Array(S * S * S)));
    const lx = x & M, ly = y & M, lz = z & M;
    c[lx + S * (ly + S * lz)] = id;
    const r = (l: number) => (l === 0 ? [-1, 0] : l === M ? [0, 1] : [0]);  // neighbours whose apron sees it (AO needs diagonals)
    for (const dx of r(lx)) for (const dy of r(ly)) for (const dz of r(lz)) this.dirty.add(VoxelStore.key(cx + dx, cy + dy, cz + dz));
  }
  padded(cx: number, cy: number, cz: number) {                  // P³ copy for the mesher (≈0.8 ms)
    const out = new Uint16Array(P * P * P), c = this.chunks.get(VoxelStore.key(cx, cy, cz));
    for (let z = -1; z <= S; z++) for (let y = -1; y <= S; y++) for (let x = -1; x <= S; x++) {
      const inside = x >= 0 && y >= 0 && z >= 0 && x < S && y < S && z < S;
      out[at(x, y, z)] = inside ? (c ? c[x + S * (y + S * z)] : 0) : this.get(cx * S + x, cy * S + y, cz * S + z);
    }
    return out;
  }
}
```

Use `Uint16Array` ids (65 535 block types). For memory, palette-compress cold chunks (a local palette + 1-8 bit
indices) and drop all-air chunks entirely.

## Recipe 2: culled mesher with per-vertex AO (worker-safe; 3.3 ms as written, 1.0 ms with typed arrays)

```ts
// src/voxel/mesher.ts: no three.js import; runs in a worker
import { S, P, PP, at } from './store';
const STRIDE = [1, P, PP], AO = [0.45, 0.62, 0.8, 1.0];        // brightness for ao 0..3
const FACES = [0, 1, 2].flatMap(a => [1, -1].map(s => {
  const u = (a + 1) % 3, v = (a + 2) % 3, n = [0, 0, 0]; n[a] = s;  // u × v = +a → CCW from +a
  const cs = s > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
  const nOff = s * STRIDE[a];
  return { n, nOff,
    corners: cs.map(([du, dv]) => { const p = [0, 0, 0]; if (s > 0) p[a] = 1; p[u] = du; p[v] = dv; return p; }),
    ao: cs.map(([du, dv]) => { const su = du ? 1 : -1, sv = dv ? 1 : -1;  // side1, side2, corner in the front layer
      return [nOff + su * STRIDE[u], nOff + sv * STRIDE[v], nOff + su * STRIDE[u] + sv * STRIDE[v]]; }) };
}));

export function meshChunk(vox: Uint16Array, opaque: Uint8Array /* [id] → 0|1 */, tint: Float32Array /* rgb per id */) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], ind: number[] = [];
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = at(x, y, z), id = vox[i];
    if (id === 0) continue;
    for (const f of FACES) {
      if (opaque[vox[i + f.nOff]]) continue;                   // face hidden by an opaque neighbour
      const base = pos.length / 3, ao = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const o = f.ao[k], s1 = opaque[vox[i + o[0]]], s2 = opaque[vox[i + o[1]]], c = opaque[vox[i + o[2]]];
        ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + c);              // 0fps vertexAO
        const p = f.corners[k], b = AO[ao[k]];                 // × light level (references/lighting.md)
        pos.push(x + p[0], y + p[1], z + p[2]); nor.push(...f.n);
        col.push(tint[id * 3] * b, tint[id * 3 + 1] * b, tint[id * 3 + 2] * b);
      }
      if (ao[0] + ao[2] > ao[1] + ao[3]) ind.push(base + 1, base + 2, base + 3, base + 1, base + 3, base); // split on darker diagonal
      else ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col), indices: new Uint32Array(ind) };
}
```

This snippet gives output identical to the typed-array version in `references/meshing.md` (checked), but takes
3.3 ms instead of 1.0 ms per chunk because of `number[]` pushes. Use the reference version in production. Transparent blocks (glass, leaves, water) need `opaque[id] = 0` and a rule "draw the face if the
neighbour id differs", in a separate transparent mesh.

## Recipe 3: worker + three.js (r18x, WebGL or WebGPU renderer)

```ts
// main.ts
const pool = Array.from({ length: Math.max(1, (navigator.hardwareConcurrency || 4) - 1) },
  () => new Worker(new URL('./voxel/mesh.worker.ts', import.meta.url), { type: 'module' }));
const material = new THREE.MeshLambertMaterial({ vertexColors: true });   // MeshStandardMaterial if you want PBR
function onMeshed({ key, positions, normals, colors, indices }: any) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  const old = meshes.get(key); if (old) { old.geometry.dispose(); scene.remove(old); }
  const [cx, cy, cz] = key.split(',').map(Number), m = new THREE.Mesh(g, material);
  m.position.set(cx * S, cy * S, cz * S); m.matrixAutoUpdate = false; m.updateMatrix();
  scene.add(m); meshes.set(key, m);
}
// each frame: take ≤ 4 keys from store.dirty (nearest first), post store.padded(...) with [buf.buffer] as transfer
// worker: self.onmessage = e => { const m = meshChunk(e.data.vox, OPAQUE, TINT); postMessage({ key, ...m }, [m.positions.buffer, …]) }
```

Rules: keep generation in the worker too (seeded, `game-world-generation` noise). Cap uploads per frame (≤ 4).
Skip all-air and fully-buried chunks. Frustum culling works per chunk mesh. Sort chunk jobs nearest-first and
drop stale results (the chunk was edited again while the job was in flight, so tag jobs with a version).

## Recipe 4: picking, editing, destruction, physics

```ts
// DDA (Amanatides & Woo). dir normalised. Place at voxel + normal, break at voxel.
export function raycastVoxels(solid: (x: number, y: number, z: number) => boolean, o: number[], dir: number[], maxDist: number) {
  const p = o.map(Math.floor), step = [0, 0, 0], tMax = [Infinity, Infinity, Infinity], tDelta = [Infinity, Infinity, Infinity];
  for (let a = 0; a < 3; a++) {
    if (dir[a] === 0) continue;                                 // avoid 0 * Infinity = NaN
    step[a] = dir[a] > 0 ? 1 : -1; tDelta[a] = Math.abs(1 / dir[a]);
    tMax[a] = (dir[a] > 0 ? p[a] + 1 - o[a] : o[a] - p[a]) * tDelta[a];
  }
  const normal = [0, 0, 0]; let t = 0;
  while (t <= maxDist) {
    if (solid(p[0], p[1], p[2])) return { voxel: p, normal, t };
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    p[a] += step[a]; t = tMax[a]; tMax[a] += tDelta[a];
    normal[0] = normal[1] = normal[2] = 0; normal[a] = -step[a];
  }
  return null;
}
```

```ts
// Rapier voxel collider per chunk (Rapier ≥ 0.16; tested on 0.21): voxel (i,j,k) fills [i,i+1]×[j,j+1]×[k,k+1] × voxelSize
const coords: number[] = []; /* push lx, ly, lz for every solid voxel */
const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx * S, cy * S, cz * S));
const col = world.createCollider(RAPIER.ColliderDesc.voxels(new Int32Array(coords), { x: 1, y: 1, z: 1 }), body);
col.setVoxel(lx, ly, lz, false);                 // O(1) edit, no rebuild (verified: ray then passes through)
// once per neighbouring pair: col.combineVoxelStates(other, shiftX, shiftY, shiftZ) to kill internal-edge bumps;
// after setVoxel on a border voxel: col.propagateVoxelChange(other, lx, ly, lz, shiftX, shiftY, shiftZ)
```

Edit flow: `store.set` → light update (`references/lighting.md`, `onBlockChanged`) → dirty chunks remesh →
`col.setVoxel` → spawn debris. Destruction: remove a sphere of voxels, then flood-fill from the ground to
find disconnected islands, and turn small islands into dynamic bodies (a voxel collider on a dynamic body is
supported since Rapier 0.17). Delete tiny ones as particles. Player controller: the Rapier character controller
on voxel colliders, or a hand-written AABB-vs-grid sweep per axis (cheapest, very robust).

## Recipe 5: MagicaVoxel `.vox`

```ts
import { VOXLoader, buildMesh } from 'three/addons/loaders/VOXLoader.js';
const result = await new VOXLoader().loadAsync('/models/castle.vox');   // r182+: { chunks, scene }
scene.add(result.scene);                    // node transforms applied, greedy-meshed, vertex colours
const mesh = buildMesh(result.chunks[0]);   // single model (VOXMesh is deprecated since r182)
// gameplay voxels: chunk.size {x,y,z}, chunk.data = Uint8Array [x,y,z,colorIndex]*, chunk.palette (R in low byte)
```

MagicaVoxel is **Z-up**: map `(x, y, z)` → `(x, z, -y)` when stamping into a Y-up world, and check with an
asymmetric test model. Templates for buildings (template + placement + decay): `game-building-generation`.

## Godot: godot_voxel

Add `VoxelTerrain` (blocky: `VoxelMesherBlocky` + `VoxelBlockyLibrary`, generator `VoxelGeneratorNoise2D` with a
`FastNoiseLite`, stream `VoxelStreamSQLite`) or `VoxelLodTerrain` (smooth: `VoxelMesherTransvoxel` +
`VoxelGeneratorGraph`), and a **`VoxelViewer` on the player** (without it nothing loads and no collisions generate).

```gdscript
@onready var terrain: VoxelTerrain = $VoxelTerrain
func break_block(origin: Vector3, dir: Vector3) -> void:
	var vt := terrain.get_voxel_tool()
	var hit := vt.raycast(origin, dir, 8.0)
	if hit: vt.set_voxel(hit.position, 0)          # blocky: channel TYPE, 0 = air
func dig(at: Vector3) -> void:                      # smooth terrain
	var vt := terrain.get_voxel_tool()
	vt.channel = VoxelBuffer.CHANNEL_SDF
	vt.mode = VoxelTool.MODE_REMOVE
	vt.do_sphere(at, 3.0)
```

Install: prebuilt editor builds from the godot_voxel GitHub releases (it is a C++ **module**, i.e. a custom
engine build), or the GDExtension build (works with official Godot ≥ 4.4.1, less tested, **no FastNoise2**).
Exporting needs matching export templates for the module build.

## Performance budgets (measured: Node 22, one core, 32³ chunks)

| Item | Number | Budget rule |
|---|---|---|
| Culled + AO mesh, natural terrain chunk | 1.0 ms, 1 831 quads | ≤ 4 chunks/frame on one worker; use a pool |
| Culled + AO, cave-heavy chunk (3D noise) | 2.5 ms, 11 555 quads, 1.5 MB unpacked | Pack vertices (`references/meshing.md`) → ~0.3 MB |
| Greedy (AO-aware, unoptimised) | 26 ms; 1.3× fewer quads on noise, 6.2× on flat | Use for built/flat worlds or no-AO styles |
| Padded copy from store | 0.8 ms | Do it on the main thread or keep chunks in the worker |
| Surface nets 34³ SDF | 2.3 ms | Same pool |
| Render distance | 8-12 chunks horizontal (256-384 m at 1 m voxels) desktop; 4-6 mobile | Beyond that: LOD rings |
| Visible triangles | ≤ 2-4 M desktop WebGPU/WebGL2, ≤ 0.5 M mobile | Skip buried chunks, frustum + (optional) occlusion |
| Memory per loaded chunk | 64 KB ids + 32 KB light + mesh | All-air chunks cost nothing |

## Pitfalls the model gets wrong

- **Meshing on the main thread** or creating a `THREE.Mesh` per block (100 k draw calls). One mesh per chunk, built in a worker.
- **No apron**: meshing a chunk without its neighbours' border voxels gives faces at every chunk wall and AO seams.
  Pad to (S+2)³ including edges and corners, and remesh the neighbours when a border voxel changes (diagonals too).
- **AO interpolation anisotropy**: always flip the quad diagonal by the AO rule above.
- **Greedy + texture atlas**: merged quads can't tile atlas sub-rects with UVs alone. Use a `DataArrayTexture`/
  texture array and UVs in block units, or don't merge.
- **Day/night by remeshing**: store sun and block light separately (two vertex attributes) and apply a time-of-day
  uniform in the shader.
- **`Math.floor(x / 32)` vs `x >> 5`**: both work for negatives. `Math.trunc` and `| 0` do **not** (chunk -1 becomes 0).
- **SharedArrayBuffer without COOP/COEP**: it's undefined. In Vite set `server.headers` (`Cross-Origin-Opener-Policy:
  same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) and the same on the host, or just transfer buffers.
- **Physics trimesh rebuild per edit** stalls (tens of ms). Use Rapier voxel colliders, or rebuild only the edited chunk in a worker.
- **Choosing noa/DivineVoxelEngine for three.js**: both render with Babylon.js (DVE's three.js renderer is dormant).
- **Licences**: godot_voxel MIT; voxelize MIT; Transvoxel tables MIT (EricLengyel/Transvoxel); `parse-magica-voxel` GPLv3;
  MagicaVoxel itself is free but closed-source.

## Verification

1. **Mesher unit tests** (vitest, Node): every triangle's geometric normal matches its stored normal (winding);
   greedy and culled meshes have identical total area; surface nets on a sphere SDF is watertight (every edge
   shared by exactly 2 triangles) and the area is within 2 % of 4πr².
2. **Lighting test**: N random edits with incremental updates, compared against a full recompute after each
   edit. The result must be identical (the reference test does 400).
3. **Determinism**: hash the generated chunk ids for seeds × chunk coords (golden hash, see `game-world-generation`).
4. **Visual**: Playwright screenshots of (a) a debug view colouring chunks by remesh count, (b) an AO close-up of an
   inner corner and a single block on a floor, (c) a torch in a cave. Overlay chunk coords, queue lengths, meshing ms,
   draw calls and triangles (`game-debug-tools`).
5. **Perf gate**: a scripted fly-through that fails if p95 frame time > 16.7 ms or any frame > 50 ms while streaming.

## Install instead of reinventing

- Zylann/godot_voxel (Godot, MIT), voxelize/voxelize (three.js + Rust, MIT, ~690★), fenomas/noa (Babylon.js, MIT),
  Divine-Star-Software/DivineVoxelEngine (Babylon.js, MIT), cgerikj/binary-greedy-meshing (C++, MIT),
  EricLengyel/Transvoxel (tables, MIT), dgreenheck/minecraft-threejs-clone (small tutorial codebase).
- Reading: 0fps "Meshing in a Minecraft Game" (2012), "Ambient occlusion for Minecraft-like worlds" (2013),
  "Voxel lighting" (2018); transvoxel.org; the Seed of Andromeda flood-fill lighting article (unverified URL).
- three.js examples: `webgl_loader_vox`, `webgl_interactive_voxelpainter`, `physics_rapier_*`.
- Related skills: `game-world-generation` (noise, seeds, streaming), `game-building-generation` (templates + decay),
  `game-physics`, `game-performance-optimization`.
