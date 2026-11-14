---
name: game-materials-shaders
description: "Load when a game's surfaces, lighting or image need work. Covers PBR materials and textures (Poly Haven, ambientCG), HDRI lighting, colour management and tone mapping, and custom shaders (TSL node materials on WebGPURenderer, or GLSL on WebGLRenderer). Techniques: terrain splatting and triplanar, toon shading and outlines, water, grass wind, sky, fog, clouds and decals. Post-processing: bloom, AO, SSR, LUT grading. Also load when a scene looks flat, washed out, plasticky or too dark, or a shader won't compile."
---

# Game materials, shaders and post

Default stack: three.js r187 (released 2026-10-30), Vite, TS, and `WebGPURenderer` with TSL. Every snippet here was type-checked against `@types/three@0.187`. The TSL snippets were also compiled and rendered in headless Chrome on the WebGL2 fallback backend.
Related skills: `game-particles-vfx` (VFX), `game-asset-pipeline` (where assets come from), `game-performance-optimization` (KTX2, draw calls), `game-art-review` (visual critique loop), `game-world-generation` (terrain shapes).

## 1. First decision: which shader path

| Situation | Pick | Why | Not when |
|---|---|---|---|
| New three.js game | `WebGPURenderer` from `three/webgpu` + TSL node materials | One shader source compiles to WGSL (WebGPU) **and** GLSL (it auto-falls back to WebGL2). Compute, MRT post, `RenderPipeline`. All new three features land here. | You depend on a WebGL-only lib: three.quarks, pmndrs/postprocessing, N8AO, three.meshline, `Water`/`Sky` (non-Mesh variants), Effekseer (WebGL build). |
| Existing WebGL game | `WebGLRenderer` + `onBeforeCompile` patches or `three-custom-shader-material` (CSM). Use `ShaderMaterial` only for fully custom looks. | Keeps the stock PBR, shadow and fog chunks and the whole WebGL ecosystem. | You need compute particles or GPU-driven anything. |
| WebGL game, but you want one TSL material | `renderer.setNodesHandler(new WebGLNodesHandler())` (`three/addons/tsl/WebGLNodesHandler.js`, new in r18x) | Lets you migrate gradually. | It has no MRT, no VSM, no transmission, no storage textures, and no WebGPU post stack (see the header comment of that file). |
| Godot 4 | `.gdshader` (spatial/canvas_item) or VisualShader. Use `StandardMaterial3D` for plain PBR. | Built-in triplanar, Decal node, FogVolume, sky shaders. | |
| Unity 6 | URP + Shader Graph. Use the URP Decal Projector, Volume post, and Lit/Simple Lit. | Fastest path. HDRP only for desktop showpieces. | WebGL builds: keep shaders simple. WebGPU is supported from Unity 6.6. |

Don't mix the two families: `WebGPURenderer` cannot render `ShaderMaterial`/`RawShaderMaterial` or `onBeforeCompile`. Port to TSL instead.

## 2. When to use what (techniques)

| Problem | three.js WebGPU (TSL) | three.js WebGL | Godot 4 | Unity 6 URP | Don't use when |
|---|---|---|---|---|---|
| Realistic surfaces | `MeshStandardNodeMaterial` + CC0 scans | `MeshStandardMaterial` | StandardMaterial3D | Lit | Stylised game: use toon or unlit + baked AO instead |
| Ambient lighting | `scene.environment = HDRI` (Poly Haven) | same | WorldEnvironment + Sky | Skybox + APV/probes | Indoor scene lit by a sunny outdoor HDRI: wrong colour |
| Sky + time of day | `SkyMesh` (has clouds since r18x). For physically based Hillaire: `@pmndrs/sky` | `Sky` (addons) | ProceduralSkyMaterial / PhysicalSkyMaterial | Skybox/Procedural | Static scene: an HDRI looks better and is cheaper |
| Cliffs and meshes without UVs | `triplanarTexture()` | GLSL triplanar (references) | `uv1_triplanar` checkbox | Shader Graph Triplanar node | Flat ground: 3× texture cost for nothing |
| Terrain blending | splat RGBA, or texture array + index map | same in GLSL `sampler2DArray` | Terrain3D (32 layers) | Terrain layers | More than 4 layers with plain splats: use arrays |
| Toon / cel | `MeshToonNodeMaterial` + `toonOutlinePass` | `MeshToonMaterial` + `OutlineEffect` | shader + inverted hull | Shader Graph + Renderer Feature | Combined with photoreal PBR props: pick one style |
| Water | `WaterMesh` (ocean-ish), `Water2Mesh.js` (flow/river) | `Water`, `Water2` | custom shader / GodotOceanWaves (FFT) | URP water package / custom | Hero ocean: FFT (see references/water-sky-fog.md) |
| Grass / foliage | InstancedMesh + `positionNode` wind | `onBeforeCompile` wind | MultiMesh + shader | VFX Graph / instancing | Under ~500 blades: just meshes |
| Fog | `scene.fogNode = fog(color, exponentialHeightFogFactor(...))` | `scene.fog` (+ chunk patch for height) | Environment fog + FogVolume | Volume fog / URP fog | |
| Decals | `DecalGeometry` (any renderer) | `DecalGeometry` | `Decal` node | URP Decal Projector | Hundreds per frame: pool them or bake into a texture |
| AO | GTAO `ao()` + `builtinAOContext` + TRAA | N8AO (`N8AOPostPass`) | SSAO checkbox | SSAO Renderer Feature | Low-end mobile: bake AO into textures |
| Bloom | `bloom()` on an emissive MRT target | pmndrs `BloomEffect` (mipmapBlur) | Glow | Volume Bloom | Everything blooming: threshold on emissive only |
| Reflections | env map → `reflector()` planar → `ssr()` | `Reflector`, `SSRPass` | ReflectionProbe, SSR | Reflection probes, SSR (HDRP) | SSR on rough surfaces: costs a lot for no gain |
| Colour grade | `lut3D()` after `renderOutput()` | `LUT3DEffect` | Environment adjustments + LUT | Volume Color Lookup | |

