---
name: game-physics
description: Load when adding, choosing or debugging game physics in three.js, R3F, Godot, Unity or 2D web. Covers Rapier, Jolt, Box2D v3, Box3D, Havok, planck and Matter, plus character controllers, vehicles, ragdolls, triggers, collision layers, terrain and mesh colliders, fixed timestep, determinism and rollback, physics in a Web Worker, and bugs such as tunnelling, jitter, sleeping bodies and WASM init errors.
---

# Game physics: pick an engine, step it right, prove it works

Defaults: **three.js + Vite + TS → Rapier (`@dimforge/rapier3d-compat` 0.21)**, fixed 60 Hz step, render interpolation, meters/kg/seconds.
Versions checked on 2026-10-31: rapier 0.21.0 (Sep 2026), jolt-physics 1.1.1, box2d3-wasm 6.0.0 (Box2D v3.2), box3d-wasm 0.2.0, @react-three/rapier 2.2.0, three 0.187.

## When to use what

| Problem | three.js / web 3D | Godot 4.6+ | Unity 6.x | 2D web | Why | Not when |
|---|---|---|---|---|---|---|
| General 3D: bodies, character, raycast vehicle, triggers | **Rapier** `@dimforge/rapier3d-compat` | Built-in **Jolt**, the default for new 4.6 projects. On 4.4–4.5, turn it on in Physics > 3D | Built-in PhysX | – | Apache-2.0, typed JS API, KCC + vehicle + debug render + snapshots + voxels + convex decomposition built in | You need swing-twist ragdolls, tracked or motorbike vehicles, or 1000+ body stacks → Jolt |
| Ragdolls, big stacks, realistic wheeled, tracked or motorbike vehicles, large or double-precision worlds | **JoltPhysics.js** `jolt-physics` (MIT) | Jolt | PhysX, or Havok/Unity Physics for DOTS | – | The same engine as Horizon Forbidden West and Godot. It ships `Ragdoll`, `SwingTwistConstraint`, `WheeledVehicleController` and `CharacterVirtual` | You can't do manual `Jolt.destroy()` memory management, or want a small bundle |
| R3F / React | **`@react-three/rapier`** 2.2 (pins rapier-compat **0.19.2**) | – | – | – | Declarative `<RigidBody>`, built-in interpolation, `debug` prop | You need 0.20+ features (new CCD, soft bodies). If so, use raw Rapier in `useFrame` |
| Deterministic lockstep / rollback | `@dimforge/rapier3d-deterministic-compat` + `takeSnapshot()` | `appsinacup/godot-rapier-physics` (cross-platform deterministic) | Unity Physics (DOTS) | `@dimforge/rapier2d-deterministic-compat`, or Box2D v3 | Bit-identical across browsers. Snapshots give you rollback | Plain `rapier3d`, Jolt npm builds and PhysX are only locally deterministic |
| 2D platformer / physics puzzle | – | Godot Physics 2D (or Rapier 2D addon) | Rigidbody2D; Unity 6.3+ `UnityEngine.LowLevelPhysics2D` (Box2D v3) | **planck.js** (pure JS, small) → **box2d3-wasm** (fast, threads, large-world double build) → **Rapier2d** (if you want the same API as 3D) | Box2D lineage is the most battle-tested 2D solver | Arcade AABB is enough → Phaser Arcade or hand-rolled. **Matter.js** is fine for toys, but its last release was 2024 and it stacks poorly |
| You use Babylon.js, or need Havok specifically | `@babylonjs/havok` (MIT WASM) | – | Havok Physics for Unity (check licence tier) | – | First-class in Babylon | three.js: only a raw C-style `HP_*` handle API, with no KCC or vehicle. Use Rapier or Jolt instead |
| FPS capsule vs static level only | `three/addons/math/Octree.js` + `Capsule.js` (see the `games_fps` example) | CharacterBody3D | CharacterController | – | No WASM, ~200 lines | Anything needs to be pushed, stacked or thrown |
| Weekend prototype | `three/addons/physics/RapierPhysics.js` or `JoltPhysics.js` | – | – | – | One-liner `addScene()` | Shipping. It imports from a CDN with `@vite-ignore` and uses a variable timestep |
| Watch / experiment | **Box3D** (erincatto/box3d, MIT, alpha since Jul 2026) via `box3d-wasm` | – | – | – | Box2D-style API in 3D, cross-platform determinism, threads | Production. It is alpha and its API will change |
| Avoid in new projects | cannon-es (last release Aug 2022), ammo.js (npm 2016, raw Bullet IDL) | GodotPhysics3D (legacy) | – | – | Unmaintained or awkward | – |

