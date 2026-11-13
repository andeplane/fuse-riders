# ECS for many agents, and AI debug panels

## Do you need an ECS?
- **Under ~500 NPCs** with rich individual logic: plain classes (`class Npc`) plus arrays are fine and the easiest to debug.
- **1k–100k agents** (crowds, RTS units, boids, sim tenants): use an ECS or hand-written struct-of-arrays. Cache-friendly loops, cheap add/remove of state tags (`Fleeing`, `Stunned`), and the data is trivially serialisable.
- Keep **the authoritative AI state in the ECS** and the meshes as a view, and sync one way (ECS → `InstancedMesh`) at the end of each frame.

| Library | Licence | Version (npm) | Style | Pick when |
|---|---|---|---|---|
| **bitecs** (NateTheGreatt/bitECS, ~1.5k★) | MPL-2.0 | 0.4.0 | Components are any arrays you like (SoA typed arrays or AoS), plus queries and relations | Max throughput, typed arrays you can share with a worker, data-oriented sims |
| **koota** (pmndrs, ~750★) | ISC | 0.6.x | Traits with schemas, `world.spawn`, relations, `Added`/`Changed`/`Removed` tracking, `koota/react` | R3F apps, ergonomic queries, AI targeting relations. Ships an official agent skill: `npx skills add pmndrs/koota` |
| **miniplex** (hmans, ~1.1k★) | MIT | 2.0.0 (2023) | Plain objects as entities, `world.with(...)` queries, `@miniplex/react` | Small and medium games, simplest mental model, stable but quiet |
| **becsy** (lastolivegames, ~300★) | check repo | 0.16.x | Decorator-based schemas, a system scheduler, multithreading designed in | You want built-in system ordering and threads. Check its docs for the current API |

## bitecs 0.4
```ts
import { createWorld, addEntity, removeEntity, addComponent, removeComponent, hasComponent, query } from 'bitecs';
const MAX = 20_000;                                          // typed arrays are indexed by eid, so size them to the max live entity count
const world = createWorld({ components: {
  Position: { x: new Float32Array(MAX), z: new Float32Array(MAX) },
  Velocity: { x: new Float32Array(MAX), z: new Float32Array(MAX) },
  Brain:    { state: new Uint8Array(MAX), nextThink: new Float32Array(MAX), seed: new Uint32Array(MAX) },
  Fleeing:  {},                                              // tag
  CrowdRef: [] as (number | undefined)[],                    // AoS slot for non-numeric refs (crowd agent index, a BT instance…)
} });
const { Position, Velocity, Brain, Fleeing } = world.components;

const eid = addEntity(world);
addComponent(world, eid, Position); addComponent(world, eid, Velocity); addComponent(world, eid, Brain);
Position.x[eid] = 4; Brain.nextThink[eid] = 0;

export function thinkSystem(now: number) {                   // event-driven: only agents whose think time has come
  for (const e of query(world, [Brain, Position])) {
    if (Brain.nextThink[e] > now) continue;
    const scared = senseThreat(e);
    if (scared && !hasComponent(world, e, Fleeing)) addComponent(world, e, Fleeing);
    else if (!scared && hasComponent(world, e, Fleeing)) removeComponent(world, e, Fleeing);
    Brain.nextThink[e] = now + 0.2 + (Brain.seed[e] % 7) * 0.01;   // jitter spreads the load
  }
}
export function moveSystem(dt: number) {
  for (const e of query(world, [Position, Velocity])) { Position.x[e] += Velocity.x[e] * dt; Position.z[e] += Velocity.z[e] * dt; }
}
```
- 0.4 breaking changes vs 0.3: there's no `defineComponent` and no `Types`. Components are whatever objects or arrays you pass, `addComponent(world, eid, C)` takes the arguments in this order, and `query(world, [A, B])` replaces `defineQuery`. Read `docs/MIGRATION_GUIDE_0.4.0.md` in the package before porting 0.3 code or tutorials.
- For a sim worker, back the typed arrays with a `SharedArrayBuffer` (this needs cross-origin isolation, see `game-physics/references/worker-and-determinism.md`), or copy positions into a transferable buffer per tick.

## koota
```ts
import { createWorld, trait, relation, Not } from 'koota';
const Position = trait({ x: 0, z: 0 });
const Velocity = trait({ x: 0, z: 0 });
const Awareness = trait({ level: 0, lastSeenX: 0, lastSeenZ: 0 });
const Fleeing = trait();                                    // tag
const Targeting = relation({ exclusive: true });            // one target per entity
const world = createWorld();
const player = world.spawn(Position({ x: 0, z: 0 }));
const guard = world.spawn(Position({ x: 10, z: 4 }), Velocity, Awareness);
guard.add(Targeting(player));
world.query(Position, Velocity, Not(Fleeing)).updateEach(([p, v]) => { p.x += v.x * dt; p.z += v.z * dt; });
guard.add(Fleeing); guard.remove(Fleeing);
```
- `world.query(Targeting(player))` gives you everyone after the player, which is handy for attack tokens and squad logic.
- In React, `useQuery(Position, Velocity)` and `useTrait(entity, Awareness)` drive the UI. Keep per-frame motion in `useFrame` loops, not React state.

