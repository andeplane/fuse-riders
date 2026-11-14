/**
 * Pixel-art image tools for the Killer Fuse art pipeline (`scripts/killer-fuse-art.ts`): a dependency-free PNG
 * codec and the operations that turn an image model's "pixel art" (soft, off-grid, any colour) into real sprites
 * on one grid and one palette. Nothing here runs in the game.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface Img {
  w: number;
  h: number;
  /** RGBA, row-major. Alpha is only ever 0 or 255 once an image has been through `snap`. */
  d: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

export const img = (w: number, h: number): Img => ({
  w,
  h,
  d: new Uint8ClampedArray(w * h * 4),
});

export const hex = (value: string): Rgb => {
  const n = parseInt(value.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Channel `c` of pixel (x, y); 0 outside the image. */
export const at = (m: Img, x: number, y: number, c: number) =>
  x < 0 || y < 0 || x >= m.w || y >= m.h
    ? 0
    : (m.d[(y * m.w + x) * 4 + c] ?? 0);

export const alpha = (m: Img, x: number, y: number) => at(m, x, y, 3);

export const rgbAt = (m: Img, x: number, y: number): Rgb => [
  at(m, x, y, 0),
  at(m, x, y, 1),
  at(m, x, y, 2),
];

export const put = (m: Img, x: number, y: number, c: Rgb, a = 255) => {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
  const i = (y * m.w + x) * 4;
  m.d[i] = c[0];
  m.d[i + 1] = c[1];
  m.d[i + 2] = c[2];
  m.d[i + 3] = a;
};

export const clear = (m: Img, x: number, y: number) =>
  put(m, x, y, [0, 0, 0], 0);

export const fill = (m: Img, c: Rgb, a = 255) => {
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) put(m, x, y, c, a);
  return m;
};

export const rect = (
  m: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  c: Rgb,
) => {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) put(m, x + i, y + j, c);
};

export const copy = (m: Img): Img => ({ w: m.w, h: m.h, d: m.d.slice() });

export const crop = (
  m: Img,
  x: number,
  y: number,
  w: number,
  h: number,
): Img => {
  const out = img(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (alpha(m, x + i, y + j))
        put(out, i, j, rgbAt(m, x + i, y + j), alpha(m, x + i, y + j));
  return out;
};

/** Draws `src` onto `dst` with its top left at (x, y); transparent source pixels leave `dst` alone. */
export const blit = (
  dst: Img,
  src: Img,
  x: number,
  y: number,
  flip = false,
) => {
  for (let j = 0; j < src.h; j++)
    for (let i = 0; i < src.w; i++) {
      const sx = flip ? src.w - 1 - i : i;
      if (alpha(src, sx, j) >= 128) put(dst, x + i, y + j, rgbAt(src, sx, j));
    }
};

/** Alpha-blends `src` over `dst` at `opacity`; for mock scenes and dim background layers only. */
export const blend = (
  dst: Img,
  src: Img,
  x: number,
  y: number,
  opacity = 1,
) => {
  for (let j = 0; j < src.h; j++)
    for (let i = 0; i < src.w; i++) {
      const a = (alpha(src, i, j) / 255) * opacity;
      if (a <= 0) continue;
      const s = rgbAt(src, i, j);
      const t = rgbAt(dst, x + i, y + j);
      put(dst, x + i, y + j, [
        Math.round(s[0] * a + t[0] * (1 - a)),
        Math.round(s[1] * a + t[1] * (1 - a)),
        Math.round(s[2] * a + t[2] * (1 - a)),
      ]);
    }
};

export const flipX = (m: Img): Img => {
  const out = img(m.w, m.h);
  blit(out, m, 0, 0, true);
  return out;
};

/** Integer nearest-neighbour upscale. */
export const scaleUp = (m: Img, k: number): Img => {
  const out = img(m.w * k, m.h * k);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const sx = Math.floor(x / k);
      const sy = Math.floor(y / k);
      put(out, x, y, rgbAt(m, sx, sy), alpha(m, sx, sy));
    }
  return out;
};

/** Bounding box of the opaque pixels, or undefined for an empty image. */
export const bounds = (m: Img) => {
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (alpha(m, x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

export const trim = (m: Img): Img => {
  const b = bounds(m);
  return b ? crop(m, b.x, b.y, b.w, b.h) : img(1, 1);
};

// ---------------------------------------------------------------------------------------------------------------
// PNG

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Uint8Array) => {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, body.length + 8)), body.length + 8);
  return out;
};

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Encodes as an indexed PNG when the image has at most 256 colours (every game sprite does: a few bytes per
 * frame), else as RGBA.
 */
