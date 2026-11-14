# Smooth voxels: SDF terrain, meshing, LOD, digging

## Data

- Store a **signed distance** per sample (negative = solid) plus a material id. Quantise to `Int8` (±1 voxel range
  scaled to ±127) or `Int16` to save memory: 32³ × 1 B = 32 KB per chunk. godot_voxel uses 8- or 16-bit SDF channels.
- Chunks share their border: a chunk of S cells needs S+1 samples per side to mesh, plus +1 for normals/padding. The
  surface nets code below takes N = S + 2 samples with a 1-sample apron.
- Generation: SDF = `y − height(x, z)` for terrain, `min`/`max` (union/subtract) with cave SDFs (3D noise worms,
  spheres along splines), then clamp to ±k voxels. Don't store huge distances; only the sign and nearby values matter.
- Editing = CSG on the field: dig a sphere with `sdf = max(sdf, r − |p − c|)`, build with `sdf = min(sdf, |p − c| − r)`.
  Use smooth min/max for soft brushes.

## Which mesher

| Algorithm | Pros | Cons | Use |
|---|---|---|---|
| **Surface nets** (naive) | Simplest, watertight, fewer triangles than MC, shared vertices (smooth normals) | Rounds sharp edges, slight shrink | **Default for web** |
| Marching cubes | Classic; tables everywhere | 256-case tables, more triangles, ambiguous cases can leave holes unless the tables are consistent | Only if you need MC specifically (e.g. transvoxel) |
| Dual contouring | Sharp features (needs Hermite data: normals at crossings) | Complex, QEF solve, can self-intersect | Hard-surface, man-made smooth voxels |
| **Transvoxel** (Lengyel) | MC + transition cells: crack-free LOD seams | More code. Tables MIT (EricLengyel/Transvoxel) | Large smooth worlds with LOD (godot_voxel uses it) |

three.js's `MarchingCubes` addon (`webgl_marchingcubes`) is a **metaball effect** over a single bounded field. It
is not a chunked terrain mesher, so don't build terrain on it. The old JS packages (`isosurface`, `surface-nets` by
mikolalysenko, 2014, MIT) still work as references.

## Surface nets (`nets.ts`, tested)

Tested on a sphere SDF in a 34³ grid: watertight (every edge shared by exactly 2 triangles), all 3 792 triangles
facing outward, area 1 249 vs analytic 1 257 (−0.6 %), 2.3 ms per chunk once warm.

```ts
// nets.ts: naive Surface Nets over a padded SDF chunk (negative = solid). Watertight, one vertex per surface cell.
// sdf: Float32Array(N³), index x + N*(y + N*z). Chunks share a 1-sample border so neighbours' meshes meet exactly.
const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export function surfaceNets(sdf: Float32Array, N: number) {
  const NN = N * N, OFF = C.map(([x, y, z]) => x + N * y + NN * z);
  const vid = new Int32Array(N * N * N).fill(-1), pos: number[] = [], idx: number[] = [], v = new Float64Array(8);
  for (let z = 0; z < N - 1; z++) for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
    const i = x + N * y + NN * z;
    let mask = 0;
    for (let k = 0; k < 8; k++) { v[k] = sdf[i + OFF[k]]; if (v[k] < 0) mask |= 1 << k; }
    if (mask === 0 || mask === 255) continue;              // fully outside / inside
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = EDGES[e][0], b = EDGES[e][1];
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      const t = v[a] / (v[a] - v[b]);                       // linear zero crossing
      sx += C[a][0] + t * (C[b][0] - C[a][0]); sy += C[a][1] + t * (C[b][1] - C[a][1]); sz += C[a][2] + t * (C[b][2] - C[a][2]); n++;
    }
    vid[i] = pos.length / 3;
    pos.push(x + sx / n, y + sy / n, z + sz / n);
  }
  const STEP = [1, N, NN];
  for (let z = 1; z < N - 1; z++) for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = x + N * y + NN * z, s0 = sdf[i] < 0;
    for (let a = 0; a < 3; a++) {
      if ((a === 0 ? x : a === 1 ? y : z) + 1 >= N) continue;
      if ((sdf[i + STEP[a]] < 0) === s0) continue;          // no sign change along this lattice edge
      const du = STEP[(a + 1) % 3], dv = STEP[(a + 2) % 3];
      const q0 = vid[i], q1 = vid[i - du], q2 = vid[i - dv], q3 = vid[i - du - dv];  // 4 cells around the edge
      if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
      if (s0) idx.push(q0, q1, q3, q0, q3, q2); else idx.push(q0, q2, q3, q0, q3, q1);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
```

Normals: compute from the SDF gradient at each vertex (central differences, trilinear sample) rather than
`computeVertexNormals()`. That way normals match across chunk borders. Materials: per vertex, pick the material of
the nearest solid sample, or carry 2-4 weights for blending (triplanar texturing, since there are no UVs).

## Seams and LOD

- Same-LOD neighbours: with the shared 1-sample apron, neighbouring chunks produce vertices at identical positions
  on the border, so no cracks.
- Different LOD: surface nets has no transition cells. Use skirts or overlap and fog, or switch to transvoxel.
  The quick fix: generate each LOD level's border cells at the finer neighbour's resolution (stitching strip).
- Rule of thumb: LOD0 for 3-4 chunks around the player, then doubling ranges. Re-mesh LODs from the SDF downsampled
  by taking every second sample. That is correct for an SDF, unlike block ids.

## Physics for smooth terrain

- Trimesh collider per near chunk (Rapier `ColliderDesc.trimesh(vertices, indices)`), rebuilt in a worker after
  edits. Only chunks within ~2 of a dynamic body need colliders.
- Character controllers on SDFs can also query the field directly (sphere vs SDF: push out along the gradient
  when `sdf(p) < r`). This is cheap and exact for the player.

## Godot: godot_voxel smooth terrain

- Node: `VoxelLodTerrain` with `VoxelMesherTransvoxel` and a `VoxelGeneratorGraph` (node graph with SDF ops and noise;
  GPU generation is optional on Vulkan). Add `VoxelViewer` to the player, and `VoxelInstancer` for grass/rocks on the
  surface.
- Digging/building: `get_voxel_tool()`, `channel = VoxelBuffer.CHANNEL_SDF`, `mode = VoxelTool.MODE_REMOVE` or
  `MODE_ADD`, `do_sphere(center, radius)`. Read the field with `get_voxel_f(pos)` (the integer `get_voxel` is encoded).
- Raycasts: `VoxelTool.raycast(origin, dir, max_distance)` returns `VoxelRaycastResult` (`position`,
  `previous_position`, `distance`, `normal` if enabled).
- Builds: module (custom engine build, prebuilt editors on GitHub releases) or GDExtension (official Godot ≥ 4.4.1,
  no FastNoise2). Use the FastNoise2-backed noise nodes only with the module build.
