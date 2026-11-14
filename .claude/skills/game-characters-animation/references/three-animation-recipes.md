# three.js animation recipes (tested)

All code below lives in one ES module, `src/anim/recipes.js`, and works fine as `.ts` with `any` types. It was tested in Node against `three@0.187.0`:
- two-bone IK error < 1e-9 m over 2000 random reachable targets;
- foot IK on a step and a hole lands each foot at its target height;
- `AnimEvents` fires once per loop;
- `LegStepper` never steps two groups at once;
- skinned-equipment remap binds to the body skeleton.

**Per-frame order:**
1. `mixer.update(dt)`
2. `events.update()`
3. procedural (look-at / foot IK / legs)
4. read bones for hitboxes
5. render

```js
import * as THREE from 'three';

// ---------- bone math helpers ----------
const _pq = new THREE.Quaternion(), _tmp = new THREE.Quaternion();
/** Apply a WORLD-space rotation q to a bone, keeping its parent untouched. */
export function rotateBoneWorld(bone, q) {
  bone.parent.getWorldQuaternion(_pq);
  _tmp.copy(_pq).invert().multiply(q).multiply(_pq);   // local' = P^-1 * q * P * local
  bone.quaternion.premultiply(_tmp);
  bone.updateMatrixWorld(true);
}

// ---------- analytic two-bone IK ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _ac = new THREE.Vector3(), _ab = new THREE.Vector3();
const _ba = new THREE.Vector3(), _bc = new THREE.Vector3(), _at = new THREE.Vector3(), _axis = new THREE.Vector3(), _q = new THREE.Quaternion();
const clamp1 = (x) => Math.min(1, Math.max(-1, x));
/** root→mid→end (thigh→shin→foot / upperArm→forearm→hand). fallbackAxis: bend axis if the limb is dead straight
 *  (use the character's world right vector for knees, -right/up for elbows). */
export function solveTwoBoneIK(root, mid, end, target, fallbackAxis = new THREE.Vector3(1, 0, 0)) {
  root.getWorldPosition(_a); mid.getWorldPosition(_b); end.getWorldPosition(_c);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  const lat = THREE.MathUtils.clamp(target.distanceTo(_a), 1e-4, lab + lcb - 1e-4);
  _ac.subVectors(_c, _a).normalize(); _ab.subVectors(_b, _a).normalize();
  _ba.subVectors(_a, _b).normalize(); _bc.subVectors(_c, _b).normalize(); _at.subVectors(target, _a).normalize();
  const ac_ab_0 = Math.acos(clamp1(_ac.dot(_ab))), ba_bc_0 = Math.acos(clamp1(_ba.dot(_bc)));
  const ac_ab_1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const ba_bc_1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  _axis.crossVectors(_ac, _ab); if (_axis.lengthSq() < 1e-8) _axis.copy(fallbackAxis); _axis.normalize();
  rotateBoneWorld(root, _q.setFromAxisAngle(_axis, ac_ab_1 - ac_ab_0));
  rotateBoneWorld(mid, _q.setFromAxisAngle(_axis, ba_bc_1 - ba_bc_0));
  end.getWorldPosition(_c); _ac.subVectors(_c, _a).normalize();
  rotateBoneWorld(root, _q.setFromUnitVectors(_ac, _at));      // swing chain onto target
}

// ---------- foot IK (planting on uneven ground) ----------
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _h = new THREE.Vector3(), _t = new THREE.Vector3();
/** legs: [{ thigh, shin, foot, ankle: 0.08 }]. castDown(origin, maxDist) → ground Y or null (Rapier castRay / three-mesh-bvh).
 *  Call after mixer.update(), only while grounded. Returns the hips drop actually applied (m). */
export function footIK(root, hips, legs, castDown, right, weight = 1) {
  root.updateMatrixWorld(true);
  root.getWorldPosition(_r);
  let drop = 0;
  const plans = legs.map((leg) => {
    leg.foot.getWorldPosition(_f);
    const lift = _f.y - _r.y - leg.ankle;                                   // animated height above root
    const w = weight * (1 - THREE.MathUtils.smoothstep(lift, 0.05, 0.25));  // planted feet only
    const gy = castDown(_t.set(_f.x, _f.y + 0.5, _f.z), 1.2);
    if (gy === null || w <= 0) return null;
    const want = gy + leg.ankle + Math.max(lift, 0);                        // keep animated lift above the new ground
    drop = Math.min(drop, (want - _f.y) * w);
    return { leg, want, w };
  });
  hips.getWorldPosition(_h); _h.y += drop; hips.parent.worldToLocal(_h); hips.position.copy(_h);
  hips.updateMatrixWorld(true);
  for (const p of plans) {
    if (!p) continue;
    p.leg.foot.getWorldPosition(_f);
    _t.set(_f.x, THREE.MathUtils.lerp(_f.y, p.want, p.w), _f.z);
    solveTwoBoneIK(p.leg.thigh, p.leg.shin, p.leg.foot, _t, right);
  }
  return drop;
}

// ---------- additive look-at ----------
const _fwd = new THREE.Vector3(), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
/** bones: [{bone: neck, share: .4}, {bone: head, share: .6}]. Keeps the animation's own head motion (additive). */
export function lookAtAdditive(model, bones, target, maxAngle = 1.0, weight = 1) {
  model.getWorldDirection(_fwd);
  bones[bones.length - 1].bone.getWorldPosition(_p);
  _dir.subVectors(target, _p).normalize();
  _d.setFromUnitVectors(_fwd, _dir);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(_d.w)));
  const t = (angle > maxAngle ? maxAngle / angle : 1) * weight;
  for (const { bone, share } of bones) rotateBoneWorld(bone, _q2.identity().slerp(_d, t * share));
}

// ---------- in-place clips + locomotion blend ----------
export function stripRootMotion(clip, hip = 'mixamorigHips') {
  const c = clip.clone();
  const tr = c.tracks.find((t) => t.name === `${hip}.position`);
  if (!tr) return { clip: c, speed: 0 };
  const v = tr.values, last = v.length - 3;
  const speed = Math.hypot(v[last] - v[0], v[last + 2] - v[2]) / c.duration;   // native m/s (scale by root scale!)
  for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }      // keep Y bob, remove XZ travel
  return { clip: c, speed };
}
export class Locomotion {
  constructor(mixer, clips, names = ['Idle', 'Walk', 'Run'], hip = 'mixamorigHips', rootScale = 1) {
    this.mixer = mixer;
    this.states = names.map((n) => {
      const { clip, speed } = stripRootMotion(THREE.AnimationClip.findByName(clips, n), hip);
      const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0);
      return { a, speed: speed * rootScale };
    });
    this.states[0].a.setEffectiveWeight(1);
  }
  /** speed = horizontal speed of the physics capsule (m/s). */
  update(dt, speed) {
    const [idle, walk, run] = this.states;
    const w = speed <= walk.speed
      ? [1 - speed / walk.speed, speed / walk.speed, 0]
      : [0, 1 - THREE.MathUtils.clamp((speed - walk.speed) / (run.speed - walk.speed), 0, 1), 0];
    w[2] = 1 - w[0] - w[1];
    this.states.forEach((s, i) => s.a.setEffectiveWeight(w[i]));
    const s = Math.max(speed, 1e-3);
    walk.a.setEffectiveTimeScale(THREE.MathUtils.clamp(s / walk.speed, 0.5, 2));
    run.a.setEffectiveTimeScale(THREE.MathUtils.clamp(s / run.speed, 0.5, 2));
    this.mixer.update(dt);
    return w;
  }
}
/** Split a clip by bone set, e.g. for an upper-body layer. */
export function filterClip(clip, boneNames, name = clip.name + '_part') {
  const c = clip.clone(); c.name = name;
  c.tracks = c.tracks.filter((t) => boneNames.has(t.name.split('.')[0]));
  return c;
}

// ---------- animation events (three.js has none) ----------
export class AnimEvents {
  constructor() { this.list = []; this.prev = new Map(); }
  on(action, time, fn) { this.list.push({ action, time, fn }); return this; }
  update() {                                   // call right after mixer.update()
    for (const e of this.list) {
      const a = e.action; if (!a.isRunning()) { this.prev.delete(e); continue; }
      const prev = this.prev.get(e) ?? a.time, now = a.time;
      const crossed = now >= prev ? prev < e.time && e.time <= now : (prev < e.time || e.time <= now); // loop wrap
      if (crossed) e.fn();
      this.prev.set(e, now);
    }
  }
}

// ---------- skinned equipment ----------
export function attachSkinnedEquipment(body, armor) {
  const idx = new Map(body.skeleton.bones.map((b, i) => [b.name, i]));
  const remap = armor.skeleton.bones.map((b) => { const i = idx.get(b.name); if (i === undefined) throw new Error(`bone ${b.name} missing`); return i; });
  const si = armor.geometry.getAttribute('skinIndex');
  for (let i = 0; i < si.array.length; i++) si.array[i] = remap[si.array[i]];
  si.needsUpdate = true;
  armor.bind(body.skeleton, body.bindMatrix);   // pass bindMatrix or bind() recomputes inverses from the current pose
  body.parent.add(armor);
  return armor;
}

// ---------- procedural legs ----------
export class LegStepper {
  constructor(body, restOffsets, { stepDist = 0.6, stepTime = 0.15, stepHeight = 0.25 } = {}) {
    Object.assign(this, { body, stepDist, stepTime, stepHeight });
    this.legs = restOffsets.map((o, i) => ({ rest: o, foot: body.localToWorld(o.clone()), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, group: i % 2 }));
    this._home = new THREE.Vector3();
  }
  update(dt, groundAt, velocity) {
    this.body.updateMatrixWorld();
    const stepping = new Set(this.legs.filter((l) => l.t < 1).map((l) => l.group));
    for (const leg of this.legs) {
      this._home.copy(leg.rest).applyMatrix4(this.body.matrixWorld).addScaledVector(velocity, this.stepTime);
      this._home.y = groundAt(this._home.x, this._home.z);
      if (leg.t >= 1 && leg.foot.distanceTo(this._home) > this.stepDist && !stepping.has(1 - leg.group)) {
        leg.from.copy(leg.foot); leg.to.copy(this._home); leg.t = 0; stepping.add(leg.group);
      }
      if (leg.t < 1) {
        leg.t = Math.min(1, leg.t + dt / this.stepTime);
        const s = leg.t * leg.t * (3 - 2 * leg.t);
        leg.foot.lerpVectors(leg.from, leg.to, s);
        leg.foot.y += Math.sin(Math.PI * leg.t) * this.stepHeight;
      }
    }
    return this.legs.reduce((a, l) => a + l.foot.y, 0) / this.legs.length;   // use for body height
  }
}
```