## 3. Baseline: colour, tone mapping, PBR, HDRI (WebGPU)

```ts
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'; // RGBELoader is deprecated since r180

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();                          // before compute(), getMaxAnisotropy(), KTX2 detectSupport()
renderer.toneMapping = THREE.AgXToneMapping;    // or ACESFilmic (punchy) / Neutral (product-true)
// outputColorSpace is already SRGBColorSpace: never "fix" brightness by changing it.

const env = await new HDRLoader().loadAsync('/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr');
env.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = env;  scene.background = env;   // PMREM is generated for you
scene.environmentIntensity = 1; scene.backgroundBlurriness = 0;

const tl = new THREE.TextureLoader(), aniso = renderer.getMaxAnisotropy();
const tex = (url: string, isColor: boolean, rep = 1) => {
  const t = tl.load(url);
  t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace; // only albedo and emissive are sRGB
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = aniso;
  return t;
};
const id = 'rocky_terrain_02';                  // Poly Haven ids; "arm" = R:AO G:rough B:metal = three's slots
const arm = tex(`/tex/${id}_arm_2k.jpg`, false, 8);
const mat = new THREE.MeshStandardMaterial({
  map: tex(`/tex/${id}_diff_2k.jpg`, true, 8),
  normalMap: tex(`/tex/${id}_nor_gl_2k.jpg`, false, 8),  // _gl. For DirectX normals: mat.normalScale.y = -1
  aoMap: arm, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1,
});
```
GLTFLoader sets colour spaces itself, so don't touch textures that come out of a glTF. `aoMap` no longer needs `uv2` (r151+ uses `texture.channel`, default 0).

## 4. Texture and HDRI sources (all CC0)

| Source | API | Terms that matter |
|---|---|---|
| Poly Haven: HDRIs, textures, models | `GET https://api.polyhaven.com/assets?t=hdris&c=skies`, `GET /files/{id}`. Textures: `Diffuse/nor_gl/arm/Rough/AO/Displacement → 1k..8k → jpg/png/exr → {url,md5,size}`. HDRIs: `hdri → 1k..16k → hdr/exr`. | Assets are CC0. The **API** is free, including commercial use, but needs a unique `User-Agent` and a visible "Powered by Poly Haven" credit wherever you surface it live. Downloading at build time and self-hosting needs no credit. |
| ambientCG: materials, HDRIs, decals | `GET https://ambientCG.com/api/v3/assets?type=material&q=sand&include=downloads` → `downloads[].attributes` such as `2K-JPG` → zip | CC0, attribution appreciated. Use the `NormalGL` map (typical zip naming: `_Color`, `_NormalGL`, `_Roughness`, `_AmbientOcclusion`, `_Displacement`; check the zip). |

Fetch at build time (`tools/fetch-textures.ts`, Node 22 `fetch` with a `User-Agent` header), write to `public/tex/`, add a `CREDITS.md` row, then compress to KTX2 (`game-performance-optimization`). Script in `references/textures-and-tools.md`.

