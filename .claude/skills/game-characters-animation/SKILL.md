---
name: game-characters-animation
description: Load when adding, animating or controlling characters or creatures in three.js, Godot, Unity or 2D web. It covers sourcing (Mixamo, Quaternius, KayKit, Rocketbox, VRM, Meshy/Tripo auto-rig, video mocap), AnimationMixer blending, retargeting and IK, a third-person controller with a spring-arm camera, bone hitboxes and 2D paper-doll equipment sprites (Aseprite), plus T-poses, foot sliding, skinned meshes vanishing at screen edges, and armour missing from animations.
---

# Game characters & animation

The default stack is three.js r18x (r187 is current, Oct 2026) with Vite, TS and `GLTFLoader`, plus Rapier for the controller. There are notes for Godot 4.6/4.7, Unity 6 and 2D web.
Character generation and Blender cleanup live in `game-asset-pipeline`. Rapier setup lives in `game-physics`, and sprite tooling in `game-2d`. This skill is about **making characters move well**.

## The 5-minute path (humanoid, three.js)

1. Get a rig with animations. For a prototype, use **Quaternius UAL 1+2** (CC0, 250+ clips on one humanoid rig) or **KayKit Adventurers + Character Animations** (CC0). For your own mesh, run it through the **Mixamo** auto-rigger, or use Meshy/Tripo auto-rig.
2. Export one GLB holding the skinned mesh and all clips, using **in-place** locomotion. Compress it with `gltf-transform optimize` (see `game-performance-optimization`).
3. Load it once, then use `SkeletonUtils.clone` for each instance. Give each instance its own `AnimationMixer`, and share the clips.
4. Drive the mixer with an explicit state machine: idle/walk/run blended by speed, plus one-shots (attack, jump) crossfaded on top.
5. Move the capsule with a Rapier kinematic character controller. Animation follows the speed, never the reverse (unless you chose root motion).
6. Verify with the steps in "Verification" (no console binding warnings, foot-slide metric, screenshots at fixed times).

## When to use what

### Character sources

| Need | Pick | Why | Not when |
|---|---|---|---|
| Free humanoid + big clip library | **Quaternius Universal Animation Library** 1 (120+ clips, 2025) & 2 (130+, Jan 2026), CC0, FBX/GLB/Blend | One retarget-ready rig, also used by ozz-animation 0.17's samples | You need realism. The style is stylised low-poly |
| Stylised party/RPG cast | **KayKit** Adventurers/Skeletons + **KayKit Character Animations** (133 clips, CC0, FBX/GLTF; `.blend` source pack $14.99) | Matching rigs (Rig_Medium/Rig_Large) and equippable props | Non-KayKit meshes. The clips retarget poorly to other proportions |
| Realistic humans | **Microsoft Rocketbox** (115 avatars, 417 anims, ARKit/visemes, MIT, FBX, ~645★) | Free, realistic, commercial-OK | Close-up hero shots on mobile (heavy). Its FBX needs a Blender → GLB pass |
| Rig your own humanoid mesh | **Mixamo** (free with an Adobe ID, royalty-free in games). Has a big mocap library, "In Place" toggle and "Without Skin" export | Fastest auto-rig and the largest free mocap set | Non-bipeds, CI/automation (it has no official API), or redistributing the raw clips as an asset pack |
| Auto-rig from an AI pipeline | **Meshy** `POST /openapi/v1/rigging` then the Animation API (`action_id(s)`, ~480 presets). **Tripo** v3 `POST /v3/animations/retarget` (`animations: ['preset:walk',…]`, ≤5, `animate_in_place`) | API-driven. Tripo rig v2.5+/v3.0 handles quadrupeds, hexapods, serpents | Meshy rigging is humanoid-only, textured, ≤380k tris, faces +Z. Both are paid credits |
| Custom/creature rig, cleanup, retarget | **Blender** with Rigify (built in) or **Auto-Rig Pro** (paid; game-engine export + Remap retargeter), driven by **blender-mcp** (`claude mcp add blender uvx mcp-for-blender`, MIT, ~32k★) | Full control. The agent can script it | You only need stock humanoid motion (use Mixamo/UAL) |
| Anime/VTuber avatars | **VRM** + `@pixiv/three-vrm` 3.5.x (MIT, WebGPU via `MToonNodeMaterial`); VRoid Studio to author; `@pixiv/three-vrm-animation` for `.vrma` | Standard humanoid, spring bones, expressions, look-at | Realistic or stylised games without anime shading |
| "Ready Player Me" | **Dead.** Netflix bought it (Dec 2025) and shut the public API/creator down on **Jan 31 2026**. Old GLBs still load, but RPM URLs don't | — | Always. Use VRM, Avaturn/MetaPerson (paid), or your own modular kit |
| Video → animation | **Rokoko Vision** (free 30 s/mo), **Move One** (iPhone, single cam, credits), **DeepMotion** (free 60 s/mo, non-commercial), **QuickMagic**, **Uthana** ($0.05/s, API), **Cartwheel**. OSS: **FreeMoCap** (AGPL-3.0 app, ~10.6k★), **GVHMR** (research/non-commercial licence) | Cheap custom motions (emotes, signature attacks) | Locomotion cycles. Stock loops are cleaner; always clean up foot contacts |

