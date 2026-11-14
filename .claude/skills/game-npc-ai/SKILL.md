---
name: game-npc-ai
description: Load when building NPCs, enemies, companions, crowds or simulated citizens. Covers navmesh pathfinding (recast-navigation-js, navcat, Godot NavigationServer, Unity AI Navigation), steering, flocking and crowds, A* and flow fields for RTS, FSM, behaviour trees, utility AI and GOAP, perception (vision, hearing, memory), daily routines for sim games, LLM-driven dialogue with Claude, ECS for thousands of agents, and debug overlays for AI state.
---

# NPC and enemy AI: navigate, decide, perceive, and make it visible

Defaults (three.js + Vite + TS):
- Navigation: **recast-navigation-js 0.44** (navmesh + DetourCrowd), or **navcat 0.4** if you want pure JS.
- Decisions: **hand-written FSM** for simple enemies, **mistreevous** behaviour trees for complex ones, **utility AI** for needs and sims.
- Data: **koota** or **bitecs** once you pass ~500 agents.
- Debug: a **tweakpane / lil-gui** panel plus in-world labels.

AI code runs in the fixed sim tick (see `game-physics` Recipe 2), never in the render loop.

## When to use what

| Problem | three.js / web | Godot 4.x | Unity 6.x | 2D web | Why | Not when |
|---|---|---|---|---|---|---|
| 3D walkable-area pathfinding | **recast-navigation-js** (`recast-navigation` + `@recast-navigation/three`, MIT) | `NavigationRegion3D` + `NavigationAgent3D` (Recast inside) | AI Navigation pkg: `NavMeshSurface` + `NavMeshAgent` | Godot `NavigationRegion2D`. Web: grid A* or navcat on a flat mesh | The industry-standard Recast/Detour, with tile cache obstacles, off-mesh links and Node support | Your bundle budget can't take the ~WASM blob, or you need custom traversal → navcat |
| Same, pure JS, hackable | **navcat** (isaac-mason, MIT): JSON-serialisable, function query filters, dynamic off-mesh links, crowd with animation hooks, flow-field example | – | – | navcat works for 2D floors too | No WASM init, tree-shakeable, debuggable | Very large runtime regeneration → recast is faster |
| Navmesh made in Blender, query only | three-pathfinding (donmccurdy, last release May 2024) | – | – | – | Tiny, simple | You need generation, crowds or obstacles |
| Crowds and local avoidance | DetourCrowd (`new Crowd(navMesh, …)`) or navcat `crowd` | `NavigationAgent3D.avoidance_enabled` (RVO) + `velocity_computed` | NavMeshAgent avoidance (or RVO2 assets) | Boids with a spatial hash | Handles path corridors, separation and obstacle avoidance | 10k+ units to one goal → flow field |
| RTS swarms, tower-defence waves | **Flow field** on a grid (one Dijkstra pass per goal, O(1) per unit), see `references/navigation.md` | Same, in GDScript or C# | Same, with Jobs and Burst | Same | Cost is independent of the unit count | Few units with distinct goals → A* + crowd |
| Grid or tile games, roguelikes | A* with a binary heap (60 lines in `references/navigation.md`), `ngraph.path` for general graphs | `AStarGrid2D`, `AStar3D` | Custom, or the A* Pathfinding Project asset | Same | Exact and cheap on grids | Continuous 3D levels → navmesh |
| Steering, flocking, pursuit, wander | **Yuka** (MIT, stable but last release 2022) or ~50 lines of custom boids | Custom (`Vector3` math) | Custom | Same | Craig Reynolds behaviours, ready-made | You're already on DetourCrowd for avoidance (don't double-steer) |
| Few clear states (patrol / chase / attack) | **Typed FSM** (below) | `LimboHSM` or a node FSM (GodotPrompter `state-machine`) | Custom, or Animator-driven | Same | Debuggable, deterministic | More than ~8 states with cross-links → HFSM or BT |
| Complex combat or boss logic, reusable subtrees | **mistreevous** (MDSL or JSON, guards, seedable RNG, visualiser) | **LimboAI** (BT + HSM, editor and debugger, MIT) or **Beehave** (GDScript, MIT) | Unity **Behavior** package (`com.unity.behavior`, graph editor) | mistreevous | Reactive priorities, interruptible actions, designers can read them | Needs and sim scoring → utility |
| Needs-driven sims, "pick the best thing to do" | **Utility AI** (below) + smart objects | Same (custom), or LimboAI tasks | Same | Same | Smooth, emergent, tunable with curves | You need guaranteed scripted sequences → BT |
| Multi-step emergent plans (get key → open door → loot) | **GOAP** (custom planner, see `references/decision-making.md`) | Custom | Custom | – | Designers add actions, not transitions | Most games: more expensive and harder to debug than a BT with utility |
| Vision, hearing, memory, stealth awareness | Custom cones + raycasts (below), or Yuka `Vision` + `MemorySystem` | `Area3D` + `RayCast3D` | Physics overlap + raycast | Same in 2D | Simple and precise | – |
| Daily routines for many citizens (SimTower-likes) | Schedule tables + smart objects + sim LOD (`references/sim-routines.md`) | Same | Same | Same | Thousands of agents at low cost | – |
| Open-ended conversation | **Claude API via your backend** (`references/llm-dialogue.md`) | Same backend via `HTTPRequest` (`HTTPClient` to stream) | Same via `UnityWebRequest` + `DownloadHandlerScript` | Same | Real conversation, emergent social play | Barks, combat callouts, quest-critical lines → authored (Ink or Yarn) |
| 500–50k agents | **koota** (pmndrs, ISC, R3F hooks, official agent skill) or **bitecs 0.4** (SoA typed arrays, **MPL-2.0**) | Servers + MultiMesh, or C# | DOTS/ECS | Same | Cache-friendly loops, archetype queries | Under ~200 agents: plain classes are fine. miniplex 2 is simple but last released 2023 |

