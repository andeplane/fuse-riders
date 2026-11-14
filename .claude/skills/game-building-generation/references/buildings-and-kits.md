# Buildings, kits, templates and towns

## Split grammar → facade placements (`building.ts`, tested)

Outputs `{ piece, m }` placements for the `BatchedMesh` assembler (SKILL.md Recipe 1). Modules are
normalised to *bottom-centre pivot, outer face at z = 0, facing +z, `moduleW` wide*. Tested: deterministic,
every facade module faces outward, 1 door per building.

```ts
// building.ts: CGA-style split grammar → list of kit-piece placements (deterministic)
import * as THREE from 'three';
import { mulberry32 } from './rng';

export type Placement = { piece: string; m: THREE.Matrix4 };
type Size = number | { r: number };                      // absolute metres, or relative share of the rest

/** Split a length into parts: absolute sizes first, the remainder shared by relative weights. */
export function split(len: number, sizes: Size[]): [number, number][] {
  const abs = sizes.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  const rel = sizes.reduce<number>((s, v) => s + (typeof v === 'number' ? 0 : v.r), 0);
  const rest = Math.max(0, len - abs);
  let at = 0;
  return sizes.map(v => { const l = typeof v === 'number' ? v : (rest * v.r) / (rel || 1); const seg: [number, number] = [at, l]; at += l; return seg; });
}
/** Repeat a tile of nominal size along len: integer count, stretched to fill exactly (CGA "~tile"). */
export function repeat(len: number, tile: number): [number, number][] {
  const n = Math.max(1, Math.round(len / tile)), l = len / n;
  return Array.from({ length: n }, (_, i) => [i * l, l]);
}

export function building(seed: number, W: number, D: number, floors: number, opts = { bay: 3, groundH: 4, floorH: 3, moduleW: 3 }) {
  const r = mulberry32(seed), out: Placement[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  // comp(faces): 4 facades, each with an origin, a u-axis and a yaw so +z-facing modules face outward
  const facades = [
    { o: new THREE.Vector3(-W / 2, 0, D / 2), yaw: 0, len: W },             // front (+z), u = +x
    { o: new THREE.Vector3(W / 2, 0, D / 2), yaw: Math.PI / 2, len: D },     // right (+x), u = -z
    { o: new THREE.Vector3(W / 2, 0, -D / 2), yaw: Math.PI, len: W },        // back (-z),  u = -x
    { o: new THREE.Vector3(-W / 2, 0, -D / 2), yaw: -Math.PI / 2, len: D },  // left (-x),  u = +z
  ];
  const floorsSplit = split(opts.groundH + (floors - 1) * opts.floorH, [opts.groundH, ...Array(floors - 1).fill({ r: 1 })]);
  const doorBay = Math.floor(r() * repeat(W, opts.bay).length);
  facades.forEach((f, fi) => {
    const q = new THREE.Quaternion().setFromAxisAngle(up, f.yaw);
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const bays = repeat(f.len, opts.bay);
    floorsSplit.forEach(([y, h], level) => {
      bays.forEach(([x, w], bi) => {
        let piece: string;
        if (level === 0) piece = fi === 0 && bi === doorBay ? 'door' : r() < 0.6 ? 'shopWindow' : 'wall';
        else piece = r() < 0.75 ? 'window' : 'wall';
        const p = f.o.clone().addScaledVector(u, x + w / 2).addScaledVector(up, y);
        const s = new THREE.Vector3(w / opts.moduleW, h / (level === 0 ? opts.groundH : opts.floorH), 1); // stretch to fit
        out.push({ piece, m: new THREE.Matrix4().compose(p, q, s) });
      });
    });
  });
  out.push({ piece: W * D > 150 ? 'roofFlat' : 'roofGable',
    m: new THREE.Matrix4().compose(new THREE.Vector3(0, floorsSplit.at(-1)![0] + floorsSplit.at(-1)![1], 0), new THREE.Quaternion(), new THREE.Vector3(W, 1, D)) });
  return out;
}
```

Extending the grammar (same two primitives):
- **Mass models**: L/U/T footprints = union of boxes; run facades per box, and skip facade bays that are inside
  another box (test the bay centre against the other boxes).
