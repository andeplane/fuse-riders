# Wave Function Collapse for levels and towns

## Pick the variant

| Variant | Input | Good for | Library |
|---|---|---|---|
| Overlapping model | one sample bitmap, N×N patterns (N=3 typical) | textures, organic 2D maps learned from a drawing | mxgmn/WaveFunctionCollapse (C#), kchapelier/wavefunctioncollapse `OverlappingModel` (JS, MIT) |
| Simple tiled model | tile list + adjacency (sockets) | roads, walls, rooms, castles, 3D modular kits | own solver below; kchapelier `SimpleTiledModel`; DeBroglie (C#, constraints + backtracking, 2D/hex/3D) |
| 3D modules (Townscaper, marian42 city) | modules with 6 sockets incl. up/down | buildings, cities, infinite chunked worlds | marian42/wavefunctioncollapse (Unity, backtracking, MIT) as reference |
| Irregular grid | quad mesh (hex→tri→merge→subdivide→relax) + corner states | Townscaper look | Sylves (C#) `TownscaperGrid`; own TS port: half-edge mesh + this solver over a neighbour graph |
| Godot | TileMapLayer / GridMap 2D slice | 2D maps, flat 3D layers | AlexeyBond/godot-constraint-solving (MIT; backtracking, threads, learns rules from an example map; no global constraints, no 3D) |

Oskar Stålberg's tricks (Bad North / Townscaper): WFC on *corners* of an irregular grid (marching-squares style)
rather than cells; heuristics that keep each zone navigable during collapse; and pin cells from the user/plan
before solving.

## Socket-based simple-tiled solver (`wfc.ts`, tested)

Uses `mulberry32`/`hashSeed` from your rng module. Sockets are strings per side; two tiles may touch when the
facing sockets are equal. For asymmetric edges, use directional labels (`"wall_l"` vs `"wall_r"`) and list both
orientations explicitly.

```ts
// wfc.ts: simple-tiled WFC with sockets, weights, pinned cells, deterministic restarts. 2D grid; see notes for 3D/irregular.
import { mulberry32, hashSeed } from './rng';

export type Tile = { name: string; weight: number; sockets: [string, string, string, string] }; // +x, +y, -x, -y
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], OPP = [2, 3, 0, 1];

/** Adds 90° rotations: rotating CCW maps +x→+y→-x→-y, so new[i] = old[(i + 3) % 4]. */
export function withRotations(base: Tile[], rotatable: (t: Tile) => boolean = () => true): Tile[] {
  const out: Tile[] = [], seen = new Set<string>();
  for (const t of base) {
    let s = t.sockets;
    for (let r = 0; r < (rotatable(t) ? 4 : 1); r++) {
      const key = s.join('|');
      if (!seen.has(t.name.split('@')[0] + key)) { seen.add(t.name.split('@')[0] + key); out.push({ name: `${t.name}@${r * 90}`, weight: t.weight, sockets: s }); }
      s = [s[3], s[0], s[1], s[2]];
    }
  }
  return out;
}

export function wfc(tiles: Tile[], W: number, H: number, seed: number,
  pinned: Record<number, number[]> = {}, maxAttempts = 20): { grid: Int32Array; attempts: number } | null {
  const T = tiles.length;
  // compat[d][a][b]: tile b may sit in direction d of tile a (sockets must be equal)
  const compat = [0, 1, 2, 3].map(d => tiles.map(a => tiles.map(b => a.sockets[d] === b.sockets[OPP[d]])));
  const logw = tiles.map(t => Math.log(t.weight));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = mulberry32(hashSeed(seed, attempt));
    const wave = new Uint8Array(W * H * T).fill(1), count = new Int32Array(W * H).fill(T);
    const stack: number[] = [];
    const ban = (c: number, t: number) => { if (wave[c * T + t]) { wave[c * T + t] = 0; count[c]--; stack.push(c); } };
    const propagate = (): boolean => {
      while (stack.length) {
        const c = stack.pop()!, x = c % W, y = (c / W) | 0;
        if (count[c] === 0) return false;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;   // non-periodic edges
          const n = nx + ny * W;
          for (let b = 0; b < T; b++) {
            if (!wave[n * T + b]) continue;
            let ok = false;
            for (let a = 0; a < T && !ok; a++) ok = wave[c * T + a] === 1 && compat[d][a][b];
            if (!ok) { ban(n, b); if (count[n] === 0) return false; }
          }
        }
      }
      return true;
    };
    let failed = false;
    for (const [cell, allowed] of Object.entries(pinned)) {      // pre-constraints: doors, roads at borders, etc.
      const set = new Set(allowed);
      for (let t = 0; t < T; t++) if (!set.has(t)) ban(+cell, t);
    }
    if (!propagate()) continue;
    for (;;) {
      // observe: lowest Shannon entropy cell, rng noise breaks ties deterministically
      let best = -1, bestE = Infinity;
      for (let c = 0; c < W * H; c++) {
        if (count[c] <= 1) continue;
        let sw = 0, swl = 0;
        for (let t = 0; t < T; t++) if (wave[c * T + t]) { sw += tiles[t].weight; swl += tiles[t].weight * logw[t]; }
        const e = Math.log(sw) - swl / sw + 1e-6 * rng();
        if (e < bestE) { bestE = e; best = c; }
      }
      if (best < 0) break;                                       // all collapsed
      let sw = 0; for (let t = 0; t < T; t++) if (wave[best * T + t]) sw += tiles[t].weight;
      let pick = rng() * sw, chosen = -1;
      for (let t = 0; t < T; t++) if (wave[best * T + t]) { chosen = t; pick -= tiles[t].weight; if (pick <= 0) break; }
      for (let t = 0; t < T; t++) if (t !== chosen) ban(best, t);
      if (!propagate()) { failed = true; break; }
    }
    if (failed) continue;
    const grid = new Int32Array(W * H);
    for (let c = 0; c < W * H; c++) for (let t = 0; t < T; t++) if (wave[c * T + t]) grid[c] = t;
    return { grid, attempts: attempt + 1 };
  }
  return null;
}

/** Validator: every adjacent pair must be compatible. Run it in tests, never trust the solver blindly. */
export function validate(tiles: Tile[], grid: Int32Array, W: number, H: number) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let d = 0; d < 2; d++) {
    const nx = x + DX[d], ny = y + DY[d]; if (nx >= W || ny >= H) continue;
    if (tiles[grid[x + y * W]].sockets[d] !== tiles[grid[nx + ny * W]].sockets[OPP[d]]) return false;
  }
  return true;
}
```

Usage and validation:

```ts
const base: Tile[] = [
  { name: 'grass', weight: 6, sockets: ['g', 'g', 'g', 'g'] },
  { name: 'road', weight: 2, sockets: ['r', 'g', 'r', 'g'] },
  { name: 'corner', weight: 1, sockets: ['r', 'r', 'g', 'g'] },
  { name: 'tee', weight: 0.5, sockets: ['r', 'r', 'r', 'g'] },
  { name: 'cross', weight: 0.2, sockets: ['r', 'r', 'r', 'r'] },
  { name: 'house', weight: 1.5, sockets: ['g', 'g', 'g', 'r'] },   // door faces -y onto a road
];
const tiles = withRotations(base);                                  // 16 unique variants
const W = 24, H = 16, gate = 0 + 8 * W;                             // pin: road enters at the west gate
const roadWest = tiles.flatMap((t, i) => (t.sockets[2] === 'r' ? [i] : []));
const res = wfc(tiles, W, H, seed, { [gate]: roadWest });
if (!res || !validate(tiles, res.grid, W, H) || !roadsConnected(res.grid)) regenerateWith(hashSeed(seed, 1));
```

Measured: 256/256 seeds solved without a restart on 24×16 with this set; 48×48 took ~240 ms in Node (naive
O(T²) propagation). Write `roadsConnected` as a BFS over road sockets. WFC never guarantees global properties,
so the plan + validator does.

## Scaling up

- **Performance**: precompute `compat[d][a]` as `Uint32Array` bitsets and AND/OR words instead of the inner loop,
  or keep mxgmn-style *support counters* (per cell, per tile, per direction: how many neighbour tiles still support
  it) so each ban is O(T). Run in a worker; chunk large maps.
- **Contradictions**: restarts (above) are simplest and deterministic. For big 3D maps, backtrack the last N
  decisions (DeBroglie, marian42) or solve in overlapping chunks with fixed borders.
- **3D**: 6 directions; add `+z/-z` and vertical sockets (`"roof"`, `"air"`, `"floor"`). Rotate only about the up
  axis. Encode vertical sockets with the rotation (`"stairs_0"`) if they're not rotationally symmetric. Pin the
  bottom layer to ground tiles and the top to air.
- **Irregular grids**: replace `(x, y, d)` with a neighbour table `nb[cell][edge] = { cell, edgeBack }`. Socket
  checks compare `sockets[edge]` with the neighbour's `sockets[edgeBack]`. The rest of the solver is unchanged.
- **Weights as design levers**: lower `cross`/`tee` weights for fewer intersections; boost `grass` near the edge
  with per-cell weight maps (multiply weights by a mask before choosing).

## Townscaper-style grid recipe (TS sketch)

1. Hex of triangles (`TriangleBound.Hexagon(n)` in Sylves terms): generate triangle lattice points within a hex.
2. Randomly pair adjacent triangles into quads (seeded). Leftover triangles stay.
3. Subdivide every polygon into quads (each n-gon → n quads via edge midpoints + centroid). Now everything is a quad.
4. Relax: move interior vertices towards the average of their neighbours for ~10-50 iterations (pin border vertices).
5. Treat quad *corners* as cells with an occupancy state per height level, and pick a module per quad by its 4
   (or 8 with height) corner states, marching-squares style. Deform the module to the quad with bilinear
   interpolation of its x/z.
6. For infinite worlds, generate per hex chunk with a seed derived from the hex coords, then relax across chunk
   borders (Sylves `PlanarLazyMeshGrid` + `RelaxModifier`).
