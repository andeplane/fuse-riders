# Third-person controller + spring-arm camera (three.js + Rapier)

- **Tested:** type-checks against `three@0.187` / `@dimforge/rapier3d-compat@0.21`. In a Node run of the core KCC + spring arm, it climbed a 0.3 m step with autostep, settled grounded on flat ground, and the arm stopped at 5.6 m in front of a wall 5.8 m away (0.2 m margin).
- **Install:** `npm i three @dimforge/rapier3d-compat`. The `-compat` build embeds the WASM, so it needs no Vite plugin. Physics details (layers, worker, determinism) are in `game-physics`.

**Design rules:**
- Physics runs at a **fixed 60 Hz**, and the render pose is **interpolated**.
- Animation is driven by **measured** capsule speed. The character stops "running in place" against walls.
- The camera yaw defines input space. The model turns toward the velocity with angle-wrapped damping.
- The spring arm **snaps in** instantly when blocked and **eases out**, so it never clips walls or pumps.

```ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export async function createThirdPerson(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, model: THREE.Object3D,
  onSpeed: (dt: number, horizontalSpeed: number, grounded: boolean) => void) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // ---- capsule + KCC (total height 2*(HALF+RADIUS) = 1.7 m) ----
  const HALF = 0.55, RADIUS = 0.3, FEET = HALF + RADIUS;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0));
  const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), body);
  const kcc = world.createCharacterController(0.02);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(45));
  kcc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(50));
  kcc.enableAutostep(0.35, 0.2, true);
  kcc.enableSnapToGround(0.3);
  kcc.setApplyImpulsesToDynamicBodies(true);

  // ---- input (pointer-lock orbit) ----
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  let yaw = 0, pitch = -0.25;
  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    yaw -= e.movementX * 0.0025;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0025, -1.2, 0.6);
  });

  // ---- fixed-step simulation ----
  const DT = 1 / 60;
  let acc = 0, vy = 0, measuredSpeed = 0, grounded = false;
  const vel = new THREE.Vector3(), wish = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const prev = new THREE.Vector3(0, 2, 0), curr = new THREE.Vector3(0, 2, 0);

  function fixedStep() {
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));             // camera forward on the ground plane
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.copy(fwd).multiplyScalar(f).addScaledVector(right, r);
    if (wish.lengthSq() > 1) wish.normalize();
    const speed = keys.has('ShiftLeft') ? 4.0 : 1.6;
    vel.lerp(wish.multiplyScalar(speed), 1 - Math.exp(-10 * DT)); // accel/decel

    grounded = kcc.computedGrounded();
    vy = grounded ? (keys.has('Space') ? 5 : -1) : vy - 9.81 * DT;
    kcc.computeColliderMovement(capsule, { x: vel.x * DT, y: vy * DT, z: vel.z * DT });
    const m = kcc.computedMovement();
    if (!grounded && vy > 0 && m.y < vy * DT * 0.5) vy = 0;   // bonked a ceiling
    measuredSpeed = Math.hypot(m.x, m.z) / DT;               // real speed: 0 when pushing into a wall
    const p = body.translation();
    prev.copy(curr);
    body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    world.step();
    const t = body.translation(); curr.set(t.x, t.y, t.z);
  }

  // ---- spring arm ----
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  let armLen = 4;
  function springArm(pivot: THREE.Vector3, dirToCam: THREE.Vector3, maxLen: number, dt: number) {
    ray.origin = { x: pivot.x, y: pivot.y, z: pivot.z };
    ray.dir = { x: dirToCam.x, y: dirToCam.y, z: dirToCam.z };
    const hit = world.castRay(ray, maxLen, true, undefined, undefined, capsule); // exclude own capsule
    const target = hit ? Math.max(0.3, hit.timeOfImpact - 0.2) : maxLen;
    armLen = target < armLen ? target : THREE.MathUtils.damp(armLen, target, 4, dt); // snap in, ease out
    return armLen;
  }

  const pivot = new THREE.Vector3(), camDir = new THREE.Vector3(), camRight = new THREE.Vector3();
  const camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let modelYaw = 0;

  /** Call once per rendered frame with the frame dt (clamped). */
  return function update(dt: number) {
    acc = Math.min(acc + dt, 0.25);
    while (acc >= DT) { fixedStep(); acc -= DT; }
    const alpha = acc / DT;

    model.position.lerpVectors(prev, curr, alpha);           // interpolate render pose
    model.position.y -= FEET;                                // model origin at the feet
    if (vel.lengthSq() > 0.01) {                             // face movement (model faces +Z)
      const target = Math.atan2(vel.x, vel.z);
      const d = Math.atan2(Math.sin(target - modelYaw), Math.cos(target - modelYaw));
      modelYaw += d * (1 - Math.exp(-12 * dt));
      model.rotation.y = modelYaw;
    }
    onSpeed(dt, measuredSpeed, grounded);                    // e.g. locomotion.update(dt, speed)

    camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    pivot.copy(model.position).add({ x: 0, y: 1.55, z: 0 }).addScaledVector(camRight, 0.45); // over-the-shoulder
    camDir.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); // pivot → camera
    const len = springArm(pivot, camDir, 4, dt);
    camera.position.copy(pivot).addScaledVector(camDir, len);
    camera.quaternion.setFromEuler(camEuler.set(pitch, yaw, 0));
    return { world, body, capsule, kcc };
  };
}
```