Details for each engine (Jolt setup, Box2D v3, Box3D, Havok, Godot and Unity notes): `references/engines.md`.

## Recipe 1: install and async WASM init (Rapier)

```bash
npm i three @dimforge/rapier3d-compat      # -compat embeds the wasm (base64): works in Vite, workers, and Vitest/Node with no plugin
# deterministic: npm i @dimforge/rapier3d-deterministic-compat   SIMD (faster, needs simd128): @dimforge/rapier3d-simd-compat
```
```ts
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();                              // MUST resolve before *any* RAPIER.* call (even new RAPIER.Vector3)
export const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
```
- The non-compat `@dimforge/rapier3d` imports the `.wasm` directly, so Vite needs `vite-plugin-wasm` and `vite-plugin-top-level-await`. For size: 0.21 `-compat` is ~4.3 MB of JS (1.65 MB gzipped), against a separate 3.1 MB `.wasm`. Use `-compat` unless mobile download size is critical. Show a loading screen either way.
- 0.20 moved the compat files to `dist/`. Old deep imports or CDN URLs ending `/rapier.mjs` must now end `/dist/rapier.mjs`.
- Gate the game loop on a `physicsReady` promise. The usual symptom of skipping this is `undefined is not an object (… __wbindgen …)` on first load.

## Recipe 2: fixed timestep plus interpolation (the loop every game needs)

```ts
const DT = 1 / 60, MAX_STEPS = 5;
type Synced = { body: RAPIER.RigidBody; obj: THREE.Object3D; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion };
const synced: Synced[] = [];
export function sync(body: RAPIER.RigidBody, obj: THREE.Object3D) {
  const t = body.translation(), r = body.rotation();
  const p = new THREE.Vector3(t.x, t.y, t.z), q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  synced.push({ body, obj, p0: p.clone(), p1: p, q0: q.clone(), q1: q });
}
const events = new RAPIER.EventQueue(true);
let acc = 0, last = performance.now();
renderer.setAnimationLoop((now: number) => {
  acc += Math.min((now - last) / 1000, 0.25); last = now;       // clamp: tab-switch must not explode the sim
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS) {
    for (const s of synced) { s.p0.copy(s.p1); s.q0.copy(s.q1); }
    fixedUpdate(DT);                       // input → character controller → AI → forces. Never in the render part
    world.step(events);
    events.drainCollisionEvents(onCollision);
    for (const s of synced) {
      const t = s.body.translation(), r = s.body.rotation();
      s.p1.set(t.x, t.y, t.z); s.q1.set(r.x, r.y, r.z, r.w);
    }
    acc -= DT; steps++;
  }
  if (steps === MAX_STEPS) acc = 0;        // drop time rather than spiral of death
  const a = acc / DT;
  for (const s of synced) { s.obj.position.lerpVectors(s.p0, s.p1, a); s.obj.quaternion.slerpQuaternions(s.q0, s.q1, a); }
  renderer.render(scene, camera);
});
```
- Render is one step behind the physics state. Raycasts, the camera and gameplay should read **physics state**, not mesh positions.
- Physics state belongs in a module that never imports `three`, so sim and render stay split. A test enforces it: `grep -L "from 'three'" src/sim/**`.
- Godot: Project Settings `physics/common/physics_interpolation = true` (3D since 4.4), and do gameplay in `_physics_process`. Unity: `Rigidbody.interpolation = Interpolate`, and do gameplay in `FixedUpdate`.

## Recipe 3: kinematic character controller (Rapier KCC)

