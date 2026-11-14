# TSL recipes (three.js r187, WebGPURenderer)

All of these were compiled and rendered on r187 (WebGL2 fallback backend in headless Chrome). Imports come from `three/webgpu` and `three/tsl` unless noted. Snippets are written as plain JS, because TS typings for some TSL helpers return an untyped `Node`. If `tsc` complains, wrap the value in a typed node, e.g. `float(x)`, or reorder (`a.mul(b)` instead of `b.mul(a)`).

## Material node slots (cheat sheet)
`colorNode` (albedo, linear), `opacityNode`, `alphaTestNode` (discard when alpha < value), `normalNode` (view-space normal; use `normalMap(texture(n))`), `roughnessNode`, `metalnessNode`, `emissiveNode` (feeds the emissive MRT for bloom), `aoNode`, `positionNode` (local position *after* skinning, morphs and instancing), `backdropNode`/`backdropAlphaNode` (screen-space refraction/distortion), `mrtNode` (per-material MRT outputs, e.g. a bloom mask), `fragmentNode`/`vertexNode` (full override, so you lose lighting).

## Height-blended splat (no mushy 50/50 crossfades)
```js
// ha/hb: height (e.g. albedo alpha or a height map). wa/wb: splat weights. depth: transition softness.
const heightBlend = (ca, ha, wa, cb, hb, wb, depth = 0.2) => {
  const ma = ha.add(wa), mb = hb.add(wb);
  const m = ma.max(mb).sub(depth);
  const ba = ma.sub(m).max(0), bb = mb.sub(m).max(0);
  return ca.mul(ba).add(cb.mul(bb)).div(ba.add(bb).max(1e-4));
};
const tuv = uv().mul(48), A = texture(grass, tuv), B = texture(rock, tuv), w = texture(splat, uv());
terrain.colorNode = heightBlend(A.rgb, A.a, w.r, B.rgb, B.a, w.g);
```
Pack each layer's height in its albedo alpha (or roughness alpha) so you don't need extra samples. For N layers, fold the blend pairwise. Reference: Andrey Mishkinis, "Advanced Terrain Texture Splatting" (2013).

## Many layers: texture array + control/index map (Terrain3D-style)
```js
// control map RGBA8 with NearestFilter: r = layer A index/255, g = layer B index/255, b = blend
const ctrl = texture(controlMap, uv());
const la = ctrl.r.mul(255).round(), lb = ctrl.g.mul(255).round();
terrain.colorNode = mix(texture(layers, tuv).depth(la), texture(layers, tuv).depth(lb), ctrl.b);
```
Indices can't be interpolated, so a Nearest control map gives blocky borders. Fix it by sampling the 4 neighbouring control texels and bilinearly weighting the 4 results (Terrain3D does this), or by dithering. Build `layers` as KTX2 array textures with baked mips (best), or at runtime:
```js
async function makeArray(urls, size = 1024) {          // runtime fallback; prefer KTX2 arrays
  const c = new OffscreenCanvas(size, size), ctx = c.getContext('2d');
  const data = new Uint8Array(size * size * 4 * urls.length);
  for (let i = 0; i < urls.length; i++) {
    const bmp = await createImageBitmap(await (await fetch(urls[i])).blob(), { imageOrientation: 'flipY' });
    ctx.drawImage(bmp, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
  }
  const t = new THREE.DataArrayTexture(data, size, size, urls.length);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;                                    // DataArrayTexture defaults to Nearest + no mips
  return t;
}
```
Separate arrays for albedo (sRGB) and normal/ORM (linear): never put both in one array. Godot users should install Terrain3D (MIT, up to 32 textures) instead of writing this.

## Anti-tiling / macro variation
```js
const macro = mx_fractal_noise_float(positionWorld.xz.mul(0.02), 3).mul(0.5).add(0.5);
mat.colorNode = texture(grass, tuv).rgb.mul(mix(float(0.75), float(1.15), macro));
// Second trick: blend the same texture at two scales: texture(t, tuv) and texture(t, tuv.mul(0.27))
// Third: stochastic tiling (Heitz/Neyret). Not built in; port a WGSL/GLSL version if needed.
```

## Triplanar
`triplanarTexture(texX, texY?, texZ?, scale, positionNode, normalNode)` handles colour. For normal maps, the naive triplanar is wrong: each projection's tangent frame differs. Use the "whiteout" or "reoriented normal" blend from Ben Golus, "Normal Mapping for a Triplanar Shader" (2017), written with three samples, or skip normal maps and add `bumpMap()` from a triplanar height. Use world-space `positionWorld` for terrain (continuous across chunks) and `positionLocal` for props that move.

## Inverted-hull outline (per mesh, works on skinned meshes)
```js
const outlineMat = new THREE.MeshBasicNodeMaterial({ color: 0x111111, side: THREE.BackSide });
outlineMat.positionNode = positionLocal.add(normalLocal.mul(0.03)); // thickness in local units
mesh.add(new THREE.Mesh(mesh.geometry, outlineMat));              // for SkinnedMesh: clone as SkinnedMesh + bind same skeleton
```
Hard-edged meshes split normals and crack the hull, so bake smoothed normals into a second attribute and push along that. Use the post `toonOutlinePass` (core) for whole-scene ink, `outline()` (addons OutlineNode) for selection highlights, and `sobel()` on depth/normal for a hand-drawn edge look.

## Rim / fresnel and hit flash
```js
const rim = normalView.dot(positionViewDirection).oneMinus().clamp().pow(3);
const flash = uniform(0);                                          // set 1 on hit, decay to 0 over ~80 ms
mat.emissiveNode = color(0x66ccff).mul(rim).mul(2).add(color(0xffffff).mul(flash));
```

## Dissolve (spawn/death), in SKILL.md
Noise vs threshold with `alphaTestNode`, emissive edge with `smoothstep(d, d+0.06, n).oneMinus()`. Never write `smoothstep(hi, lo, x)`: reversed edges are undefined in GLSL and WGSL.

## Decals
`DecalGeometry(mesh, position, orientationEuler, size)` from `three/addons/geometries/DecalGeometry.js` projects a box onto the mesh triangles on the CPU, so the mesh must be up to date (`updateMatrixWorld()`). Material: `transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4`. Keep a ring buffer (e.g. 64) and dispose the oldest geometry. Rotate around the normal randomly. Skinned or moving targets: parent the decal to the hit object, or bake the decal into a render-target "damage texture" for that object instead.

## Procedural wood/marble/noise starters
`mx_noise_float`, `mx_fractal_noise_float`, `mx_worley_noise_float` (MaterialX ports), `voronoi2d/3d` (`three/addons/tsl/math/voronoiNoise.js`), `curlNoise` (`three/addons/tsl/math/curlNoise.js`), plus the example `webgpu_tsl_wood`.