Full source notes and pipeline scripts are in `references/sources-and-pipelines.md`.

### Runtime animation

| Problem | three.js | Godot 4 | Unity 6 | Not when |
|---|---|---|---|---|
| Play/switch clips | `AnimationMixer` + `action.crossFadeTo(next, 0.2, true)` | `AnimationTree` StateMachine `travel()` | Animator / Playables | — |
| Speed-based locomotion | 3 actions always playing, weights from speed, timeScale synced (`Locomotion` below) | BlendSpace1D/2D | Blend Tree | You use root motion (then speed comes from the clip) |
| Upper-body attack while running | Split clips by bone set (lower/upper), crossfade only the upper action | `AnimationNodeBlend2` + filters, or OneShot with filters | Avatar Mask layer | — |
| Breathing/aim offsets | `AnimationUtils.makeClipAdditive(clip.clone())` → additive action | `Add2`/`Add3` nodes | Additive layer | The clip is not authored relative to a reference pose |
| Many identical NPCs | `SkeletonUtils.clone` + mixer per NPC; throttle far mixers | Instanced scenes; `AnimationMixer.callback_mode_process` manual | GPU Resident Drawer skips SkinnedMeshRenderer; use VAT or DOTS animation for crowds | >200 visible animated characters: use InstancedMesh2 skinning, VAT, or compute skinning (`webgpu_skinning_instancing_individual`) |
| Big crowds / custom C++/WASM engine | Vertex animation textures (OpenVAT Blender add-on, GPL tool / MIT engine shaders) | VAT shader (godotshaders) | VAT / Entities | Characters need IK or ragdoll |
| Engine-agnostic C++ runtime | **ozz-animation** 0.17 (MIT, ~2.9k★, SoA SIMD, IK jobs, WASM-tested) | GDExtension | — | You're on three.js/Godot with fewer than ~200 characters: the built-in mixer is enough |

### IK & procedural

| Problem | Use | Notes |
|---|---|---|
| Foot planting on slopes/stairs | Raycast per foot, then analytic **two-bone IK**, and lower the hips by the worst foot offset | Code in `references/three-animation-recipes.md`. Tested to <1e-9 m error |
| Head/eyes track a target | Additive look-at on neck+head after `mixer.update` (snippet below). VRM: `vrm.lookAt.target = obj` | Clamp to about 60°. Damp the weight in and out |
| Long chains (tail, tentacle, crane) | `CCDIKSolver` (`three/addons/animation/CCDIKSolver.js`) | The target must be a **bone in the skeleton** (add it in Blender). Supports per-link `rotationMin/Max` limits |
| Spider/mech legs | `LegStepper` (step when foot is far from its predicted home, alternate leg groups, arc + smoothstep), then IK | In recipes; tested so two groups never step together |
| Robot/closed-chain IK | `closed-chain-ik-js` (gkjohnson, Apache-2.0, ~320★) | URDF-oriented, not humanoids |
| `THREE.IK` (jsantell) | **Don't**: last published 2018 | — |
| Godot | 4.6+ has `TwoBoneIK3D`, `FABRIK3D`, `CCDIK3D`, `JacobianIK3D`, `SplineIK3D` (SkeletonModifier3D) + `LookAtModifier3D` (4.4), `SpringBoneSimulator3D` | See `references/godot-and-ozz.md` |

