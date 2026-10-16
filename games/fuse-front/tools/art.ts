/**
 * Renders the Fuse Front concept art from the pixel-art library to PNGs, upscaled with nearest-neighbour sampling:
 *
 *   pnpm exec tsx games/fuse-front/tools/art.ts [out-dir]
 *
 * Writes concept-battlefield.png, concept-hud.png, concept-title.png and concept-sheet.png to
 * games/fuse-front/docs/images/ by default.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { Img } from "../src/render/pixel/image.js";
import { BIOME, type BiomeId } from "../src/render/pixel/palette.js";
import { HEROES, portrait } from "../src/render/pixel/portraits.js";
import {
  MAP_THUMB_SEEDS,
  UNIT_CARDS,
  battlefield,
  factoryScene,
  mapThumb,
  titleScene,
  unitCard,
} from "../src/render/pixel/scenes.js";
import { hudBottom, logo } from "../src/render/pixel/ui.js";

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An RGBA PNG of the image. */
function encodePng(img: Img): Buffer {
  const stride = img.w * 4 + 1;
  const raw = Buffer.alloc(stride * img.h);
  for (let y = 0; y < img.h; y++)
    Buffer.from(img.d.buffer, img.d.byteOffset + y * img.w * 4, img.w * 4).copy(
      raw,
      y * stride + 1,
    );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.w, 0);
  header.writeUInt32BE(img.h, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Nearest-neighbour upscale by an integer factor. */
function upscale(src: Img, k: number): Img {
  const out = new Img(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++) {
    const row = Math.floor(y / k) * src.w;
    for (let x = 0; x < out.w; x++) {
      const s = (row + Math.floor(x / k)) * 4;
      out.d.set(src.d.subarray(s, s + 4), (y * out.w + x) * 4);
    }
  }
  return out;
}

/** Lays images out in rows on a dark backdrop, `gap` pixels apart. */
function contactSheet(rows: readonly (readonly Img[])[], gap = 4): Img {
  const width = Math.max(
    ...rows.map((r) => r.reduce((w, i) => w + i.w + gap, gap)),
  );
  const height = rows.reduce(
    (h, r) => h + Math.max(...r.map((i) => i.h)) + gap,
    gap,
  );
  const sheet = new Img(width, height);
  sheet.rect(0, 0, width, height, "#0e1013");
  let y = gap;
  for (const row of rows) {
    let x = gap;
    for (const img of row) {
      sheet.blit(img, x, y);
      x += img.w + gap;
    }
    y += Math.max(...row.map((i) => i.h)) + gap;
  }
  return sheet;
}

const outDir =
  process.argv[2] ?? fileURLToPath(new URL("../docs/images/", import.meta.url));
mkdirSync(outDir, { recursive: true });
const save = (img: Img, scale: number, name: string): void => {
  const png = encodePng(upscale(img, scale));
  writeFileSync(join(outDir, name), png);
  console.log(`${name} ${img.w * scale}x${img.h * scale} ${png.length} B`);
};

const field = battlefield();
save(field, 3, "concept-battlefield.png");
save(hudBottom(field), 3, "concept-hud.png");
save(titleScene(), 3, "concept-title.png");

const portraits = HEROES.map((who) => {
  const img = new Img(44, 44);
  portrait(img, 0, 0, who, "red");
  return img;
});
const biomes = Object.keys(BIOME) as BiomeId[];
save(
  contactSheet([
    [logo("FUSE FRONT")],
    portraits,
    UNIT_CARDS.map(unitCard),
    [factoryScene("robot"), factoryScene("vehicle")],
    biomes.map((b) => mapThumb(b, MAP_THUMB_SEEDS[b])),
  ]),
  4,
  "concept-sheet.png",
);