## 5. TSL recipes (WebGPURenderer)

```ts
import { texture, uv, float, vec3, color, uniform, time, sin, positionLocal, positionWorld, normalWorld,
  triplanarTexture, mix, smoothstep, fog, exponentialHeightFogFactor, toonOutlinePass,
  mx_fractal_noise_float, instanceIndex, hash } from 'three/tsl';

// Triplanar: rocks, caves, marching-cubes/voxel meshes without UVs
cliff.colorNode = triplanarTexture(texture(rock), null, null, float(0.25), positionWorld, normalWorld);

// Splat map: RGBA weights → 4 tiled layers
const w = texture(splat, uv()), tuv = uv().mul(48), sum = w.r.add(w.g).add(w.b).add(w.a).max(1e-4);
terrain.colorNode = texture(grass, tuv).rgb.mul(w.r).add(texture(dirt, tuv).rgb.mul(w.g))
  .add(texture(rock, tuv).rgb.mul(w.b)).add(texture(snow, tuv).rgb.mul(w.a)).div(sum);

// Texture array (DataArrayTexture / KTX2 array): pick a layer
arrMat.colorNode = texture(layers, uv()).depth(uniform(2));

// Grass wind on an InstancedMesh: positionLocal already includes the instance matrix here
const gust = mx_fractal_noise_float(positionLocal.xz.mul(0.05).add(time.mul(0.1)), 2).mul(0.5).add(0.5);
const sway = sin(time.mul(1.6).add(positionLocal.x.mul(0.6)).add(positionLocal.z.mul(0.4)).add(hash(instanceIndex).mul(6.28)));
const bend = uv().y.pow(2).mul(0.35).mul(gust);                 // blade root (uv.y=0) stays planted
grassMat.positionNode = positionLocal.add(vec3(sway.mul(bend), 0, sway.mul(bend).mul(0.4)));

// Height fog. Factor = 1-exp(-(density*(height-y)*viewZ)^2): keep both small and tune live
scene.fogNode = fog(color(0xbfd4e6), exponentialHeightFogFactor(uniform(0.01), uniform(3)));

// Toon: a 3-texel ramp (DataTexture defaults to NearestFilter = hard bands) + outline post
const ramp = new THREE.DataTexture(new Uint8Array([40, 120, 255]), 3, 1, THREE.RedFormat); ramp.needsUpdate = true;
const toon = new THREE.MeshToonNodeMaterial({ color: 0xff8844, gradientMap: ramp });
pipeline.outputNode = toonOutlinePass(scene, camera, new THREE.Color(0x111111), 0.003, 1);

// Dissolve (death/spawn): noise vs threshold, with a glowing edge
const d = uniform(0), n = mx_fractal_noise_float(positionLocal.mul(3), 3).mul(0.5).add(0.5);
dm.opacityNode = n; dm.alphaTestNode = d;
dm.emissiveNode = color(0xff5500).mul(smoothstep(d, d.add(0.06), n).oneMinus()).mul(4);
```
More recipes (height-blended splats, triplanar normals, inverted-hull outlines, rim light, decals, sky/water setup) are in `references/tsl-recipes.md` and `references/water-sky-fog.md`.

## 6. GLSL path (WebGLRenderer)

- **Patch, don't replace.** `onBeforeCompile` + `shader.vertexShader.replace('#include <begin_vertex>', ...)` keeps the PBR, shadow and fog code. Set `customProgramCacheKey` whenever the patch varies. Full example in `references/glsl-recipes.md`.
- **CSM** (`npm i three-custom-shader-material`, MIT): `new CustomShaderMaterial({ baseMaterial: THREE.MeshPhysicalMaterial, vertexShader, fragmentShader, uniforms })` from `three-custom-shader-material/vanilla`. Write `csm_Position`, `csm_DiffuseColor`, `csm_Roughness`, `csm_Emissive`. WebGL only.
- `ShaderMaterial` is always GLSL ES 3.00 on WebGL2, so `sampler2DArray` and `texture()` work without `glslVersion`. Leave `glslVersion` unset, write to `gl_FragColor`, and end with `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`, or the material looks wrong next to stock ones. With `GLSL3` set, three stops defining `gl_FragColor`.

## 7. Post-processing

