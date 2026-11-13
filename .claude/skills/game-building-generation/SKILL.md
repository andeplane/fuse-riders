---
name: game-building-generation
description: Load when procedurally generating buildings, towns, cities, interiors, dungeons or levels - shape grammars (CGA-style split/repeat), modular kit assembly (Kenney/KayKit), Wave Function Collapse (incl. Townscaper-style irregular grids), BSP rooms, cellular-automata caves, graph-based lock-and-key dungeons (cyclic generation, Unexplored) with a per-seed solver, template + placement + decay, and navmesh-friendly layouts.
---

# Procedural buildings, towns, dungeons and levels

**Structure first, geometry second, dressing last, and a solver proves every seed.** Models fail here by
running WFC or random rooms on their own and hoping the result is playable. Good generators build a
*plan* (graph, lots, footprints), turn the plan into *kit pieces*, decorate and decay it, and then *validate* it
(solvable, reachable on the navmesh, no floating geometry) before the player sees it.

```
seed ─► plan: mission graph / road graph / lots + footprints     (abstract, cheap, testable)
     ─► layout: graph → lattice / rooms / BSP leaves              (no overlaps by construction)
     ─► geometry: split grammar or WFC → kit-piece placements     (instanced, 1-few draw calls)
     ─► dressing: props, lights, loot; decay/overgrowth            (seeded per instance)
     ─► validate: solver over (room, inventory), navmesh paths, connectivity  → reject + reseed
```

References (tested code):
- `references/dungeon-graphs-and-solvers.md`: cyclic lock-and-key generator on a grid lattice, (room × inventory) solver with soft-lock and decorative-lock detection, 256-seed sweep, ASCII/tiles export, BSP + cellular caves.
- `references/wfc.md`: socket-based simple-tiled WFC (weights, rotations, pinned cells, restarts, validator), 3D and irregular-grid extensions, existing libraries.
- `references/buildings-and-kits.md`: split grammar → facade placements, kit normalisation + `BatchedMesh`, Godot `GridMap`, voxel template + placement + decay, interiors at city scale, Blender/blender-mcp pipeline.

## When to use what