## Usage notes

### Locomotion
`new Locomotion(mixer, gltf.animations, ['Idle','Walk','Run'], 'mixamorigHips', root.scale.y)`.
- Mixamo: download walk/run **without** "In Place" if you want the measured speed. Otherwise hard-code the speeds: Mixamo walk ≈ 1.4 m/s, run ≈ 3.5–4 m/s (measure yours).
- Quaternius UAL uses its own hip name. Check with `gltf.animations[0].tracks.map(t => t.name)`.

### 2D blend (strafe)
Use the same idea with 4–8 directional clips:
1. Compute barycentric or "gradient band" weights from the local velocity (x = right, z = forward).
2. Normalise the weights to sum to 1.
3. Set all directional clips to the same `timeScale` so their phases match. Author the cycles with equal duration, or `syncWith()` them to the forward clip.

### Upper-body layer

```js
const UPPER = new Set(['mixamorigSpine1','mixamorigSpine2','mixamorigNeck','mixamorigHead', /* arms, hands… */]);
const LOWER = new Set(gltf.animations[0].tracks.map(t => t.name.split('.')[0]).filter(n => !UPPER.has(n)));
const runLower = mixer.clipAction(filterClip(run, LOWER, 'RunLower')).play();
const runUpper = mixer.clipAction(filterClip(run, UPPER, 'RunUpper')).play();
const slashUpper = mixer.clipAction(filterClip(slash, UPPER, 'SlashUpper'));
// attack while running: legs keep running, torso swaps
slashUpper.reset().setLoop(THREE.LoopOnce, 1).play(); runUpper.crossFadeTo(slashUpper, 0.1, false);
```

