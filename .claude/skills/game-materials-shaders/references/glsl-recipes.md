# GLSL recipes (WebGLRenderer)

Use these only when you are on `WebGLRenderer`, usually because you need three.quarks, pmndrs postprocessing, N8AO or another WebGL-only library. The TS was type-checked against r187.

## onBeforeCompile wind on a stock material (keeps PBR, shadows, fog)
```ts
export function windify(mat: THREE.MeshStandardMaterial) {
  const uTime = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 root = instanceMatrix[3].xyz;
       #else
         vec3 root = vec3(0.0);
       #endif
       float h = clamp(uv.y, 0.0, 1.0);
       float s = sin(uTime * 1.6 + root.x * 0.6 + root.z * 0.4);
       transformed.xz += vec2(s, s * 0.4) * h * h * 0.35;`);
  };
  mat.customProgramCacheKey = () => 'wind-v1';
  return (t: number) => { uTime.value = t; };
}
```
Shadows: the shadow pass uses `MeshDepthMaterial`, so swaying grass casts static shadows unless you set `mesh.customDepthMaterial` (and `customDistanceMaterial` for point lights) to a depth material with the same patch.

Common hook chunks: `begin_vertex` (local position `transformed`), `beginnormal_vertex` (`objectNormal`), `map_fragment` (`diffuseColor`), `roughnessmap_fragment` (`roughnessFactor`), `emissivemap_fragment` (`totalEmissiveRadiance`), `opaque_fragment` (final `gl_FragColor` before tone mapping), `fog_fragment`. Chunk names drift between releases, so grep `node_modules/three/src/renderers/shaders/ShaderChunk/` before patching.

## three-custom-shader-material (CSM)
```ts
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
const mat = new CustomShaderMaterial({
  baseMaterial: THREE.MeshPhysicalMaterial,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`uniform float uTime; void main(){ csm_Position = position + normal * sin(uTime)*0.02; }`,
  fragmentShader: /* glsl */`void main(){ csm_DiffuseColor = vec4(0.8, 0.3, 0.2, 1.0); }`,
  roughness: 0.4,
});
```
Outputs: `csm_Position` (unprojected), `csm_PositionRaw`, `csm_Normal`, `csm_DiffuseColor`, `csm_Roughness`, `csm_Metalness`, `csm_Emissive`, `csm_AO`, `csm_FragColor` (overrides lighting), `csm_UnlitFac`. MIT, 1.3k★, WebGL only.

## Triplanar (GLSL function)
```glsl
vec3 triplanar(sampler2D t, vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture(t, p.yz * scale).rgb * w.x + texture(t, p.xz * scale).rgb * w.y + texture(t, p.xy * scale).rgb * w.z;
}
```
Pass world position and world normal as varyings. A colour map sampled manually in a `ShaderMaterial` is in sRGB, so mark the texture `SRGBColorSpace` and three decodes it on sampling.

## Texture arrays
```ts
// ShaderMaterial is always compiled as GLSL ES 3.00 on WebGL2, so sampler2DArray works WITHOUT glslVersion.
// Leaving glslVersion unset keeps three's `gl_FragColor` define, which the tonemapping/colorspace chunks write to.
const mat = new THREE.ShaderMaterial({
  uniforms: { uLayers: { value: arrayTexture }, uLayer: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `precision highp sampler2DArray; uniform sampler2DArray uLayers; uniform float uLayer; varying vec2 vUv;
    void main(){ gl_FragColor = texture(uLayers, vec3(vUv, uLayer));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
```
If you set `glslVersion: THREE.GLSL3` (as the `webgl_texture2darray` example does), three no longer defines `gl_FragColor`. You must then declare `out vec4 outColor` yourself, and the chunk includes above stop compiling. Compressed arrays: see the `webgl_texture2darray_compressed` example (KTX2).

## Fog in custom shaders
Add `#include <fog_pars_vertex>`, `#include <fog_vertex>` (needs `mvPosition`), `#include <fog_pars_fragment>`, `#include <fog_fragment>`, plus `fog: true` and `uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {...}])`. Without these, your mesh glows through the fog.

## Post: pmndrs/postprocessing + N8AO (full)
```ts
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, LUT3DEffect, LUTCubeLoader } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
renderer.toneMapping = THREE.NoToneMapping;
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const n8 = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
n8.configuration.aoRadius = 2; n8.configuration.distanceFalloff = 1; n8.configuration.intensity = 3;
composer.addPass(n8);
const lut = await new LUTCubeLoader().loadAsync('/luts/warm.cube');
composer.addPass(new EffectPass(camera,
  new BloomEffect({ luminanceThreshold: 1.0, mipmapBlur: true, intensity: 1.2 }),
  new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
  new LUT3DEffect(lut),
  new SMAAEffect()));
renderer.setAnimationLoop(() => composer.render());
```
Also useful from postprocessing: `SelectiveBloomEffect`, `OutlineEffect`, `ShockWaveEffect` (explosions), `ChromaticAberrationEffect`, `VignetteEffect`, `GodRaysEffect`, `DepthOfFieldEffect`, `HueSaturationEffect`, `BrightnessContrastEffect`. N8AO: `aoRadius` should be about 1/10–1/100 of the scene extent. Use `setQualityMode('Low'|'Medium'|...)` and `configuration.halfRes = true` on weak GPUs, plus SMAA, because MSAA doesn't mix with AO.
Three's own WebGL stack (`EffectComposer` in `three/addons/postprocessing/`) works too: `UnrealBloomPass`, `GTAOPass`, `SSRPass`, `OutlinePass`, `LUTPass`. Always end it with `OutputPass` (tone mapping + sRGB).
