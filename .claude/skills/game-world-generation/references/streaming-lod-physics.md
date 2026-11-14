# Chunk streaming, terrain LOD and colliders

## Pick the LOD scheme

| World size | Scheme | three.js effort | Notes |
|---|---|---|---|
| ≤ 1 km² | One displaced `PlaneGeometry` (≤ 1024² verts) | trivial | 2 M tris is fine on desktop WebGPU; 2048² (8 M tris) crashed a session in 2026 field notes |
| 1-16 km | **Chunk grid + geomipmapping** (per-chunk resolution by distance ring) + skirts | ~300 lines | Default. CPU heights, worker meshing, per-chunk colliders |
| 16 km+ / infinite / flight | **CDLOD** (quadtree of one reusable grid patch, heights sampled from a texture in the vertex shader, vertex morphing between levels) or **geometry clipmaps** (camera-centred nested rings) | 600+ lines, shader work | Constant vertex budget. Gameplay still needs CPU heights near the player |
| Overhangs, caves, digging | Voxels / SDF + transvoxel | see `game-voxels` | Heightfields can't do overhangs |

Godot: Terrain3D is a clipmap terrain (`mesh_lods` default 7, `mesh_size` 48, `region_size` 256, dynamic collision
within `collision_radius` 64 m by default). Don't reimplement it.

## Chunk manager (worker pool, priority, budget, hysteresis)

```ts
import * as THREE from 'three';

type Job = { cx: number; cz: number; lod: number; d: number };
type Result = { cx: number; cz: number; lod: number; res: number; h: Float32Array; nrm: Float32Array };
interface Chunk { cx: number; cz: number; lod: number; wantLod: number; pending: boolean; mesh?: THREE.Mesh; h?: Float32Array }

export class ChunkManager {
  chunks = new Map<string, Chunk>();
  private ready: Result[] = [];
  private idle: Worker[] = [];
  constructor(private scene: THREE.Scene, private material: THREE.Material, private seed: string,
    private o = { size: 64, radius: 12, unloadRadius: 14, uploadsPerFrame: 2, lodRings: [2, 5, 9], resByLod: [64, 32, 16, 8] },
    private onChunk?: (c: Chunk, added: boolean) => void) {      // hook: colliders, scatter, nav
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<Result>) => { this.ready.push(e.data); this.idle.push(w); };
      this.idle.push(w);
    }
  }
  private lodFor(d: number) { const r = this.o.lodRings; for (let i = 0; i < r.length; i++) if (d <= r[i]) return i; return r.length; }

  update(cam: THREE.Vector3) {
    const { size, radius, unloadRadius, uploadsPerFrame, resByLod } = this.o;
    const ccx = Math.floor(cam.x / size), ccz = Math.floor(cam.z / size);
    const jobs: Job[] = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dz); if (d > radius) continue;
      const cx = ccx + dx, cz = ccz + dz, lod = this.lodFor(d), c = this.chunks.get(`${cx},${cz}`);
      if (!c || (!c.pending && c.lod !== lod)) jobs.push({ cx, cz, lod, d });
    }
    jobs.sort((a, b) => a.d - b.d);                      // nearest first; add a frustum bias if you like
    for (const j of jobs) {
      const w = this.idle.pop(); if (!w) break;
      const k = `${j.cx},${j.cz}`;
      const c = this.chunks.get(k) ?? { cx: j.cx, cz: j.cz, lod: -1, wantLod: j.lod, pending: false };
      c.pending = true; c.wantLod = j.lod; this.chunks.set(k, c);
      w.postMessage({ seed: this.seed, cx: j.cx, cz: j.cz, size, res: resByLod[j.lod], lod: j.lod });
    }
    for (let u = 0; u < uploadsPerFrame && this.ready.length; u++) {   // cap GPU uploads per frame
      const r = this.ready.shift()!, c = this.chunks.get(`${r.cx},${r.cz}`);
      if (!c) continue;                                   // unloaded while in flight
      c.pending = false;
      if (r.lod !== c.wantLod) continue;                  // stale LOD; next update re-queues
      const mesh = new THREE.Mesh(chunkGeometry(r.h, r.nrm, size, r.res), this.material);
      mesh.position.set(r.cx * size + size / 2, 0, r.cz * size + size / 2);
      if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      this.scene.add(mesh); c.mesh = mesh; c.lod = r.lod; c.h = r.h;
      this.onChunk?.(c, true);
    }
    for (const [k, c] of this.chunks) {                  // hysteresis: unload radius > load radius
      if (c.pending || Math.hypot(c.cx - ccx, c.cz - ccz) <= unloadRadius) continue;
      if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      this.onChunk?.(c, false); this.chunks.delete(k);
    }
  }
}
```

The worker from SKILL.md Recipe 2 must echo `lod` and `res` in its reply. `chunkGeometry` is in SKILL.md
Recipe 2 (add `addSkirt` below). Neighbouring chunks should differ by at most one LOD level. With the rings above
that holds, but assert it in a debug overlay that colours chunks by LOD.

## Skirts (hide LOD cracks without stitching)

