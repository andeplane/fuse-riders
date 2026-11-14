# three.quarks (WebGLRenderer) and three-nebula

three.quarks 0.17.1 (MIT, peer `three>=0.182`), `npm i three.quarks`. It renders with `ShaderMaterial`, so it needs **`WebGLRenderer`**. It does not work on `WebGPURenderer` with either backend.

All code below was type-checked against three r187 + three.quarks 0.17.1. The firework, sub-emitter, mesh debris and pool code also ran in Node: the rockets died, `EmitSubParticleSystem` spawned 60-spark bursts at each death, and the debris burst gave 12 particles, then 0 after its life.

## Core model
- **One `BatchedRenderer` per scene.** `batch.addSystem(sys)` for every system. Systems that share material, blending and render mode are drawn together in one batch.
- **`ParticleSystem`** = settings + `behaviors[]`. `sys.emitter` is the `Object3D` you place in the scene. `worldSpace: true` leaves particles behind when the emitter moves (trails of smoke); `false` moves them with it (an aura).
- **Values:** `ConstantValue`, `IntervalValue(a,b)` (random per particle), `PiecewiseBezier([[new Bezier(p0,p1,p2,p3), t0], ...])` (curve over life).
- **Colours:** `ConstantColor`, `ColorRange(v4a, v4b)` (lerp), `RandomColor`, `Gradient([[rgb QV3, t]...], [[alpha, t]...])`.
- **Use quarks' own `Vector3`/`Vector4` (re-exported from quarks.core) for every colour, force and axis.** tsc rejects THREE's.
- Loop: `batch.update(dt)` before `renderer.render`. Pass the **simulation** dt so hit-stop and slow motion apply to the VFX.

## Emitters, render modes, behaviours
- Shapes:
  - `PointEmitter`
  - `SphereEmitter({radius})`
  - `HemisphereEmitter`
  - `ConeEmitter({radius, angle /*rad*/, arc, thickness})`
  - `CircleEmitter`, `DonutEmitter`, `RectangleEmitter`, `GridEmitter`
  - `MeshSurfaceEmitter(geometry)`: emit from a character's skin, a sword blade, a logo.
- `RenderMode`:
  - `BillBoard`
  - `StretchedBillBoard` (`rendererEmitterSettings: {speedFactor, lengthFactor}`): sparks, rain.
  - `Mesh` (`instancingGeometry` + `{startRotationX/Y/Z}`): debris, shell casings, leaves.
  - `Trail` (`{startLength, followLocalOrigin}` + `WidthOverLength`): ribbons, rocket trails.
  - `HorizontalBillBoard`: ground rings, shockwave decals.
  - `VerticalBillBoard`: fire columns.
- Behaviours:
  - Over life: `ColorOverLife`, `SizeOverLife`, `SpeedOverLife`, `RotationOverLife`, `Rotation3DOverLife`, `FrameOverLife`, `ForceOverLife`.
  - Forces and motion: `ApplyForce(dir, magnitude)`, `GravityForce(center, magnitude)` (point attractor), `OrbitOverLife` (vortex), `Noise(freq, power)`, `TurbulenceField`, `LimitSpeedOverLife`.
  - Speed-driven: `ColorBySpeed`, `SizeBySpeed`, `RotationBySpeed`.
  - Spawning: `EmitSubParticleSystem`, `ChangeEmitDirection`.
  - Collision: `ApplyCollision(resolver, bounce)`.
- Flipbooks: `uTileCount: 8, vTileCount: 8` + `FrameOverLife(new PiecewiseBezier([[new Bezier(0,21,42,63),0]]))`, or `startTileIndex` for a random still frame. `blendTiles: true` cross-fades between frames, so a 16-frame smoke sheet looks smooth.