export const encodePng = (m: Img): Buffer => {
  const colours = new Map<number, number>();
  for (let i = 0; i < m.w * m.h && colours.size <= 256; i++) {
    const a = m.d[i * 4 + 3] ?? 0;
    const key = a
      ? (((m.d[i * 4] ?? 0) << 24) |
          ((m.d[i * 4 + 1] ?? 0) << 16) |
          ((m.d[i * 4 + 2] ?? 0) << 8) |
          a) >>>
        0
      : 0;
    if (!colours.has(key)) colours.set(key, colours.size);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(m.w, 0);
  head.writeUInt32BE(m.h, 4);
  head[8] = 8;
  if (colours.size <= 256) {
    head[9] = 3;
    const palette = Buffer.alloc(colours.size * 3);
    const trns = Buffer.alloc(colours.size);
    for (const [key, index] of colours) {
      palette[index * 3] = key >>> 24;
      palette[index * 3 + 1] = (key >>> 16) & 255;
      palette[index * 3 + 2] = (key >>> 8) & 255;
      trns[index] = key & 255;
    }
    const rows = Buffer.alloc((m.w + 1) * m.h);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const i = (y * m.w + x) * 4;
        const a = m.d[i + 3] ?? 0;
        const key = a
          ? (((m.d[i] ?? 0) << 24) |
              ((m.d[i + 1] ?? 0) << 16) |
              ((m.d[i + 2] ?? 0) << 8) |
              a) >>>
            0
          : 0;
        rows[y * (m.w + 1) + 1 + x] = colours.get(key) ?? 0;
      }
    return Buffer.concat([
      SIGNATURE,
      chunk("IHDR", head),
      chunk("PLTE", palette),
      chunk("tRNS", trns),
      chunk("IDAT", deflateSync(rows, { level: 9 })),
      chunk("IEND", new Uint8Array()),
    ]);
  }
  head[9] = 6;
  const rows = Buffer.alloc((m.w * 4 + 1) * m.h);
  for (let y = 0; y < m.h; y++)
    rows.set(
      m.d.subarray(y * m.w * 4, (y + 1) * m.w * 4),
      y * (m.w * 4 + 1) + 1,
    );
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
};

