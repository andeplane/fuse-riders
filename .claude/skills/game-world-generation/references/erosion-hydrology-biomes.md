# Erosion, hydrology and biomes

All CPU code here is deterministic: no `Math.random`, and grid traversal order is fixed. Heights are a `Float32Array`
of `size*size`, **x fastest** (`i = x + y*size`), with cell spacing = 1 unit. Normalise heights to roughly 0..1
before erosion and rescale afterwards, because the default parameters assume that range.

## Which erosion when

| Method | Looks like | Cost | Use when |
|---|---|---|---|
| Droplet (particle) hydraulic | Gullies, alluvial fans, softened slopes | 30k-150k droplets for 512², seconds in a worker | Default for ≤1024² tiles |
| Pipe model / shallow water (Mei et al. 2007) | Meandering channels, lakes fill, sediment transport | Many small GPU steps, needs a flux limiter | GPU, interactive sandboxes, ≥2048² |
| Stream-power incision (Braun & Willett 2013) | Real drainage basins, ridge/valley anatomy | ~50 implicit iterations, O(N log N) per pass | Big mountain ranges; add uplift or peaks decay |
| Thermal (talus) | Scree slopes, removes spikes | Cheap, local | Always, as a final cleanup pass |
| Fake (derivative-damped fBm, ridged noise) | Erosion-ish ridges, infinite and local | Free | Infinite chunked worlds where real erosion can't run |

Order: base noise → (uplift mask) → hydraulic → thermal → sharp detail (cracks, rills) last. Smoothers placed after
the detail pass erase it.

## Droplet erosion (Lague-style, corrected)

```ts
export const DROPLET_DEFAULTS = { droplets: 70_000, inertia: 0.05, capacity: 4, minCapacity: 0.01,
  erode: 0.3, deposit: 0.3, evaporate: 0.01, gravity: 4, maxSteps: 30, radius: 3 };

export function dropletErosion(h: Float32Array, size: number, rng: () => number, P = DROPLET_DEFAULTS) {
  // Precompute the erosion brush (weights sum to 1).
  const bx: number[] = [], by: number[] = [], bw: number[] = [];
  let wsum = 0;
  for (let dy = -P.radius; dy <= P.radius; dy++) for (let dx = -P.radius; dx <= P.radius; dx++) {
    const d = Math.hypot(dx, dy);
    if (d < P.radius) { bx.push(dx); by.push(dy); bw.push(1 - d / P.radius); wsum += 1 - d / P.radius; }
  }
  for (let k = 0; k < bw.length; k++) bw[k] /= wsum;

  const sample = (x: number, y: number) => {          // bilinear height + gradient
    const ix = x | 0, iy = y | 0, u = x - ix, v = y - iy, i = ix + iy * size;
    const a = h[i], b = h[i + 1], c = h[i + size], d = h[i + size + 1];
    return { h: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v,
             gx: (b - a) * (1 - v) + (d - c) * v, gy: (c - a) * (1 - u) + (d - b) * u };
  };

  for (let n = 0; n < P.droplets; n++) {
    let x = rng() * (size - 2), y = rng() * (size - 2);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < P.maxSteps; step++) {
      const ix = x | 0, iy = y | 0, u = x - ix, v = y - iy, i = ix + iy * size;
      const s0 = sample(x, y);
      dx = dx * P.inertia - s0.gx * (1 - P.inertia);
      dy = dy * P.inertia - s0.gy * (1 - P.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;                             // flat: droplet dies
      dx /= len; dy /= len; x += dx; y += dy;
      if (x < 0 || y < 0 || x >= size - 1 || y >= size - 1) break;
      const dh = sample(x, y).h - s0.h;                  // < 0 when moving downhill
      const cap = Math.max(-dh * speed * water * P.capacity, P.minCapacity);
      if (sediment > cap || dh > 0) {
        // Deposit at the OLD position (fill the pit we climbed out of, or drop the excess).
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * P.deposit;
        sediment -= amt;
        h[i] += amt * (1 - u) * (1 - v); h[i + 1] += amt * u * (1 - v);
        h[i + size] += amt * (1 - u) * v; h[i + size + 1] += amt * u * v;
      } else {
        // Erode with the brush, never more than the drop (prevents holes/spikes).
        const amt = Math.min((cap - sediment) * P.erode, -dh);
        for (let k = 0; k < bw.length; k++) {
          const ex = ix + bx[k], ey = iy + by[k];
          if (ex < 0 || ey < 0 || ex >= size || ey >= size) continue;
          const j = ex + ey * size, w = amt * bw[k];
          const taken = Math.min(w, Math.max(0, h[j]));  // don't dig below 0
          h[j] -= taken; sediment += taken;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * P.gravity)); // speeds up downhill
      water *= 1 - P.evaporate;
    }
  }
}
```

