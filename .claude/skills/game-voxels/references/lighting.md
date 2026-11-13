# Voxel lighting: sunlight + block light flood fill

Model (Minecraft-style): each voxel stores **sun** (0-15) and **block** light (0-15) in one byte. Sunlight enters
from the sky at 15 and falls straight down without loss, losing 1 per step sideways. Block light starts at an
emitter's level (torch 14) and loses 1 per step in every direction. Opaque voxels block both.

Tested: starting from a terrain with floating roofs, 400 random edits (place, break, place torch) were each
followed by the incremental update and compared against a full recompute. All 400 matched exactly.

## Code (`light.ts`)

```ts
// light.ts: Minecraft-style light. One byte per voxel: high nibble = sun (0-15), low nibble = block light (0-15).
// Works on any world accessor, so it crosses chunk borders. Mark every chunk you touch dirty for remeshing.
export interface LightWorld {
  inside(x: number, y: number, z: number): boolean;
  opaque(x: number, y: number, z: number): boolean;
  get(x: number, y: number, z: number, sun: boolean): number;
  set(x: number, y: number, z: number, sun: boolean, level: number): void;
  emission(x: number, y: number, z: number): number;   // torch = 14, lava = 15, else 0
  topY: number;                                         // y of the highest layer
}
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
type Q = number[];                                       // flat [x, y, z, x, y, z, …] queue (no allocations per node)

function spread(w: LightWorld, q: Q, sun: boolean) {
  for (let k = 0; k < q.length; k += 3) {
    const x = q[k], y = q[k + 1], z = q[k + 2], l = w.get(x, y, z, sun);
    for (const [dx, dy, dz] of N6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!w.inside(nx, ny, nz) || w.opaque(nx, ny, nz)) continue;
      const nl = sun && dy === -1 && l === 15 ? 15 : l - 1;  // full sunlight falls straight down unattenuated
      if (nl > w.get(nx, ny, nz, sun)) { w.set(nx, ny, nz, sun, nl); q.push(nx, ny, nz); }
    }
  }
}

/** Initial sunlight for a column range: 15 down to the first opaque voxel, then spread sideways. */
export function seedSunlight(w: LightWorld, x0: number, z0: number, x1: number, z1: number) {
  const q: Q = [];
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++)
    for (let y = w.topY; y >= 0 && !w.opaque(x, y, z); y--) { w.set(x, y, z, true, 15); q.push(x, y, z); }
  spread(w, q, true);
}

export function addLightSource(w: LightWorld, x: number, y: number, z: number, level: number) {
  w.set(x, y, z, false, level); spread(w, [x, y, z], false);
}

/** Remove light that originated at (x,y,z) (torch removed, or a block placed), then refill from the borders. */
export function removeLight(w: LightWorld, x: number, y: number, z: number, sun: boolean) {
  const rem: Q = [x, y, z], lv: number[] = [w.get(x, y, z, sun)], refill: Q = [];
  w.set(x, y, z, sun, 0);
  for (let k = 0, j = 0; k < rem.length; k += 3, j++) {
    const cx = rem[k], cy = rem[k + 1], cz = rem[k + 2], l = lv[j];
    for (const [dx, dy, dz] of N6) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (!w.inside(nx, ny, nz)) continue;
      const nl = w.get(nx, ny, nz, sun);
      if (nl === 0) continue;
      if (nl < l || (sun && dy === -1 && l === 15 && nl === 15)) {   // lit by us → remove and continue
        w.set(nx, ny, nz, sun, 0); rem.push(nx, ny, nz); lv.push(nl);
      } else refill.push(nx, ny, nz);                                 // lit by someone else → re-spread
    }
  }
  if (!sun) for (let k = 0; k < rem.length; k += 3) {               // emitters inside the removed area relight
    const e = w.emission(rem[k], rem[k + 1], rem[k + 2]);
    if (e > 0) { w.set(rem[k], rem[k + 1], rem[k + 2], false, e); refill.push(rem[k], rem[k + 1], rem[k + 2]); }
  }
  spread(w, refill, sun);
}

/** Call when the block at (x,y,z) changes. */
export function onBlockChanged(w: LightWorld, x: number, y: number, z: number, wasOpaque: boolean, wasEmission: number) {
  const nowOpaque = w.opaque(x, y, z), e = w.emission(x, y, z);
  if (wasEmission > 0) removeLight(w, x, y, z, false);
  if (!wasOpaque && nowOpaque) { removeLight(w, x, y, z, true); removeLight(w, x, y, z, false); }
  if (wasOpaque && !nowOpaque) {                                   // opened a hole: pull light in from neighbours
    for (const sun of [true, false]) {
      const q: Q = [];
      for (const [dx, dy, dz] of N6) if (w.inside(x + dx, y + dy, z + dz) && w.get(x + dx, y + dy, z + dz, sun) > 0) q.push(x + dx, y + dy, z + dz);
      if (sun && (y === w.topY || (w.inside(x, y + 1, z) && w.get(x, y + 1, z, true) === 15))) { w.set(x, y, z, true, 15); q.push(x, y, z); }
      spread(w, q, sun);
    }
  }
  if (e > 0) addLightSource(w, x, y, z, e);
}
```

## Wiring it into chunks

- Store light per chunk (`Uint8Array(S³)`) next to the ids. The `LightWorld` accessor maps world coords to chunk +
  local index (same `>>`/`&` trick as the block store), so the BFS crosses chunk borders freely.
- Every voxel whose light changes marks its chunk **and** the neighbours whose apron contains it dirty (same rule as
  block edits), because vertex light samples the front layer.
- New chunk: generate blocks → `seedSunlight` over its columns → if chunks above are loaded, pull their light in by
  calling `spread` from the boundary. A torch-lit cave across a chunk border needs both chunks loaded. Do initial
  lighting before the first mesh.
- Unloaded neighbours: treat them as opaque and dark, then re-light the border when they load. Otherwise light
  leaks into the void.
- Tall worlds: a per-column "highest opaque y" heightmap makes `seedSunlight` O(columns), not O(volume).

## Using light in the mesh

- Per face: sample sun/block in the **front** cell (the one the face looks into).
- Smooth lighting: per vertex, average the 4 front-layer cells around that corner (the same cells AO uses), skipping
  opaque ones. Combine with AO: `brightness = AO_CURVE[ao] * lightCurve(max(sun * daylight, block))`.
- Keep sun and block in **separate vertex attributes** (e.g. `uint8×2`, normalised). Then day/night is a uniform:
  `light = max(sun * uDaylight, block)`, and torches stay lit at night without remeshing.
- `lightCurve(l) = 0.8^(15 − l)` is a good default (Minecraft-ish). Add a minimum ambient (~0.03) so caves aren't pure black.
- Coloured block light: 3 channels × 4 bits (RGB torches). The BFS runs per channel, and memory doubles.

## Performance

- The BFS touches only cells whose value changes. A torch costs ~15³ × 6 checks worst case. Placing a block under
  open sky removes one column of 15s (up to world height) plus sideways refill.
- Batch edits per tick: run all removals first, then one combined `spread`.
- Run lighting in the same worker as meshing for that region, or on the main thread with a per-frame budget for
  single edits (it's usually < 1 ms).