## Recipe: explosion + pool (replay instead of allocate)
```ts
import { BatchedRenderer, ParticleSystem, RenderMode, ConstantValue, IntervalValue, ConstantColor, SphereEmitter, PointEmitter,
  ColorOverLife, SizeOverLife, Gradient, PiecewiseBezier, Bezier, FrameOverLife, ApplyForce, Vector3 as QV3, Vector4 as QV4 } from 'three.quarks';
export function makeExplosion() {
  const sparks = makeSparks();   // the SKILL.md §3 sparks system, wrapped in a function
  const smoke = new ParticleSystem({
    duration: 1, looping: false, autoDestroy: false,
    startLife: new IntervalValue(1.2, 2.0), startSpeed: new IntervalValue(0.5, 2), startSize: new IntervalValue(1.5, 3),
    startColor: new ConstantColor(new QV4(0.25, 0.22, 0.2, 0.8)),
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0.05, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 }],
    shape: new PointEmitter(),
    material: new THREE.MeshBasicMaterial({ map: smokeSheet, transparent: true, depthWrite: false }),  // alpha, NOT additive
    uTileCount: 8, vTileCount: 8, renderMode: RenderMode.BillBoard,
    softParticles: true, softNearFade: 0, softFarFade: 1.5,
    behaviors: [ new FrameOverLife(new PiecewiseBezier([[new Bezier(0, 21, 42, 63), 0]])),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.6, 0.9, 1.0, 1.2), 0]])),
      new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[0, 0], [1, 0.1], [0, 1]])) ],  // fade in, then out
  });
  const root = new THREE.Group(); root.add(sparks.emitter, smoke.emitter);
  batch.addSystem(sparks); batch.addSystem(smoke);
  return { root, systems: [sparks, smoke] };
}
export class ExplosionPool {
  private free: ReturnType<typeof makeExplosion>[] = [];
  constructor(n: number) { for (let i = 0; i < n; i++) { const e = makeExplosion(); scene.add(e.root); this.free.push(e); } }
  play(at: THREE.Vector3) {
    const e = this.free.shift(); if (!e) return;           // over budget: drop the effect, never allocate mid-fight
    e.root.position.copy(at); e.systems.forEach((s) => s.restart());
    setTimeout(() => this.free.push(e), 2500);              // longest life + margin (use your game clock in practice)
  }
}
```

## Recipe: firework = trail rockets + sub-emitter on death
```ts
const burstSparks = new ParticleSystem({
  looping: false, duration: 1, worldSpace: true,
  startLife: new IntervalValue(0.6, 1.2), startSpeed: new IntervalValue(4, 9), startSize: new IntervalValue(0.08, 0.16),
  startColor: new ColorRange(new QV4(3, 1.2, 0.4, 1), new QV4(3, 2.5, 1, 1)),
  emissionOverTime: new ConstantValue(0),
  emissionBursts: [{ time: 0, count: new ConstantValue(60), cycle: 1, interval: 0.01, probability: 1 }],
  shape: new SphereEmitter({ radius: 0.05 }), material: additiveMat,
  renderMode: RenderMode.StretchedBillBoard, rendererEmitterSettings: { speedFactor: 0.05, lengthFactor: 0 },
  behaviors: [new ApplyForce(new QV3(0, -1, 0), new ConstantValue(4))],
});
const rockets = new ParticleSystem({
  looping: true, duration: 2, worldSpace: true,
  startLife: new IntervalValue(1.0, 1.4), startSpeed: new IntervalValue(10, 14), startSize: new ConstantValue(0.15),
  startColor: new ConstantColor(new QV4(2, 2, 2, 1)), emissionOverTime: new ConstantValue(2),
  shape: new ConeEmitter({ radius: 0.1, angle: 0.2 }),
  material: new THREE.MeshBasicMaterial({ map: trailTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  renderMode: RenderMode.Trail,
  rendererEmitterSettings: { startLength: new ConstantValue(20), followLocalOrigin: false },   // 20 history points
  behaviors: [new ApplyForce(new QV3(0, -1, 0), new ConstantValue(6)),
    new WidthOverLength(new PiecewiseBezier([[new Bezier(1, 0.7, 0.3, 0), 0]]))],          // taper to the tail
});
rockets.addBehavior(new EmitSubParticleSystem(rockets, false, burstSparks.emitter, SubParticleEmitMode.Death)); // Death | Birth | Frame
scene.add(rockets.emitter, burstSparks.emitter); batch.addSystem(rockets); batch.addSystem(burstSparks);
```
`SubParticleEmitMode.Frame` spawns every frame (a smoke trail behind each projectile particle); `Birth` spawns once at birth (muzzle puff). Keep sub-emitter counts small: they multiply.