## Recipe 1: navmesh + crowd with recast-navigation-js

```bash
npm i recast-navigation@0.44.0 @recast-navigation/three@0.44.0   # keep both on the same version
# vite.config.ts: optimizeDeps: { exclude: ['recast-navigation'] }
```
```ts
import { init, NavMeshQuery, Crowd, type CrowdAgent } from 'recast-navigation';
import { threeToSoloNavMesh, NavMeshHelper, CrowdHelper } from '@recast-navigation/three';
await init();                                                      // async WASM, as with physics
const cs = 0.15, ch = 0.1;                                         // cell size and height, in WORLD units
const agent = { radius: 0.35, height: 1.8, climb: 0.4 };
const { success, navMesh } = threeToSoloNavMesh(walkableMeshes, {  // pass only floors, stairs and static blockers. No foliage or props
  cs, ch, walkableSlopeAngle: 45,
  walkableRadius: Math.ceil(agent.radius / cs),                    // ⚠ these three are in VOXELS, not meters
  walkableHeight: Math.ceil(agent.height / ch),
  walkableClimb: Math.floor(agent.climb / ch),
});                                                                // large levels: threeToTiledNavMesh(..., { tileSize: 32 })
if (!success || !navMesh) throw new Error('navmesh failed: check scale, indices, and voxel units');
const query = new NavMeshQuery(navMesh);
const crowd = new Crowd(navMesh, { maxAgents: 256, maxAgentRadius: agent.radius }); // fixed capacity
scene.add(new NavMeshHelper(navMesh));                             // debug: ALWAYS look at it once
const crowdHelper = new CrowdHelper(crowd); scene.add(crowdHelper);

const npcs = new Map<number, { agent: CrowdAgent; mesh: THREE.Object3D; goal?: THREE.Vector3 }>();
function spawnNpc(id: number, mesh: THREE.Object3D) {
  const { randomPoint } = query.findRandomPoint();
  const a = crowd.addAgent(randomPoint, { radius: agent.radius, height: agent.height, maxSpeed: 3.5, maxAcceleration: 8,
    collisionQueryRange: agent.radius * 8, pathOptimizationRange: agent.radius * 30, separationWeight: 1.5 });
  if (a.agentIndex < 0) throw new Error('crowd full'); // addAgent does NOT throw when maxAgents is reached
  npcs.set(id, { agent: a, mesh });
}
function setGoal(id: number, p: THREE.Vector3) {                   // call on DECISION, not every frame
  const n = npcs.get(id)!;
  if (n.goal && n.goal.distanceToSquared(p) < 0.25) return;        // don't re-request a near-identical target
  const { point } = query.findClosestPoint(p);                     // snap to the navmesh, or the request fails
  n.agent.requestMoveTarget(point); n.goal = p.clone();
}
// render loop: fixed 60 Hz crowd sub-steps + interpolation built in
function updateCrowd(frameDt: number) {
  crowd.update(1 / 60, frameDt, 4);
  for (const { agent: a, mesh } of npcs.values()) {
    const p = a.interpolatedPosition, v = a.velocity();
    mesh.position.set(p.x, p.y, p.z);                              // agent y is ON the navmesh, so put the mesh origin at the feet
    if (v.x * v.x + v.z * v.z > 0.01) mesh.rotation.y = Math.atan2(v.x, v.z);
  }
  crowdHelper.update();
}
```
- Dynamic doors and obstacles: `threeToTileCache` + `tileCache.addBoxObstacle/addCylinderObstacle` + `tileCache.update(navMesh)` (max 64 queued requests). Jumps and ladders: `offMeshConnections` in the generator config.
- Bake offline for big levels: `exportNavMesh(navMesh)` → a `Uint8Array` in `public/`, then `importNavMesh` at runtime. Generate in a worker (`examples-integrations/three-vite-worker-example`).
- **Physics integration.** Pick one authority. Either the crowd drives the position and the physics body is kinematic (`setNextKinematicTranslation(agent pos)`), or the KCC moves by `agent.desiredVelocity()·dt` and you `agent.teleport(kccPos)` when they drift more than 0.3 m apart. Never let both write the same transform.
- Clean up on level unload: `crowd.destroy(); query.destroy(); navMesh.destroy()`.
- navcat equivalent: `generateSoloNavMesh(input, options)` from `navcat/blocks`, `findPath(navMesh, start, end, halfExtents, DEFAULT_QUERY_FILTER)`, `createNavMeshHelper` from `navcat/three`. Its crowd API is `crowd.create/addAgent/requestMoveTarget/update`, which take node refs (check the navcat docs). See `references/navigation.md`.

