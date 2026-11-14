# Godot 4 and Unity 6 particle notes

## Godot 4: GPUParticles3D
**Nodes:**
- `GPUParticles3D` (GPU, the default). Behaviour lives in a `ParticleProcessMaterial` or a `shader_type particles;` shader. Its look comes from `draw_pass_1` (a mesh, usually `QuadMesh`) and that mesh's material.
- `CPUParticles3D`: same features, runs on the CPU. Use it on very old GPUs or when you need per-particle reads. Convert with the menu GPUParticles3D → Convert to CPUParticles3D.
- 2D: `GPUParticles2D` / `CPUParticles2D`.

**Properties that matter:**
- Emission and amount:
  - `amount`: pool size.
  - `amount_ratio`: scale emission at runtime without restarting, e.g. for quality settings.
  - `lifetime`.
  - `one_shot`.
  - `explosiveness`: 1 means a burst.
  - `randomness`.
  - `preprocess`: start already "full", for ambient fire.
  - `speed_scale`: set it to 0 for hit-stop on just this effect.
- Simulation rate:
  - `fixed_fps`: the default 30 is cheap, smoothed by `interpolate`. Collision accuracy depends on it; raise it to 60 for fast colliding particles.
  - `fract_delta`.
- `local_coords`: off means particles stay in world space when the node moves.
- **`visibility_aabb`**: particles, and their collisions, are culled outside it. Use GPUParticles3D → Generate Visibility AABB after editing an effect, or particles pop out when the emitter leaves the screen.
- `draw_order` (Index, Lifetime, Reverse Lifetime, View Depth).
- `trail_enabled` + `trail_lifetime`.
- `sub_emitter`.
- `collision_base_size`.

**ParticleProcessMaterial groups:**
- Emission shape: point, sphere (surface), box, ring, points from a mesh. Use "Create Emission Points from Node" for mesh surfaces.
- Motion: direction/spread, initial velocity, gravity, damping, orbit, radial accel, tangential accel.
- Over life: scale curve, colour ramp + initial colour ramp, hue variation.
- Turbulence: 3D noise. The docs warn it has a "high performance cost on the GPU", so use it on a few systems, not all.
- Animation: flipbook speed and offset.
- Collision mode: Rigid (bounce/friction) or Hide On Contact.
- Sub-emitter mode: Constant / At End / At Collision, with `Amount At End` / `Amount At Collision`.
- Attractor interaction.

**Flipbooks:**
1. On the draw-pass material (`StandardMaterial3D`), set `billboard_mode = Particle Billboard`. This unlocks `particles_anim_h_frames` / `v_frames` / `loop`.
2. Then `anim_speed` on the process material: 1 = the whole sheet over the lifetime.
3. Add `anim_offset` randomness so neighbours differ.

Soft particles: `proximity_fade_enabled` + `proximity_fade_distance` on the `StandardMaterial3D`. Additive: `blend_mode = Add`, and `shading_mode = Unshaded` for energy effects.

**Collision and forces (nodes in the scene):**
- `GPUParticlesCollisionSphere3D` / `Box3D`: cheap, for moving objects.
- `GPUParticlesCollisionHeightField3D`: real-time, for terrain and outdoor scenes. Set `follow_camera_enabled` for big worlds and choose the `update_mode`.
- `GPUParticlesCollisionSDF3D`: baked, for complex static interiors. It is **Forward+ / Mobile only**.
- Attractors: `GPUParticlesAttractorSphere3D` / `Box3D` / `VectorField3D` (vortex, suction). Particles react only if attractor interaction is enabled.
- Collision does not happen outside the Visibility AABB.

**Trails:**
1. Set `trail_enabled = true`.
2. Set draw pass 1 to `RibbonTrailMesh` (flat) or `TubeTrailMesh`.
3. In the material, enable `use_particle_trails`.

Trails are **Forward+ / Mobile only, not Compatibility**.

**Renderers and the web:**
- Godot 4 web export uses the **Compatibility** renderer (WebGL2). GPUParticles run there, but trails and SDF collision don't.
- Design web-bound effects without them: use a ribbon mesh you update yourself, or a stretched billboard (`particle_flag_align_y` + velocity stretching in a particles shader).
- Always test the effect in a web export, not only in the editor's Forward+ viewport.