## Mesh debris (lit, opaque)
```ts
const debris = new ParticleSystem({
  looping: false, duration: 0.2, startLife: new IntervalValue(1.5, 2.5), startSpeed: new IntervalValue(4, 8),
  startSize: new IntervalValue(0.1, 0.3), startColor: new ConstantColor(new QV4(1, 1, 1, 1)),
  emissionOverTime: new ConstantValue(0), emissionBursts: [{ time: 0, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 }],
  shape: new ConeEmitter({ radius: 0.3, angle: 0.6 }),
  material: new THREE.MeshStandardMaterial({ color: 0x665544, roughness: 1 }), instancingGeometry: rockGeo,
  renderMode: RenderMode.Mesh,
  rendererEmitterSettings: { startRotationX: new IntervalValue(0, 6.28), startRotationY: new IntervalValue(0, 6.28), startRotationZ: new IntervalValue(0, 6.28) },
  behaviors: [new ApplyForce(new QV3(0, -1, 0), new ConstantValue(9.8)), new RotationOverLife(new IntervalValue(-4, 4))],
});
```
quarks has no world collision except `ApplyCollision` with your own resolver. For debris that must bounce on terrain, spawn a few real physics bodies (see `game-physics`) and keep the quarks debris as tiny dust only.

## Soft particles need a depth texture
```ts
const rt = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h) });
batch.setDepthTexture(rt.depthTexture);
function frame(dt: number) {
  batch.visible = false; renderer.setRenderTarget(rt); renderer.render(scene, camera);   // opaque depth pre-pass
  batch.visible = true;  renderer.setRenderTarget(null);
  batch.update(dt); renderer.render(scene, camera);
}
```
With pmndrs `postprocessing`, the composer already makes a depth texture for passes that set `needsDepthTexture` (it hands it over through `Pass.setDepthTexture`). Forwarding that texture to `batch.setDepthTexture` saves the second scene render (wiring unverified). Set `softParticles: true, softNearFade, softFarFade` per system.

## Editor JSON (artist or AI-authored)
quarks.art/create is a browser editor. It exports JSON and imports Unity Shuriken prefabs.
```ts
import { QuarksLoader, QuarksUtil } from 'three.quarks';
new QuarksLoader().load('/fx/portal.json', (obj) => {
  QuarksUtil.addToBatchRenderer(obj, batch);   // every system inside the prefab
  QuarksUtil.play(obj); scene.add(obj);         // also: stop, restart, pause, endEmit, setAutoDestroy
});
```
Keep the JSON in git, and clone the loaded object for pooling (`obj.clone()` + `addToBatchRenderer` again) (unverified for deep clones; if clones share state, load N times at startup instead).

## Numbers and checks
- `sys.particleNum` = live count. Assert in tests: the burst equals its count at frame 1, and it is 0 after `max(startLife)`.
- `batch.batches.length` = draw calls from quarks. Aim for under 10 by sharing materials and textures (atlas).
- CPU cost scales with live particles × behaviours. About 5–20k live is the comfortable range; above that use TSL compute on WebGPU or `GPUComputationRenderer`.

## three-nebula (alternative, works on both renderers)
13.3.0, MIT. Its API is classic emitter/initializer/behaviour:
```ts
import System, { Emitter, Rate, Span, Position, Mass, Life, Radius, RadialVelocity, Alpha, Scale, Color, PointZone, Vector3D, SpriteRenderer } from 'three-nebula';
const system = new System();
const emitter = new Emitter()
  .setRate(new Rate(new Span(10, 20), new Span(0.05)))
  .setInitializers([new Position(new PointZone(0, 0, 0)), new Mass(1), new Radius(0.5, 1), new Life(1, 2), new RadialVelocity(5, new Vector3D(0, 1, 0), 30)])
  .setBehaviours([new Alpha(1, 0), new Scale(1, 0.2), new Color(new THREE.Color(0xffaa33), new THREE.Color(0xff2200))])
  .emit();
system.addEmitter(emitter).addRenderer(new SpriteRenderer(scene, THREE));   // WebGL; one Sprite per particle!
// loop: system.tick(realDtSeconds)   — update() once per frame runs 2x fast on 120 Hz screens
```
- Renderers: `SpriteRenderer` (simple, one draw call per particle), `MeshRenderer`, the core `GPURenderer` (WebGL, batched), `RibbonRenderer` (trails) and `CustomRenderer`.
- WebGPU: `import { GPURenderer } from 'three-nebula/webgpu'`, then `system.addRenderer(new GPURenderer(scene, THREE /* three/webgpu namespace */, { maxParticles }))`. It is one instanced `SpriteNodeMaterial` draw with a texture atlas.
- Determinism: `system.setSeed(1234)` + `update()` × N gives byte-identical frames for tests.
- Our Node run: 127 particles after 30 ticks; `SpriteRenderer` added 127 scene children. That is why you should not use `SpriteRenderer` for more than a few hundred particles.