## Recipe 2: the AI tick (sense → think → act, at different rates)

```ts
// in fixedUpdate(dt), with the sim at 60 Hz. Stagger agents so 1000 NPCs don't all think on the same tick
for (const npc of npcs) {
  if ((tick + npc.id) % 6 === 0) npc.perceive(world);      // 10 Hz: cones, raycasts, hearing queue → memory
  if ((tick + npc.id) % 12 === 0) npc.decide();            // 5 Hz: FSM / BT step / utility pick → sets goal and stance
  npc.act(dt);                                             // 60 Hz: steering, animation params, attack timers
}
```
- **AI LOD**: off-screen or far agents perceive at 1–2 Hz and skip crowd steering, by moving along their path corridor or teleporting along their schedule. Agents in a different chunk run as a pure schedule simulation.
- Every random choice uses the NPC's seeded RNG (`mulberry32(seed ^ npc.id)`), so replays, seed sweeps and bug reports reproduce.

## Recipe 3: typed FSM (most enemies need nothing more)

```ts
type S = 'patrol' | 'investigate' | 'chase' | 'attack' | 'flee';
type StateDef = { enter?(n: Npc): void; tick(n: Npc, dt: number): S | void; exit?(n: Npc): void };
const Guard: Record<S, StateDef> = {
  patrol:      { enter: n => n.goTo(n.route.next()), tick: n => n.sees('player') ? 'chase' : n.heard() ? 'investigate' : n.arrived() ? (n.goTo(n.route.next()), undefined) : undefined },
  investigate: { enter: n => n.goTo(n.memory.lastKnown('player') ?? n.lastNoise!), tick: n => n.sees('player') ? 'chase' : n.arrived() && n.timeIn > 4 ? 'patrol' : undefined },
  chase:       { tick: n => n.hp < 0.2 ? 'flee' : n.dist('player') < 1.6 ? 'attack' : !n.sees('player') && n.timeSinceSeen > 2 ? 'investigate' : (n.goTo(n.memory.lastKnown('player')!), undefined) },
  attack:      { enter: n => n.startAttack(), tick: n => n.attackDone() ? 'chase' : undefined },
  flee:        { enter: n => n.goTo(n.farthestCover()), tick: n => n.arrived() && n.timeIn > 6 ? 'patrol' : undefined },
};
export function stepFsm(n: Npc, dt: number) {
  n.timeIn += dt;
  const next = Guard[n.state].tick(n, dt);
  if (next && next !== n.state) { Guard[n.state].exit?.(n); n.log.push([n.simTime, n.state, next]); n.state = next; n.timeIn = 0; Guard[next].enter?.(n); }
}
```
`n.log` (state transitions with timestamps) feeds the debug overlay and the tests.