```ts
const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0));
const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3), body); // halfHeight 0.5 + radius 0.3 → 1.6 m tall
const kcc = world.createCharacterController(0.02);       // skin offset in m. Too small → snagging, too big → floating
kcc.setUp({ x: 0, y: 1, z: 0 });
kcc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(45));
kcc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(30));
kcc.enableAutostep(0.35, 0.2, false);                   // maxHeight, minWidth, includeDynamicBodies
kcc.enableSnapToGround(0.3);
kcc.setApplyImpulsesToDynamicBodies(true);              // push crates
let vy = 0, grounded = false;
function fixedUpdate(dt: number) {
  if (grounded) vy = input.jump ? 5.5 : Math.max(vy, -1); // the KCC never applies gravity: you integrate it
  vy -= 9.81 * dt;
  const want = { x: input.x * 5 * dt, y: vy * dt, z: input.z * 5 * dt };   // a *translation* for this step, not a velocity
  kcc.computeColliderMovement(collider, want, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
  const m = kcc.computedMovement(); grounded = kcc.computedGrounded();
  if (m.y > want.y + 1e-4 && vy < 0) vy = 0;            // landed on something mid-air
  const p = body.translation();
  body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
}
```
Iterate `kcc.numComputedCollisions()` / `kcc.computedCollision(i)` for footstep surfaces and wall-run checks. R3F: put the same code in `useBeforePhysicsStep`. Godot: `CharacterBody3D.move_and_slide()`. Unity: `CharacterController.Move()`. Jolt: `CharacterVirtual`.

## Recipe 4: collision layers and sensors/triggers

```ts
export const L = { Player: 0, Enemy: 1, World: 2, Projectile: 3, Trigger: 4, Ragdoll: 5, Debris: 6 } as const;
const bits = (ls: number[]) => ls.reduce((a, l) => a | (1 << l), 0);
// Rapier InteractionGroups = (memberships << 16) | filter. Both sides must accept each other.
export const groups = (member: number[], hits: number[]) => (((bits(member) & 0xffff) << 16) | (bits(hits) & 0xffff)) >>> 0;

const playerCol = RAPIER.ColliderDesc.capsule(0.5, 0.3).setCollisionGroups(groups([L.Player], [L.World, L.Enemy, L.Trigger]));
const zone = world.createCollider(
  RAPIER.ColliderDesc.cuboid(2, 1, 2).setTranslation(10, 1, 0).setSensor(true)
    .setCollisionGroups(groups([L.Trigger], [L.Player]))
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    // a sensor with no parent body counts as FIXED. A kinematic character vs a fixed sensor is OFF by default:
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED));
const triggers = new Map<number, (other: RAPIER.Collider, started: boolean) => void>([[zone.handle, (o, s) => s && openDoor()]]);
function onCollision(h1: number, h2: number, started: boolean) {
  triggers.get(h1)?.(world.getCollider(h2), started);
  triggers.get(h2)?.(world.getCollider(h1), started);
}
```
- Use `setSolverGroups` to keep events but skip the contact response. One-way platforms and "ghost" pickups need a `PhysicsHooks` filter (check docs).
- Rapier colliders have no `userData`. Keep a `Map<collider.handle, Entity>` and delete the entry when you remove the collider.
- Godot: 32 `collision_layer`/`collision_mask` bits, plus `Area3D` signals. With Jolt, Area3D ignores StaticBody3D unless `physics/jolt_physics_3d/simulation/areas_detect_static_bodies` is on. Unity: the Layer Collision Matrix plus `OnTriggerEnter`, and at least one side needs a Rigidbody.

## Recipe 5: colliders for terrain, levels and props

| Geometry | Use | API | Notes |
|---|---|---|---|
| Terrain grid | **Heightfield** | `ColliderDesc.heightfield(nrows, ncols, heights, scale, HeightFieldFlags.FIX_INTERNAL_EDGES)` | `(nrows+1)*(ncols+1)` samples, **column-major, rows = Z, cols = X**, centred on the body, spans `scale.x × scale.z` |
| Static level mesh | **Trimesh** on a *fixed* body | `ColliderDesc.trimesh(pos, idx, TriMeshFlags.FIX_INTERNAL_EDGES)` | Never on dynamic bodies (hollow, slow). Merge static meshes per chunk |
| Dynamic concave prop | **Compound of convex hulls** | offline CoACD → `ColliderDesc.convexHull(pts)` per hull, or runtime `ColliderDesc.convexDecomposition(pos, idx)` (built-in V-HACD) | Runtime decomposition costs 100 ms–seconds per mesh. Do it at build time and cache it |
| Simple prop | Primitive (`cuboid`, `capsule`, `ball`, `roundCuboid`) | | Cheapest and most stable. Use it for 90% of props |
| Voxel world | **Voxels** collider per chunk | `ColliderDesc.voxels(Int32Array coords, {x:1,y:1,z:1})`, `collider.setVoxel(ix,iy,iz,filled)` | `combineVoxelStates` between neighbouring chunks removes seam bumps |

