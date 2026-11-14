# Godot 4 and Unity 6 equivalents (brief)

## Godot 4.6 / 4.7

| Need | Godot tool |
|---|---|
| Profile | Debugger → **Profiler** (script/physics frame time), **Visual Profiler** (CPU/GPU per render pass), **Monitors** (draw calls, objects, VRAM). In code: `RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)` and `Performance.get_monitor(Performance.TIME_FPS)` |
| Overlay | `get_viewport().debug_draw = Viewport.DEBUG_DRAW_OVERDRAW` (also `_WIREFRAME`, `_UNSHADED`) |
| Instancing | `MultiMeshInstance3D` (+ the scatter tool in the editor). GPUParticles for VFX |
| Mesh LOD | **Automatic on import** (meshoptimizer-based, enabled by default for meshes). Tune with `ProjectSettings rendering/mesh_lod/lod_change/threshold_pixels` and per-instance `lod_bias` |
| HLOD / impostor swap | **Visibility ranges** on GeometryInstance3D (`visibility_range_begin/end`, `fade_mode` Self/Dependencies) to swap a detailed node for a merged or impostor node |
| Occlusion culling | `OccluderInstance3D` + bake (Project Settings → Rendering → Occlusion Culling → enable) |
| Shader hitches | 4.4+ **ubershaders + pipeline pre-compilation** remove most first-use stutter. Still warm up rare materials during loading |
| Resolution scaling | `rendering/scaling_3d/mode` (bilinear, FSR 1, FSR 2.2) + `scaling_3d/scale` |
| Physics | Jolt is built in (4.4+, default for new 3D projects in 4.6). Use simple collision shapes, not trimesh, for moving bodies |
| Web export | Uses the **Compatibility (WebGL2) renderer**: no Forward+ features, a smaller budget, and a big wasm/pck download. Budget it like mobile web |
| Terrain | Terrain3D (TokisanGames) has clipmap LOD built in. See `game-world-generation` |

Godot verification: run with `--print-fps`, or log monitors from a script into `user://bench.csv` along a fixed camera path. Compare before and after.

## Unity 6 (6000.x)

| Need | Unity tool |
|---|---|
| Profile | **Profiler** (CPU/GPU/Memory modules), **Frame Debugger** (per-draw state), **Memory Profiler** package, Rendering Debugger |
| Draw calls | **SRP Batcher** (default URP/HDRP), **GPU Resident Drawer** (BatchRendererGroup-based automatic instancing, Forward+), static batching, GPU instancing |
| Culling | **GPU occlusion culling** (with GPU Resident Drawer), classic baked Umbra occlusion |
| LOD | **Mesh LOD** (6.2+): auto-generated at import, stored in the mesh's index buffer, chosen by screen size, less memory than LOD Group. Don't combine it with LOD Group. Skinned meshes still deform LOD0. **LOD Group** for material swaps and cross-fades |
| Resolution | URP Render Scale + **STP** (Spatial-Temporal Post-processing) upscaler, FSR, Dynamic Resolution |
| Shader hitches | `ShaderVariantCollection.WarmUp`, strip variants, PSO pre-warm (`GraphicsStateCollection` in Unity 6; check docs) |
| Web | Unity Web (WebGL2; WebGPU backend in progress, check status). Brotli compression. Budget like mobile web |
| Crowds | GPU Resident Drawer skips SkinnedMeshRenderer. Use VAT (OpenVAT Unity tools, MIT) or Entities-based animation |