## Recipe 4: behaviour tree with mistreevous

```ts
import { BehaviourTree, State } from 'mistreevous';           // npm i mistreevous   (v4.3, MIT)
const GUARD_BT = `root {
  selector {
    sequence while(CanSeePlayer) { action [ChasePlayer] action [Attack] }
    sequence { condition [HasLastKnown] action [Investigate] }
    sequence { condition [IsTired] action [GoRest] wait [3000, 6000] }
    action [Patrol]
  }
}`;
class GuardAgent {                                              // conditions return boolean; actions return a State (or a Promise)
  constructor(private n: Npc) {}
  CanSeePlayer = () => this.n.sees('player');
  HasLastKnown = () => this.n.memory.lastKnown('player') !== null;
  IsTired = () => this.n.needs.energy < 0.2;
  ChasePlayer = () => (this.n.goTo(this.n.memory.lastKnown('player')!), this.n.dist('player') < 1.6 ? State.SUCCEEDED : State.RUNNING);
  Attack = () => this.n.attackDone() ? State.SUCCEEDED : (this.n.startAttack(), State.RUNNING);
  Investigate = () => this.n.arrived() ? (this.n.memory.forget('player'), State.SUCCEEDED) : State.RUNNING;
  GoRest = () => this.n.arrived() ? State.SUCCEEDED : (this.n.goTo(this.n.home), State.RUNNING);
  Patrol = () => (this.n.arrived() && this.n.goTo(this.n.route.next()), State.RUNNING);
}
const bt = new BehaviourTree(GUARD_BT, new GuardAgent(npc), {
  getDeltaTime: () => DECIDE_DT,       // sim time in seconds, so `wait` honours pause and replays. The default is wall-clock
  random: npc.rng,                     // seeded: deterministic lotto, wait and repeat ranges
  onNodeStateChange: c => npc.btTrace.push(c),
});
bt.step();                             // in decide(). bt.getTreeNodeDetails() gives a live tree for the debug panel
```
Paste the MDSL into the mistreevous visualiser (nikkorn.github.io/mistreevous-visualiser) to review it.

## Recipe 5: utility AI (needs, sims, "what's best right now")

```ts
type Ctx = { n: Npc; t: number };
type Action = { name: string; weight?: number; considerations: ((c: Ctx) => number)[]; start(c: Ctx): void };
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function score(a: Action, c: Ctx) {
  let s = a.weight ?? 1; const k = 1 - 1 / a.considerations.length;   // compensation, so 5 factors aren't punished vs 2
  for (const f of a.considerations) { const v = clamp01(f(c)); s *= v + (1 - v) * k * v; if (s === 0) return 0; }
  return s;
}
export function choose(actions: Action[], c: Ctx, current?: Action) {
  let best = current, bestS = current ? score(current, c) * 1.15 : 0;  // inertia: stops dithering between near-equal options
  for (const a of actions) { const s = score(a, c); if (s > bestS) { best = a; bestS = s; } }
  return best;
}
const eat: Action = { name: 'eat', considerations: [c => c.n.needs.hunger, c => 1 - c.n.distTo('food') / 50, c => (c.n.hasFood ? 1 : 0.6)], start: c => c.n.useNearest('food') };
```
Response curves (quadratic, logistic, inverse) are where the tuning lives. Expose them in the debug panel and log the top-3 scores per decision. Sims combine this with **smart objects** that advertise which needs they satisfy (`references/sim-routines.md`).

