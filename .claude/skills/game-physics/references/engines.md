# Engine-by-engine notes (versions as of 2026-10-31)

## Rapier: `@dimforge/rapier3d(-compat|-simd|-deterministic)` and `rapier2d*` 0.21.0, Apache-2.0
- The repo is `dimforge/rapier` (~6k★). Since 0.21 the JS bindings live in `bindings/typescript` (the old `rapier.js` repo is gone).
- 0.20 (Aug 2026): rewritten sleeping (persistent islands), sweep-based CCD on by default against fixed bodies, velocity caps, new contact defaults, and compat files moved to `dist/`. 0.21 (Sep 2026): soft bodies (rope, cloth, volumetric, FEM, tearing), deformable colliders, and snapshot format v2.
- Also built in: `KinematicCharacterController`, `DynamicRayCastVehicleController`, `PidController`, voxels colliders (dynamic too), V-HACD `convexDecomposition`, `debugRender()`, `takeSnapshot()`/`restoreSnapshot()`, profiler timings, and `lengthUnit`.

## react-three-rapier: `@react-three/rapier` 2.2.0 (pmndrs, ~1.5k★, MIT)
```tsx
import { Canvas } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier';
<Canvas>
  <Suspense>                                              {/* Physics suspends while the WASM loads */}
    <Physics timeStep={1 / 60} interpolate debug={debug}>
      <RigidBody colliders="hull" position={[0, 5, 0]} collisionGroups={interactionGroups(0, [1, 2])}>
        <mesh><icosahedronGeometry /><meshStandardMaterial /></mesh>
      </RigidBody>
      <CuboidCollider args={[20, 0.5, 20]} position={[0, -0.5, 0]} />   {/* args = half extents */}
      <CuboidCollider sensor args={[1, 1, 1]} position={[5, 1, 0]} onIntersectionEnter={() => score()} />
    </Physics>
  </Suspense>
</Canvas>
```
- Peer deps: R3F 9, React 19, three ≥ 0.159. **It bundles rapier3d-compat 0.19.2**, so 0.20/0.21 features (soft bodies, new CCD and sleep) aren't available yet.
- `useRapier()` gives `{ world, rapier }`. `useBeforePhysicsStep` / `useAfterPhysicsStep` give you the fixed tick. Don't read body state inside contact callbacks: cache it in `useBeforePhysicsStep`, or you get Rust aliasing errors.
- `<Physics updateLoop="independent">` runs physics in its own loop and only invalidates frames while bodies move. That is good for `frameloop="demand"` apps.

## Jolt: `jolt-physics` 1.1.1 (jrouwe/JoltPhysics.js ~0.6k★; core jrouwe/JoltPhysics ~11.8k★; MIT)
```ts
import initJolt from 'jolt-physics';               // = wasm-compat. Other flavours: /wasm, /asm, /debug-wasm-compat, /wasm-compat-multithread
const Jolt = await initJolt();
const LAYER_STATIC = 0, LAYER_MOVING = 1;
const settings = new Jolt.JoltSettings();
const objFilter = new Jolt.ObjectLayerPairFilterTable(2);
objFilter.EnableCollision(LAYER_STATIC, LAYER_MOVING); objFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
const bpI = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
bpI.MapObjectToBroadPhaseLayer(LAYER_STATIC, new Jolt.BroadPhaseLayer(0));
bpI.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1));
settings.mObjectLayerPairFilter = objFilter;
settings.mBroadPhaseLayerInterface = bpI;
settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bpI, 2, objFilter, 2);
const jolt = new Jolt.JoltInterface(settings); Jolt.destroy(settings);
const bi = jolt.GetPhysicsSystem().GetBodyInterface();
const cs = new Jolt.BodyCreationSettings(new Jolt.BoxShape(new Jolt.Vec3(0.5, 0.5, 0.5), 0.05, null),
  new Jolt.RVec3(0, 5, 0), Jolt.Quat.prototype.sIdentity(), Jolt.EMotionType_Dynamic, LAYER_MOVING);
const body = bi.CreateBody(cs); Jolt.destroy(cs);
bi.AddBody(body.GetID(), Jolt.EActivation_Activate);
// fixed tick:
jolt.Step(1 / 60, 1);                               // (deltaTime, collisionSteps). Use 2 collision steps if dt > 1/55
const p = body.GetPosition(), q = body.GetRotation(); // read p.GetX() … q.GetW(). Do not destroy these (borrowed)
```
- The C++ docs are the API reference. Check `JoltJS.idl` to see whether a class or method is exposed.
- Memory: every `new Jolt.X` you keep must be `Jolt.destroy`ed. Ref-counted types (Shape, ShapeSettings, Constraint, settings for vehicles, characters and ragdolls) use `AddRef()`/`Release()`. Bodies are destroyed with `bi.RemoveBody(id); bi.DestroyBody(id)`. See `Examples/proper_cleanup.html`.
- Features worth switching for: `CharacterVirtual` (a better KCC with stairs, sticking to the floor, and interaction with dynamics), `VehicleConstraint` with wheeled, tracked and motorcycle controllers, `Ragdoll` + `SwingTwistConstraint`, soft bodies, buoyancy, conveyor belts, `HeightFieldShape`, `MutableCompoundShape`, and multithreading.
- Multithread flavours need COOP/COEP (see worker-and-determinism.md). Double precision and cross-platform determinism mean building the WASM yourself (`-DDOUBLE_PRECISION=ON`, `-DCROSS_PLATFORM_DETERMINISTIC=ON`).
- Bundle: `jolt-physics.js` (wasm-compat) is ~5.5 MB unminified. The debug flavours are 12–15 MB, so never ship those.
- For R3F there is `pmndrs/react-three-jolt` (check its maintenance before use).