## Core recipes (three.js)

### R1. Load once, clone many, one mixer each

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const gltf = await new GLTFLoader().loadAsync('/models/hero.glb'); // add setMeshoptDecoder/KTX2 as in perf skill
const clips = gltf.animations;                                       // shared between all clones
function spawn(): { root: THREE.Object3D; mixer: THREE.AnimationMixer } {
  const root = SkeletonUtils.clone(gltf.scene);  // NOT gltf.scene.clone(): that leaves clones bound to the original bones
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; }); // or enlarge bounds (see Pitfalls)
  return { root, mixer: new THREE.AnimationMixer(root) };
}
const timer = new THREE.Timer();               // Clock is deprecated since r183
renderer.setAnimationLoop((t) => { timer.update(t); const dt = Math.min(timer.getDelta(), 1 / 20); npcs.forEach((n) => n.mixer.update(dt)); /* …then IK/look-at, then render */ });
```

### R2. Crossfade and one-shots

```ts
function fadeTo(from: THREE.AnimationAction, to: THREE.AnimationAction, dur = 0.2) {
  to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play(); // the target must be playing before crossFade
  from.crossFadeTo(to, dur, true);                                   // warp = sync timeScales during the fade
}
const attack = mixer.clipAction(THREE.AnimationClip.findByName(clips, 'Attack'));
attack.setLoop(THREE.LoopOnce, 1); attack.clampWhenFinished = true;
mixer.addEventListener('finished', (e) => { if (e.action === attack) fadeTo(attack, idle, 0.25); });
```

### R3. Locomotion blend (1D blend tree, in-place clips)

`stripRootMotion` (in recipes) zeroes the hips' XZ track and returns the clip's native speed in m/s. Weights then come from the actual capsule speed. Walk and run playback rates are scaled to `speed / clipSpeed`, which removes foot sliding. The class is tested in node and lives in `references/three-animation-recipes.md` (`Locomotion`). Feed it **horizontal velocity from the physics controller**, not input.

### R4. Layers & additive

- **Upper-body layer:** three.js has no bone masks. Make filtered copies of the clips instead: `clip.clone()` with `tracks.filter(t => UPPER.has(t.name.split('.')[0]))`. Play the lower-body locomotion constantly and crossfade only between the upper-body clips. Two actions on the same bone **average** by weight; they don't override.
- **Additive:** `const add = THREE.AnimationUtils.makeClipAdditive(clip.clone())` (it mutates the clip and sets `blendMode = AdditiveAnimationBlendMode`). Then `mixer.clipAction(add).play()`, with the weight as the intensity.

### R5. Retarget a clip to a different skeleton

```ts
const clip = SkeletonUtils.retargetClip(targetSkinnedMesh, sourceSkeletonOrMesh, sourceClip, {
  hip: 'mixamorigHips',                      // SOURCE hip bone name
  names: { Hips: 'mixamorigHips', Spine: 'mixamorigSpine' /* target → source, every bone */ },
  scale: 1 / targetRoot.scale.y,             // when the target is scaled (e.g. 0.01 FBX)
  // localOffsets: { LeftArm: rotMatrix }    // fixes differing bind orientations (A-pose vs T-pose)
});
const mixer = new THREE.AnimationMixer(targetSkinnedMesh);   // bind to the SkinnedMesh, not its parent (output tracks are relative to it)
```

Retargeting at runtime is fine for a few clips. For a whole library, **retarget offline** in Blender (Auto-Rig Pro Remap, or the Rokoko add-on) and ship baked clips. VRM has its own path: three-vrm's `loadMixamoAnimation` example maps Mixamo onto normalized humanoid bones.

### R6. Look-at, equipment, hitboxes

```ts
// Additive look-at: call AFTER mixer.update(). It keeps the animation's own head motion.
lookAtAdditive(model, [{ bone: neck, share: 0.4 }, { bone: head, share: 0.6 }], targetWorldPos, 1.0 /*rad clamp*/, weight);
// Rigid gear: parent it to a bone (a socket). Skinned gear (armour): re-skin it onto the body skeleton by bone name.
model.getObjectByName('mixamorigRightHand')!.add(sword);
attachSkinnedEquipment(bodySkinnedMesh, armourSkinnedMesh);    // remaps skinIndex + bind(body.skeleton, body.bindMatrix)
```

Hitboxes: after `mixer.update` and `root.updateMatrixWorld()`, read `bone.getWorldPosition/Quaternion` and run a Rapier `world.intersectionsWithShape(pos, rot, capsule, cb)` **only inside the clip's active window**. Detect the window by checking for a crossing `prevTime < t <= action.time`, since three.js has no animation events. Dedupe hits per swing with a `Set`. Code: `lookAtAdditive`, `attachSkinnedEquipment`, `AnimEvents` and the `updateHitbox` query are all in `references/three-animation-recipes.md`.

### R7. Third-person controller and camera

The flow each frame:
1. Input is relative to camera yaw.
2. The KCC (`computeColliderMovement` → `setNextKinematicTranslation`) runs on a fixed 60 Hz step.
3. The model yaw is damped toward the move direction.
4. `Locomotion.update(dt, horizontalSpeed)` runs.
5. The camera pivot is the character position plus a shoulder offset.
6. A spring arm `castRay`s from the pivot toward the camera, excluding the player collider. It snaps in instantly and eases out with `MathUtils.damp`.

The full tested code (autostep, snap-to-ground, slope limits, pointer-lock orbit, interpolation) is in `references/third-person-controller.md`.

### R8. 2D sprites with equipment (paper doll)

"How do I keep equipped armour in every animation?" Every equipment item is its **own layer, drawn for every frame of every tag**, all on the same canvas and frame grid. Export each layer as a sheet with an **identical layout**:

```bash
for L in body legs_leather torso_iron helmet_iron weapon_back weapon_front; do
  aseprite -b --layer "$L" hero.aseprite --sheet "out/$L.png" --sheet-type rows \
    --data "out/$L.json" --format json-array --list-tags      # NO --trim / --merge-duplicates: they break alignment