Run it in a worker and post progress every ~5k droplets. For a seeded world, use
`mulberry32(hashSeed(worldSeed, tileX, tileZ, EROSION))` as the rng.

## Thermal erosion (talus)

```ts
// talus = max stable height difference between neighbours = tan(angle) * cellSize (in height units)
export function thermalErosion(h: Float32Array, size: number, talus: number, rate = 0.5, iters = 20) {
  const nb = [1, -1, size, -size];
  for (let it = 0; it < iters; it++)
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = x + y * size;
      let maxD = 0, sumD = 0;
      for (const o of nb) { const d = h[i] - h[i + o]; if (d > talus) { sumD += d - talus; maxD = Math.max(maxD, d); } }
      if (sumD === 0) continue;
      const move = rate * (maxD - talus) * 0.5;
      for (const o of nb) { const d = h[i] - h[i + o]; if (d > talus) { const m = move * (d - talus) / sumD; h[i] -= m; h[i + o] += m; } }
    }
}
```

Typical talus angle is 30-40° for scree. A very steep talus (~65°) only removes numerical spikes.

## GPU erosion with TSL compute (WebGPU, three.js r18x)

Gather-style thermal erosion: each cell computes its own outflow and its neighbours' inflow, so no atomics are
needed and the result is stable on a given GPU. Droplet erosion on GPU needs `atomicAdd` on an `int`
`instancedArray(...).toAtomic()` with fixed-point heights (scale 1e6). That is the approach in the 2026
"open world browser" series on cinevva.com (unverified details).

```ts
import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, uniform, float, max, select } from 'three/tsl';

export async function gpuThermal(renderer: THREE.WebGPURenderer, heights: Float32Array, N: number, iters = 200) {
  const A = instancedArray(heights, 'float');          // typed array accepted
  const B = instancedArray(N * N, 'float');
  const talus = uniform(0.004), rate = uniform(0.2);

  const step = (src: typeof A, dst: typeof A) => Fn(() => {
    const i = instanceIndex, x = i.mod(N), y = i.div(N);
    // uint math: never do x.sub(1) without a guard (underflow); border neighbour = self → zero flow
    const nbs = [
      select(x.greaterThan(0), i.sub(1), i), select(x.lessThan(N - 1), i.add(1), i),
      select(y.greaterThan(0), i.sub(N), i), select(y.lessThan(N - 1), i.add(N), i),
    ];
    const hi = src.element(i);
    const delta = float(0).toVar();
    for (const j of nbs) {                               // JS loop unrolls at graph-build time
      const hj = src.element(j);
      delta.subAssign(max(hi.sub(hj).sub(talus), 0).mul(rate).mul(0.25)); // my outflow
      delta.addAssign(max(hj.sub(hi).sub(talus), 0).mul(rate).mul(0.25)); // neighbour's inflow to me
    }
    dst.element(i).assign(hi.add(delta));
  })().compute(N * N);

  const ab = step(A, B), ba = step(B, A);
  for (let k = 0; k < iters; k++) renderer.compute(k % 2 ? ba : ab); // after renderer.init()
  const buf = await renderer.getArrayBufferAsync((iters % 2 ? B : A).value); // read back for CPU/physics
  return new Float32Array(buf);
}
```

Pitfalls: call `await renderer.init()` first (or use `computeAsync`); keep `N*N` within buffer limits (a 2048²
float buffer is 16 MB, fine; 8192² is 256 MB, too big for many laptops); render the heights from the same storage
buffer in the vertex shader (`A.element(vertexIndex)`) to avoid a round trip; and *read back once* at the end
for physics. Pipe-model hydraulic erosion is the same pattern with 4-5 buffers (water, sediment, flux RGBA,
velocity) and 5 passes per step (rain → flux → water/velocity → erosion/deposition → semi-Lagrangian sediment
advection). Read LanLou123/Webgl-Erosion (MIT) for a working shader set before writing one.

## Hydrology: pit filling + D8 flow accumulation

