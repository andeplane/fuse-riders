# Effekseer, flipbook packs, trails

## Effekseer in a three.js + Vite + TS game (WebGLRenderer)
EffekseerForWebGL 1.80.8 is a zip from GitHub releases (`github.com/effekseer/Effekseer/releases/download/1808/EffekseerForWebGL1.80.8.zip`, 3 MB, MIT). It is not on npm. It contains:
- `effekseer.min.js` (168 KB): a global `effekseer` namespace.
- `effekseer.wasm` (1.4 MB).
- `effekseer_asmjs.js`: a no-WASM fallback, 2.9 MB.
- `effekseer.d.ts`.
- Samples and `Resources/*.efk`.

API names below come from that `effekseer.d.ts` and the bundled `TypeScript/renderer.ts` sample.

Setup:
1. Copy `effekseer.min.js` and `effekseer.wasm` to `public/effekseer/`, and `effekseer.d.ts` to `src/types/`.
2. In `index.html`, add `<script src="/effekseer/effekseer.min.js"></script>` before your module script.
3. Put effects (`.efkefc` saved by the editor, plus the textures/models they reference, in the same relative folders) under `public/fx/`.

```ts
/// <reference path="./types/effekseer.d.ts" />
import * as THREE from 'three';
export async function initEffekseer(renderer: THREE.WebGLRenderer) {
  await new Promise<void>((ok, fail) => effekseer.initRuntime('/effekseer/effekseer.wasm', ok, fail));
  const ctx = effekseer.createContext();
  ctx.init(renderer.getContext(), { instanceMaxCount: 2000, squareMaxCount: 8000 });   // the budget
  ctx.setRestorationOfStatesFlag(false);        // fast path; we resetState() three ourselves
  return ctx;
}
export function loadFx(ctx: effekseer.EffekseerContext, url: string, scale = 1) {
  return new Promise<effekseer.EffekseerEffect>((ok, fail) => {
    const e = ctx.loadEffect(url, scale, () => ok(e), (reason, path) => fail(new Error(`${reason}: ${path}`)));
  });
}
// play: const h = ctx.play(fx, x, y, z); h.setRotation(rx, ry, rz); h.setScale(s, s, s); h.setAllColor(255, 200, 200, 255)
//       h.setSpeed(0) during hit-stop, h.setTargetLocation(...) for homing beams, h.sendTrigger(0), h.setDynamicInput(0, v)
//       h.stop(); h.exists === false when finished; ctx.stopAll(); ctx.releaseEffect(fx)
export function drawFx(ctx: effekseer.EffekseerContext, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, simDt: number) {
  ctx.update(simDt * 60);                                       // Effekseer counts in 60 Hz frames
  renderer.render(scene, camera);
  ctx.setProjectionMatrix(Float32Array.from(camera.projectionMatrix.elements));
  ctx.setCameraMatrix(Float32Array.from(camera.matrixWorldInverse.elements));
  ctx.draw();
  renderer.resetState();                                        // Effekseer dirtied GL state
}
```
Notes:
- Effekseer draws straight into the bound framebuffer after three, so by default its effects **skip three's tone mapping and post** (no bloom).
  - To include them: render the scene into your composer's input target, call `ctx.draw()` with that target still bound, then run the post passes (unverified wiring; check the result visually).
  - Or accept LDR effects and author them brighter.
- `instanceMaxCount` / `squareMaxCount` are hard caps on live instances and sprite quads. An effect that exceeds them silently drops parts.
- Effects are scaled at load (`loadEffect(url, scale)`). Effekseer's editor works in its own units; agree on 1 unit = 1 m with whoever authors them.
- Typings: `effekseer.d.ts` declares the global namespace. Add `"types"` or a triple-slash reference so tsc sees it.

## EffekseerForWeb (next generation, WebGL and WebGPU)
Repository `effekseer/EffekseerForWeb` (MIT, brand new, about 1 star, no release yet). It is an ES module:
- `initRuntime({ backend: 'webgl' | 'webgpu', scriptPath, wasmPath, device? })`, then `createContext({ backend, graphicsContext })` (WebGL) or `createContext({ backend: 'webgpu', canvas, canvasContext, device })`.
- `await ctx.loadEffect(url)` returns a Promise.
- `ctx.play(effect, x, y, z)`, `ctx.update(1)`, `ctx.draw()`.
- `ctx.setCameraFromThree(camera)` for three.js.
- WebGPU only: `ctx.drawToRenderPass(renderPassEncoder, options)` to record into your own pass.
- A `Sample/basic-threejs-webgpu.html` exists. Sharing three's `GPUDevice` (`renderer.backend.device`) is the integration point (unverified).

