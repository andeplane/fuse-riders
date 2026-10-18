/**
 * The battlefield's ground as plain arrays, built once per match from the map's tiles: one world unit per tile, x east,
 * z south, y up. Cliffs (`^`) rise with steep faces, rivers (`~`, and the water under a bridge `=`) carve a bed, and
 * open sand rolls in low dunes. Cosmetic only: the engine still walks the tiles, never these heights.
 */

export interface Ground {
  width: number;
  height: number;
  terrain: readonly string[];
}

/** World height of each tile kind's floor. */
export const FLOOR: Readonly<Record<string, number>> = {
  ".": 0,
  "#": 0.1,
  "^": 1.4,
  "~": -0.7,
  "=": -0.7,
};
/** The river's surface and a bridge's deck. */
export const WATER_Y = -0.3;
export const DECK_Y = 0.08;
/** Vertices per tile edge: 3 keeps a cliff face within two thirds of a tile. */
export const RES = 3;
/** A big map (over `BIG_MAP` tiles) takes 2: less than half the vertices to build and draw, cliffs a little softer. */
export const BIG_MAP = 20000;
export const resFor = (map: Ground): number =>
  map.width * map.height > BIG_MAP ? 2 : RES;

export interface HeightField {
  cols: number;
  rows: number;
  res: number;
  heights: Float32Array;
}

/** A small deterministic hash in [0, 1). */
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1), wrapping every `wrap` cells when given (for tiling textures). */
export function noise(x: number, y: number, seed: number, wrap = 0): number {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const at = (i: number, j: number) =>
    wrap ? hash(i % wrap, j % wrap, seed) : hash(i, j, seed);
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

const tile = (map: Ground, x: number, y: number) =>
  map.terrain[Math.min(map.height - 1, Math.max(0, y))]?.[
    Math.min(map.width - 1, Math.max(0, x))
  ] ?? "#";

/** Heights on a grid of `width·res + 1` × `height·res + 1` vertices; a vertex on a tile edge averages its tiles. */
export function heightField(map: Ground, res = RES, seed = 7): HeightField {
  const cols = map.width * res + 1,
    rows = map.height * res + 1;
  const heights = new Float32Array(cols * rows);
  const span = (i: number) =>
    i % res === 0 ? [i / res - 1, i / res] : [Math.floor(i / res)];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      let sum = 0,
        n = 0,
        open = true,
        cliff = true;
      for (const ty of span(j))
        for (const tx of span(i)) {
          const c = tile(map, tx, ty);
          sum += FLOOR[c] ?? 0;
          n++;
          open &&= c === ".";
          cliff &&= c === "^";
        }
      const x = i / res,
        z = j / res;
      const dune = open ? (noise(x / 5, z / 5, seed) - 0.5) * 0.35 : 0;
      const crag = cliff ? (noise(x * 1.5, z * 1.5, seed + 1) - 0.5) * 0.5 : 0;
      heights[j * cols + i] = sum / n + dune + crag;
    }
  return { cols, rows, res, heights };
}

/** The ground's height under world point (x, z), bilinear between vertices. */
export function heightAt(field: HeightField, x: number, z: number): number {
  const { cols, rows, res, heights } = field;
  const gx = Math.min(cols - 1.001, Math.max(0, x * res)),
    gz = Math.min(rows - 1.001, Math.max(0, z * res));
  const i = Math.floor(gx),
    j = Math.floor(gz),
    fx = gx - i,
    fz = gz - j;
  const h = (a: number, b: number) => heights[b * cols + a]!;
  const top = h(i, j) + (h(i + 1, j) - h(i, j)) * fx;
  const bottom = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * fx;
  return top + (bottom - top) * fz;
}

/** Where something walking at (x, z) stands: on a bridge's deck, else on the ground. */
export function standY(
  map: Ground,
  field: HeightField,
  x: number,
  z: number,
): number {
  return tile(map, Math.floor(x), Math.floor(z)) === "="
    ? DECK_Y
    : Math.max(WATER_Y, heightAt(field, x, z));
}

/** Tiles the river fills: open water and the water under a bridge. */
export const wet = (c: string) => c === "~" || c === "=";

/** How far world point (x, z) lies from the nearest tile that passes `test`, looking `reach` tiles out (else `reach`). */
// prettier-ignore
export function distanceTo(map: Ground, x: number, z: number, test: (c: string) => boolean, reach = 2): number {
  let best = reach;
  for (let ty = Math.floor(z - reach); ty <= z + reach; ty++)
    for (let tx = Math.floor(x - reach); tx <= x + reach; tx++)
      if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height && test(tile(map, tx, ty)))
        best = Math.min(best, Math.hypot(Math.max(tx - x, 0, x - tx - 1), Math.max(ty - z, 0, z - ty - 1)));
  return best;
}

// Linear-light colours (sRGB squared, near enough) for sand, wet bed, damp bank and rock.
const lin = (hex: number) =>
  [hex >> 16, (hex >> 8) & 255, hex & 255].map((c) => (c / 255) ** 2.2);