```ts
// three.js PlaneGeometry(rotateX(-PI/2)) order is X-fastest: h[iz*nx1+ix]. Rapier wants Z-fastest. Transpose!
function heightfieldFromGrid(h: Float32Array, nx1: number, nz1: number, sizeX: number, sizeZ: number) {
  const out = new Float32Array(nx1 * nz1);
  for (let iz = 0; iz < nz1; iz++) for (let ix = 0; ix < nx1; ix++) out[iz + ix * nz1] = h[iz * nx1 + ix];
  return RAPIER.ColliderDesc.heightfield(nz1 - 1, nx1 - 1, out, { x: sizeX, y: 1, z: sizeZ }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
}
```
The three.js `physics_rapier_terrain` example skips the transpose. Its radial terrain is symmetric, so the bug never shows. Verify with a raycast at an **asymmetric** point. CoACD pipeline, vehicles and ragdolls: `references/rapier-recipes.md`.

## Recipe 6: debug rendering (always wire this up first)

```ts
const dbg = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
dbg.frustumCulled = false; scene.add(dbg);
export function drawPhysicsDebug(on: boolean) {
  dbg.visible = on; if (!on) return;
  const { vertices, colors } = world.debugRender();          // flat xyz pairs + rgba per vertex
  dbg.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  dbg.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
}
```
Toggle it with `?debug=physics` or a lil-gui checkbox (see `game-debug-tools`). Since 0.20, bodies that could sleep but are still awake get their own debug colour, so a pile that stays coloured is "never sleeping". R3F: `<Physics debug>`. Godot: Debug > Visible Collision Shapes. Jolt: the `debug-wasm-compat` flavour plus `DebugRendererJS`.

## Recipes in references

- `references/rapier-recipes.md`: raycast vehicle, ragdoll (Rapier joints vs Jolt `Ragdoll`), CoACD offline decomposition, projectiles and hitscan, explosions, PID-controlled kinematics.
- `references/worker-and-determinism.md`: running physics in a Web Worker (transferables vs SharedArrayBuffer and COOP/COEP), deterministic builds, snapshot rollback, the cross-browser `Math.sin` trap, and determinism tests.
- `references/engines.md`: setup for Jolt, box2d3-wasm, Box3D, planck, Havok, Matter, react-three-rapier, Godot Jolt, Unity PhysX and Unity 6.3 Box2D v3.

## Pitfalls the model gets wrong