## Recipe 6: perception (vision cone + line of sight + memory)

```ts
const _to = new THREE.Vector3(), ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
export function canSee(n: Npc, target: THREE.Vector3) {
  _to.subVectors(target, n.eye); const d = _to.length();
  if (d > n.viewDist) return false;
  _to.divideScalar(d);
  if (_to.dot(n.forward) < n.cosHalfFov) return false;          // precompute cos(fov/2)
  ray.origin = n.eye; ray.dir = _to;
  return world.castRay(ray, d - 0.2, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups([L.Enemy], [L.World]), undefined, n.body) === null;
}
```
- **Stealth awareness**: `awareness += dt · rate(distance, light, inCentralCone ? 2 : 0.5)`. It decays when nothing is seen. Thresholds are 0.4 (suspicious, look around) and 1.0 (alert, chase). Show it as a meter over the head, as players expect.
- **Hearing**: gameplay emits `{pos, radius, kind, tick}` into a queue. An NPC hears a sound if its *navmesh path length* is under `radius × 1.2` (so walls muffle it), or uses straight distance for cheapness.
- **Memory**: `Map<entityId, {pos, time, confidence}>`. Confidence decays, and the entry is forgotten after N seconds. Decisions read memory, not raw perception, so NPCs search the last-known position instead of tracking the player through walls.
- Several cones per NPC (near 120°, far 60°) and raycasts to 2–3 body points (head, chest, feet) avoid "can't see the head poking over cover" bugs.

## Recipe 7: make AI state visible (agents debug much better when they can see it)

- In-world: a `CSS2DRenderer` label over each NPC with `state | top utility | awareness`, a path polyline from `agent.corners()`, a vision cone mesh coloured by awareness, and memory markers. Toggle with `?debug=ai`.
- Panel: **tweakpane** for monitors and graphs (`pane.addBinding(stats, 'activeAgents', { readonly: true, view: 'graph' })`), **lil-gui** for quick sliders (it ships with three.js examples), **leva** in R3F, and **jsimgui** (`@mori2003/jsimgui`, Dear ImGui 1.92 docking, WebGL/WebGPU, three.js example) when you want a real ImGui. Shared panel setup is in `game-debug-tools`.
- Expose `window.__ai = { npcs: () => [...npcs.values()].map(n => ({ id: n.id, state: n.state, pos: n.pos.toArray(), goal: n.goal?.toArray() })) }` so Playwright and agents can assert on it.
- Godot: the LimboAI debugger, the Beehave debug view, and Debug > Visible Navigation. Unity: the Behavior graph debugger and the NavMesh gizmos.

## Pitfalls the model gets wrong

