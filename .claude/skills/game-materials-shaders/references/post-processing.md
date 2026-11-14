# Post-processing recipes

## WebGPU: `THREE.RenderPipeline` (r183+), TSL pass nodes
Rules: build the graph once; in the loop call `pipeline.render()`. Change `pipeline.outputNode` only on settings changes, then set `pipeline.needsUpdate = true`. By default the pipeline applies tone mapping and sRGB at the end. Set `pipeline.outputColorTransform = false` and use `renderOutput(node)` when you need effects after tone mapping (LUTs, film grain, UI-space effects).

### Bloom only on emissive (the cleanest look)
```ts
import { pass, mrt, output, emissive, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, emissive: vec4(emissive, output.a) }));
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = scenePass.getTextureNode('output').add(bloom(scenePass.getTextureNode('emissive'), 0.8, 0.4)); // strength, radius
```
Per-object bloom amount: `material.mrtNode = mrt({ bloomIntensity: uniform(1) })` plus a default `bloomIntensity: float(0)` in the pass MRT, then `bloom(color.mul(bloomIntensityTex))` (example `webgpu_postprocessing_bloom_selective`). The example `webgpu_postprocessing_bloom_emissive` also sets `scenePass.getTexture('emissive').type = THREE.UnsignedByteType` to save bandwidth (that clamps emissive to [0,1]).

### GTAO done right (AO darkens only ambient light, TRAA removes noise)
```ts
import { pass, mrt, normalView, velocity, sample, screenUV, packNormalToRGB, unpackRGBToNormal, builtinAOContext } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
const prePass = pass(scene, camera); prePass.transparent = false;
prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
const preNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
const preDepth = prePass.getTextureNode('depth'), preVelocity = prePass.getTextureNode('velocity');
const scenePass = pass(scene, camera);
const aoPass = ao(preDepth, preNormal, camera); aoPass.resolutionScale = 0.5;
scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
pipeline.outputNode = traa(scenePass, preDepth, preVelocity, camera);
```
Cheaper and self-denoised: `ssao(depth, normal, camera)` instead of `ao(...)`, with MSAA (`scenePass.options.samples = 4`) instead of TRAA. Full version: example `webgpu_postprocessing_ao`.

### LUT colour grade (after tone mapping)
```ts
import { pass, renderOutput, texture3D, uniform } from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';   // also LUT3dlLoader, LUTImageLoader
const lut = await new LUTCubeLoader().loadAsync('/luts/warm.cube');
pipeline.outputColorTransform = false;
pipeline.outputNode = lut3D(renderOutput(pass(scene, camera)), texture3D(lut.texture3D), lut.texture3D.image.width, uniform(1));
```
Make LUTs in any grading tool (DaVinci Resolve, Photoshop, Krita): grade a screenshot plus the identity LUT strip, then export a 33³ `.cube`.

### SSR (glossy floors)
```ts
scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), metalrough: vec2(metalness, roughness) }));
const normal = sample((uv) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(uv)));
const mr = scenePass.getTextureNode('metalrough');
const ssrPass = ssr(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), normal, { metalnessNode: mr.r, roughnessNode: mr.g });
pipeline.outputNode = smaa(scenePass.getTextureNode('output').add(ssrPass.rgb));   // SSR is premultiplied: add it
```
This follows `webgpu_postprocessing_ssr`. It is expensive, so lower its resolution on weak GPUs.

### Other built-ins worth knowing (all `three/addons/tsl/display/`)
`fxaa`, `smaa`, `traa` (temporal AA; needs velocity MRT), `taau` + `fsr1` (upscaling for weak GPUs), `dof`, `motionBlur`, `outline` (selection), `godrays`, `lensflare`, `chromaticAberration`, `film`, `vignette`/`scanlines`/`barrelUV` (CRT.js), `pixelationPass` (pixel-art 3D), `retroPass` (PS1 look), `sobel`, `afterImage`, `transition` (scene transitions), `ssgi` (screen-space GI, heavy), `sss` (screen-space shadows), `denoise`.

## Tone mapping choices
| Operator | Look | Use |
|---|---|---|
| `AgXToneMapping` | Filmic, desaturates highlights gracefully | Default for realistic games, HDR-heavy VFX |
| `ACESFilmicToneMapping` | Contrasty, saturated, hue shifts in brights | Cinematic/stylised punch |
| `NeutralToneMapping` (Khronos PBR Neutral) | Keeps albedo colours true | Product, UI-heavy, stylised flat colours |
| None | Clips | Pixel art / unlit 2D in 3D |
`renderer.toneMappingExposure` (or auto exposure in your own pass) is your "camera exposure". Light the scene for the tone mapper; don't fight it by lowering light values.

## WebGL: pmndrs/postprocessing (+ N8AO)
See `glsl-recipes.md` for the full composer. Key rules: renderer `{ antialias:false, stencil:false, depth:false }`, `frameBufferType: HalfFloatType`, renderer `toneMapping = NoToneMapping`, `ToneMappingEffect` last in the `EffectPass`, and effects merged into as few `EffectPass`es as possible. Peer range in 6.39.5: `three >=0.168 <0.187`. v7 is in beta (7.0.0-beta.16) with breaking API changes, so don't mix docs.

## Engines
- Godot 4: `WorldEnvironment` → `Environment`: tonemap (AgX available since 4.4), glow (bloom, uses HDR threshold), SSAO/SSIL/SSR, volumetric fog, adjustments + colour-correction LUT (`adjustment_color_correction`). Compositor effects (4.3+) for custom full-screen passes.
- Unity 6 URP: Volume profile (Bloom, Tonemapping, Color Lookup, Vignette...) + Renderer Features (SSAO, Decals, Full Screen Pass for custom shaders).
