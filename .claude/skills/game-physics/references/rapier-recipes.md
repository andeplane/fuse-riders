# Rapier recipes (JS 0.21): vehicles, ragdolls, decomposition, projectiles

These recipes were checked against `@dimforge/rapier3d-compat@0.21.0` `.d.ts`. All code runs inside `fixedUpdate(dt)` from SKILL.md Recipe 2.

## Raycast vehicle (`DynamicRayCastVehicleController`)

```ts
const chassis = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.5, 0).setCanSleep(false).setAdditionalSolverIterations(2));
world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.3, 2.0).setDensity(120)  // ≈ 520 kg
  .setTranslation(0, 0.1, 0), chassis);                                         // keep the COM low, or it flips in corners
const car = world.createVehicleController(chassis);
car.indexUpAxis = 1;
car.setIndexForwardAxis = 2;   // (sic) a *setter property* named setIndexForwardAxis. Default forward is X; three.js cars usually face ±Z
const down = { x: 0, y: -1, z: 0 }, axle = { x: -1, y: 0, z: 0 };
const WHEELS: [number, number][] = [[-0.8, 1.3], [0.8, 1.3], [-0.8, -1.3], [0.8, -1.3]]; // 0,1 = front
WHEELS.forEach(([x, z], i) => {
  car.addWheel({ x, y: -0.15, z }, down, axle, /*rest*/ 0.3, /*radius*/ 0.35);
  car.setWheelSuspensionStiffness(i, 30);
  car.setWheelSuspensionCompression(i, 2.3);
  car.setWheelSuspensionRelaxation(i, 4.4);
  car.setWheelMaxSuspensionTravel(i, 0.3);
  car.setWheelFrictionSlip(i, 1.6);          // grip. Lower → drift
  car.setWheelSideFrictionStiffness(i, 1.0);
});
const notChassis = (c: RAPIER.Collider) => c.parent()?.handle !== chassis.handle;
function driveCar(dt: number) {
  const steer = -input.x * 0.45;            // radians. Reduce with speed: 0.45 / (1 + |v| * 0.05)
  car.setWheelSteering(0, steer); car.setWheelSteering(1, steer);
  const f = input.throttle * 1200;          // N. Rear-wheel drive
  car.setWheelEngineForce(2, f); car.setWheelEngineForce(3, f);
  for (let i = 0; i < 4; i++) car.setWheelBrake(i, input.brake ? 25 : 0);
  car.updateVehicle(dt, undefined, undefined, notChassis);   // BEFORE world.step
}
// visuals: wheel i centre (chassis space) = connectionPoint + down * wheelSuspensionLength(i).
// Spin = wheelRotation(i), steer = wheelSteering(i). Interpolate the chassis like any synced body.
```
- Speed is `car.currentVehicleSpeed()`, and `car.wheelIsInContact(i)` tells you a wheel is airborne. Use both for the HUD, audio and air control.
- Arcade feel: add a downforce `chassis.addForce({x:0,y:-k*v*v,z:0}, true)`, cap the yaw rate, and auto-right the car with a torque when `up.y < 0.3`.
- Tanks, motorbikes, gearboxes, differentials and anti-roll bars: use **Jolt** `VehicleConstraint` + `WheeledVehicleControllerSettings`, `TrackedVehicleControllerSettings` or `MotorcycleControllerSettings` (examples `vehicle_wheeled.html`, `vehicle_tank.html`, `vehicle_motorcycle.html`). Godot: `VehicleBody3D` + `VehicleWheel3D`. Unity: `WheelCollider`.

## Ragdoll

**Rapier** (good enough for death flops). Use one capsule body per major bone, about 11 bodies: pelvis, spine, head, upper/lower arms, upper/lower legs.

```ts
function bone(a: THREE.Vector3, b: THREE.Vector3, r: number) {      // world-space joint positions from the skeleton
  const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mid.x, mid.y, mid.z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.1).setAngularDamping(1.0));
  world.createCollider(RAPIER.ColliderDesc.capsule(Math.max(len / 2 - r, 0.01), r)
    .setCollisionGroups(groups([L.Ragdoll], [L.World, L.Debris])), body);   // limbs don't collide with each other
  return { body, halfLen: len / 2 };
}
// knee / elbow: hinge with limits. Anchors are in each body's local frame (capsule axis = local Y)
const knee = RAPIER.JointData.revolute({ x: 0, y: -thigh.halfLen, z: 0 }, { x: 0, y: shin.halfLen, z: 0 }, { x: 1, y: 0, z: 0 });
knee.limitsEnabled = true; knee.limits = [-2.4, 0];
world.createImpulseJoint(knee, thigh.body, shin.body, true).setContactsEnabled(false);
// hip / shoulder: JointData.spherical(a1, a2). The JS API has NO cone limit, only per-axis motors.
// Soft-limit them: sph.configureMotorPosition(RAPIER.JointAxis.AngX, 0, 2, 0.5) (same for Y and Z)
```
- On death, copy each bone's world transform into the bodies. Seed `setLinvel` from the animation's last-frame velocity so the body doesn't stop dead, then start driving the bones: `bone.quaternion = parentWorldQ⁻¹ · bodyQ · bindOffsetQ`. Store `bindOffsetQ = bodyQ⁻¹ · boneWorldQ` when you create the ragdoll.
- **Jolt is the better ragdoll engine.** It has `RagdollSettings` (Skeleton + parts with `SwingTwistConstraintSettings` cone and twist limits), `DisableParentChildCollisions()`, `Stabilize()`, `ragdoll.AddToPhysicsSystem(Jolt.EActivation_Activate)`, plus `DriveToPoseUsingMotors(pose)` for **active ragdolls**: hit reactions that blend back into animation. Names are from `JoltJS.idl`, and there is no JS example, so port from the C++ samples.
- Godot: `PhysicalBoneSimulator3D` + `PhysicalBone3D` (Skeleton3D > Create Physical Skeleton). Unity: the Ragdoll Wizard and `CharacterJoint`.

