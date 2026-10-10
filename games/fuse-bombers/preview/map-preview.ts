/**
 * Renders the temple map to a PNG, one pixel per 4 px cell: rock (purple), indestructible rock (blue, teal edges),
 * spawn anchors (gold: a gunship-sized disc, its 60 px clearance ring and its index), sky zones (blue outlines) and a
 * 400 px grid.
 *
 *   pnpm exec tsx games/fuse-bombers/preview/map-preview.ts [out.png]
 *
 * Writes games/fuse-bombers/docs/images/temple-map.png by default.
 */
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { cellHard, cellSolid } from "../src/engine/grid.js";
import { TEMPLE_MAP, buildTempleGrid } from "../src/engine/temple-map.js";

type Rgb = readonly [number, number, number];

const out =
  process.argv[2] ??
  new URL("../docs/images/temple-map.png", import.meta.url).pathname;
const grid = buildTempleGrid();
const { cols: w, rows: h, cell } = grid;
const pixels = new Uint8Array(w * h * 3);

function put(x: number, y: number, rgb: Rgb, alpha = 1): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (Math.floor(y) * w + Math.floor(x)) * 3;
  for (const [k, v] of rgb.entries())
    pixels[i + k] = Math.round((pixels[i + k] ?? 0) * (1 - alpha) + v * alpha);
}

const edge = (col: number, row: number): boolean =>
  [-1, 1].some(
    (d) => !cellSolid(grid, col + d, row) || !cellSolid(grid, col, row + d),
  );
for (let row = 0; row < h; row++)
  for (let col = 0; col < w; col++) {
    let color: Rgb = [10 + (row * 12) / h, 12 + (row * 10) / h, 34 + row / 30];
    if (cellHard(grid, col, row))
      color = edge(col, row) ? [120, 255, 230] : [66, 84, 150];
    else if (cellSolid(grid, col, row))
      color = edge(col, row) ? [214, 140, 255] : [86, 58, 128];
    else if (col % 100 === 0 || row % 100 === 0) color = [30, 36, 70];
    put(col, row, color);
  }

for (const { x0, y0, x1, y1 } of TEMPLE_MAP.skyZones)
  for (let x = x0 / cell; x < x1 / cell; x++)
    for (let y = y0 / cell; y < y1 / cell; y++) {
      const inner = Math.min(x - x0 / cell, y - y0 / cell, x1 / cell - 1 - x);
      const border = Math.min(inner, y1 / cell - 1 - y) < 1;
      put(x, y, [80, 170, 255], border ? 0.9 : 0.08);
    }

// A 3 × 5 pixel font for the anchor numbers, drawn at double size.
// prettier-ignore
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
TEMPLE_MAP.spawnAnchors.forEach((anchor, index) => {
  const [cx, cy] = [anchor.x / cell, anchor.y / cell];
  const [ring, ship] = [60 / cell, 26 / cell]; // clearance and gunship radius
  for (let x = Math.floor(cx - ring) - 1; x <= cx + ring + 1; x++)
    for (let y = Math.floor(cy - ring) - 1; y <= cy + ring + 1; y++) {
      const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= ship) put(x, y, [255, 210, 80]);
      else if (Math.abs(d - ring) < 0.6) put(x, y, [255, 210, 80], 0.8);
    }
  [...String(index)].forEach((digit, k) => {
    const glyph = DIGITS[Number(digit)] ?? "";
    for (let i = 0; i < 60; i++) {
      const [px, py] = [i % 6, Math.floor(i / 6)]; // 6 × 10 pixels
      if (glyph[Math.floor(py / 2) * 3 + (px >> 1)] === "1")
        put(cx + ring + 3 + k * 8 + px, cy - 5 + py, [255, 230, 150]);
    }
  });
});

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const frame = Buffer.alloc(8 + data.length + 4);
  frame.writeUInt32BE(data.length, 0);
  body.copy(frame, 4);
  frame.writeUInt32BE(crc32(body), 8 + data.length);
  return frame;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(w, 0);
header.writeUInt32BE(h, 4);
header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
const raw = Buffer.alloc((w * 3 + 1) * h); // each row: filter byte 0, then RGB
for (let y = 0; y < h; y++)
  raw.set(pixels.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const idat = chunk("IDAT", deflateSync(raw, { level: 9 }));
const end = chunk("IEND", Buffer.alloc(0));
writeFileSync(
  out,
  Buffer.concat([signature, chunk("IHDR", header), idat, end]),
);
console.log(`wrote ${out} (${w}×${h})`);