const SAND = lin(0xd2ad78),
  BED = lin(0x8a7458),
  DAMP = lin(0x8c6c48),
  ROCK = lin(0x7a6a5c);

export interface TerrainBuffers {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * The ground mesh's vertex data: positions from the height field, colour by slope and height (darker on the river's
 * banks when `map` is given), world-space UVs.
 */
// prettier-ignore
export function terrainBuffers(field: HeightField, seed = 7, map?: Ground): TerrainBuffers {
  const { cols, rows, res, heights } = field;
  const count = cols * rows;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const h = (i: number, j: number) =>
    heights[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))]!;
  // Tiles within two of water: only their vertices can be damp, so the rest skip the search (a big map is mostly dry).
  const near = map && new Uint8Array(map.width * map.height);
  if (map && near)
    for (let ty = 0; ty < map.height; ty++)
      for (let tx = 0; tx < map.width; tx++)
        if (wet(tile(map, tx, ty)))
          for (let y = Math.max(0, ty - 2); y <= Math.min(map.height - 1, ty + 2); y++)
            for (let x = Math.max(0, tx - 2); x <= Math.min(map.width - 1, tx + 2); x++) near[y * map.width + x] = 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const v = j * cols + i, y = heights[v]!, x = i / res, z = j / res;
      positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
      uvs[v * 2] = x / 4; uvs[v * 2 + 1] = z / 4;
      const slope = Math.hypot(h(i + 1, j) - h(i - 1, j), h(i, j + 1) - h(i, j - 1)) * res;
      const rock = Math.min(1, Math.max(0, (slope - 0.6) * 1.5));
      const bed = Math.min(1, Math.max(0, -y * 2.5));
      const dry = !near || !near[Math.min(map!.height - 1, Math.floor(z)) * map!.width + Math.min(map!.width - 1, Math.floor(x))];
      const damp = map && !dry ? Math.max(0, 1 - distanceTo(map, x, z, wet, 1.5) / 1.5) ** 1.5 : 0;
      const tint = 0.9 + noise(x / 3, z / 3, seed + 2) * 0.2;
      for (let c = 0; c < 3; c++) {
        const sand = SAND[c]! + (DAMP[c]! - SAND[c]!) * damp;
        const ground = sand + (BED[c]! - sand) * bed;
        colors[v * 3 + c] = (ground + (ROCK[c]! - ground) * rock) * tint;
      }
    }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  for (let j = 0, k = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++, k += 6) {
      const a = j * cols + i, c = a + cols;
      indices[k] = a; indices[k + 1] = c; indices[k + 2] = a + 1;
      indices[k + 3] = a + 1; indices[k + 4] = c; indices[k + 5] = c + 1;
    }
  return { positions, colors, uvs, indices };
}

/** Tiles along a ground chunk's side: a big map's ground is cut into chunks so the camera draws only those in view. */
export const CHUNK = 64;

export interface Chunk {
  /** Triangles over the shared vertices of `terrainBuffers`, in its winding. */
  indices: Uint32Array;
  /** The chunk's extent in tiles (x east, z south). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The ground's triangles cut into `chunk` × `chunk`-tile pieces, row by row; together they are `terrainBuffers`'. */
// prettier-ignore
export function terrainChunks(field: HeightField, chunk = CHUNK): Chunk[] {
  const { cols, rows, res } = field;
  const step = chunk * res, out: Chunk[] = [];
  for (let j0 = 0; j0 < rows - 1; j0 += step)
    for (let i0 = 0; i0 < cols - 1; i0 += step) {
      const i1 = Math.min(cols - 1, i0 + step), j1 = Math.min(rows - 1, j0 + step);
      const indices = new Uint32Array((i1 - i0) * (j1 - j0) * 6);
      for (let j = j0, k = 0; j < j1; j++)
        for (let i = i0; i < i1; i++, k += 6) {
          const a = j * cols + i, c = a + cols;
          indices[k] = a; indices[k + 1] = c; indices[k + 2] = a + 1;
          indices[k + 3] = a + 1; indices[k + 4] = c; indices[k + 5] = c + 1;
        }
      out.push({ indices, x0: i0 / res, z0: j0 / res, x1: i1 / res, z1: j1 / res });
    }
  return out;
}

/** A tiling `size` × `size` height texture of three octaves of value noise in [0, 1). */
// prettier-ignore
export function tileNoise(size: number, cells: number, seed: number) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let o = 0, f = cells, a = 4 / 7; o < 3; o++, f *= 2, a /= 2)
        sum += noise((x / size) * f, (y / size) * f, seed + o, f) * a;
      out[y * size + x] = sum;
    }
  return out;
}

/** An RGBA normal map from a tiling height texture; `strength` steepens it. */
// prettier-ignore
export function normalMap(heights: Float32Array, size: number, strength = 4) {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)]!;
  const byte = (v: number) => Math.round((v * 0.5 + 0.5) * 255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength, dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const n = Math.hypot(dx, dy, 1);
      out.set([byte(dx / n), byte(dy / n), Math.round(255 / n), 255], (y * size + x) * 4);
    }
  return out;
}