## Box2D v3 for the web
- **box2d3-wasm** 6.0.0 (Birch-san, MIT, Oct 2026) wraps upstream Box2D **v3.2** (erincatto/box2d ~10.5k★, MIT). The flavours are `compat` (no SIMD or threads), `deluxe` (SIMD + threads, needs cross-origin isolation) and `double` (large-world mode with `b2Pos`). It exposes the C API (`b2CreateWorld`, `b2World_Step(worldId, dt, subSteps)`…) plus box2cpp classes.
```js
import Box2DFactory from 'box2d3-wasm';             // auto-selects deluxe or compat
const b2 = await Box2DFactory();
const wd = b2.b2DefaultWorldDef(); wd.gravity = new b2.b2Vec2(0, -10);
const worldId = b2.b2CreateWorld(wd); wd.delete();
const bd = b2.b2DefaultBodyDef(); bd.type = b2.b2BodyType.b2_dynamicBody; bd.position = new b2.b2Vec2(0, 4);
const bodyId = b2.b2CreateBody(worldId, bd); bd.delete();
const sd = b2.b2DefaultShapeDef();
const box = b2.b2MakeBox(0.5, 0.5);
b2.b2CreatePolygonShape(bodyId, sd, box); box.delete(); sd.delete();
b2.b2World_Step(worldId, 1 / 60, 4);
const pos = b2.b2Body_GetPosition(bodyId); /* use pos.x, pos.y */ pos.delete();   // returned class values are OWNED: delete them or leak every frame
```
- Check the README's memory-ownership rules: borrowed views like `def.base` and `bodyDef.position` must never be `.delete()`d. Build user data from integer ids and a JS lookup table.
- **phaser-box2d** (phaserjs, MIT, ~160★) is a pure-JS port of Box2D v3.0. Its last npm release is 1.1.0 (Jan 2025), so prefer box2d3-wasm unless you must avoid WASM.
- **planck.js** 1.5.1 (piqnt, ~5.3k★, MIT, active Oct 2026) is a pure TS rewrite in the Box2D v2 style (`world.step(dt, velIters, posIters)`, `body.createFixture(shape, {density, friction})`). It is small, debuggable and has a testbed. Use it for jam-sized 2D physics.
- **Matter.js** 0.20.0 (liabru, ~18.4k★, MIT) was last released June 2024. It has an easy API but weaker stacking and no CCD. Fine for toys and UI physics, not for physics-heavy games.

## Box3D (new, alpha)
- erincatto/box3d (~6.5k★, MIT) was announced in early July 2026 and is described as alpha. It is a C17 engine forked from the Box2D v3 architecture, with code derived from "Rubikon-Lite". Features: soft-step solver, continuous physics, convex hulls, capsules, triangle meshes, heightfields, sensors, a character mover, joints, multithreading and SIMD, **cross-platform determinism and record/replay**.
- Web: `box3d-wasm` 0.2.0 (monteslu, MIT, ~26★) with plain `{x,y,z}` and `{x,y,z,w}` objects and `standard` and `deluxe` (threaded) builds. A three.js demo with ragdolls, dominoes and a buggy is at box3d.netlify.app.
```js
import Box3D from 'box3d-wasm';
const b3 = await Box3D();
const world = new b3.World({ gravity: { x: 0, y: -10, z: 0 } });
const body = world.createBody({ type: 'dynamic', position: { x: 0, y: 5, z: 0 } });
body.createBox({ halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, density: 1, friction: 0.5 });
world.step(1 / 60, 4);
```
- Use it for experiments and determinism prototypes. Pin exact versions, because the API will move.