**Pooling one-shot effects (GDScript):**
```gdscript
# vfx_pool.gd — autoload. Effect scene root = GPUParticles3D with one_shot = true, emitting = false.
extends Node3D
@export var effect_scene: PackedScene
@export var size := 8
var _pool: Array[GPUParticles3D] = []
var _next := 0

func _ready() -> void:
	for i in size:
		var p := effect_scene.instantiate() as GPUParticles3D
		p.one_shot = true
		p.emitting = false
		add_child(p)
		_pool.append(p)

func play(at: Vector3) -> void:
	var p := _pool[_next]
	_next = (_next + 1) % _pool.size()   # round-robin: a still-playing instance gets cut, never allocated
	p.global_position = at
	p.restart()                          # clears and re-emits; listen to `finished` if you need a callback
```
- Composite effects (flash + sparks + smoke + debris): make one scene with several child `GPUParticles3D` nodes and restart all of them.
- Pre-warm at level load by playing every effect once off-screen. Godot compiles particle and material shaders on first use, and its ubershader and pipeline cache reduce but don't remove the stutter.
- **Hit-stop:** `Engine.time_scale = 0.0`, then `get_tree().create_timer(0.06, true, false, true).timeout` (`ignore_time_scale = true`) to restore it. For selective freezes, use `speed_scale = 0` on the effects.

**Effekseer in Godot:**
- EffekseerForGodot4 (MIT, about 114★). It is a GDExtension; 1.80.2+ requires Godot 4.6+ and supports web export.
- Use the `EffekseerEmitter3D` / `EffekseerEmitter2D` nodes (node names from the plugin docs (unverified)).
- In 2D, soft particles and depth features don't work.

**kanaworks in Godot:**
- The addon gives `SakugaFlipbook2D.spawn(res, parent, pos)` and `SakugaFlipbook3D.spawn(res, parent, pos)`.
- Each `.tres` is a normal `SpriteFrames` (Godot 4.3+).

**Godot's own references:** the docs section "3D particles" (properties, process material, subemitters, trails, turbulence, attractors, collision, complex shapes). They are short and accurate; read them before tuning.

## Unity 6
| | Shuriken (`ParticleSystem`) | VFX Graph (`VisualEffect`) |
|---|---|---|
| Runs on | CPU sim, every platform including **WebGL** | GPU compute: **not WebGL**; web only through the WebGPU build target (production in Unity 6.6) |
| Scale | Hundreds to a few thousand per system | 100k–millions |
| Gameplay reads | Yes: `GetParticles`, collision callbacks (`OnParticleCollision`), triggers | No CPU readback. GPU events stay on the GPU |
| Authoring | Inspector modules | Node graph, Shader Graph outputs |
| Use for | Mobile/WebGL, gameplay-coupled effects, small counts | Big ambient/weather, swarms, hero effects on desktop/console |

**Shuriken essentials:**
- Modules: Main (`stopAction = Callback` or `Disable` for pooling), Emission bursts, Shape, Velocity/Force/Size/Color over Lifetime, Noise, Collision (World or Planes), Sub Emitters (Birth/Collision/Death), Texture Sheet Animation (flipbooks), Trails, Renderer (Billboard / Stretched / Mesh; sorting).
- Play with `ps.Play()`, burst with `ps.Emit(count)`, or `ps.Emit(emitParams, count)` for one-off positions without moving the system.

**VFX Graph essentials:**
- Contexts: Spawn → Initialize → Update → Output.
- Trigger from C#:
  - `vfx.SendEvent("OnPlay")`.
  - Or, with data: `var a = vfx.CreateVFXEventAttribute(); a.SetVector3("position", p); vfx.SendEvent("Hit", a);`.
  - Exposed properties via `vfx.SetFloat/SetVector3/SetTexture`.
- GPU Events (Trigger Event On Die / Rate / Always) give sub-emitters.
- "Collide with Depth Buffer" gives cheap screen-space collision.
- Particle Strips give trails/ribbons.
- "Sample Signed Distance Field" gives mesh-shaped effects, with the SDF Bake Tool.
- Flipbook Player block.
- Bounds: set them explicitly or record them. Wrong bounds cull the effect, as Godot's AABB does.
- **WebGPU on the web (Unity 6.6) limits** (from Unity's WebGPU limitations page): no RWBuffer, no async compute, no synchronous GPU readback.
  - Test every VFX Graph on the web build target. Keep a Shuriken fallback for WebGL2 users.

**Pooling:** `ObjectPool<ParticleSystem>` (`UnityEngine.Pool`) with `stopAction = Callback` returning to the pool in `OnParticleSystemStopped()`.

**Hit-stop:** `Time.timeScale = 0` + `WaitForSecondsRealtime`. Particle systems follow scaled time unless `main.useUnscaledTime` is set. **Shake:** Cinemachine Impulse Source/Listener.

**Effekseer in Unity:**
- EffekseerForUnity (UPM git URL `https://github.com/effekseer/EffekseerForUnity_Release.git?path=Assets/Effekseer`; licence not verified on the release repo; the Effekseer core is MIT).
- Use the `EffekseerEmitter` component, or play from script through `EffekseerSystem` (exact method names unverified; check the package's docs).

**kanaworks in Unity:**
- Unity 6 URP package. `SakugaFlipbook.Spawn(prefab, pos, rot)`, or `M_<id>_Particles.mat` with Texture Sheet Animation set to the sheet's grid.
- Same licence: under USD 1M revenue, credit required.