Use it only if you are on `WebGPURenderer` and need Effekseer content. Pin a commit, because the API can still change.

## Authoring Effekseer content
- **Effekseer editor** (Windows/macOS/Linux, MIT). It saves `.efkefc`. Node-based materials (`.efkmat`) are supported by the web runtime (unverified per feature). Check that every effect plays in the web sample before importing it.
- **`kanaworksai-hue/effekseer-vfx-skill`** (MIT, Claude Code plugin, Oct 2026).
  - The agent writes effects as Python recipes, builds `.efkefc` with EffekseerCore 1.80.7, renders them in Godot 4.7 and reviews contact sheets.
  - It runs only on macOS ARM64 and Windows x64.
  - It is useful when you want many variants of an effect (elements × forms) quickly.
- Sample effects that ship with Effekseer and third-party packs have their own terms. Record the source and licence of each in `CREDITS.md`.

## Flipbook sheets (kanaworks-sakuga-vfx and your own)
kanaworks-sakuga-vfx sidecar `<id>.flipbook.json`:
- `grid [cols, rows]`, `cell [w, h]`, `frames`, `fps` (30), `loop`
- `blend` (`alpha` = straight alpha | `additive`)
- `pivot [x, y]` (0–1 from the top-left; the root of ground columns), `bottom_inset`, `source`

Licence recap:
- Free only for annual revenue under USD 1M.
- Credit `VFX: KanaWorks_AI (@KanaWorks_AI)`.
- No resale or redistribution as a pack.
- The code is MIT.

### WebGPURenderer (type-checked, r187)
```ts
import * as THREE from 'three/webgpu';
import { texture, spritesheetUV, uv, vec2, uniform, float } from 'three/tsl';
interface Flipbook { grid: [number, number]; cell: [number, number]; frames: number; fps: number; loop: boolean;
  blend: 'alpha' | 'additive'; pivot: [number, number]; bottom_inset?: number; source: string; }
export async function loadFlipbook(jsonUrl: string) {
  const fb: Flipbook = await (await fetch(jsonUrl)).json();
  const tex = await new THREE.TextureLoader().loadAsync(new URL(fb.source, new URL(jsonUrl, location.href)).href);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { fb, tex };
}
export class FlipbookFx {
  readonly sprite: THREE.Sprite;
  private readonly uFrame = uniform(0);
  private time = 0; private playing = false;
  constructor(private fb: Flipbook, tex: THREE.Texture, size = 2, tint = new THREE.Color(1, 1, 1)) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false,
      blending: fb.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = texture(tex, spritesheetUV(vec2(fb.grid[0], fb.grid[1]), uv(), this.uFrame));   // frame 0 = top-left
    mat.colorNode = s.rgb.mul(uniform(tint));                 // tint > 1 → bloom
    mat.opacityNode = fb.blend === 'additive' ? float(1) : s.a;
    this.sprite = new THREE.Sprite(mat);
    this.sprite.center.set(fb.pivot[0], 1 - fb.pivot[1]);    // JSON pivot is top-left based, Sprite.center bottom-left
    this.sprite.scale.set(size * fb.cell[0] / fb.cell[1], size, 1);
    this.sprite.visible = false;
  }
  play(at: THREE.Vector3) { this.sprite.position.copy(at); this.time = 0; this.playing = true; this.sprite.visible = true; }
  update(simDt: number) {                                    // sim dt: hit-stop freezes the frame
    if (!this.playing) return;
    this.time += simDt;
    let f = Math.floor(this.time * this.fb.fps);
    if (f >= this.fb.frames) { if (this.fb.loop) f %= this.fb.frames; else { this.playing = false; this.sprite.visible = false; return; } }
    this.uFrame.value = f;
  }
}
```
Pool 4–8 `FlipbookFx` per effect type, created at load, and reuse the first idle one. All instances share the texture, and their node graphs are identical, so the pipeline is compiled once. Ground columns (pillars of fire, geysers) look wrong as camera-facing sprites when seen from above. Use a vertical billboard (`billboarding({ horizontal: true, vertical: false })` on a `Mesh`, or quarks `VerticalBillBoard`).

### WebGLRenderer
- **In quarks:** `uTileCount: cols, vTileCount: rows`, `startLife: new ConstantValue(frames / fps)`, `FrameOverLife(new PiecewiseBezier([[new Bezier(0, (frames-1)/3, 2*(frames-1)/3, frames-1), 0]]))`, and `emissionBursts` of 1. Check the tile order with a **numbered test sheet** (draw 0..N on a canvas grid), because some tools count frames from the bottom-left.
- **Single sprites:** `const t = tex.clone()` per instance (clones share the GPU image), `t.repeat.set(1/cols, 1/rows)`, then per frame `t.offset.set(col/cols, 1 - (row+1)/rows)` on a `SpriteMaterial({ map: t })`.