1. **Recast units.** `walkableRadius`, `walkableHeight` and `walkableClimb` are **voxels**, while `cs`/`ch` are world units. Passing meters gives an empty or "everything walkable" navmesh. Levels in centimetres need cs ≈ 15 or a scaled input.
2. **Navmesh input.** Include only static walkable geometry and blockers, in world space, with CCW winding. Skinned meshes, foliage and dynamic props ruin it. Non-indexed geometry is handled, but huge triangle soups are slow: use tiled navmeshes.
3. **Path requests every frame** kill performance and make agents stutter. Replan on goal change of more than 0.5 m, or on a timer of 0.5–1 s.
4. **Double steering**: DetourCrowd + Yuka + physics all pushing the same agent. One system owns the velocity.
5. **Crowd capacity** is fixed at `new Crowd`. Beyond `maxAgents`, `addAgent` returns a `CrowdAgent` with `agentIndex === -1` and doesn't throw. Check for that, size the crowd with headroom, or keep a pool.
6. **Agent goals off the mesh**: snap them with `findClosestPoint` first, and use a sensible `halfExtents` vertically for multi-floor levels.
7. **mistreevous `wait`** uses wall-clock time unless you pass `getDeltaTime`. Pause and replays break otherwise.
8. **Utility dithering**: two actions with near-equal scores flip every decision. Add inertia, minimum durations and cooldowns.
9. **GOAP blowup**: an unbounded search over 30 actions stalls a frame. Cap the depth and nodes, cache the plan, and replan only on relevant world changes.
10. **Yuka** has its own `Vector3` and `EntityManager` and hasn't been released since 2022. Sync to three.js with `entity.setRenderComponent(mesh, syncFn)`, and don't mix its math types with three's.
11. **LLM NPCs**: never ship the API key to the client. The model is not authoritative: it *proposes* actions, and the sim validates them. Put volatile state in the newest turn, never in the cached system prefix.
12. **Licences**: bitecs is MPL-2.0 (file-level copyleft), koota ISC, miniplex, mistreevous, Yuka, recast-navigation-js and navcat MIT, and recastnavigation itself zlib. All are OK for commercial games.

## Verification

- **Navmesh coverage** (Vitest in Node, since recast-navigation runs in Node): take 300 random `findRandomPoint` pairs and `computePath`. Assert a success rate ≥ 99%, and fail if any designer-placed spawn or goal marker is more than 0.5 m from the mesh (`findClosestPoint`). Also take a Playwright screenshot with `NavMeshHelper` on.
- **Crowd soak**: 200 agents with random goals, 120 s of sim at a fixed dt, headless. Assert that no agent with a target moves less than 0.1 m in any 3 s window (stuck), and that 95% arrive within 2× straight-line time / maxSpeed.
- **Decision tests**: unit-test the FSM, BT and utility logic with a fake `Npc`. Scenario examples: player behind a wall → `patrol`; noise → `investigate` → back to `patrol` within 10 s; HP < 20% → `flee`. Assert no more than 2 state changes per second per agent (anti-dither), using `n.log`.
- **Perception**: scripted rigs assert the player inside the cone is seen within the reaction time, the player behind cover is not, and the player directly behind is not.
- **Seed sweep**: run the level's AI for 256 seeds × 60 s. Assert there are no exceptions, no NaN positions and no permanently stuck agents. Save failing seeds as regression fixtures.
- **Visual**: Playwright loads `?debug=ai&seed=42`, advances N ticks via `window.__sim.step(n)`, takes a screenshot showing labels, paths and cones, and asserts on `window.__ai.npcs()`.

## References in this skill
- `references/navigation.md`: navcat, three-pathfinding, Godot/Unity navigation, grid A*, flow fields, tile-cache obstacles, off-mesh links, multi-floor.
- `references/decision-making.md`: HFSM, BT patterns (LimboAI, Beehave, Unity Behavior), GOAP planner, Yuka steering and flocking, group tactics.
- `references/sim-routines.md`: daily schedules, smart objects, elevators and queues, sim LOD for SimTower-style games.
- `references/llm-dialogue.md`: Claude-powered NPC dialogue with a backend proxy, prompt caching, streaming, action tools, cost and latency.
- `references/ecs-and-debug.md`: bitecs, koota, miniplex and becsy patterns, AI debug panels.

## Install instead of reinventing
- `npx skills add pmndrs/koota` (official koota agent skill).
- `gamedev-skills/awesome-gamedev-agent-skills`: `game-ai`, `ai-behavior-trees-utility-ai`, `unity-navmesh`.
- `jame581/GodotPrompter`: `ai-navigation`, `state-machine`, `limboai`, `beehave`.
- The live example galleries for recast-navigation-js (recast-navigation-js.isaacmason.com) and navcat (navcat.dev/examples) cover crowds, obstacles, off-mesh links and flow fields.
- `htdt/godogen`: a game generator whose agents judge results from the running game (live URL or recorded clip). Pair it with the `window.__ai` hooks above so they can see the AI state.
