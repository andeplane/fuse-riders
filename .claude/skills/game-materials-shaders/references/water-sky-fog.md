# Water, sky, clouds, fog, reflections

## Water: pick by scope

| Need | three.js WebGPU | three.js WebGL | Godot 4 | Cost |
|---|---|---|---|---|
| Lake/sea seen from shore, stylised-real | `WaterMesh` from `objects/WaterMesh.js` (normal-map scrolling + reflection + sun glint) | `Water` (`objects/Water.js`) | shader + `ReflectionProbe` | Low |
| River/pool with flow direction, refraction | `WaterMesh` from `objects/Water2Mesh.js` (flow map, two normal maps). **Same export name**: alias it | `Water` from `objects/Water2.js` | shader with flow map | Medium |
| Stylised/toon water, shoreline foam | MeshBasic/Standard node material: `viewportLinearDepth.sub(linearDepth())` gives depth to the opaque scene → foam/colour ramps, `backdropNode` for refraction (example `webgpu_backdrop_water`) | `onBeforeCompile` + depth texture | `DEPTH_TEXTURE` + `SCREEN_TEXTURE` | Low |
| Interactive ripples (pond, puddle, pool) | heightfield compute: example `webgpu_compute_water` | `GPUComputationRenderer` (`webgl_gpgpu_water`) | compute/viewport texture | Medium |
| Open ocean, boats, hero shot | FFT (Tessendorf) in compute, multiple cascades | not worth it on WebGL | **2Retr0/GodotOceanWaves** (3.3k★, MIT) | High |

```ts
import { WaterMesh } from 'three/addons/objects/WaterMesh.js';
import { WaterMesh as FlowWaterMesh } from 'three/addons/objects/Water2Mesh.js';   // same class name!
const normals = new THREE.TextureLoader().load('/tex/waternormals.jpg');
normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
const sea = new WaterMesh(new THREE.PlaneGeometry(10000, 10000), {
  waterNormals: normals, sunDirection: sunDir.clone(), sunColor: 0xffffff, waterColor: 0x001e0f, distortionScale: 3.7,
});
sea.rotation.x = -Math.PI / 2;
const river = new FlowWaterMesh(new THREE.PlaneGeometry(30, 40), {
  color: 0xffffff, scale: 2, flowDirection: new THREE.Vector2(1, 1), normalMap0, normalMap1,
});
river.rotation.x = -Math.PI / 2; river.renderOrder = Infinity;     // as in the webgpu_water example
```

### FFT ocean architecture (as in dgreenheck/tidewater and Noniv/web-ocean)
- Spectrum: JONSWAP (or TMA for shallow water) with directional spreading (Donelan-Banner) plus a separate long swell. Initial `h0(k)` texture is built once per sea state.
- Per frame: evolve `h(k,t)` → inverse FFT (radix-2 compute in workgroup memory; 256² per cascade) for height + horizontal displacement ("choppy") + slopes. Use **3–6 cascades** with patch sizes like 1000 m / 100 m / 10 m / 1 m to kill tiling.
- Foam: where the Jacobian of the horizontal displacement < threshold (folding crests), accumulated in a decaying foam texture.
- Shading: Fresnel reflection of the sky/env, subsurface tint on backlit crests, sun glitter from slope variance (LEAN mapping) so the far sea doesn't alias. Mesh: camera-centred clipmap/CDLOD grid, vertex-displaced.
- Read-to-learn sources: dgreenheck/tidewater (`src/ocean/`, MIT, 1.4k★, raw WebGPU/WGSL), Noniv/web-ocean (MIT, 908★, raw WebGPU, six cascades, single HTML), GodotOceanWaves (Godot compute). Porting to TSL: `instancedArray`/`storageTexture` + `Fn().compute()`, butterfly passes as separate compute nodes. Budget: a few ms on desktop. Offer a "low" setting that uses `WaterMesh`.
- Buoyancy: sample the same displacement on the CPU (cheap Gerstner approximation of the dominant waves) or read back a tiny height texture asynchronously (`renderer.getArrayBufferAsync`, a frame late). Never read back synchronously.