| Problem | three.js / web | Godot 4.4+ | Unity 6 | Why | When NOT |
|---|---|---|---|---|---|
| Recognisable buildings (floors, bays, doors, roofs) | **Split grammar** (CGA-style `split`/`repeat`/`comp`) emitting kit pieces; ~150 lines TS | Same, emitting `GridMap` cells or scene instances | Same in C# | Architecture is hierarchical; grammars encode it directly | Ruins/organic: add decay, or use voxels |
| Locally coherent tiles (towns, walls, roads, terrain tiles, castles) | **WFC simple-tiled** with sockets (`references/wfc.md`), or `kchapelier/wavefunctioncollapse` (2D, MIT) | `AlexeyBond/godot-constraint-solving` (MIT, TileMapLayer/GridMap 2D slices, backtracking, threads) | `BorisTheBrave/DeBroglie` (MIT, constraints, backtracking, 3D/hex), Tessera (paid, unverified) | Local rules → plausible variety | Global structure (connectivity, progression, pacing): WFC can't guarantee it, so pin cells from a plan |
| Townscaper-like organic grid | Hex → triangles → random-merge to quads → subdivide → relax, then marching-squares/cubes module pick per corner | Sylves (C#, BorisTheBrave) | Sylves | Irregular but all-quads grid, so WFC still works | Gameplay grids (pathing, building placement): use regular grids |
| Roguelike rooms + corridors (2D/top-down) | `rot-js` `Map.Digger` / `Map.Uniform` / `Map.Rogue`, or BSP (own code) | BSP / random walk in GDScript; GodotPrompter `procedural-generation` skill | Edgar-Unity (graph + room templates) | Fast, proven | Progression-heavy levels: use the graph method |
| Caves | Cellular automata (`rot-js` `Map.Cellular`, or own 4-5 rule) + keep largest region + connect | same | same | Organic | 3D caves with overhangs: voxels/SDF (`game-voxels`) |
| **Progression: lock-and-key, loops, shortcuts** | **Mission graph first** (Dormans' cyclic generation, as in Unexplored) on a lattice → rooms; solver per seed | same; Edgar.Godot (MIT, wraps Edgar-DotNet) for room-template layouts | Edgar-Unity (MIT, no resale; PRO adds directed graphs) | Guarantees pacing and solvability | Pure arenas/open fields |
| Hand-authored quality at scale | **Template + placement + decay**: author voxel/prefab templates, place by worldgen rules, decay per instance | same (scenes as templates) | Prefabs | Authored detail + procedural variety | Every instance must be unique |
| City road networks | Tensor-field streets (ProbableTrain/MapGenerator, LGPL/GPL, reference only in closed games), or agent/L-system growth on terrain | same | same | Believable blocks | Small towns: hand-lay a spline or two |
| Offline hero buildings | Blender geometry nodes (Buildify, free/pay-what-you-want) via blender-mcp → glTF → meshopt/KTX2 | import glTF | import FBX/glTF | Artist-grade | Runtime-random buildings |
| Interiors for thousands of buildings | Interior-mapping shader for far windows; generate real rooms lazily within ~50-100 m | same | same | Millions of rooms cost nothing until entered | Small games: just model them |
| Navmesh | `recast-navigation` + `@recast-navigation/three` (MIT, WASM), or `navcat` (pure JS, MIT) | `NavigationRegion3D` bake | AI Navigation package | Proves reachability | Grid games: BFS on the grid |

## Recipe 1: modular kit assembly (three.js r18x)

Kenney (CC0, e.g. *Modular Buildings*, *City Kit*, *Building Kit*) and KayKit (*Dungeon Remastered*: CC0, 200+
pieces free, one 1024² gradient atlas) usually ship one file per piece. When pieces share one atlas texture, they can
share **one material**, and a whole town fits in one `BatchedMesh` draw call. The loader below assumes that, so
check that every piece's `material.map.image` is the same file, and group by texture if not.

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Piece = { geo: THREE.BufferGeometry; size: THREE.Vector3; id?: number };
async function loadKit(names: string[], base: string) {
  const loader = new GLTFLoader(), kit = new Map<string, Piece>();
  let material: THREE.Material | undefined;
  for (const name of names) {
    const gltf = await loader.loadAsync(`${base}/${name}.glb`);
    const geos: THREE.BufferGeometry[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { geos.push(m.geometry.clone().applyMatrix4(m.matrixWorld)); material ??= m.material as THREE.Material; } });
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos)!;  // null if attributes differ
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -b.max.z); // pivot: bottom-centre, outer face at z=0, faces +z
    kit.set(name, { geo, size: b.getSize(new THREE.Vector3()) });
  }
  return { kit, material: material! };
}

