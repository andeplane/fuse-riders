# Navigation: navmesh libraries, engines, grid A*, flow fields

## Library status (2026-10-31)

| Library | Version | Licence | Notes |
|---|---|---|---|
| recastnavigation/recastnavigation (C++) | – | zlib | ~8k★. The upstream that Godot and many engines embed |
| isaac-mason/recast-navigation-js | 0.44.0 (Oct 30 2026) | MIT | ~430★. WASM Recast/Detour, `@recast-navigation/three` and `/playcanvas`, Node support, tile cache, off-mesh links, crowd. Online generator: navmesh.isaacmason.com |
| isaac-mason/navcat | 0.4.1 (May 2026) | MIT | ~280★. Pure JS, same voxel algorithm, JSON-serialisable, function query filters, global dynamic off-mesh links, crowd with off-mesh animation hooks, flow-field example, `navcat/three` helpers |
| donmccurdy/three-pathfinding | 1.3.0 (May 2024) | MIT | ~1.4k★. Query only (zones and groups). The navmesh comes from Blender or recast. Fine for tiny static levels |
| Mugen87/yuka | 0.7.8 (2022) | MIT | ~1.4k★. Has a `NavMesh` + `NavMeshLoader` for glTF navmeshes, as part of its larger AI toolkit |

## navcat quick start (pure JS)

```ts
import { DEFAULT_QUERY_FILTER, findPath, type Vec3 } from 'navcat';
import { generateSoloNavMesh } from 'navcat/blocks';
import { getPositionsAndIndices, createNavMeshHelper } from 'navcat/three';
const [positions, indices] = getPositionsAndIndices(walkableMeshes);
const cellSize = 0.15, cellHeight = 0.25, r = 0.3, hgt = 2.0, climb = 0.5;
const { navMesh } = generateSoloNavMesh({ positions, indices }, {
  cellSize, cellHeight,
  walkableRadiusWorld: r,  walkableRadiusVoxels: Math.ceil(r / cellSize),
  walkableHeightWorld: hgt, walkableHeightVoxels: Math.ceil(hgt / cellHeight),
  walkableClimbWorld: climb, walkableClimbVoxels: Math.ceil(climb / cellHeight),
  walkableSlopeAngleDegrees: 45, borderSize: 0, minRegionArea: 8, mergeRegionArea: 20,
  maxSimplificationError: 1.3, maxEdgeLength: 12, maxVerticesPerPoly: 5,
  detailSampleDistance: cellSize * 6, detailSampleMaxError: cellHeight * 1,
});
scene.add(createNavMeshHelper(navMesh).object);
const res = findPath(navMesh, [-4, 0, -4] as Vec3, [4, 0, 4] as Vec3, [0.5, 0.5, 0.5] as Vec3, DEFAULT_QUERY_FILTER);
const waypoints = res.path.map(p => p.position);
```
- Vectors are plain `[x, y, z]` tuples. Query filters are plain functions, so "doors this NPC has keys for" is a closure, not area flags.
- Crowd (`navcat/blocks`): `crowd.create(maxAgentRadius)`, `crowd.addAgent(c, navMesh, pos, params)`, `crowd.requestMoveTarget(c, id, nodeRef, pos)` (get `nodeRef` from `findNearestPoly`), and `crowd.update(c, navMesh, dt)`. Set `autoTraverseOffMeshConnections: false` to play your own jump or ladder animation, then call `completeOffMeshConnection`. The upstream recommendation is to copy the crowd block into your project and modify it.
- Performance: recast-navigation-js is faster at runtime generation and usually at queries, but has a ~40 ms async init and a larger bundle. Benchmarks: `isaac-mason/navcat-vs-recast-navigation-js-bench`.

## three-pathfinding (legacy query-only)
```ts
import { Pathfinding } from 'three-pathfinding';
const pf = new Pathfinding(); const ZONE = 'level1';
pf.setZoneData(ZONE, Pathfinding.createZone(navmeshGeometry));   // BufferGeometry of the navmesh itself
const group = pf.getGroup(ZONE, from);
const path = pf.findPath(from, to, ZONE, group);                  // THREE.Vector3[] | null
```