## Concave props: CoACD offline, convex hulls at runtime

```bash
pip install coacd trimesh                      # CoACD: MIT, SIGGRAPH 2022, better hulls than V-HACD (V-HACD repo is archived)
```
```python
# tools/decompose.py  →  writes <name>.hulls.json next to the glb (run in the asset pipeline, not at runtime)
import coacd, trimesh, json, sys
mesh = trimesh.load(sys.argv[1], force="mesh")
parts = coacd.run_coacd(coacd.Mesh(mesh.vertices, mesh.faces), threshold=0.05)   # lower = more, tighter hulls
json.dump([v.flatten().tolist() for v, f in parts], open(sys.argv[1].replace(".glb", ".hulls.json"), "w"))
```
```ts
const hulls: number[][] = await (await fetch('/models/statue.hulls.json')).json();
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
for (const pts of hulls) {
  const d = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));   // returns null on degenerate input
  if (d) world.createCollider(d.setDensity(500), body);
}
```
- Rapier's built-in `ColliderDesc.convexDecomposition(vertices, indices, { concavity?, alpha?, beta? … })` runs V-HACD in WASM. Use it for editor tools and prototypes, then cache the result.
- Cap each prop at 8–16 hulls of ≤ 64 vertices. Simplify first with meshoptimizer or gltf-transform `simplify`.
- Godot: Mesh > Create Collision Shape > Multiple Convex (V-HACD), or import the CoACD output as `ConvexPolygonShape3D`s. Unity: `MeshCollider.convex` allows one hull of at most 255 triangles. For concave dynamic props, import the CoACD hulls as child MeshColliders.

## Projectiles, hitscan, explosions

```ts
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
function hitscan(origin: THREE.Vector3, dir: THREE.Vector3, range: number, shooter: RAPIER.RigidBody) {
  ray.origin = origin; ray.dir = dir;                           // dir normalised
  const hit = world.castRayAndGetNormal(ray, range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    groups([L.Projectile], [L.World, L.Enemy, L.Ragdoll]), undefined, shooter);
  if (!hit) return null;
  return { collider: hit.collider, point: origin.clone().addScaledVector(dir, hit.timeOfImpact), normal: hit.normal };
}
```
- For **fast bullets** (≥ 300 m/s, over Rapier's ~400 u/s velocity cap), sweep a ray from the last position to the next one each tick. Don't use rigid bodies.
- For **slow visible projectiles** (grenades, arrows), use dynamic bodies with `setCcdEnabled(true)`.
- **Explosions**: `world.intersectionsWithShape(center, identityRot, new RAPIER.Ball(r), (c) => { … apply impulse ∝ 1/d² to c.parent(); return true; })`. Wake each body with `applyImpulse(v, true)`.

## Moving platforms and PID following

- A platform is `kinematicPositionBased` + `setNextKinematicTranslation(path(t))` every tick. Riders using the KCC inherit its motion automatically. A rider with a dynamic body needs friction.
- A dynamic body that must *follow* a target (a held object, a hover drone) uses `world.createPidController(kp, ki, kd, RAPIER.PidAxesMask.*)`. See the `pidController` testbed demo for how to apply its output each tick. The alternative is a spring impulse `(target − pos)·k − vel·c`. Never teleport it.

## Joints cheat sheet (`RAPIER.JointData.*`)

`fixed` (weld), `spherical` (ball, motors only), `revolute` (hinge, `limits`, motor), `prismatic` (slider, `limits`), `rope(length, a1, a2)`, `spring(rest, k, c, a1, a2)`, `generic(a1, a2, axis, JointAxesMask)` (6-DOF, lock any subset). Create joints with `world.createImpulseJoint(data, b1, b2, wakeUp)`. Use multibody joints (`createMultibodyJoint`) for long chains that must not stretch, like cranes and robot arms.