Wiring:

```ts
const loco = new Locomotion(mixer, gltf.animations, ['Idle', 'Walk', 'Run'], 'mixamorigHips', root.scale.y);
const tp = await createThirdPerson(renderer, camera, root, (dt, speed, grounded) => {
  loco.update(dt, grounded ? speed : 0);      // or switch to a Fall/Jump action when !grounded
});
renderer.setAnimationLoop((t) => { timer.update(t); const dt = Math.min(timer.getDelta(), 1 / 20); tp(dt); renderer.render(scene, camera); });
```

## Variations

- **Thicker camera probe:** replace `castRay` with `world.castShape(pivot, identityQuat, dirToCam, new RAPIER.Ball(0.2), 0, maxLen, true, …, capsule)`. Note that the hit field is `time_of_impact` (snake_case), unlike rays.
- **Ignore small props/NPCs for the camera:** give them a collision group and pass `filterGroups` to the cast.
- **Pivot inside a wall** (shoulder offset pushed through geometry): first cast from the head centre to the shoulder pivot and shorten the offset.
- **Fade occluders instead of pulling in** (top-down/iso): see three.js `webgpu_tsl_occlusion_dither`. It uses `material.maskNode` with `bayer16(screenCoordinate)`.
- **Lock-on / strafe:** set the model yaw to the camera yaw, and feed local velocity (x, z) to a 2D directional blend.
- **Root-motion attacks:** during the one-shot, set `vel` from the clip (sample the hips delta per step) instead of from input. Restore input control on `finished`.
- **Moving platforms:** add the platform's per-step delta to the desired translation before `computeColliderMovement`.

## Engine equivalents

- **Godot 4:** `CharacterBody3D` + `move_and_slide()` (Jolt is the default 3D physics in 4.6). The camera is the built-in **`SpringArm3D`** (`spring_length`, `margin`, `shape`, and `add_excluded_object(rid)` for the player).
- **Unity 6:** `CharacterController` or KCC asset. For the camera use Cinemachine 3 `CinemachineThirdPersonFollow`, which has built-in obstacle avoidance, plus `CinemachineDeoccluder` (check docs for current component names).

## Verification

Scripted inputs are run headless in Playwright, with an exposed `window.__tp = { setKeys(set), state() }`.
1. Hold W for 2 s on flat ground. Expect `|z| ≈ 1.6 × 2 ± 10 %` and `grounded === true`.
2. Walk into a 0.3 m box. Expect y to rise ≈ 0.3. Then try a 0.5 m box: expect it blocked, with measured speed → 0 and the Idle weight → 1.
3. Walk into a wall with the camera behind. `armLen` must be < 4 and the camera must not be inside any collider (`world.intersectionsWithPoint` returns nothing).
4. Screenshot at each checkpoint. The character must be visible, never occluded, with no jitter: compare 2 consecutive frames at constant speed, and the camera delta should equal the character delta.
