# Godot 4 animation notes + ozz-animation (C++/WASM)

## Godot 4.6 / 4.7

### AnimationTree essentials (GDScript)

```gdscript
@onready var tree: AnimationTree = $AnimationTree
@onready var sm: AnimationNodeStateMachinePlayback = tree["parameters/playback"]

func _physics_process(delta: float) -> void:
	var hspeed := Vector2(velocity.x, velocity.z).length()
	tree.set("parameters/Locomotion/blend_position", hspeed)          # BlendSpace1D inside the state machine
	tree.set("parameters/conditions/airborne", not is_on_floor())    # transition condition
	if Input.is_action_just_pressed("attack"):
		tree.set("parameters/Attack/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)  # OneShot (with upper-body filter)
	if Input.is_action_just_pressed("roll"):
		sm.travel("Roll")                                             # pathfinds through the state graph
```

- **Layering:** a `BlendTree` with `OneShot` or `Blend2` nodes. Enable **filters** on the node and tick the upper-body bones. That's Godot's avatar mask.
- **Additive:** `Add2`/`Add3` nodes. Author the additive clips relative to a reference pose.
- **Root motion:**
  1. Set `root_motion_track` to the hips (`Skeleton3D:Hips`).
  2. Each physics tick, rotate `tree.get_root_motion_position()` by the character basis, divide by delta, and assign it to `velocity`.
  3. Call `move_and_slide()`.

  Pick one source of truth per state.
- **Manual update for determinism:** set `callback_mode_process = ANIMATION_CALLBACK_MODE_PROCESS_MANUAL` and call `tree.advance(delta)` from your fixed step.
- **Retargeting on import:** Advanced Import → Skeleton3D → Retarget → `BoneMap` with `SkeletonProfileHumanoid`, and enable "Rename Bones". Mixamo, UAL and Rocketbox clips then share one library. Since 4.4, `RetargetModifier3D` keeps the original bone rests.

### SkeletonModifier3D stack (runs after animation, in child order)

| Node | Since | Use |
|---|---|---|
| `LookAtModifier3D` | 4.4 | Head/eye tracking with angle limits (1-bone IK) |
| `SpringBoneSimulator3D` | 4.4/4.5 | Hair, tails, cloth strips (VRM-style spring bones) |
| `BoneConstraint3D` → `AimModifier3D`, `CopyTransformModifier3D`, `ConvertTransformModifier3D` | 4.5 | Rig constraints. They can reference `Node3D`s in 4.6 |
| `IKModifier3D` → `TwoBoneIK3D`, `ChainIK3D` → `SplineIK3D`, `FABRIK3D`, `CCDIK3D`, `JacobianIK3D` | **4.6** | IK is back (removed in 4.0). Use TwoBone for legs/arms, FABRIK/CCD for tails, Spline for spines |
| `BoneTwistDisperser3D`, `LimitAngularVelocityModifier3D` | 4.6 | Post-IK refinement (twist distribution, jitter limits) |

- **Foot IK in 4.6:** for each foot, raycast down (`PhysicsDirectSpaceState3D.intersect_ray`) and move a `Marker3D` target there. Add a `TwoBoneIK3D` per leg, and offset the hips by the lower foot. Check the docs for property names, because these nodes are new.
- **Equipment:** set a skinned armour `MeshInstance3D`'s `skeleton` to the body `Skeleton3D`; the armour must share bone names. For rigid gear, use `BoneAttachment3D`.
- **2D:** `AnimatedSprite2D` for single sprites. For a paper doll, use `AnimationPlayer` + `Sprite2D` layers (see `sprite-paper-doll.md`). `Skeleton2D` + `Bone2D` do cut-out rigs.
- **Prompt packs:** `jame581/GodotPrompter`, `htdt/godogen`.

## Unity 6 (brief)

- **Locomotion:** Animator with Blend Trees, Avatar Masks for layers, Humanoid retargeting (Mixamo → Humanoid rig), and **Animation Rigging** package constraints (TwoBoneIK, MultiAim) for IK.
- **Crowds:** the GPU Resident Drawer doesn't do skinned meshes. Use VAT (OpenVAT ships Unity tools under MIT) or DOTS-based animation solutions.

## ozz-animation (guillaumeblanc/ozz-animation)

- **Facts:** MIT, ~2.9k★, v0.17.0. C++17, data-oriented SoA SIMD, no engine dependencies, tested on WebAssembly.
- **Offline toolchain:** converts glTF/FBX into `.ozz` skeleton and animation archives. `gltf2ozz` is the glTF importer; FBX needs the FBX SDK.
- **18 browser-runnable samples:** playback, attachment, blending, partial blending, additive, baked physics, user channels, motion extraction/playback/blending, keyframe reduction, two-bone IK, look-at, foot IK, skinning, multithreading.

### When to use it
- You're building a **custom C++ or WebGPU engine**: The Forge, a native app, or a WASM core with JS rendering. You need deterministic, fast sampling for **hundreds of skeletons**, or server-side animation for hit validation.
- Not for: a normal three.js game with fewer than ~100–200 characters. `AnimationMixer` plus instancing is simpler. Godot and Unity have their own systems.

### WASM integration sketch (check docs for exact signatures)

1. **Build:** `emcmake cmake -B build -Dozz_build_samples=OFF -Dozz_build_tests=OFF -Dozz_build_howtos=OFF -Dozz_build_fbx=OFF && cmake --build build`. Link `ozz_animation` and `ozz_base` into your own embind module.
2. **Load:** fetch the `.ozz` bytes in JS, copy them into the WASM heap, then `ozz::io::MemoryStream` → `ozz::io::IArchive` → `archive >> skeleton` / `archive >> animation`.
3. **Per character per frame:**
   - `SamplingJob` (with a `SamplingJob::Context`) → SoA local transforms;
   - optionally `BlendingJob` (layers with per-joint weights) and `TwoBoneIKJob` / `AimIKJob`;
   - `LocalToModelJob` → model-space `float4x4[]`;
   - multiply by the inverse bind matrices, then write into a Float32Array view of the WASM heap.
4. **Render (three.js):** upload the palette per instance into a `DataTexture` or WebGPU storage buffer, and skin in the vertex shader. In TSL, follow the `webgpu_skinning_instancing_individual` pattern, which reads bone matrices from a storage buffer.
5. **Data:** use the Quaternius UAL rig. The ozz 0.17 samples already ship converted UAL data, so you can validate your build against them.

### Verification
- Compare model-space joint positions from ozz and from three.js `AnimationMixer` at the same clip times. The max error should be under 1 mm after unit conversion.
- Benchmark the time per 100 skeletons per frame in JS versus WASM.
