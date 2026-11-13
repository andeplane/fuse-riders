# Physics in a Web Worker, and determinism for replays and netcode

## Should physics go in a worker?

Move it off the main thread when `world.step` takes over 3–4 ms, or when rendering and physics together blow the 16.6 ms budget. Below that, the extra latency and complexity aren't worth it.

**Design rule: move the whole simulation, not just the physics.** Raycasts, the character controller, AI sensing and gameplay rules all query physics synchronously. If physics is in a worker and gameplay isn't, every query becomes an async round trip of 1–2 frames. The sim worker should own the physics world, gameplay and AI. The main thread renders, plays audio, reads input and runs the UI. That's a clean split between sim and render.

## Recipe: transferable ping-pong (no special headers)

```ts
// src/sim/sim.worker.ts  (never imports three)
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const DT = 1 / 60; world.timestep = DT;
const bodies: RAPIER.RigidBody[] = [];           // index = render id
let input = { x: 0, z: 0, jump: false };
let spare: Float32Array[] = [];                   // buffers returned by the main thread
onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'input') input = m.input;
  else if (m.type === 'return') spare.push(m.buf);
  else if (m.type === 'spawn') bodies.push(spawn(m));   // spawn() is your factory: creates body + collider and returns the body
};
let tick = 0;
setInterval(() => {                               // the worker's own clock. A drifting accumulator is fine here
  stepGameplay(input, DT); world.step(); tick++;
  const n = bodies.length * 7;
  let buf = spare.pop();
  if (!buf || buf.length !== n) buf = new Float32Array(n);      // body count changed → fresh buffer
  bodies.forEach((b, i) => { const t = b.translation(), r = b.rotation(); buf.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7); });
  postMessage({ type: 'frame', tick, time: performance.now(), buf }, [buf.buffer]);   // zero-copy transfer
}, DT * 1000);
```
```ts
// main thread
const sim = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), { type: 'module' });
let prev: Float32Array | null = null, curr: Float32Array | null = null, currTime = 0;
sim.onmessage = (e) => {
  if (e.data.type !== 'frame') return;
  if (prev) sim.postMessage({ type: 'return', buf: prev }, [prev.buffer]);   // recycle the buffer
  prev = curr; curr = e.data.buf; currTime = performance.now();
};
function applyTransforms(objs: THREE.Object3D[]) {        // call in the render loop
  if (!prev || !curr) return;
  const a = Math.min((performance.now() - currTime) / (1000 / 60), 1);  // renders one sim tick behind
  objs.forEach((o, i) => {
    const k = i * 7;
    o.position.set(prev![k] + (curr![k] - prev![k]) * a, prev![k+1] + (curr![k+1] - prev![k+1]) * a, prev![k+2] + (curr![k+2] - prev![k+2]) * a);
    _q0.fromArray(prev!, k + 3); _q1.fromArray(curr!, k + 3); o.quaternion.slerpQuaternions(_q0, _q1, a);
  });
}
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
```
- Keep body ids stable. Mark a despawned id as a hole (write NaN and hide the mesh) instead of compacting the array mid-game.
- `setInterval` drifts and is throttled in background tabs. For a lockstep game, drive ticks from a time-based accumulator and number every input with its tick.

## SharedArrayBuffer variant (lower latency, needs cross-origin isolation)

```ts
// vite.config.ts
export default defineConfig({
  server:  { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
});
```
- With isolation on, write transforms into a `SharedArrayBuffer`-backed `Float32Array` with two slots plus an `Int32Array` sequence counter (`Atomics.store`/`Atomics.load`). The main thread reads the slot that isn't being written.
- Production hosting must send the same headers. On itch.io, GitHub Pages and some CDNs you can't set them: check `crossOriginIsolated === true` at runtime and fall back to transferables.
- The same isolation is required for **Jolt `*-multithread`**, **box2d3-wasm `deluxe`** and **box3d-wasm `deluxe`** builds. `COEP: require-corp` also blocks cross-origin images, fonts and audio without CORP/CORS headers, so test asset loading.
- The only library wrapping this pattern is `@react-three/cannon` (cannon-es in a worker, last release Aug 2023, not recommended). There is no maintained Rapier-in-worker wrapper. A hand-rolled ~150-line protocol is normal.

## Determinism: what is actually guaranteed