### Straight alpha, fringes, mipmaps
Straight-alpha sheets with black transparent pixels can show dark halos when filtered or mipmapped. Fixes:
- Premultiply at import (multiply RGB by A in a build script), then use `premultipliedAlpha: true` with `NormalBlending`.
- Or dilate the colour into the transparent pixels (TexturePacker "extrude/bleed", or a script).

Additive-on-black variants have no fringe problem: black adds nothing.

### Making your own sheets
- **Blender** (free): render the simulation (Mantaflow smoke/fire) to an image sequence, then pack it (TexturePacker, ImageMagick `montage -tile 8x8 -geometry +0+0 -background none`, or a 20-line sharp script).
- **EmberGen** (JangaFX, commercial): real-time volumetric fire and smoke to flipbook.
- **Kenney Particle Pack** (CC0) and similar CC0 sprites: sparks, smoke puffs and circles to build layers from.
- **AI image generation**: fine for single sprites (sparks, glyphs, shock rings). It is poor at temporally coherent frames, so animate those in-engine (scale, rotation, dissolve) instead of generating frames.
- Size: 8×8 frames of 256 px = a 2048² sheet (16 MB RGBA8 in VRAM). Use 1024² sheets (4×4 or 8×8 at 128 px) for small or fast effects, and KTX2/UASTC for shipping (`game-performance-optimization`).

## Trails and ribbons
### WebGLRenderer: three.meshline 2.0 (MIT, spite fork on npm)
```ts
import { MeshLine, MeshLineMaterial } from 'three.meshline';   // no TS types: add `declare module 'three.meshline'`
const N = 32, line = new MeshLine();
line.setPoints(new Float32Array(N * 3), (p: number) => p);      // width taper: 0 at tail, 1 at head
const trail = new THREE.Mesh(line, new MeshLineMaterial({ color: new THREE.Color(0x88ccff), lineWidth: 0.25,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
trail.frustumCulled = false; scene.add(trail);
const tip = new THREE.Vector3();
function tickTrail() { blade.getWorldPosition(tip); line.advance(tip); }   // shift history, push the newest point
```
The Node test gave 64 vertices for 32 points, and `advance` updated them. It is screen-space width, which is good for projectile and missile trails. Being a `ShaderMaterial`, it does not work on WebGPURenderer.

### Any renderer: a two-edge slash ribbon (type-checked and Node-tested)
A sword swoosh is a ribbon between the blade **base** and **tip** over the last N frames. It is plain geometry, so it works on both renderers.
```ts
export class SlashTrail {
  readonly mesh: THREE.Mesh; private readonly pos: Float32Array; private readonly geo = new THREE.BufferGeometry(); private count = 0;
  constructor(private readonly samples: number, material: THREE.Material) {
    this.pos = new Float32Array(samples * 6);
    const uvs = new Float32Array(samples * 4), idx: number[] = [];
    for (let i = 0; i < samples; i++) {
      const u = 1 - i / (samples - 1); uvs.set([u, 0, u, 1], i * 4);             // u = 1 newest → 0 oldest
      if (i < samples - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); this.geo.setIndex(idx); this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, material); this.mesh.frustumCulled = false;
  }
  push(base: THREE.Vector3, tip: THREE.Vector3) {                 // once per frame while swinging (world space)
    this.pos.copyWithin(6, 0, (this.samples - 1) * 6);
    this.pos.set([base.x, base.y, base.z, tip.x, tip.y, tip.z], 0);
    if (this.count < this.samples) this.count++;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, (this.count - 1) * 6);
  }
  reset() { this.count = 0; this.geo.setDrawRange(0, 0); }      // or keep pushing the last pose: it shrinks away
}
```
Material:
- WebGPU: `MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending })` with `opacityNode = uv().x.pow(2).mul(texture(slashTex).a)` and an HDR `colorNode`.
- WebGL: `alphaMap` of a horizontal gradient.

For the anime look, also:
- Sample the swing at a fixed 60 Hz and Catmull-Rom subdivide when the blade moves fast (otherwise you get a polygonal fan).
- Add a bright thin edge line at v = 1 (tip).

### Other ribbon options
- quarks `RenderMode.Trail`: trails per particle (rocket and spark trails).
- three-nebula `RibbonRenderer`.
- `Line2` + `LineMaterial` (WebGL) / `Line2NodeMaterial` (WebGPU, exists in r187): fat polylines for laser beams and lightning arcs. Regenerate the zig-zag points each 2–3 frames for lightning.