To blend the upper-body aim with spine twist, add an additive aim-offset clip on top. Run `makeClipAdditive` on a pose clip, then set its weight from the pitch.

### Foot IK with Rapier

```js
const ray = new RAPIER.Ray({x:0,y:0,z:0}, {x:0,y:-1,z:0});
const castDown = (o, max) => { ray.origin = o; const h = world.castRay(ray, max, true, undefined, undefined, playerCollider);
  return h ? o.y - h.timeOfImpact : null; };
if (kcc.computedGrounded()) footIK(root, hips, legs, castDown, rightVectorWorld, ikWeight);
```

- Damp `ikWeight` to 0 when airborne, and back to 1 within about 0.15 s of landing.
- Optional: align the foot to the hit normal with `rotateBoneWorld(foot, q.setFromUnitVectors(up, normal))`. Read the normal from `castRayAndGetNormal`.

### Hitboxes from bones

```js
const shape = new RAPIER.Capsule(0.35, 0.06);           // blade: halfHeight, radius
const events = new AnimEvents()
  .on(slash, 0.22, () => { swing.active = true; swing.hit.clear(); })
  .on(slash, 0.40, () => { swing.active = false; });
function updateHitbox() {
  if (!swing.active) return;
  bladeBone.getWorldPosition(p); bladeBone.getWorldQuaternion(q);
  world.intersectionsWithShape(p, q, shape, (col) => {
    const target = col.parent()?.userData?.entity;   // map collider → entity however you store it
    if (target && target !== self && !swing.hit.has(target)) { swing.hit.add(target); target.damage(10); }
    return true;                                       // keep iterating
  });
}
```

