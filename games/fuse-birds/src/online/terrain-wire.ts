import {
  decodeState,
  encodeState,
  HEIGHT,
  WIDTH,
  type Match,
} from "../engine/index.js";
const BYTES = (WIDTH * HEIGHT) / 8;
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
function base64(bytes: Uint8Array): string {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(raw);
}
/** Bounded byte runs reduce ordinary terrain transfers; incompressible masks use packed raw bytes. */
export function encodeMatch(state: Match): unknown {
  const copy = encodeState(state),
    bytes = copy.terrain.bits;
  const runs: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const value = bytes[i]!;
    let count = 1;
    while (
      count < 65535 &&
      i + count < bytes.length &&
      bytes[i + count] === value
    )
      count++;
    runs.push(count >>> 8, count & 255, value);
    i += count;
    // No benefit is possible once run encoding reaches the raw size.
    if (runs.length >= bytes.length)
      return {
        ...copy,
        terrain: { ...copy.terrain, bits: "b1:" + base64(bytes) },
      };
  }
  return {
    ...copy,
    terrain: { ...copy.terrain, bits: "r1:" + base64(Uint8Array.from(runs)) },
  };
}
export function decodeMatch(raw: unknown): Match | undefined {
  if (!record(raw) || !record(raw.terrain)) return;
  const encoded = raw.terrain.bits;
  if (typeof encoded !== "string" || encoded.length > 3 + (BYTES * 4) / 3)
    return;
  const mode = encoded.slice(0, 3),
    payload = encoded.slice(3);
  // Both encodings use a multiple of three bytes and canonical unpadded Base64.
  if (
    !["b1:", "r1:"].includes(mode) ||
    !payload.length ||
    payload.length % 4 ||
    !/^[A-Za-z0-9+/]+$/.test(payload)
  )
    return;
  const packed = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  let bytes: Uint8Array;
  if (mode === "b1:") {
    if (packed.length !== BYTES) return;
    bytes = packed;
  } else {
    if (packed.length % 3) return;
    bytes = new Uint8Array(BYTES);
    let offset = 0;
    for (let i = 0; i < packed.length; i += 3) {
      const count = packed[i]! * 256 + packed[i + 1]!;
      if (!count || offset + count > BYTES) return;
      bytes.fill(packed[i + 2]!, offset, offset + count);
      offset += count;
    }
    if (offset !== BYTES) return;
  }
  return decodeState({ ...raw, terrain: { ...raw.terrain, bits: bytes } });
}