**WebGPU (built in, r183+ `THREE.RenderPipeline`; `PostProcessing` is the deprecated name):**
```ts
import { pass, mrt, output, emissive, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, emissive: vec4(emissive, output.a) }));     // bloom only what glows
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = scenePass.getTextureNode('output').add(bloom(scenePass.getTextureNode('emissive'), 0.8, 0.4));
renderer.setAnimationLoop(() => pipeline.render());                       // not renderer.render()
```
Available in `three/addons/tsl/display/`: GTAO `ao`, `ssao`, `ssr`, `ssgi`, `traa`, `taau`, `fxaa`, `smaa`, `dof`, `motionBlur`, `outline`, `godrays`, `lensflare`, `lut3D`, `chromaticAberration`, `film`, `pixelationPass`, `retroPass`, `sobel`, `fsr1`, `sharpen`, and more. The AO, LUT and SSR wiring is in `references/post-processing.md`.

**WebGL:** `npm i postprocessing n8ao` (pmndrs, Zlib; N8AO, CC0). Create the renderer with `antialias:false, stencil:false, depth:false`, and the composer with `{ frameBufferType: HalfFloatType }`. Keep `renderer.toneMapping = NoToneMapping` and add `ToneMappingEffect({ mode: ToneMappingMode.AGX })` last. Order: `RenderPass` → `N8AOPostPass` → `EffectPass(Bloom, ToneMapping, LUT3D, SMAA)`. **postprocessing 6.39.5 declares `three < 0.187`**, so pin three 0.186.x or install with `--legacy-peer-deps` and test. N8AO ships no TS types: add `declare module 'n8ao'`.

## 8. Procedural and AI texture tools

| Tool | Licence/cost | Use for | Notes |
|---|---|---|---|
| Material Maker (RodZill4/material-maker, 6.0k★) | MIT, free | Node-based procedural PBR, Substance Designer-style; v1.4 (Oct 2025) runs on Godot 4 | Export to Godot `.tres`, Unity `.mat`, Unreal, or PNG/EXR (choose the "Blender" target for OpenGL normals). Command-line export exists ("check docs"). |
| ArmorPaint 1.0 (Sep 2026) | Source zlib; $19 binaries | Painting on meshes, layers, local AI nodes (text-to-image, image-to-PBR) | Free if you compile it yourself |
| Adobe Substance 3D Designer/Painter/Sampler | **Commercial subscription** | Industry standard | Its outputs are yours; the tools are not free |
| InstaMAT | Commercial, with a free tier (terms unverified) | Substance-like layering and graphs | Check the current licence |
| DeepBump (HugoTini, 1.4k★) | GPL-3.0 tool; your outputs are not GPL | Normal and height maps from a single photo, as a Blender addon or CLI | |
| Ubisoft CHORD + ComfyUI-Chord | **Research-only licence** | Image → base colour, normal, height, roughness, metalness | Prototyping only. Do not ship its outputs commercially without legal review |
| Code (TSL `mx_noise_float`, `mx_worley_noise_float`, `mx_fractal_noise_float`) | MIT | Procedural albedo/roughness variation, macro-variation to break up tiling | The cheapest "AI texture": noise driving `mix()` between two CC0 scans |

The workflow the best demos use: CC0 photoscan base + procedural macro variation in the shader + decals. AI-generated albedo goes through DeepBump or Material Maker for normals, then onto KTX2.

## 9. Pitfalls Claude typically gets wrong

1. **Colour space.** Normal, roughness, AO and metal maps tagged `SRGBColorSpace` make the surface look washed out or too shiny. Albedo left as `NoColorSpace` looks too bright and desaturated. Never set `outputColorSpace = LinearSRGBColorSpace` to "fix" this.
2. **Brightness with tone mapping.** AgX and ACES darken and desaturate. Raise light intensities (physical units: sun 2–5, HDRI `environmentIntensity`) instead of turning off tone mapping. With pmndrs postprocessing, set renderer tone mapping off and use `ToneMappingEffect`. Doing both tone-maps twice.
3. **Deprecated names in r18x:** `PostProcessing` → `RenderPipeline` (r183); `RGBELoader` → `HDRLoader` (r180); `renderAsync`/`computeAsync`/`detectSupportAsync` → `await renderer.init()`, then the sync calls (r181).
4. **Two `WaterMesh`es.** `objects/WaterMesh.js` (sun-glint ocean, like `Water`) and `objects/Water2Mesh.js` (flow-map river, like `Water2`) **both export `WaterMesh`**. `Water`, `Water2` and `Sky` are WebGL-only, and their `*Mesh` twins are WebGPU-only.
5. **WebGL-only libraries on WebGPURenderer** (three.quarks, postprocessing, N8AO, CSM, three.meshline) fail silently or throw. Check before choosing the renderer.
6. **Fog:** custom `ShaderMaterial`s ignore `scene.fog` unless you include the fog chunks. In TSL, `scene.fogNode` replaces `scene.fog`. Height fog with `height=12, density=0.015` turns the whole screen white: tune in the Inspector.
7. **Normal map conventions:** three, Blender, Godot and Unity use OpenGL (+Y); Unreal and Substance's "DirectX" preset use −Y. Inverted lighting on bumps means a flipped green channel.
8. **Mipmaps and tiling:** a missing `RepeatWrapping` gives stretched edges, and visible repetition needs macro-variation noise or stochastic tiling, not bigger textures. Set `anisotropy = renderer.getMaxAnisotropy()` (after `init()`) on ground textures, or they blur at grazing angles.
9. **Transparent sorting:** water, glass, decals and particles need `depthWrite:false`. Water2Mesh in the example sets `renderOrder = Infinity`.
10. **Licences:** Substance is commercial; CHORD is research-only; Poly Haven API use needs the credit line. CC0 scans need no credit, but keep `CREDITS.md` anyway.