1. **Tunnelling.** Since rapier 0.20, fast dynamic bodies sweep against fixed colliders by default. `setCcdEnabled(true)` turns a body into a "bullet" that also sweeps dynamic and kinematic bodies. `world.maxCcdSubsteps = 0` disables CCD. Thin walls under 2× the per-step travel still need CCD or thicker colliders. `setSoftCcdPrediction(d)` is a cheaper alternative for medium speeds.
2. **Velocity cap.** Rapier 0.35/JS 0.20 clamps linear speed to about 400 units/s and rotation to about 45° per step. Bullets (300–900 m/s) must be **raycasts or shape-casts** (`world.castRay`, `world.castShape`), not rigid bodies. Fast spinning wheels or props need `setAllowFastRotation` (Rust API; check whether the JS binding exposes it).
3. **Scale and units.** Engines are tuned for meters and objects 0.1–10 m. A 2D game in pixels must set `world.lengthUnit = 100` (pixels per meter), or convert. Glb files exported in centimetres give "moon gravity" and jitter. Never `mesh.scale` a physics body: rebuild the collider at the new size.
4. **Sleeping.** Defaults changed in 0.20: islands sleep after 0.5 s below 0.05 normalised displacement. A body teleported with `setTranslation(v, false)` stays asleep, so pass `wakeUp = true`. A kinematic platform moving a sleeping crate must wake it. Use `setCanSleep(false)` only for the player or vehicle, never globally.
5. **Kinematic APIs.** For kinematic bodies use `setNextKinematicTranslation` / `setNextKinematicRotation`, which give contacts real velocity. `setTranslation` teleports and leaves riders behind. Never set the position of a dynamic body every frame: apply impulses or use a PID or joint.
6. **Time step.** `world.step()` uses `world.timestep`, not the frame delta. Calling it once per rAF on a 120 Hz monitor runs the game at 2× speed. Never pass a variable dt to a solver you want stable or deterministic.
7. **Memory.** In Rapier, `world.free()` frees WASM memory on level unload. In Jolt, everything `new Jolt.X` needs `Jolt.destroy`, and ref-counted settings need `AddRef`/`Release`. Leaks only show as tab OOM after 20 restarts.
8. **Snapshots** from Rapier before 0.21 can't be loaded in 0.21. Version-tag your replays.
9. **react-three-rapier** pins rapier 0.19.2. Don't import a second `@dimforge/rapier3d-compat@0.21` alongside it: that gives two WASM instances, and handles from one are garbage in the other.
10. **Licences.** Rapier is Apache-2.0. Jolt, Box2D v3, Box3D, planck and Matter are MIT. ammo.js is zlib. V-HACD is BSD-3. All are fine for commercial use.

## Verification (the agent must do these, not eyeball them)

- **Settle test** (Vitest or Node, headless): drop a 1 m cube from y = 5 onto the ground, step 300 times, then assert `|y − 0.5| < 0.01` and that it is asleep (`body.isSleeping()`).
- **Tunnelling sweep**: fire 200 spheres at 30, 60 and 120 m/s at a 0.1 m wall. Count any with `x > wall`, which must be 0. Re-run after any CCD or scale change.
- **KCC test**: script 10 s of input over a test course (stairs at 0.3 m, 40° and 50° ramps, a 1 m gap). Assert that it climbs the stairs and the 40° ramp, cannot climb the 50° ramp, and that `grounded` never flickers while walking flat.
- **Heightfield orientation**: raycast down at (0.3·sizeX, −0.2·sizeZ). The hit y must equal the mesh height sampled by three.js `Raycaster` within 1 cm.
- **Determinism** (if used): run the same input log twice, plus once in Node and once in Playwright Chromium. The `takeSnapshot()` byte hashes must match at ticks 60, 600 and 6000.
- **Visual**: in Playwright, load `?debug=physics`, wait for `window.__physicsSettled === true`, and take a screenshot. Collider lines must hug the meshes, with no offset or rotation.
- **Perf budget**: log the median `world.step` time over 600 ticks (`world.profilerEnabled = true` + `world.timingStep()`). It must stay under 4 ms on the target device, or move physics to a worker.

## Install instead of reinventing

- `gamedev-skills/awesome-gamedev-agent-skills`: `physics-tuning` (cross-engine), `godot-physics`, `unity-physics`, `phaser-arcade-physics`.
- `jame581/GodotPrompter`: `physics-system` (Jolt, ragdolls, interpolation in Godot).
- `majidmanzarpour/threejs-game-skills`: `threejs-gameplay-systems` (physics selection). `CloudAI-X/threejs-skills` has no physics skill.
- The Rapier testbed demos (`dimforge/rapier/bindings/typescript/testbed3d/src/demos`) are the canonical JS samples: characterController, ccd, collisionGroups, convexDecomposition, heightfield, voxels, softBodies.
- JoltPhysics.js examples (`jrouwe/JoltPhysics.js/Examples`) cover vehicles, character_virtual, ragdolls, soft bodies and debug draw.
- `htdt/godogen`: an autonomous game generator for Godot, Bevy, Babylon.js and three.js. Its Godot guide (`engines/godot.md`) assumes Jolt physics and has the agent prove results from the running game, the same "verify by looking" loop used here.
