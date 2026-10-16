import { crc32, deflateSync } from "node:zlib";
import type { Img } from "../src/render/pixel/image.js";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An 8-bit RGBA PNG of the image (no interlace, filter type 0 on every row). */
export function encodePng(img: Img): Buffer {
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
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