## 10. Shader debugging

- `renderer.inspector = new Inspector()` (`three/addons/inspector/Inspector.js`) gives a live parameters panel. `node.toInspector('Label')` previews any TSL node or post pass as a texture, and also shows timings.
- `debug(node)` from `three/tsl` logs the generated shader around that node. `await renderer.debug.getShaderAsync(scene, camera, mesh)` returns `{ vertexShader, fragmentShader }` (WGSL or GLSL). Grep it when "it compiles but looks wrong".
- Visualise intermediates: temporarily set `mat.colorNode = normalWorld.mul(0.5).add(0.5)`, `vec3(uv(), 0)`, or `vec3(texture(splat).r)`. For GLSL, `gl_FragColor = vec4(vNormal*0.5+0.5, 1.)`.
- Tools: Spector.js (WebGL frame capture, MIT), WebGPU Inspector extension (brendan-duncan/webgpu_inspector, MIT: capture, buffers, live WGSL edit), RenderDoc (native/Godot/Unity). Godot also has the shader error console and `--rendering-driver opengl3` to compare backends.
- WebGL: `renderer.debug.checkShaderErrors = true` in dev (default), `false` in production builds (it is a sync stall).

## 11. Verification (the agent must prove it)

1. **Playwright screenshots** from 3 fixed camera poses (overview, close-up on the material, grazing angle) at noon and at low sun. Compare against a reference image with `game-art-review`. Headless Chrome usually has no WebGPU, and three falls back to WebGL2, which still validates the TSL logic. Use `--enable-unsafe-webgpu` with a real GPU for the WebGPU path.
2. **Numeric checks:** read `renderer.info.render.drawCalls` / `.triangles` inside the loop right after rendering (they reset every frame) and assert they stay under budget. For post, read a 1×1 region (`renderer.readRenderTargetPixelsAsync`) to assert that the sky pixel is not clipped (< 1.0 before tone mapping) and that the shadow side is not pitch black.
3. **Debug views:** a `?debug=normals|uv|ao|splat` URL flag swaps `colorNode` to the views above, so screenshots can prove each channel.
4. **Shader compile:** call `await renderer.compileAsync(scene, camera)` at load and fail the test on any console error that contains "shader".

## 12. Install instead of reinventing

- `dgreenheck/webgpu-claude-skill` (1.3k★, MIT): the TSL/WebGPU reference skill. Install it next to this one.
- `CloudAI-X/threejs-skills` (3.7k★, MIT): `threejs-shaders`, `threejs-textures`, `threejs-postprocessing`.
- `linegel/threejs-complete-set-of-skill` (5★, ISC, quality unverified): ideas for volumetric clouds, spectral ocean, water optics and rain/wet surfaces.
- Libraries: `@pmndrs/sky` (Hillaire sky + IBL + haze, WebGPU, MIT, very new), `@takram/three-atmosphere` / `three-clouds` (Bruneton atmosphere + volumetric clouds, MIT; clouds are WebGL/postprocessing), `three-custom-shader-material` (1.3k★, MIT).
- Reference implementations to read: three.js examples `webgpu_postprocessing_ao`, `webgpu_postprocessing_bloom_emissive`, `webgpu_water`, `webgpu_ocean`, `webgpu_sky`, `webgpu_backdrop_water`, `webgpu_tsl_procedural_terrain`, `webgpu_volume_cloud`, `webgpu_materials_toon`. dgreenheck/tidewater (1.4k★, MIT) has an FFT ocean, Hillaire sky and Nubis-style clouds in raw WebGPU/WGSL.