## Godot 4 (NavigationServer3D)
```gdscript
extends CharacterBody3D
@onready var agent: NavigationAgent3D = $NavigationAgent3D
@export var speed := 4.0
func _ready() -> void:
    agent.velocity_computed.connect(_on_velocity_computed)
    await get_tree().physics_frame          # the nav map syncs on the first physics frame. Querying in _ready gives empty paths
func set_goal(p: Vector3) -> void:
    agent.target_position = p               # don't set it every frame
func _physics_process(_dt: float) -> void:
    if agent.is_navigation_finished(): return
    var v := global_position.direction_to(agent.get_next_path_position()) * speed
    if agent.avoidance_enabled: agent.velocity = v     # RVO computes safe_velocity → signal
    else: _on_velocity_computed(v)
func _on_velocity_computed(v: Vector3) -> void:
    velocity = v
    move_and_slide()
```
- Bake with `NavigationRegion3D` (runtime: `bake_navigation_mesh(true)` on a thread). Use `NavigationLink3D` for jumps and ladders, `NavigationObstacle3D` for avoidance-only obstacles (these don't carve the navmesh), and navigation layers for per-agent-type filtering.
- 2D: `NavigationRegion2D` / `NavigationAgent2D`. For grids, use `AStarGrid2D` (`region`, `cell_size`, `update()`, `get_id_path()`).
- Skills: GodotPrompter `ai-navigation`.

## Unity 6 (AI Navigation package `com.unity.ai.navigation`)
```csharp
using UnityEngine; using UnityEngine.AI;
public class Chaser : MonoBehaviour {
  [SerializeField] Transform target; NavMeshAgent agent; float repath;
  void Awake() => agent = GetComponent<NavMeshAgent>();
  void Update() { if ((repath -= Time.deltaTime) <= 0f) { repath = 0.25f; agent.SetDestination(target.position); } }
}
```
Add a `NavMeshSurface` (component-based bake, runtime `BuildNavMesh()`), plus `NavMeshLink`, `NavMeshModifier` and `NavMeshObstacle` (carve). Skill: awesome-gamedev-agent-skills `unity-navmesh`.

## Grid A* with a binary heap (roguelikes, tactics, tile games)

```ts
export class Heap {                                  // min-heap of (key, value)
  k: number[] = []; v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!, n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** walkable[y*w+x] = 1 when passable. Returns the cell indices from start to goal, or null. */
export function gridAStar(w: number, h: number, walkable: Uint8Array, start: number, goal: number, diag = true): number[] | null {
  const g = new Float32Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1), closed = new Uint8Array(w * h);
  const gx = goal % w, gy = (goal / w) | 0;
  const H = (i: number) => { const dx = Math.abs((i % w) - gx), dy = Math.abs(((i / w) | 0) - gy); return diag ? dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy) : dx + dy; };
  const open = new Heap(); g[start] = 0; open.push(H(start), start);
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) { const path = [cur]; let c = cur; while (from[c] !== -1) path.push((c = from[c])); return path.reverse(); }
    if (closed[cur]) continue; closed[cur] = 1;
    const cx = cur % w, cy = (cur / w) | 0;
    for (let d = 0; d < (diag ? 8 : 4); d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx; if (!walkable[ni] || closed[ni]) continue;
      if (d >= 4 && (!walkable[cy * w + nx] || !walkable[ny * w + cx])) continue;   // no corner cutting
      const ng = g[cur] + (d < 4 ? 1 : Math.SQRT2);
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; open.push(ng + H(ni), ni); }
    }
  }
  return null;
}
```
- Smooth the result with string pulling (a line-of-sight check between waypoints), or use Theta*.
- On huge maps, HPA* (clusters + portals) or JPS (uniform-cost grids) give 10–100× speedups. Cache paths per (start cluster, goal cluster).
- General graphs (road networks, room graphs in a tower): `ngraph.path` (anvaka, MIT, 1.6.1).

## Flow fields (RTS, tower defence, hordes)

```ts
/** cost[i]: 1..254 = traversal cost, 255 = wall. Returns a per-cell step direction (−1/0/1) toward the nearest goal. */
export function flowField(w: number, h: number, cost: Uint8Array, goals: number[]) {
  const dist = new Float32Array(w * h).fill(Infinity), done = new Uint8Array(w * h), open = new Heap();
  for (const gi of goals) { dist[gi] = 0; open.push(0, gi); }
  while (open.size) {                                         // Dijkstra "integration field"
    const i = open.pop(); if (done[i]) continue; done[i] = 1;
    const x = i % w, y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx; if (cost[ni] === 255) continue;
      if (d >= 4 && (cost[y * w + nx] === 255 || cost[ny * w + x] === 255)) continue;
      const nd = dist[i] + (d < 4 ? 1 : Math.SQRT2) * cost[ni];
      if (nd < dist[ni]) { dist[ni] = nd; open.push(nd, ni); }
    }
  }
  const dirX = new Int8Array(w * h), dirY = new Int8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (cost[i] === 255 || dist[i] === Infinity) continue;
    const x = i % w, y = (i / w) | 0; let best = dist[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (d >= 4 && (cost[y * w + nx] === 255 || cost[ny * w + x] === 255)) continue;
      if (dist[ni] < best) { best = dist[ni]; dirX[i] = DX[d]; dirY[i] = DY[d]; }
    }
  }
  return { dist, dirX, dirY };
}
// unit: cell = floor(pos/cellSize); desired = normalize(dir[cell]) * maxSpeed (bilinear-blend the 4 nearest cells to avoid zig-zag),
// plus boids separation from neighbours in a spatial hash, then integrate. One field per goal, shared by every unit.
```
- Recompute a field only when its goal or the walls change. Time-slice it across frames, or run it in a worker. A 256×256 grid is ~65k cells and a few ms in JS.
- Huge maps: sector the grid (e.g. 32×32) with portal graphs, and build fields only for the sectors on the high-level path (the approach of Supreme Commander 2 and Planetary Annihilation).
- 3D navmesh games can still use flow fields per floor. navcat has a "Flow Field Pathfinding" example on the navmesh graph.

## Dynamic worlds
- **recast tile cache**: box and cylinder obstacles carve the mesh (doors, barricades). Call `tileCache.update(navMesh)` until `upToDate`. At most 64 obstacle requests can be queued. Keep the tile size at 32–64 cells.
- **Rebuild tiles** for destruction and building placement: regenerate just the affected tiles in a worker and swap them in. In navcat, rebuild the tile and replace it (see the "Dynamic NavMesh" example).
- **Voxel games**: skip navmesh generation from triangles. Build walkability directly from voxels (solid below, two air cells above), and run A* or flow fields on the voxel columns. For large worlds, use a chunk graph with portals.
- **Multi-floor and towers**: vertical `halfExtents` for queries must be smaller than the floor spacing. Otherwise `findClosestPoint` snaps to the wrong floor.