done
```

At runtime, choose one of two:
- **(a) Stack sprites** that share one animation clock, setting the same frame index on each layer every tick.
- **(b) Bake a composite** into one `OffscreenCanvas` sheet whenever equipment changes. This gives one sprite and one draw call per character, and is the better choice for many characters.

Z-order flips (a shield behind the body when facing away) are handled by splitting a slot into `_back`/`_front` layers, not per-frame logic. Weapons that swing use a hidden "socket" layer whose marker pixel is read at build time. Phaser, three.js and Godot code is in `references/sprite-paper-doll.md`. The LPC generator is the reference sheet format, but CC-BY-SA/GPL art needs credits.

## Godot quick notes

- AnimationTree: `$AnimationTree["parameters/playback"].travel("Run")` and `set("parameters/Move/blend_position", speed)`. A OneShot fires with `set("parameters/Attack/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)`.
- Root motion: set `root_motion_track` and apply `get_root_motion_position()` in `_physics_process`. Use a single source of truth (either the tree or the `CharacterBody3D` velocity).
- Retarget on import: Skeleton → `BoneMap` with `SkeletonProfileHumanoid`. This makes Mixamo/UAL clips shareable across rigs. Godot 4.4+ adds `RetargetModifier3D`.
- 2D: `AnimationPlayer` can key the `frame` of several `Sprite2D` layers at once. That makes it a native paper doll.
- More, including the 4.6 IK nodes, is in `references/godot-and-ozz.md`.

## Pitfalls the model usually gets wrong

1. **`object.clone()` on skinned models** makes every clone move with the original. Always use `SkeletonUtils.clone`.
2. **Mixamo bone names**: GLTFLoader sanitizes `mixamorig:Hips` to `mixamorigHips` (it strips `[ ] . : /`). Track names in `names` maps and bone lookups must use the sanitized form.
3. **"No target node found for track"** warnings mean the clip doesn't bind, which usually shows up as a T-pose. Treat the warning as a test failure (see Verification).
4. **Mixer order.** The order is `mixer.update` → IK/look-at/procedural → physics hitbox reads → render. Running IK before the mixer gets overwritten.
5. **Root motion plus a KCC** gives double movement. Either use in-place clips (default) or strip XZ from the hips and feed the clip's velocity into the KCC.
6. **Foot sliding** comes from a fixed `timeScale`. Scale walk/run playback by `actualSpeed / clipSpeed`, and clamp it to 0.5–2.
7. **Skinned meshes culled at screen edges.** Bounds come from the bind pose. Set `frustumCulled = false` for heroes. For crowds, compute a padded `boundingSphere` once.
8. **FBX scale 0.01 / cm units** (Mixamo, Rocketbox). Fix it in Blender (apply scale) before GLB export, or pass `scale` to `retargetClip`.
9. **`makeClipAdditive` mutates** its input. Clone first if you also need the normal version.
10. **`crossFadeTo` on a stopped action** does nothing visible. `reset().play()` the target first.
11. **CCDIKSolver targets** must be skeleton bones (indices into `skeleton.bones`). Arbitrary `Object3D`s won't work.
12. **Rapier naming split**: ray hits use `hit.timeOfImpact`, but shape-cast hits use `hit.time_of_impact`. A KCC needs `world.step()` after `setNextKinematicTranslation`.
13. **Ready Player Me** URLs/SDKs no longer work (shut down Jan 31 2026). Don't scaffold new code around them.
14. **Licences**:
    - CC0 (Quaternius, KayKit) and MIT (Rocketbox) are safe.
    - Mixamo is royalty-free inside games, but don't redistribute the raw clips.
    - DeepMotion's free tier is non-commercial.
    - GVHMR (and SMPL-based tools) are research-only.
    - FreeMoCap's app is AGPL. Its exported motion data is yours.
    - LPC sprites need attribution.
15. **Animation clips per clone:** sharing `AnimationClip`s is fine. Sharing an `AnimationAction` or mixer between characters is not.

## Verification (prove it works)

- **Binding check (Playwright):** collect `console.warn` messages while loading. Fail if any contain `No target node found` or `THREE.PropertyBinding`.
- **Pose snapshots:** expose `window.__anim.setTime(clipName, t)`, which does `action.reset().play(); mixer.setTime(t)`. Screenshot frames at t = 0, 0.25, 0.5 of each clip, then compare against goldens or review them visually. A T-pose in any frame is a fail.
- **Foot-slide metric:** while walking at constant speed for 3 s, sample the world positions of the foot bones. During contact frames (foot below hip height × 0.1), horizontal foot speed should be under ~0.05 m/s. Log the max.
- **IK check:** after the solve, `foot.getWorldPosition().distanceTo(target)` should be < 1 mm for reachable targets.
- **Clone independence:** for two clones, `a.skeleton.bones[0] !== b.skeleton.bones[0]`, and their poses differ after different `setTime`.
- **Controller:** scripted input runs (walk into a 0.3 m step, a 40° slope and a wall). Assert the final positions and `computedGrounded()`. The camera arm must stay ≥ 0.3 m and never inside geometry: the ray from pivot to camera has no hit.
- **Paper doll:** the composited sheet for each equipment combo has an identical frame count to `body.json`. Pixel-diff one frame per tag against a golden.
- **Debug overlay:** `SkeletonHelper`, the current state name, action weights and IK targets as spheres (see `game-debug-tools`).

## Install instead of reinventing

- `CloudAI-X/threejs-skills` → `threejs-animation` (mixer basics; MIT, ~3.7k★).
- `majidmanzarpour/threejs-game-skills` → `threejs-3d-generator` (Tripo rig/animate flow), `threejs-gameplay-systems` (camera/controller); MIT, ~2.6k★.
- three.js examples: `webgl_animation_skinning_blending`, `…_additive_blending`, `…_ik`, `webgpu_animation_retargeting`, `physics_rapier_character_controller`, `webgpu_skinning_instancing_individual`, `games_fps`.
- `@three.ez/instanced-mesh` (InstancedMesh2: `initSkeleton`/`setBonesAt` skinned instancing, LOD, BVH; MIT, ~460★).
- `pixiv/three-vrm` (MIT, ~2.2k★), `guillaumeblanc/ozz-animation` (MIT), `ahujasid/blender-mcp` (MIT).
- Godot: `jame581/GodotPrompter`, `htdt/godogen`. Catalog: `gamedev-skills/awesome-gamedev-agent-skills`.