- **Setbacks**: upper floors on a smaller box (`W - 2`, `D - 2`) with a parapet piece on the ledge.
- **Corners**: emit a `corner` piece at each facade end per floor, and shrink the first/last bay by its width before `repeat`.
- **Style sets**: a style = `{ bay, floorH, pieceMap, palette }`; pick by district noise so neighbours match.
- **Rule language**: if you want CityEngine-like rule files, keep them as typed TS functions (`(scope, rng) =>
  Placement[]`). A string DSL buys nothing for an agent-written codebase.

## Towns and cities

1. **Roads**: hand-placed main road splines or tensor-field streets (ProbableTrain/MapGenerator, LGPL/GPL,
   reference only), then minor streets by agent growth that stops at water/steep slope. Build a planar graph and
   extract faces = blocks.
2. **Lots**: recursively split each block polygon perpendicular to its longest edge until area < target. Discard
   lots without street frontage (or make courtyards). Inset by the sidewalk width.
3. **Buildings**: footprint = lot inset, floors from a district density field, style from district noise,
   then the grammar.
4. **Terrain fit**: sample terrain at footprint corners. If `max − min > maxStep`, add a plinth (foundation
   piece down to the lowest corner) or reject the lot.
5. **Scale**: one `BatchedMesh` per material per district chunk. Stream districts like terrain chunks
   (`game-world-generation`). Browser demos on three.js WebGPU + TSL have shown about 42 km² with
   37k buildings and millions of enterable rooms, so this scale is possible. Treat the next section as the
   standard way to get there.

## Interiors at scale

- **Far (> 50-100 m): interior mapping** (van Dongen 2008). In the window shader, take the fragment's
  facade-local position `p` in room units and the view ray `v` into the building. With `cell = floor(p)` and
  `f = fract(p)`, per axis `t_i = ((v_i > 0 ? 1 : 0) − f_i) / v_i`. The nearest `t` picks the wall/floor/ceiling
  plane, and `f + v·t` is the UV on it. `hash(cell)` picks the room texture variant and lights on/off. One quad per
  window, infinite rooms. Write it as a TSL `Fn` on `colorNode`/`emissiveNode` (three.js has no built-in node
  for this as far as we know; check before writing one).
- **Near (< 50 m): real interiors**, generated lazily from `hashSeed(citySeed, buildingId, floor)`: split each floor
  plate into rooms with the BSP from `dungeon-graphs-and-solvers.md` (corridor spine first, then rooms off it), place
  doors on shared walls, stairs/elevator core fixed per building so floors line up, then furnish with
  rule-based props against walls. Dispose when the player leaves.
- **Navmesh** per generated floor in a worker. Keep doorways ≥ 1.2-1.5 m (SKILL.md rules).

## Template + placement + decay (`decay.ts`, tested)

Templates are voxel grids (MagicaVoxel `.vox` → `VOXLoader` chunks or `vox-reader`) or prefab scenes. Rotation by
quarter turns and decay are deterministic. Tested: four rotations give back the original, voxel count is
preserved, and the same seed gives identical output.