## miniplex 2
```ts
import { World } from 'miniplex';
type Entity = { position: { x: number; z: number }; velocity?: { x: number; z: number }; brain?: { state: string }; fleeing?: true };
const world = new World<Entity>();
const moving = world.with('position', 'velocity');
const calm = world.with('brain').without('fleeing');
const npc = world.add({ position: { x: 0, z: 0 }, velocity: { x: 1, z: 0 }, brain: { state: 'patrol' } });
for (const e of moving) { e.position.x += e.velocity.x * dt; e.position.z += e.velocity.z * dt; }
world.addComponent(npc, 'fleeing', true); world.removeComponent(npc, 'fleeing');
moving.onEntityAdded.subscribe((e) => spawnView(e)); world.remove(npc);
```

## Syncing ECS → `InstancedMesh` (any library)
The snippets above (bitecs, koota and miniplex) were run against the real packages: bitecs 0.4.0, koota 0.6 and miniplex 2.0.0. This sync loop is bitecs-flavoured and assumes extra `Heading { yaw }` and `PrevPos { x, z }` components (copy `Position` → `PrevPos` at the start of each fixed step).
```ts
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const instanceToEid = new Int32Array(MAX);                   // for picking: raycast → instanceId → eid
export function syncInstances(mesh: THREE.InstancedMesh, alpha: number) {
  let i = 0;
  for (const e of query(world, [Position, Heading])) {
    _p.set(lerp(PrevPos.x[e], Position.x[e], alpha), 0, lerp(PrevPos.z[e], Position.z[e], alpha));   // fixed-step interpolation
    _q.setFromAxisAngle(UP, Heading.yaw[e]);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s)); instanceToEid[i++] = e;
  }
  mesh.count = i; mesh.instanceMatrix.needsUpdate = true;
}
```
- Skinned crowds need GPU-baked animation textures (vertex animation) or three's `BatchedMesh` per LOD, which is covered in the characters and optimisation skills. Keep AI LOD (think rate) and render LOD (animation rate) separate.

## AI debug panels (the Dear ImGui lesson: agents get more useful when they can see the state they're changing)

**tweakpane 4** (MIT, ~4.6k★). Monitors, graphs, folders and buttons:
```ts
import { Pane } from 'tweakpane';
const pane = new Pane({ title: 'AI' });
const stats = { agents: 0, thinkMs: 0, pathRequests: 0 };
pane.addBinding(stats, 'agents', { readonly: true });
pane.addBinding(stats, 'thinkMs', { readonly: true, view: 'graph', min: 0, max: 4 });     // monitors poll every 200 ms by default
const sel = { id: -1, state: '-', topAction: '-', awareness: 0 };
const f = pane.addFolder({ title: 'Selected NPC' });
f.addBinding(sel, 'state', { readonly: true }); f.addBinding(sel, 'topAction', { readonly: true });
f.addBinding(sel, 'awareness', { readonly: true, view: 'graph', min: 0, max: 1 });
f.addButton({ title: 'Step 1 tick' }).on('click', () => sim.step(1));
const tune = { viewDistance: 18, fovDeg: 110, reactionS: 0.3 };
const t = pane.addFolder({ title: 'Tuning' });
t.addBinding(tune, 'viewDistance', { min: 2, max: 50 }); t.addBinding(tune, 'fovDeg', { min: 30, max: 180, step: 1 });
t.addButton({ title: 'Copy tuning JSON' }).on('click', () => navigator.clipboard.writeText(JSON.stringify(pane.exportState())));
```
- Fill `sel` from the clicked NPC (raycast → `instanceToEid`) every frame. Show the utility scores as one readonly number per candidate, so you can watch the race.

**lil-gui** (MIT, ~1.6k★, used in the three.js examples): `gui.add(tune, 'fovDeg', 30, 180, 1)`, `gui.addFolder('Perception')`, and `.listen()` for values that change on their own.

**leva** (pmndrs, MIT, ~6.2k★): in R3F, `const { fovDeg } = useControls('AI', { fovDeg: { value: 110, min: 30, max: 180 } })`.

**jsimgui** (`@mori2003/jsimgui`, ~75★, Dear ImGui 1.92 with docking, WebGL2/WebGPU backends, has a three.js example). Use it when you want real immediate-mode tables, trees and plots:
```ts
import { ImGui, ImGuiImplWeb } from '@mori2003/jsimgui';
await ImGuiImplWeb.Init({ canvas: renderer.domElement });   // check the README for backend options (WebGL vs WebGPU)
function drawAiWindow() {                                     // call once per frame, after rendering the scene
  ImGuiImplWeb.BeginRender();
  ImGui.Begin('AI');
  for (const n of npcs.values()) ImGui.Text(`${n.id} ${n.state} aw=${n.awareness.toFixed(2)}`);
  ImGui.End();
  ImGuiImplWeb.EndRender();
}
```
- Widgets that edit a value take a one-element array (`const v = [0.3]; ImGui.SliderFloat('reaction', v, 0, 1)`). Check the jsimgui README for current signatures, since the binding is young (0.x).

**In-world overlays** (they matter more than panels):
- labels (`CSS2DRenderer`);
- path polylines;
- vision cones coloured by awareness;
- last-known-position ghosts;
- smart-object reservations;
- a heatmap of stuck agents.

Put each behind one `debugAi` flag so they cost nothing when off. Frame time, GPU time and draw calls are in `game-debug-tools` (stats-gl and so on).

**Machine-readable state** for Playwright and agents: `window.__ai.npcs()`, `window.__ai.select(id)`, `window.__sim.step(n)` and `window.__sim.hash()`. Take the screenshot *after* stepping a known number of ticks with a fixed seed, so images are comparable across runs.