| Engine / build | Same machine, same build | Across browsers, OSes and CPUs | Notes |
|---|---|---|---|
| Rapier `@dimforge/rapier3d(-compat)` / `-simd` | yes | **no** | Only locally deterministic |
| Rapier `@dimforge/rapier3d-deterministic(-compat)` (2D too) | yes | **yes** | Slower (no SIMD). Same version on all peers. Insertion order matters |
| JoltPhysics.js npm builds | yes | not guaranteed | Jolt supports `-DCROSS_PLATFORM_DETERMINISTIC=ON`, but you must build the WASM yourself |
| Box2D v3 (box2d3-wasm) | yes | designed for it | v3 advertises cross-platform determinism. Verify with your own hash test |
| Box3D | yes | advertised, plus record/replay | Alpha |
| Godot Jolt / GodotPhysics | mostly | no | Use `godot-rapier-physics` (deterministic) for rollback |
| Unity PhysX | mostly | no | Unity Physics (DOTS, stateless) is deterministic on the same build |

**Rules for a deterministic sim (lockstep, rollback, replays, "seed sweep" tests):**
1. Use a fixed `dt`, the same number of steps per tick, and inputs keyed by tick. Never feed frame deltas into the sim.
2. Use the same creation and removal order for bodies and colliders on every peer. Handles depend on it, and so does the solver order.
3. **Don't use JS `Math.sin`/`cos`/`exp`/`pow`/`atan2` in sim code.** The spec calls them *implementation-approximated*, and V8, SpiderMonkey and JavaScriptCore can differ in the last bit. Do gameplay math with `+ − × ÷ sqrt` (exact in IEEE-754), a lookup table, or fixed-point integers. Physics in WASM is unaffected, because WASM float ops are deterministic apart from NaN bit patterns, and Rapier's deterministic build avoids non-deterministic intrinsics.
4. Use a seeded PRNG (e.g. mulberry32 or sfc32) owned by the sim, never `Math.random()`. Give each subsystem its own stream, so adding particles doesn't shift the AI's rolls.
5. Never iterate a `Set` or `Map` that was filled in a nondeterministic order, such as from network arrival order. Sort by entity id.
6. Keep render-only state (particles, ragdolls used for juice, cloth) out of the deterministic world, or in a second non-authoritative `World`.

## Rollback with snapshots (Rapier)

```ts
const history = new Map<number, Uint8Array>();          // tick → snapshot (ring buffer of ~10–20 ticks)
function saveTick(tick: number) { history.set(tick, world.takeSnapshot()); history.delete(tick - 20); }
function rollbackTo(tick: number, inputs: InputLog) {
  world.free();                                          // free the old WASM world
  world = RAPIER.World.restoreSnapshot(history.get(tick)!);
  // re-acquire every body/collider handle from your own id→handle maps (handles are preserved in the snapshot)
  for (let t = tick; t < currentTick; t++) { applyInputs(inputs.at(t)); world.step(); saveTick(t + 1); }
}
```
- The character controller, vehicle controller and PID controller objects are *not* part of the snapshot. Recreate them after a restore.
- Snapshot cost grows with world size: measure `takeSnapshot()` time and bytes. Over ~1 ms, roll back fewer ticks, or take snapshots only of the networked region (a separate `World`).
- Snapshots are tied to the Rapier version: 0.21 can't read pre-0.21 snapshots. Store `RAPIER.version()` with every replay file.
- The netcode transports, prediction and interpolation are covered in `game-multiplayer`.

## Determinism test (put it in CI)

```ts
// sim.determinism.test.ts (Vitest, Node). Run the same file in Playwright to compare browser vs Node
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { createHash } from 'node:crypto';
test('same inputs → same world bytes', async () => {
  await RAPIER.init();
  const run = () => { const w = buildLevel(RAPIER, 1234); for (let t = 0; t < 600; t++) { applyInputs(w, LOG[t]); w.step(); }
    const h = createHash('sha256').update(w.takeSnapshot()).digest('hex'); w.free(); return h; };
  expect(run()).toBe(run());
  expect(run()).toBe(GOLDEN_HASH);   // recorded once and committed. Updating it is a deliberate act
});
```
Seed sweep: run `buildLevel(seed)` for 256 seeds headless. Assert that nothing escapes the world bounds, that no translation is NaN (Rapier core 0.35+ quarantines non-finite bodies by disabling them, so also assert that no body became disabled), and that everything settles to sleep within N ticks.
