import assert from "node:assert/strict";
import test from "node:test";
import { crc32, inflateSync } from "node:zlib";
import { Img } from "../src/render/pixel/image.js";
import { encodePng } from "../tools/png.js";

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

/** Splits a PNG into chunks, checking the signature, every length and every CRC. */
function chunks(png: Buffer): Chunk[] {
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "signature",
  );
  const out: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    assert.equal(
      png.readUInt32BE(at + 8 + length),
      crc32(png.subarray(at + 4, at + 8 + length)),
      `${type} crc`,
    );
    out.push({ type, data });
    at += 12 + length;
  }
  assert.equal(at, png.length, "no trailing bytes");
  return out;
}

test("encodePng writes a valid RGBA PNG whose pixels round-trip", () => {
  const img = new Img(3, 2);
  img.px(0, 0, "#ff0000");
  img.px(2, 1, [10, 20, 30, 40]);
  const parts = chunks(encodePng(img));
  assert.deepEqual(
    parts.map((c) => c.type),
    ["IHDR", "IDAT", "IEND"],
  );
  const header = parts[0]?.data;
  assert.ok(header);
  assert.equal(header.readUInt32BE(0), 3);
  assert.equal(header.readUInt32BE(4), 2);
  assert.deepEqual([...header.subarray(8)], [8, 6, 0, 0, 0]);
  const raw = inflateSync(parts[1]?.data ?? Buffer.alloc(0));
  assert.equal(raw.length, (3 * 4 + 1) * 2);
  const pixels: number[] = [];
  for (let y = 0; y < 2; y++) {
    assert.equal(raw[y * 13], 0, "filter type none");
    pixels.push(...raw.subarray(y * 13 + 1, y * 13 + 13));
  }
  assert.deepEqual(pixels, [...img.d]);
});

test("encodePng honours a view into a larger buffer", () => {
  const whole = new Uint8ClampedArray(4 * 4 * 4);
  const view = new Img(2, 2, whole.subarray(16, 32));
  view.rect(0, 0, 2, 2, "#00ff00");
  const parts = chunks(encodePng(view));
  const raw = inflateSync(parts[1]?.data ?? Buffer.alloc(0));
  assert.deepEqual([...raw.subarray(1, 9)], [0, 255, 0, 255, 0, 255, 0, 255]);
});