/** Decodes a non-interlaced 8-bit PNG (grey, RGB, palette, grey+alpha or RGBA): what image models and we write. */
export const decodePng = (file: Uint8Array): Img => {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let w = 0;
  let h = 0;
  let type = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const data: Buffer[] = [];
  for (let p = 8; p < buf.length;) {
    const length = buf.readUInt32BE(p);
    const name = buf.toString("latin1", p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + length);
    if (name === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      type = body[9] ?? 0;
      if (body[8] !== 8 || body[12] !== 0)
        throw new Error("only 8-bit non-interlaced PNGs are supported");
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") trns = body;
    else if (name === "IDAT") data.push(body);
    p += length + 12;
  }
  const channels = [1, 0, 3, 1, 2, 0, 4][type] ?? 0;
  if (!channels) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = w * channels;
  const out = img(w, h);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i] ?? 0;
      const a = i >= channels ? (line[i - channels] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= channels ? (prev[i - channels] ?? 0) : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = x * channels;
      const v = line[i] ?? 0;
      if (type === 0) put(out, x, y, [v, v, v]);
      else if (type === 2)
        put(out, x, y, [v, line[i + 1] ?? 0, line[i + 2] ?? 0]);
      else if (type === 3)
        put(
          out,
          x,
          y,
          [
            palette?.[v * 3] ?? 0,
            palette?.[v * 3 + 1] ?? 0,
            palette?.[v * 3 + 2] ?? 0,
          ],
          trns && v < trns.length ? (trns[v] ?? 255) : 255,
        );
      else if (type === 4) put(out, x, y, [v, v, v], line[i + 1] ?? 0);
      else
        put(
          out,
          x,
          y,
          [v, line[i + 1] ?? 0, line[i + 2] ?? 0],
          line[i + 3] ?? 0,
        );
    }
    prev.set(line);
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------
// Colour

export const hsl = ([r, g, b]: Rgb): [number, number, number] => {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const hue =
    max === R
      ? ((G - B) / d + 6) % 6
      : max === G
        ? (B - R) / d + 2
        : (R - G) / d + 4;
  return [hue * 60, s, l];
};

export const luma = ([r, g, b]: Rgb) =>
  (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Perceptually weighted squared distance ("redmean"), good enough to pick a nearest palette entry. */
export const dist = (a: Rgb, b: Rgb) => {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return (
    (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
  );
};

export const nearest = (c: Rgb, palette: readonly Rgb[]): Rgb => {
  let best = palette[0] ?? c;
  let bestD = Infinity;
  for (const p of palette) {
    const d = dist(c, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
};

/** True for the chroma-key background the prompts ask for (flat magenta), with tolerance for the model's drift. */
export const isKey = (c: Rgb) => {
  const [h, s, l] = hsl(c);
  return h > 280 && h < 325 && s > 0.6 && l > 0.3 && l < 0.75 && c[1] < 110;
};

/** True for the neutral team-colour region the prompts ask for (pure green). */
export const isTeam = (c: Rgb) => {
  const [h, s, l] = hsl(c);
  return h > 80 && h < 165 && s > 0.45 && l > 0.08 && l < 0.92;
};

/** Makes every chroma-key pixel transparent and every other pixel opaque. */
export const keyOut = (m: Img, key: (c: Rgb) => boolean = isKey): Img => {
  const out = copy(m);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (key(rgbAt(m, x, y)) || alpha(m, x, y) < 128) clear(out, x, y);
      else put(out, x, y, rgbAt(m, x, y));
    }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------
// Finding sprites and their pixel grid

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bounding boxes of the separate drawings on a keyed sheet, in reading order. Blobs closer than `gap` pixels are
 * one drawing (a detached antenna tip or spark belongs to its sprite); blobs under `minArea` pixels are noise.
 */
export const findSprites = (m: Img, gap: number, minArea: number): Box[] => {
  const cell = Math.max(2, Math.floor(gap / 2));
  const gw = Math.ceil(m.w / cell);
  const gh = Math.ceil(m.h / cell);
  const occupied = new Uint8Array(gw * gh);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (alpha(m, x, y))
        occupied[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1;
  const label = new Int32Array(gw * gh).fill(-1);
  const boxes: (Box & { area: number })[] = [];
  for (let start = 0; start < gw * gh; start++) {
    if (!occupied[start] || label[start] !== -1) continue;
    const id = boxes.length;
    const stack = [start];
    label[start] = id;
    let x0 = gw;
    let y0 = gh;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    while (stack.length) {
      const i = stack.pop() ?? 0;
      const cx = i % gw;
      const cy = Math.floor(i / gw);
      area++;
      x0 = Math.min(x0, cx);
      x1 = Math.max(x1, cx);
      y0 = Math.min(y0, cy);
      y1 = Math.max(y1, cy);
      // Two cells apart still connects: that is what makes `gap` a merge distance.
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (occupied[n] && label[n] === -1) {
            label[n] = id;
            stack.push(n);
          }
        }
    }
    boxes.push({
      x: x0 * cell,
      y: y0 * cell,
      w: (x1 - x0 + 1) * cell,
      h: (y1 - y0 + 1) * cell,
      area: area * cell * cell,
    });
  }
  const kept = boxes.filter((b) => b.area >= minArea);
  // Reading order: rows are groups whose vertical centres fall within half a sprite of each other.
  kept.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: (typeof kept)[] = [];
  for (const b of kept) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (
      row &&
      first &&
      Math.abs(first.y + first.h / 2 - (b.y + b.h / 2)) <
        Math.max(first.h, b.h) * 0.5
    )
      row.push(b);
    else rows.push([b]);
  }
  return rows
    .flatMap((row) => row.sort((a, b) => a.x - b.x))
    .map(({ x, y, w, h }) => ({ x, y, w, h }));
};

const colourStep = (m: Img, x0: number, y0: number, x1: number, y1: number) => {
  const a0 = alpha(m, x0, y0) >= 128;
  const a1 = alpha(m, x1, y1) >= 128;
  if (a0 !== a1) return 1;
  if (!a0) return 0;
  return dist(rgbAt(m, x0, y0), rgbAt(m, x1, y1)) > 3000 ? 1 : 0;
};

/** Edge energy per column (`axis` 0) or row (1) inside `box`: how many colour steps cross each line. */
const edgeProfile = (m: Img, box: Box, axis: 0 | 1) => {
  const n = axis === 0 ? box.w : box.h;
  const profile = new Float64Array(n);
  for (let j = 0; j < (axis === 0 ? box.h : box.w); j++)
    for (let i = 1; i < n; i++) {
      const x = axis === 0 ? box.x + i : box.x + j;
      const y = axis === 0 ? box.y + j : box.y + i;
      const px = axis === 0 ? x - 1 : x;
      const py = axis === 0 ? y : y - 1;
      profile[i] = (profile[i] ?? 0) + colourStep(m, px, py, x, y);
    }
  return profile;
};

const gridScore = (profile: Float64Array, pitch: number, phase: number) => {
  let total = 0;
  let on = 0;
  for (let i = 0; i < profile.length; i++) total += profile[i] ?? 0;
  if (!total) return 0;
  for (let line = phase; line < profile.length; line += pitch) {
    const i = Math.round(line);
    on += (profile[i - 1] ?? 0) + (profile[i] ?? 0) + (profile[i + 1] ?? 0);
  }
  // Share of the edges that sit on grid lines, less the share a random profile would put there.
  return on / total - Math.min(1, 3 / pitch);
};

export interface Grid {
  pitch: number;
  phaseX: number;
  phaseY: number;
  score: number;
}

/**
 * The art-pixel grid of the drawing inside `box`: image models draw "pixels" as soft squares of some arbitrary
 * size, so the pitch and phase are measured from where the colour steps line up rather than assumed.
 */
export const findGrid = (
  m: Img,
  box: Box,
  minPitch: number,
  maxPitch: number,
): Grid => {
  const px = edgeProfile(m, box, 0);
  const py = edgeProfile(m, box, 1);
  let best: Grid = { pitch: minPitch, phaseX: 0, phaseY: 0, score: -Infinity };
  for (let pitch = minPitch; pitch <= maxPitch; pitch += 0.05) {
    let bx = 0;
    let sx = -Infinity;
    let by = 0;
    let sy = -Infinity;
    for (let phase = 0; phase < pitch; phase += 0.5) {
      const a = gridScore(px, pitch, phase);
      if (a > sx) {
        sx = a;
        bx = phase;
      }
      const b = gridScore(py, pitch, phase);
      if (b > sy) {
        sy = b;
        by = phase;
      }
    }
    if (sx + sy > best.score)
      best = { pitch, phaseX: bx, phaseY: by, score: sx + sy };
  }
  return best;
};

/**
 * Samples the drawing in `box` onto its art-pixel grid: each cell takes the most common colour of its centre,
 * and is opaque when most of the cell is.
 */
export const snap = (m: Img, box: Box, grid: Grid): Img => {
  const { pitch } = grid;
  const x0 = box.x + grid.phaseX - pitch * Math.ceil(grid.phaseX / pitch);
  const y0 = box.y + grid.phaseY - pitch * Math.ceil(grid.phaseY / pitch);
  const cols = Math.ceil((box.x + box.w - x0) / pitch);
  const rows = Math.ceil((box.y + box.h - y0) / pitch);
  const out = img(cols, rows);
  const inset = pitch * 0.22;
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const buckets = new Map<
        number,
        { n: number; r: number; g: number; b: number }
      >();
      let opaque = 0;
      let total = 0;
      const xa = Math.round(x0 + cx * pitch + inset);
      const xb = Math.max(xa + 1, Math.round(x0 + (cx + 1) * pitch - inset));
      const ya = Math.round(y0 + cy * pitch + inset);
      const yb = Math.max(ya + 1, Math.round(y0 + (cy + 1) * pitch - inset));
      for (let y = ya; y < yb; y++)
        for (let x = xa; x < xb; x++) {
          total++;
          if (
            x < box.x ||
            y < box.y ||
            x >= box.x + box.w ||
            y >= box.y + box.h
          )
            continue;
          if (alpha(m, x, y) < 128) continue;
          opaque++;
          const [r, g, b] = rgbAt(m, x, y);
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          bucket.n++;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          buckets.set(key, bucket);
        }
      if (opaque * 2 <= total) continue;
      let top = { n: 0, r: 0, g: 0, b: 0 };
      for (const bucket of buckets.values()) if (bucket.n > top.n) top = bucket;
      put(out, cx, cy, [top.r / top.n, top.g / top.n, top.b / top.n]);
    }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------
// Resizing and cleaning real pixel art

/**
 * Shrinks pixel art by a non-integer factor without blurring it: each output pixel takes the colour that covers
 * most of its footprint, where similar colours pool their votes and small bright or dark details (eyes, pupils,
 * crown points) get `detail` extra weight so they survive.
 */
export const shrink = (
  m: Img,
  w: number,
  h: number,
  weight: (c: Rgb) => number = () => 1,
): Img => {
  const out = img(w, h);
  const fx = m.w / w;
  const fy = m.h / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const votes = new Map<number, { v: number; c: Rgb }>();
      let clearVotes = 0;
      let solid = 0;
      for (let sy = Math.floor(y * fy); sy < Math.ceil((y + 1) * fy); sy++)
        for (let sx = Math.floor(x * fx); sx < Math.ceil((x + 1) * fx); sx++) {
          const overlap =
            (Math.min(sx + 1, (x + 1) * fx) - Math.max(sx, x * fx)) *
            (Math.min(sy + 1, (y + 1) * fy) - Math.max(sy, y * fy));
          if (overlap <= 0) continue;
          if (alpha(m, sx, sy) < 128) {
            clearVotes += overlap;
            continue;
          }
          solid += overlap;
          const c = rgbAt(m, sx, sy);
          const key = (c[0] << 16) | (c[1] << 8) | c[2];
          const vote = votes.get(key) ?? { v: 0, c };
          vote.v += overlap * weight(c);
          votes.set(key, vote);
        }
      if (solid < clearVotes) continue;
      let top: { v: number; c: Rgb } | undefined;
      for (const vote of votes.values()) if (!top || vote.v > top.v) top = vote;
      if (top) put(out, x, y, top.c);
    }
  return out;
};

/** Maps every opaque pixel through `map`. */
export const recolour = (
  m: Img,
  map: (c: Rgb, x: number, y: number) => Rgb,
): Img => {
  const out = copy(m);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (alpha(m, x, y)) put(out, x, y, map(rgbAt(m, x, y), x, y));
  return out;
};

/** Removes opaque specks with fewer than `min` opaque neighbours in total (stray pixels left by snapping). */
export const despeckle = (m: Img, min = 2): Img => {
  const out = copy(m);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!alpha(m, x, y)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx || dy) && alpha(m, x + dx, y + dy)) n++;
      if (n < min) clear(out, x, y);
    }
  return out;
};