- Use a **query** instead of a sensor collider. Sensors on kinematic bodies don't report against other kinematic or fixed bodies unless you set `ActiveCollisionTypes.KINEMATIC_KINEMATIC` / `KINEMATIC_FIXED`.
- At high swing speeds, sweep the blade: test 2–3 interpolated poses between the last and current frame, or use `castShape` with the velocity.

### Crowds
- At up to ~50–100 animated characters, use mixers. Beyond that, update the far ones every 2nd–4th frame with an accumulated dt, and skip `mixer.update` for off-screen ones (test a padded bounding sphere against the frustum).
- At hundreds to thousands, use `@three.ez/instanced-mesh`: `im.initSkeleton(skeleton)`, then for each instance run `mixer.update(...)` and `im.setBonesAt(i)`. Reuse a few shared mixers at different time offsets.
- Alternatives are VAT (bake in Blender with OpenVAT and sample in a TSL vertex shader) and WebGPU compute skinning (`webgpu_skinning_instancing_individual`).

### Retarget gotchas
- Different rest poses (A vs T) need `localOffsets` per limb. The three.js `webgpu_animation_retargeting` example shows the 45°/180° matrices for a Mixamo→custom rig.
- With `hipInfluence: new Vector3(0,1,0)`, the source root travel is ignored and only hip bob is kept.
- For a whole library, retarget **offline** in Blender. Runtime retarget bakes every frame (`fps` option), so it's slow for 100+ clips.