## Reflections
| Option | three.js | When |
|---|---|---|
| Environment map (HDRI/PMREM) | `scene.environment` | Always; free; correct for rough surfaces |
| Planar reflector | WebGPU: `reflector({ resolutionScale: 0.25 })`, `scene.add(r.target)`, use `r` as a colour/emissive node (example `webgpu_reflection`). WebGL: `Reflector` | One big flat mirror/water/glossy floor. Costs a second scene render |
| SSR | WebGPU: `ssr(color, depth, normal, { metalnessNode, roughnessNode })` with MRT metal/rough (`webgpu_postprocessing_ssr`). WebGL: `SSRPass` | Wet streets, glossy interiors; misses off-screen objects |
| Probes | Godot ReflectionProbe/VoxelGI; Unity reflection probes | Engines |

## Sky and atmosphere
- **`SkyMesh`** (`three/addons/objects/SkyMesh.js`, WebGPU; `Sky` for WebGL): Preetham-style analytic sky. r18x added `cloudCoverage`, `cloudDensity`, `cloudElevation`, `cloudScale`, `cloudSpeed` and `showSunDisc` uniforms. `sky.scale.setScalar(450000)`, `sky.sunPosition.value.copy(sunDir)`. Bake it into IBL with `PMREMGenerator.fromScene` when the sun moves (throttle it).
- **Hillaire 2020** ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique"): transmittance LUT, multiple-scattering LUT, sky-view LUT, and an aerial-perspective froxel volume. Ready-made for three WebGPU: **`@pmndrs/sky`** (`npm i @pmndrs/sky`, MIT, peer `three>=0.186`, v0.6.0 Oct 2026, new and low-star):
  ```js
  import { Sky } from '@pmndrs/sky';
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14.5, latitude: 37.7, exposure: 40 });
  sky.attach(scene); await sky.compileAsync();            // sets scene.environment + background
  renderer.setAnimationLoop(() => { sky.update(camera); renderer.render(scene, camera); });
  // haze: post.outputNode = sky.applyHaze(scenePass.getTextureNode(), { scenePass, policy: 'auto' }); call sky.updateAerialPerspective()
  ```
  Raw-WebGPU alternative: `webgpu-sky-atmosphere` (JolifantoBambla, MIT, it needs your own `GPUDevice`). Reference code: sebh/UnrealEngineSkyAtmosphere (MIT). Bruneton precomputed scattering for three: `@takram/three-atmosphere` (MIT, has a `/webgpu` export).
- Godot: `PhysicalSkyMaterial` (Rayleigh/Mie) or a sky shader. Unity URP: procedural skybox; HDRP has a physically based sky.

## Clouds
- Cheap: the cloud layer in `SkyMesh`, or a scrolling noise dome.
- Volumetric box/area: three example `webgpu_volume_cloud`, `RaymarchingBox` from `three/addons/tsl/utils/Raymarching.js` + a `Data3DTexture` noise, with early-out at density≈1.
- Full sky volumetrics: the Schneider/Guerrilla "Nubis" approach (weather map + Perlin-Worley + Worley detail, beer-powder lighting, blue-noise jitter + temporal reprojection, quarter-res march). Implementations: `@takram/three-clouds` (MIT, WebGL + pmndrs postprocessing; WebGPU port "in progress"), dgreenheck/tidewater `src/sky/Clouds.js` (MIT, WGSL). Budget: render at ¼ resolution and reproject, or it costs 5–10 ms.

## Fog
- WebGL: `scene.fog = new THREE.Fog(color, near, far)` / `FogExp2(color, density)`. Match `scene.background` to the fog colour.
- WebGPU: `scene.fogNode = fog(colorNode, factorNode)` with `rangeFogFactor(near, far)`, `densityFogFactor(d)` (= 1−exp(−(d·viewZ)²)), or `exponentialHeightFogFactor(density, height)` (= 1−exp(−(d·(height−y)·viewZ)²)). Example values: density 0.01–0.04, height 2–5 m for a valley mist. Set `scene.backgroundNode` to the same colour, or the horizon line shows.
- Aerial perspective (distance haze tinted by the sky) sells scale better than fog: `@pmndrs/sky` `applyHaze`/`applyFog`, or tint fog by the sky colour in the view direction.
- Volumetric light shafts: `godrays()` (addons, needs a shadow-casting light), or the examples `webgpu_volume_lighting*`. Godot: `FogVolume` + volumetric fog in `Environment`.
