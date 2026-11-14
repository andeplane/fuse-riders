# Graph-based dungeons, solvers and seed sweeps

Everything below was run in Node 22 (`node --experimental-strip-types`). The 256-seed sweep passes on the first
attempt for every seed, and 2 000 raw generations are all valid. Drop the files into `src/levelgen/` and keep the
generator free of rendering imports (a deterministic core, a renderer on top, and a test
that enforces the split, e.g. an ESLint `no-restricted-imports` for `three` inside `src/levelgen/**`).

## Concepts (Dormans / Unexplored, via Boris the Brave's 2021 write-up)

- **Cycles, not trees.** A level is built around a major loop between entrance and goal. The two arcs get
  different jobs (one locked, one long; one dangerous, one hidden). Then minor cycles and dead ends are added.
- **Locks and keys are abstract** while planning. A key can be an item, a lever, an ability or knowledge; a lock can
  be a door, a gap or a guard. Keep the key↔lock relation in the data so the game can hint ("Pray For Help" in
  Unexplored finds what's blocking progress).
- **Valves** (one-way edges: drops, one-way doors) force forward progress and create shortcuts back. They are
  also the main source of soft-locks, hence the solver.
- **Layout on a lattice** (Unexplored starts from a 5×5 grid of nodes). Placing graph nodes on lattice cells makes
  the graph planar and overlap-free by construction. Each cell later expands to an R×R room (Unexplored doubles
  the grid for corridors, then scales ×5).

## Generator + solver (`dungeon.ts`)

```ts
// dungeon.ts: cyclic lock-and-key dungeon on a grid lattice + solver (deterministic)
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) { h ^= p | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 15; }
  return h >>> 0;
}

export type Room = { id: number; x: number; y: number; tag: 'start' | 'goal' | 'room'; key: number };
export type Edge = { a: number; b: number; lock: number; oneWay: boolean };    // lock = bitmask of keys; oneWay: a→b only
export type Dungeon = { rooms: Room[]; edges: Edge[]; W: number; H: number; pattern: string };

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function generateDungeon(seed: number, W = 8, H = 8): Dungeon {
  const r = mulberry32(seed), ri = (n: number) => Math.floor(r() * n);
  const grid = new Int32Array(W * H).fill(-1);
  const rooms: Room[] = [], edges: Edge[] = [];
  const add = (x: number, y: number, tag: Room['tag'] = 'room') => {
    const id = rooms.length; rooms.push({ id, x, y, tag, key: 0 }); grid[x + y * W] = id; return id;
  };
  const link = (a: number, b: number, lock = 0, oneWay = false) => edges.push({ a, b, lock, oneWay });
  const edgeBetween = (a: number, b: number) => edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))!;

  // 1. Major cycle: perimeter of a random rectangle on the lattice (planar, no overlaps by construction).
  const rw = 3 + ri(W - 3), rh = 3 + ri(H - 3), ox = ri(W - rw + 1), oy = ri(H - rh + 1);
  const loop: number[] = [];
  for (let x = 0; x < rw; x++) loop.push(add(ox + x, oy));
  for (let y = 1; y < rh; y++) loop.push(add(ox + rw - 1, oy + y));
  for (let x = rw - 2; x >= 0; x--) loop.push(add(ox + x, oy + rh - 1));
  for (let y = rh - 2; y > 0; y--) loop.push(add(ox, oy + y));
  const L = loop.length;
  for (let i = 0; i < L; i++) link(loop[i], loop[(i + 1) % L]);
  const s0 = ri(L), at = (k: number) => loop[(s0 + k + L) % L];   // rotate so start is random
  const patterns = ['lockAndKey', 'twoKeys', 'valveShortcut'] as const;
  const pattern = patterns[ri(patterns.length)];
  const gk = pattern === 'valveShortcut' ? Math.max(2, Math.floor(L / 3)) : L >> 1; // goal position on loop
  const start = at(0), goal = at(gk);
  rooms[start].tag = 'start'; rooms[goal].tag = 'goal';
  const arcA = Array.from({ length: gk - 1 }, (_, k) => at(k + 1));          // start → … → arcAEnd
  const arcB = Array.from({ length: L - gk - 1 }, (_, k) => at(L - 1 - k));  // start → … → arcBEnd (other way)
  const arcAEnd = at(gk - 1), arcBEnd = at(gk + 1);

  // 2. Dead-end branches (random walks into free cells): places to hide keys.
  const branch = (from: number, len: number) => {
    let cur = from;
    for (let s = 0; s < len; s++) {
      const { x, y } = rooms[cur];
      const free = DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < W && ny < H && grid[nx + ny * W] < 0);
      if (!free.length) break;
      const [nx, ny] = free[ri(free.length)];
      const n = add(nx, ny); link(cur, n); cur = n;
    }
    return cur === from ? -1 : cur;
  };

  // 3. Cycle pattern (Unexplored-style: the loop's two arcs get different jobs).
  if (pattern === 'lockAndKey') {
    // Arc A ends at a locked door. Key hides on a branch off arc B. Arc B→goal is a one-way valve back (shortcut).
    const tip = branch(arcB[ri(arcB.length)], 1 + ri(3));
    rooms[tip >= 0 ? tip : arcBEnd].key |= 1;
    edgeBetween(arcAEnd, goal).lock = 1;
    const e = edgeBetween(arcBEnd, goal); e.a = goal; e.b = arcBEnd; e.oneWay = true;
  } else if (pattern === 'twoKeys') {
    // Goal needs both keys; one per arc, each on a dead end.
    const t1 = branch(arcA[ri(arcA.length)], 1 + ri(2)), t2 = branch(arcB[ri(arcB.length)], 1 + ri(2));
    rooms[t1 >= 0 ? t1 : arcA[0]].key |= 1; rooms[t2 >= 0 ? t2 : arcB[0]].key |= 2;
    edgeBetween(arcAEnd, goal).lock = 3; edgeBetween(arcBEnd, goal).lock = 3;
  } else {
    // Short arc A is a one-way shortcut home (goal → arcAEnd). The long arc B ends in a door whose key is on a branch.
    const e = edgeBetween(arcAEnd, goal); e.a = goal; e.b = arcAEnd; e.oneWay = true;
    const tip = branch(arcB[ri(arcB.length)], 1 + ri(2));
    rooms[tip >= 0 ? tip : arcB[0]].key |= 1;
    edgeBetween(arcBEnd, goal).lock = 1;
  }
  // 4. Filler branches for exploration (no keys).
  for (let k = 0; k < 2 + ri(3); k++) branch(rooms[ri(rooms.length)].id, 1 + ri(2));
  return { rooms, edges, W, H, pattern };
}

export type Report = { solvable: boolean; steps: number; softlockStates: number; decorativeLocks: number[]; detour: number };

export function solve(d: Dungeon, dropKeys = 0): Report {
  const start = d.rooms.find(r => r.tag === 'start')!.id, goal = d.rooms.find(r => r.tag === 'goal')!.id;
  const adj: { to: number; lock: number }[][] = d.rooms.map(() => []);
  for (const e of d.edges) { adj[e.a].push({ to: e.b, lock: e.lock }); if (!e.oneWay) adj[e.b].push({ to: e.a, lock: e.lock }); }
  const keyAt = (n: number) => d.rooms[n].key & ~dropKeys;
  const K = 256, enc = (n: number, inv: number) => n * K + inv;   // ≤ 8 key types
  const s0 = enc(start, keyAt(start)), dist = new Map([[s0, 0]]), rev = new Map<number, number[]>();
  const q = [s0]; let steps = -1;
  for (let qi = 0; qi < q.length; qi++) {                            // forward BFS over (room, inventory)
    const s = q[qi], n = Math.floor(s / K), inv = s % K;
    if (n === goal && steps < 0) steps = dist.get(s)!;
    for (const { to, lock } of adj[n]) {
      if ((lock & inv) !== lock) continue;
      const t = enc(to, inv | keyAt(to));
      (rev.get(t) ?? rev.set(t, []).get(t)!).push(s);
      if (!dist.has(t)) { dist.set(t, dist.get(s)! + 1); q.push(t); }
    }
  }
  const canFinish = new Set<number>(), bq: number[] = [];               // backward from every goal state
  for (const s of dist.keys()) if (Math.floor(s / K) === goal) { canFinish.add(s); bq.push(s); }
  for (let qi = 0; qi < bq.length; qi++) for (const p of rev.get(bq[qi]) ?? []) if (!canFinish.has(p)) { canFinish.add(p); bq.push(p); }
  let softlockStates = 0; for (const s of dist.keys()) if (!canFinish.has(s)) softlockStates++;
  const decorativeLocks: number[] = [];
  if (!dropKeys) {
    const used = d.edges.reduce((m, e) => m | e.lock, 0);
    for (let k = 0; k < 8; k++) if (used & (1 << k) && solve(d, 1 << k).solvable) decorativeLocks.push(k);
  }
  // detour = solution length / shortest path ignoring locks and valves (>1 means real exploration)
  const plain = d.rooms.map(() => -1); plain[start] = 0; const pq = [start];
  const und: number[][] = d.rooms.map(() => []); for (const e of d.edges) { und[e.a].push(e.b); und[e.b].push(e.a); }
  for (let i = 0; i < pq.length; i++) for (const t of und[pq[i]]) if (plain[t] < 0) { plain[t] = plain[pq[i]] + 1; pq.push(t); }
  return { solvable: steps >= 0, steps, softlockStates, decorativeLocks, detour: steps > 0 ? steps / plain[goal] : 0 };
}

export function generateValid(seed: number, maxAttempts = 16) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const d = generateDungeon(hashSeed(seed, attempt));
    const rep = solve(d);
    if (rep.solvable && rep.softlockStates === 0 && rep.decorativeLocks.length === 0 && rep.detour >= 1.2) return { d, rep, attempt };
  }
  throw new Error(`seed ${seed}: no valid dungeon in ${maxAttempts} attempts`);
}

// Lattice → tile grid for the kit assembler (and an ASCII debug view). R = interior tiles per room side.
export function toTiles(d: Dungeon, R = 3) {
  const S = R + 1, TW = d.W * S + 1, TH = d.H * S + 1;
  const t: string[][] = Array.from({ length: TH }, () => Array(TW).fill(' '));
  for (const r of d.rooms) {
    for (let y = 0; y <= S; y++) for (let x = 0; x <= S; x++) {
      const tx = r.x * S + x, ty = r.y * S + y, edge = x === 0 || y === 0 || x === S || y === S;
      t[ty][tx] = edge ? '#' : '.';
    }
    const c = r.y * S + (S >> 1), cx = r.x * S + (S >> 1);
    t[c][cx] = r.tag === 'start' ? 'S' : r.tag === 'goal' ? 'G' : r.key ? 'k' : '.';
  }
  for (const e of d.edges) {
    const A = d.rooms[e.a], B = d.rooms[e.b];
    const wx = Math.max(A.x, B.x) * S, wy = Math.max(A.y, B.y) * S;            // shared wall line
    const [tx, ty] = A.x !== B.x ? [wx, A.y * S + (S >> 1)] : [A.x * S + (S >> 1), wy];
    t[ty][tx] = e.lock ? 'L' : e.oneWay ? (A.x < B.x ? '>' : A.x > B.x ? '<' : A.y < B.y ? 'v' : '^') : '+';
  }
  return t.map(row => row.join('')).join('\n');
}
```

### What the solver reports

| Field | Meaning | Reject when |
|---|---|---|
| `solvable` | goal reachable from start over `(room, inventory)` states | false |
| `softlockStates` | reachable states from which the goal is no longer reachable (one-way trap) | > 0 |
| `decorativeLocks` | key bits whose removal still leaves the level solvable | non-empty |
| `detour` | solution length / shortest path ignoring locks and valves | < 1.2 (too linear) |
| `steps` | solution length in rooms | outside your pacing band |

Extend the state when you add mechanics: consumable keys (inventory becomes counts), abilities (double jump
opens "gap" edges), switches that toggle doors (add the switch state bits). The state space stays tiny
(rooms × 2^keys), so brute force is fine up to ~16 binary key/switch bits.

## Seed sweep (vitest)

```ts
import { describe, expect, test } from 'vitest';
import { generateValid, generateDungeon, toTiles } from './dungeon';

describe('dungeon generator', () => {
  test('256 seeds are valid and rejections are rare', () => {
    let attempts = 0;
    for (let seed = 0; seed < 256; seed++) {
      const { rep, attempt } = generateValid(seed);
      expect(rep.softlockStates).toBe(0);
      expect(rep.decorativeLocks).toEqual([]);
      attempts += attempt + 1;
    }
    expect(attempts / 256).toBeLessThan(2);
  });
  test('deterministic', () => {
    expect(JSON.stringify(generateValid(42).d)).toBe(JSON.stringify(generateValid(42).d));
  });
  test('ascii snapshot', () => {
    expect(toTiles(generateValid(1).d, 2)).toMatchSnapshot();   // eyeball diffs in review
  });
});
```

Example output (`toTiles(d, 2)`, seed 7, pattern `twoKeys`: `S` start, `G` goal, `k` key, `L` locked, `+` door):

```
   ################+#####
   #..+..+..+..+..+..+k.#
   #..#..#..#..#..#..#..#
   #L##############+##+##
   #G.#     #..+k.#S.#..#
   #..#     #..#..#..#..#
   #L########+#####+##+##
   #..+..+..+..+..+..#..#
```

## From tiles to geometry

- Each `.` becomes a floor kit piece, each `#` adjacent to a floor becomes a wall (pick straight/corner/T by the
  4-neighbourhood bitmask), each `+` a doorway piece, `L` a locked door (key colour = lock bit), `> < ^ v` a drop
  ledge or one-way door. Unused lattice cells stay empty or become solid rock.
- Feed it into the `BatchedMesh` assembler in SKILL.md Recipe 1. Grid unit = kit tile size (KayKit/Kenney
  dungeon tiles are typically 2 or 4 units; measure).
- Room *content* (enemies, puzzles, loot) is a second pass keyed by the graph: distance-from-start for difficulty,
  the cycle arc for theme, dead ends for rewards.

## BSP rooms and cellular caves (`rooms.ts`)

```ts
// rooms.ts: BSP rooms + cellular-automata caves on a Uint8Array grid (1 = wall, 0 = floor). Deterministic.
import { mulberry32 } from './dungeon';

type Rect = { x: number; y: number; w: number; h: number };

export function bspDungeon(seed: number, W = 64, H = 40, minLeaf = 10) {
  const r = mulberry32(seed), g = new Uint8Array(W * H).fill(1), rooms: Rect[] = [];
  const carve = (x: number, y: number) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) g[x + y * W] = 0; };
  const corridor = (a: [number, number], b: [number, number]) => {        // L-shaped, 1 wide
    const [ax, ay] = a, [bx, by] = b, horizFirst = r() < 0.5;
    const cx = horizFirst ? bx : ax, cy = horizFirst ? ay : by;
    for (let x = Math.min(ax, cx); x <= Math.max(ax, cx); x++) carve(x, horizFirst ? ay : cy);
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(cx, y);
    for (let x = Math.min(cx, bx); x <= Math.max(cx, bx); x++) carve(x, by);
  };
  // returns a representative room centre for the subtree so siblings can be joined
  const node = (n: Rect): [number, number] => {
    const canV = n.w >= 2 * minLeaf, canH = n.h >= 2 * minLeaf;
    if (!canV && !canH) {
      const w = 4 + Math.floor(r() * (n.w - 5)), h = 4 + Math.floor(r() * (n.h - 5));
      const x = n.x + 1 + Math.floor(r() * (n.w - w - 1)), y = n.y + 1 + Math.floor(r() * (n.h - h - 1));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) carve(xx, yy);
      rooms.push({ x, y, w, h });
      return [x + (w >> 1), y + (h >> 1)];
    }
    const vertical = canV && (!canH || (n.w >= n.h ? r() < 0.8 : r() < 0.2));
    const span = vertical ? n.w : n.h, cut = minLeaf + Math.floor(r() * (span - 2 * minLeaf + 1));
    const [A, B]: Rect[] = vertical
      ? [{ ...n, w: cut }, { x: n.x + cut, y: n.y, w: n.w - cut, h: n.h }]
      : [{ ...n, h: cut }, { x: n.x, y: n.y + cut, w: n.w, h: n.h - cut }];
    const a = node(A), b = node(B);
    corridor(a, b);
    return r() < 0.5 ? a : b;
  };
  node({ x: 0, y: 0, w: W, h: H });
  return { g, rooms, W, H };
}

export function caves(seed: number, W = 64, H = 40, fill = 0.45, steps = 5) {
  const r = mulberry32(seed);
  let g = Uint8Array.from({ length: W * H }, (_, i) => {
    const x = i % W, y = (i / W) | 0;
    return x === 0 || y === 0 || x === W - 1 || y === H - 1 || r() < fill ? 1 : 0;
  });
  for (let s = 0; s < steps; s++) {                                     // 4-5 rule
    const n = new Uint8Array(W * H).fill(1);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) walls += g[x + dx + (y + dy) * W];
      n[x + y * W] = walls >= 5 ? 1 : 0;
    }
    g = n;
  }
  // keep only the largest open region (flood fill), so every floor tile is reachable
  const label = new Int32Array(W * H).fill(-1); let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < W * H; i++) {
    if (g[i] || label[i] >= 0) continue;
    const q = [i]; label[i] = id;
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      for (const o of [1, -1, W, -W]) { const j = c + o; if (!g[j] && label[j] < 0) { label[j] = id; q.push(j); } }
    }
    if (q.length > bestSize) { bestSize = q.length; best = id; }
    id++;
  }
  for (let i = 0; i < W * H; i++) if (!g[i] && label[i] !== best) g[i] = 1;
  return { g, W, H, openFraction: bestSize / (W * H) };
}

/** Validator: every floor tile reachable from the first one. */
export function connected(g: Uint8Array, W: number) {
  const start = g.indexOf(0); if (start < 0) return false;
  const seen = new Uint8Array(g.length), q = [start]; seen[start] = 1; let n = 1;
  for (let k = 0; k < q.length; k++) for (const o of [1, -1, W, -W]) { const j = q[k] + o; if (j >= 0 && j < g.length && !g[j] && !seen[j]) { seen[j] = 1; q.push(j); n++; } }
  return n === g.reduce((s, v) => s + (v ? 0 : 1), 0);
}
```

Sweep result: 256 seeds of each: 0 disconnected maps, ≥ 12 BSP rooms, and the largest cave region always kept
(≥ 23 % open). `rot-js` gives you the same generators plus FOV/pathfinding (`RNG.setSeed(n)` before
`new Map.Digger(w, h).create(cb)`). Use it when you also want its FOV and scheduler. BSP and caves give you
*space*. Put the mission graph's locks onto them by computing the room adjacency graph (rooms + corridors), then
running the same lock placement + solver on that graph.

## Engine tools

- **Edgar** (OndrejNepozitek): you supply the room graph + hand-made room templates, and it finds non-overlapping
  layouts with doors aligned. Edgar-Unity (MIT, not resellable; PRO adds directed graphs, platformer/isometric).
  Edgar-DotNet is the core. Edgar.Godot (RickyYCheng, MIT, Godot 4.5, C# or GDExtension kernel). Keep fewer
  than ~30 rooms per level (author's advice).
- **Gaea** (Godot addon, gaea-godot/gaea): graph-node generation for tile/grid worlds, good for cave/overworld
  tiles. Not for lock-and-key logic; do that in your own graph code.