```ts
class MinHeap { // (key, value) heap; ties broken by index for determinism
  k: number[] = []; v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] < key || (k[p] === key && v[p] < val)) break;
      k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
  pop(): number { const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!;
    if (k.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= k.length) break;
      if (c + 1 < k.length && (k[c + 1] < k[c] || (k[c + 1] === k[c] && v[c + 1] < v[c]))) c++;
      if (lk < k[c] || (lk === k[c] && lv < v[c])) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv; } return top; }
}

// Priority-flood + epsilon (Barnes et al. 2014): every cell drains to the border afterwards.
export function fillPits(h: Float32Array, size: number, eps = 1e-5) {
  const out = h.slice(), done = new Uint8Array(h.length), q = new MinHeap();
  for (let i = 0; i < size; i++) for (const j of [i, i + (size - 1) * size, i * size, i * size + size - 1])
    if (!done[j]) { done[j] = 1; q.push(out[j], j); }
  while (q.size) {
    const c = q.pop(), x = c % size, y = (c / size) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = nx + ny * size; if (done[j]) continue; done[j] = 1;
      if (out[j] <= out[c]) out[j] = out[c] + eps;       // raise pit floor, keep a tiny gradient
      q.push(out[j], j);
    }
  }
  return out;                                           // (out - h) > 0 marks lakes
}

// D8: each cell drains to its steepest neighbour; accumulate from high to low.
export function flowAccumulation(h: Float32Array, size: number) {
  const order = Uint32Array.from({ length: h.length }, (_, i) => i).sort((a, b) => h[b] - h[a] || a - b);
  const acc = new Float32Array(h.length).fill(1), recv = new Int32Array(h.length).fill(-1);
  for (const i of order) {
    const x = i % size, y = (i / size) | 0; let best = -1, drop = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = nx + ny * size, d = (h[i] - h[j]) / (dx && dy ? Math.SQRT2 : 1);
      if (d > drop) { drop = d; best = j; }
    }
    recv[i] = best; if (best >= 0) acc[best] += acc[i];
  }
  return { acc, recv };    // river cells: acc > threshold (e.g. 0.2% of cell count); follow recv to trace
}
```

Rivers: threshold `acc`, trace each river down `recv` into polylines, smooth them, then carve the heightfield
along the polyline (`h -= depth * falloff(dist)`) and lay a river mesh/spline with flow-direction UVs. Width ∝
`sqrt(acc)`. Lakes are where `filled − original > 0.5 m`. Put a flat water plane at the filled height. For
infinite worlds, compute drainage on a coarse global grid (e.g. 16 m cells over 16 km) once per seed and
sample it per chunk.

## Biomes

```ts
// temperature: latitude band + lapse rate (−6.5 °C per km of altitude); moisture: noise + distance to water
export function biome(heightM: number, tempC: number, moist: number, slopeDeg: number, seaLevel = 0) {
  if (heightM < seaLevel - 2) return 'ocean';
  if (heightM < seaLevel + 1.5 && slopeDeg < 8) return 'beach';
  if (slopeDeg > 38) return 'cliff';                    // rock material, no trees
  if (tempC < -5) return 'snow';
  if (tempC < 3) return moist > 0.4 ? 'taiga' : 'tundra';
  if (tempC < 18) return moist > 0.6 ? 'temperate_forest' : moist > 0.3 ? 'grassland' : 'shrubland';
  return moist > 0.7 ? 'rainforest' : moist > 0.35 ? 'savanna' : 'desert';
}
```

Blend materials by weights (not hard IDs) in the terrain shader: compute 2-4 biome weights per vertex, store them
in a splat texture or vertex attribute, and blend with height-based blending. Detiling (hex tiling, IQ's texture
repetition technique) and triplanar mapping on cliffs belong in `game-materials-shaders`.

## Sources

- Sebastian Lague, Hydraulic-Erosion (github.com/SebLague/Hydraulic-Erosion, MIT, Unity)
- Mei, Decaudin, Hu 2007, "Fast Hydraulic Erosion Simulation and Visualization on GPU" (pipe model)
- LanLou123/Webgl-Erosion (MIT, live demo lanlou123.github.io/Webgl-Erosion)
- dandrino/terrain-erosion-3-ways (MIT): simulation vs GAN vs river networks
- Barnes, Lehman, Mulla 2014, "Priority-Flood" (pit filling)
- getbutterfly.com "Procedural Eroded Terrain in Three.js" (2026 field notes: parameter ranges, pitfalls)
- Red Blob Games terrain/biome articles (redblobgames.com)