```ts
// Appends a vertical curtain below the chunk border. n = res + 1 vertices per side; x-fastest grid.
export function addSkirt(g: THREE.BufferGeometry, n: number, depth: number) {
  const P = g.attributes.position.array as Float32Array, N = g.attributes.normal.array as Float32Array;
  const loop: number[] = [];                              // border, walked so skirt faces point outward
  for (let i = 0; i < n; i++) loop.push(i);                          // z = min, x increasing
  for (let j = 1; j < n; j++) loop.push(n - 1 + j * n);              // x = max, z increasing
  for (let i = n - 2; i >= 0; i--) loop.push(i + (n - 1) * n);       // z = max, x decreasing
  for (let j = n - 2; j > 0; j--) loop.push(j * n);                  // x = min, z decreasing
  const base = P.length / 3, L = loop.length;
  const pos = new Float32Array(P.length + L * 3), nor = new Float32Array(N.length + L * 3);
  pos.set(P); nor.set(N);
  loop.forEach((v, k) => {
    pos.set([P[v * 3], P[v * 3 + 1] - depth, P[v * 3 + 2]], (base + k) * 3);
    nor.set([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], (base + k) * 3);   // copy normal so shading matches
  });
  const idx = Array.from(g.index!.array as ArrayLike<number>);
  for (let k = 0; k < L; k++) {
    const a = loop[k], b = loop[(k + 1) % L], a2 = base + k, b2 = base + ((k + 1) % L);
    idx.push(a, b, b2, a, b2, a2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.deleteAttribute('uv');                                // or extend uv too if your material needs it
  g.setIndex(idx);
  return g;
}
```

Skirt depth ≈ the max height error between adjacent LODs (2-4 × cell size on steep terrain).

## CDLOD in one page (Strugar 2010, github.com/fstrugar/CDLOD, MIT, paper + old DX9 source)

1. Quadtree over the heightmap. Each node covers `2^k` patches. Precompute per-node min/max height (AABB).
2. LOD ranges: `range[0] = r0`, `range[i] = range[i-1] * 2`. Select nodes top-down: if a node's AABB is outside
   the frustum, skip it. If it's beyond `range[level]`, skip. If it's inside `range[level-1]`, recurse into the
   children. Otherwise draw it (and draw only the children quadrants that are in range).
3. Draw every selected node with **one** N×N grid mesh (instanced). Per-instance data is (offset.xz, scale, level).
4. Vertex shader: world xz = offset + local × scale. Sample height from an R32F/R16F texture. Morph factor
   `m = clamp((dist − morphStart[level]) / (morphEnd[level] − morphStart[level]), 0, 1)`. Snap odd vertices toward the
   coarser grid: `xz -= fract(gridPos * 0.5) * 2 * m * cellSize`, then resample height. No cracks, no popping.
5. Normals from a normal map baked from the same heightmap (don't recompute from morphing vertices).

three.js notes: build it as a `Mesh` with an `InstancedBufferGeometry` (one grid, `instanceCount` = nodes) and an
`InstancedBufferAttribute` for (offset, scale, level). In TSL, read it with `instancedBufferAttribute(attr)` and
sample with `texture(heightTex, uv)` inside `material.positionNode`. Check the current TSL docs for exact names.
WebGL2: linear filtering of 32-bit float textures needs `OES_texture_float_linear` (often missing on mobile). Use
`HalfFloatType` (filterable everywhere) or do manual bilinear with `NearestFilter`. Keep the CPU height grid
for physics and gameplay.

Geometry clipmaps (Losasso & Hoppe 2004; Terrain3D's approach): nested square rings of fixed vertex count centred
on the camera, snapped to each ring's grid spacing so vertices don't swim. Simpler than CDLOD for "always around
the player" worlds. Worse when the camera jumps far.

## Colliders

| Engine | API | Notes |
|---|---|---|
| Rapier (`@dimforge/rapier3d-compat` 0.21) | `ColliderDesc.heightfield(nrows, ncols, heights, scale, flags?)` | nrows/ncols = **cells**; heights `(nrows+1)*(ncols+1)` **column-major, rows = z**, so transpose from x-fastest grids. Centred on the body. `HeightFieldFlags.FIX_INTERNAL_EDGES` reduces bumps on flat ground |
| Jolt (`jolt-physics` 1.x WASM) | `HeightFieldShapeSettings` (sample count must suit its block size) | Check JoltPhysics.js docs/examples for the exact constructor. Godot 4.4+ ships Jolt built in |
| Godot | `HeightMapShape3D`: `map_width`, `map_depth`, `map_data` (`PackedFloat32Array`) or `update_map_data_from_image(img, min, max)` | 1 m spacing and centred, so scale the `CollisionShape3D`. Terrain3D generates its own (dynamic mode) |
| Unity | `TerrainCollider` + `TerrainData` | Automatic with Terrain |
| cannon-es | `Heightfield(matrix, { elementSize })` | Legacy; prefer Rapier. Its heightfield lies in the local XY plane (rotate the body) |

Only chunks within ~150-300 m of dynamic bodies get colliders. Create them in `onChunk(c, true)` from `c.h` (keep
the CPU heights). Remove them with `world.removeCollider(col, false)` plus the fixed body. LOD meshes and
colliders can use different resolutions: use the finest heights for colliders even when the mesh is coarse, or
players see their feet clip into a far-LOD hill that becomes near.

## Floating origin

float32 spacing (ulp) is ~1 mm at 10 km and ~8 mm at 100 km from the origin. three.js composes `modelViewMatrix`
in float64 on the CPU, so chunk-local vertices render fine far out. **Physics (Rapier f32), particle systems and
any shader that uses world positions do not.** Past ~5-10 km, rebase: when the player is more than R from the
origin, subtract an integer multiple of chunk size from every root object, every body translation, and the
camera, and keep a float64 `worldOffset` for saves and streaming math.

## Budgets (desktop WebGPU / WebGL2, mid-range laptop)

| Item | Budget |
|---|---|
| Terrain triangles visible | 1-3 M (desktop), 0.3-0.8 M (mobile) |
| Chunk uploads per frame | 2-4 (64² chunks), else frame spikes |
| Workers | `hardwareConcurrency − 1`, max ~6 |
| Draw calls total | < 1 000 desktop WebGL, < 300 mobile; vegetation via instancing |
| Collider chunks | 3×3 to 7×7 around each dynamic body |

These are starting points. Measure with the `game-performance-optimization` skill.