function buildBatch(kit: Map<string, Piece>, material: THREE.Material, placements: { piece: string; m: THREE.Matrix4 }[]) {
  let verts = 0, idx = 0;
  for (const p of kit.values()) { verts += p.geo.attributes.position.count; idx += p.geo.index?.count ?? 0; }
  const batch = new THREE.BatchedMesh(placements.length, verts, Math.max(idx, verts), material);
  for (const p of kit.values()) p.id = batch.addGeometry(p.geo);   // each geometry stored once
  for (const pl of placements) batch.setMatrixAt(batch.addInstance(kit.get(pl.piece)!.id!), pl.m);
  return batch;
}
```

- Check that "outer face is +z" per kit: render a **kit sheet** (every piece in a row, labelled, with an
  `AxesHelper`) and screenshot it once. Kits disagree on pivots and facing, and models guess wrong.
- Snap to the kit grid (measure `size`: many Kenney/KayKit walls are 1, 2 or 4 units). Assert in code that
  `size.x` matches the grid ±1 %.
- All geometries in a `BatchedMesh` must share the same attribute set **and** all be indexed or all non-indexed
  (r187 throws `All geometries must consistently have "index"`). `mergeGeometries` returns `null` on mismatched
  attributes, so delete stray attributes (e.g. `uv1`, `color`) first.

## Recipe 2: split grammar → facades (see `references/buildings-and-kits.md` for full code)

```ts
// CGA core: split absolute + relative sizes; repeat a nominal tile and stretch it to fit exactly.
type Size = number | { r: number };
export function split(len: number, sizes: Size[]): [number, number][] {
  const abs = sizes.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  const rel = sizes.reduce<number>((s, v) => s + (typeof v === 'number' ? 0 : v.r), 0);
  const rest = Math.max(0, len - abs); let at = 0;
  return sizes.map(v => { const l = typeof v === 'number' ? v : (rest * v.r) / (rel || 1); const s: [number, number] = [at, l]; at += l; return s; });
}
export const repeat = (len: number, tile: number): [number, number][] => {
  const n = Math.max(1, Math.round(len / tile)), l = len / n;
  return Array.from({ length: n }, (_, i) => [i * l, l]);
};
// building(seed, W, D, floors): comp(faces) → 4 facades (origin, u-axis, yaw) → split floors (ground taller)
// → repeat bays (~3 m) → pick piece per bay (door on one front bay, shop windows on ground, windows above)
// → Matrix4.compose(origin + u*(x+w/2) + up*y, yaw, (w/moduleW, h/moduleH, 1)) → roof by footprint area.
```

Rules that make grammar buildings look right: one door per street-facing facade, aligned window columns across
floors (decide per *bay*, not per cell), a taller ground floor, corner pieces at facade ends, roof type by footprint
area, and per-building palette/material variation through instance colour (`batch.setColorAt`).

## Recipe 3: lock-and-key dungeon + solver (core of this skill)

The pattern: **a lock-and-key zone graph plus a solver that checks 256 seeds** in CI. Generator (full,
tested code in the reference):

1. Major cycle = perimeter of a random rectangle on a small lattice (planar, no overlaps). Start and goal sit on
   it, so the loop splits into arc A and arc B.
2. Pick a cycle pattern (Unexplored has 24). Three that cover a lot:
   **lockAndKey**: arc A ends at a locked door, the key is on a dead end off arc B, and arc B→goal is a one-way
   valve (shortcut home). **twoKeys**: the goal needs both keys, one per arc. **valveShortcut**: the goal sits
   off-centre, the short arc is one-way *from* the goal, and the long arc has a locked door.
3. Add dead-end branches (random walks into free lattice cells) to hide keys, then filler branches.
4. **Solve**: BFS over states `(room, inventoryBitmask)`. A state is a *soft-lock* if the goal can't be reached
   from it (reverse BFS). A lock is *decorative* if the level is still solvable with its key removed.
   *Detour* = solution length / shortest path ignoring locks. Reject if unsolvable, soft-locked, decorative or
   detour < 1.2, then retry with `hashSeed(seed, attempt)`.
5. Lattice → tiles: each cell becomes R×R floor tiles, edges become doors (`L` locked, `> < ^ v` one-way), and
   the tile grid feeds the kit assembler.

```ts
// vitest: the per-seed guarantee
test('256 seeds: solvable, no soft-locks, every lock matters', () => {
  for (let seed = 0; seed < 256; seed++) {
    const { rep, attempt } = generateValid(seed);
    expect(rep.solvable && rep.softlockStates === 0 && rep.decorativeLocks.length === 0).toBe(true);
    expect(attempt).toBeLessThan(8);   // generator quality: rejections must stay rare
  }
});
```

Measured with the reference code: 256/256 seeds valid on the first attempt, 2 000 raw generations all valid,
and the solver caught a broken pattern (a one-way drop that trapped the player) on the first run. Write the
solver before tuning the generator.

## Recipe 4: WFC with a plan (see `references/wfc.md`)

Use WFC for the *texture* of a place, not its structure. Pin cells from the plan first (road entering at the
gate, door sockets where the graph says a door goes, plaza in the centre). Then solve, then validate adjacency
**and** your global property (BFS: all road tiles connected, every house door touches a road). Reject and reseed
on failure. Restarts with derived seeds keep it deterministic. The reference solver did 256/256 seeds on a
24×16 road/house set with no restarts, and 48×48 × 16 tiles in ~240 ms in Node, so run it in a worker.

## Recipe 5: template + placement + decay

Author 10-40 templates (voxel `.vox` from MagicaVoxel, or prefab scenes) tagged with footprint, allowed biomes,
max slope and spacing. Worldgen picks sites per region (jittered grid, seeded per cell), filters by slope/biome
/spacing/roads, picks template and rotation from a seeded rng, flattens or founds the terrain under the
footprint, stamps the template, then **decays it**: coherent 3D-noise holes that grow with height, a flood fill
from ground contact to delete anything floating, rubble at the base, and overgrowth on exposed tops. Code in
`references/buildings-and-kits.md`. Keep decay deterministic per `(worldSeed, siteId)` so saves only store edits.

## Navmesh-friendly layout rules

Recast erodes walkable space by the agent radius, so design for the eroded size:
- Doorways ≥ 2 × agentRadius + 2 × cellSize clear (humanoid r = 0.4-0.5 m, so ≥ 1.2 m; use 1.5 m).
  Corridors ≥ 2 m.
- Step height ≤ `walkableClimb` (0.3-0.4 m), ramps ≤ `walkableSlopeAngle` (≤ 45°), ceilings ≥ `walkableHeight` (2 m).
  These are design sizes in metres. Recast's config takes radius/height/climb in **voxels** (`game-npc-ai`).
- Keep decor out of nav geometry (or mark as obstacles), or a chair in a doorway cuts the level in half.
- Validate per seed: build the navmesh (in a worker), then `NavMeshQuery.computePath(start, roomCentre)` must
  succeed for every room the solver says is reachable. See `game-npc-ai` for crowds and agents.

## Pitfalls the model gets wrong

- **WFC as the level designer.** It produces locally valid nonsense: unreachable rooms, roads to nowhere. Plan
  first, pin cells, validate globally.
- **No solver.** "Looks solvable" is not a test. One-way edges and multi-key locks create soft-locks humans
  miss. Run the (room × inventory) BFS for every seed in CI.
- **Shared RNG across stages.** Adding one prop shifts every later random number and changes the whole dungeon.
  Use one sub-seed per stage/site: `hashSeed(seed, STAGE, siteId)`.
- **Tie-breaking by `Map`/object iteration or `Array.sort` without a full comparator**: always end comparators
  with an index tie-break.
- **One mesh per piece.** 30 000 wall meshes = 30 000 draw calls. Use `BatchedMesh` (atlas kits) or one
  `InstancedMesh` per piece type.
- **Kit pivots/facing assumed.** Normalise at load and screenshot the kit sheet.
- **Licences**: Kenney and KayKit (free tiers) are CC0. watabou/TownGeneratorOS is GPL-3.0 and ProbableTrain/
  MapGenerator is LGPL/GPL, so study them, don't paste them into closed code. Edgar-Unity is MIT but "cannot be
  redistributed or resold". `parse-magica-voxel` is GPLv3 (use three.js `VOXLoader` or MIT `vox-reader`).
- **WFC perf**: naive propagation is O(T²) per cell. Past ~100 tiles or 3D, use bitset compat tables or support
  counters (mxgmn's approach), and run in a worker.

## Verification

1. **Seed sweep in CI** (vitest): 256 seeds → solver passes, no soft-locks, no decorative locks, generator
   attempts < 8, stats in range (room count, detour 1.2-3, dead ends ≥ 1). Assert determinism by generating
   twice and comparing JSON.
2. **ASCII / top-down render**: dump `toTiles()` for seeds 0-3 into the test log, plus a Playwright screenshot of an
   orthographic top-down view with door/lock/key colours. Compare against the ASCII.
3. **Navmesh check** per seed (above) and a debug overlay drawing the solver's path and key pickups
   (`game-debug-tools`).
4. **Kit sheet screenshot** once per kit, and a street-level screenshot per building style for `game-art-review`.

## Install instead of reinventing

- mxgmn/WaveFunctionCollapse (C#, the original; ~25k★), kchapelier/wavefunctioncollapse (JS port, MIT),
  BorisTheBrave/DeBroglie (C#, MIT), marian42/wavefunctioncollapse (Unity infinite city with backtracking, MIT, ~4.9k★),
  AlexeyBond/godot-constraint-solving (Godot 4 WFC, MIT).
- OndrejNepozitek/Edgar-Unity + Edgar-DotNet (graph-based room-template layouts), RickyYCheng/Edgar.Godot (Godot 4.5, MIT).
- ondras/rot.js (`rot-js`, BSD-3: Digger/Uniform/Rogue/Cellular maps, FOV, seeded `RNG.setSeed`).
- BorisTheBrave/sylves (C#, irregular/Townscaper grids, Unity + Godot compatible).
- Reading: Boris the Brave, "Dungeon Generation in Unexplored" (2021); Joris Dormans' cyclic generation; Mark
  Brown's *Boss Keys* series; Oskar Stålberg's talks on Townscaper/Bad North WFC.
- Agent skills: `gamedev-skills/awesome-gamedev-agent-skills` (`procedural-gen`, `roguelike`), `jame581/GodotPrompter`
  (`procedural-generation`). Assets: `game-asset-pipeline`. Navmesh/agents: `game-npc-ai`. Voxel structures: `game-voxels`.