## Havok: `@babylonjs/havok` 1.3.14 (MIT web build)
- `const HK = await HavokPhysics()` returns a C-style API (`HK.HP_World_Create()`, `HP_Body_*`, `HP_Shape_*`) that uses BigInt handle arrays. Babylon's `HavokPlugin` and `PhysicsCharacterController` sit on top of it.
- From three.js you'd write your own wrapper, and you get no vehicle or KCC. Choose it only if you're on **Babylon.js**, where it's first-class with great stability and a debug viewer.

## Legacy
- **cannon-es** 0.20.0 (pmndrs, ~2.1k★, MIT) was last released Aug 2022. It is pure JS and easy to use, but slow, with no maintained fixes. Fine only for an existing project.
- **ammo.js** (kripken, ~4.6k★, zlib) is an emscripten Bullet build. Its npm package dates from 2016, and three.js's `AmmoPhysics.js` loads a vendored build. Its IDL API is clunky and it leaks easily. Don't start new projects on it.

## Godot 4.4–4.7
- **Jolt is built in** (from 4.4) and the **default 3D engine for new projects since 4.6**. Turn it on with Project Settings > Physics > 3D > Physics Engine = *Jolt Physics*. Settings live under `physics/jolt_physics_3d/*`.
  - `simulation/areas_detect_static_bodies`: Area3D ignores StaticBody3D by default.
  - `simulation/generate_all_kinematic_contacts`: needed for kinematic RigidBody3D contact reports.
  - `queries/enable_ray_cast_face_index`: `face_index` is −1 otherwise.
  - `joints/world_node`: in single-body joints, Jolt treats the body as node_b.
  - Unsupported joint properties (e.g. hinge softness, 6DOF limit softness) print warnings. Shape margins shrink the shape rather than grow it.
  - 4.7 changes: Area3D now detects and affects SoftBody3D, and the SoftBody3D default mass is 1 kg with a stiffness fix. Retune soft bodies after upgrading.
- Interpolation: `physics/common/physics_interpolation` (2D from 4.3, 3D from 4.4). Gameplay goes in `_physics_process`. Call `reset_physics_interpolation()` after teleports.
- Use CharacterBody3D (`move_and_slide`, `floor_max_angle`, `floor_snap_length`), VehicleBody3D/VehicleWheel3D, PhysicalBoneSimulator3D for ragdolls, `ShapeCast3D` and `RayCast3D` nodes, and `PhysicsDirectSpaceState3D.intersect_ray(PhysicsRayQueryParameters3D.create(a, b))`.
- For deterministic or rollback games, or 2D games that need better stacking, use `appsinacup/godot-rapier-physics` (~1k★, MIT, Godot 4.4–4.7, 2D/3D, cross-platform determinism, fluids).
- Agent skills: GodotPrompter `physics-system`, awesome-gamedev-agent-skills `godot-physics`.

## Unity 6.x
- 3D uses built-in PhysX. **Unity 6 renamed `Rigidbody.velocity` → `linearVelocity`, `drag` → `linearDamping` and `angularDrag` → `angularDamping`**. Models trained on older code still write the old names.
- Use `interpolation = RigidbodyInterpolation.Interpolate` and `collisionDetectionMode = ContinuousDynamic` (fast dynamic vs dynamic) or `ContinuousSpeculative` (cheap, can ghost-collide). Configure the Layer Collision Matrix under Project Settings > Physics. Set `Physics.simulationMode = SimulationMode.Script` and call `Physics.Simulate(dt)` for manual and rollback stepping.
- Unity 6.3: the physics integration can be disabled and stripped for smaller builds. 2D now has **low-level Box2D v3 APIs** in `UnityEngine.LowLevelPhysics2D` (`PhysicsWorld`), with samples in `Unity-Technologies/PhysicsExamples2D`.
- DOTS: **Unity Physics** (stateless, deterministic, good for netcode) or **Havok Physics for Unity** (stateful, more stable stacking; check licence-tier requirements).
- Also available: CharacterController (a capsule KCC), WheelCollider, CharacterJoint + the Ragdoll Wizard, and `Physics.ContactEvent` for batch contact processing.
- Agent skill: awesome-gamedev-agent-skills `unity-physics`.