```ts
// decay.ts: "template → placement → decay" for voxel structures (deterministic)
import { createNoise3D } from 'simplex-noise';
import alea from 'alea';

export type VoxTemplate = { id: string; sx: number; sy: number; sz: number; v: Uint8Array }; // v[x + sx*(y + sy*z)], 0 = air

/** Rotate a template by r quarter turns about +y. */
export function rotateY(t: VoxTemplate, r: number): VoxTemplate {
  let cur = t;
  for (let k = 0; k < (r & 3); k++) {
    const { sx, sy, sz, v } = cur, out = new Uint8Array(v.length);  // new dims: (sz, sy, sx)
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
      out[(sz - 1 - z) + sz * (y + sy * x)] = v[x + sx * (y + sy * z)];  // (x,z) → (sz-1-z, x)
    cur = { id: t.id, sx: sz, sy, sz: sx, v: out };
  }
  return cur;
}

/** Decay: coherent noise holes that grow with height, then drop anything no longer connected to the ground. */
export function decay(t: VoxTemplate, seed: string, amount = 0.35, rubbleId = 9) {
  const n3 = createNoise3D(alea(seed + ':decay'));
  const { sx, sy, sz } = t, v = t.v.slice(), at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  for (let z = 0; z < sz; z++) for (let y = 1; y < sy; y++) for (let x = 0; x < sx; x++) {
    const i = at(x, y, z); if (!v[i]) continue;
    const hFactor = y / (sy - 1);                                    // tops rot first
    if (n3(x * 0.18, y * 0.18, z * 0.18) * 0.5 + 0.5 < amount * (0.4 + hFactor)) v[i] = 0;
  }
  // flood fill from voxels touching y = 0 (6-connected); unreached voxels would float → become rubble
  const keep = new Uint8Array(v.length), q: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) { const i = at(x, 0, z); if (v[i]) { keep[i] = 1; q.push(i); } }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const j = at(nx, ny, nz); if (v[j] && !keep[j]) { keep[j] = 1; q.push(j); }
    }
  }
  let floating = 0;
  for (let i = 0; i < v.length; i++) if (v[i] && !keep[i]) { v[i] = 0; floating++; }
  // deposit rubble at the base, one column per `floating/…` voxels (cheap fake of collapse)
  for (let k = 0, r = alea(seed + ':rubble'); k < floating >> 2; k++) {
    const x = Math.floor(r() * sx), z = Math.floor(r() * sz);
    for (let y = 0; y < sy; y++) { const i = at(x, y, z); if (!v[i]) { v[i] = rubbleId; break; } }
  }
  return { ...t, v, floating };
}
```

Placement loop (per region, deterministic):

```ts
for (const site of jitteredSites(region, spacing, hashSeed(worldSeed, region.id, SITES))) {
  const rng = mulberry32(hashSeed(worldSeed, site.id, PLACE));
  const tpl = weightedPick(templatesFor(biomeAt(site)), rng);
  if (!tpl || slopeRange(site, tpl.footprint) > tpl.maxStep || nearRoad(site) || tooClose(site, placed)) continue;
  const t = decay(rotateY(tpl, Math.floor(rng() * 4)), `${worldSeed}:${site.id}`, tpl.decay);
  foundation(world, site, t);   // fill terrain up to the floor, clear air above the footprint
  stamp(world, site, t);        // write voxels; mark touched chunks dirty for remeshing
  placed.push(site);
}
```

Saves store only player edits (diffs) because templates + decay regenerate from the seed. Bunkers/dungeons inside
templates: generate the zone graph per site with the dungeon generator (seeded by site id), and solve it at
worldgen time.

## Godot: GridMap from a kit

```gdscript
# MeshLibrary: open the kit scene, Scene → Export As… → MeshLibrary (one item per piece, collision included)
@onready var grid: GridMap = $GridMap

func place(piece: String, cell: Vector3i, yaw_deg: float) -> void:
	var item := grid.mesh_library.find_item_by_name(piece)
	var orient := grid.get_orthogonal_index_from_basis(Basis(Vector3.UP, deg_to_rad(yaw_deg)))
	grid.set_cell_item(cell, item, orient)
```

Set `GridMap.cell_size` to the kit grid. Bake navigation with a `NavigationRegion3D` that parses the GridMap.
WFC: `AlexeyBond/godot-constraint-solving` (2D slices of a GridMap). Graph layouts: Edgar.Godot.

## Blender in the loop (offline hero buildings)

- **Buildify** (Pavel Oliva): free/pay-what-you-want geometry-nodes building generator (v1.0 for Blender 3.2,
  2022; check for newer versions). It builds from modular kits and footprint curves, and has a blender-osm mode for
  real city footprints.
- **blender-mcp** (`ahujasid/blender-mcp`, now also published as `mcp-for-blender`; MIT, ~32k★):
  `claude mcp add blender uvx mcp-for-blender` (older docs: `uvx blender-mcp`). `execute_blender_code` runs Python
  in the live session, so save first; the socket has no auth, so keep it on localhost. Typical script: append the
  GN node group, create footprint curves from your generator's JSON, set modifier inputs (find identifiers via
  `mod.node_group.interface.items_tree`), apply, then
  `bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True)`.
- Then meshopt/KTX2 compression and LODs (`game-asset-pipeline`, `game-performance-optimization`).