/** Adds a one-pixel outline of colour `c` around the opaque shape; the image grows by one pixel on every side. */
export const outline = (m: Img, c: Rgb, corners = false): Img => {
  const out = img(m.w + 2, m.h + 2);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const sx = x - 1;
      const sy = y - 1;
      if (alpha(m, sx, sy)) {
        put(out, x, y, rgbAt(m, sx, sy));
        continue;
      }
      const edge =
        alpha(m, sx - 1, sy) ||
        alpha(m, sx + 1, sy) ||
        alpha(m, sx, sy - 1) ||
        alpha(m, sx, sy + 1);
      const corner =
        corners &&
        (alpha(m, sx - 1, sy - 1) ||
          alpha(m, sx + 1, sy - 1) ||
          alpha(m, sx - 1, sy + 1) ||
          alpha(m, sx + 1, sy + 1));
      if (edge || corner) put(out, x, y, c);
    }
  return out;
};

/** Parses a hand-pixelled sprite: one character per pixel, looked up in `key`; `.` and space are transparent. */
export const fromRows = (
  rows: readonly string[],
  key: Record<string, Rgb>,
): Img => {
  const w = Math.max(...rows.map((row) => row.length));
  const out = img(w, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = key[ch];
      if (c) put(out, x, y, c);
    });
  });
  return out;
};

/**
 * Area-averaged downscale to exactly `w` by `h`, for dense art (backgrounds, the cover) that has no grid worth
 * measuring. A pixel is opaque when most of its footprint is; follow with `recolour` onto a palette to make the
 * averaged edges hard again.
 */
export const boxDown = (m: Img, w: number, h: number): Img => {
  const out = img(w, h);
  const fx = m.w / w;
  const fy = m.h / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      let total = 0;
      for (
        let sy = Math.floor(y * fy);
        sy < Math.max(Math.floor(y * fy) + 1, Math.floor((y + 1) * fy));
        sy++
      )
        for (
          let sx = Math.floor(x * fx);
          sx < Math.max(Math.floor(x * fx) + 1, Math.floor((x + 1) * fx));
          sx++
        ) {
          total++;
          if (alpha(m, sx, sy) < 128) continue;
          r += at(m, sx, sy, 0);
          g += at(m, sx, sy, 1);
          b += at(m, sx, sy, 2);
          n++;
        }
      if (n * 2 > total) put(out, x, y, [r / n, g / n, b / n]);
    }
  return out;
};
