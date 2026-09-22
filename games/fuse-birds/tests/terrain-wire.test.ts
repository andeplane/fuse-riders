import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, hashState } from "fuse-birds-game";
import { encodeMatch, decodeMatch } from "../src/online/terrain-wire.js";
const match = () =>
  createMatch("wire", 123, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
test("ordinary terrain compresses and arbitrary packed bytes have a bounded lossless fallback", () => {
  const state = match();
  let wire = encodeMatch(state);
  assert.ok(JSON.stringify(wire).length < 30_000);
  assert.equal(hashState(decodeMatch(wire)!), hashState(state));
  state.terrain.bits.forEach((_, i, bytes) => {
    bytes[i] = (i * 37 + Math.floor(i / 256)) & 255;
  });
  wire = encodeMatch(state);
  assert.equal(hashState(decodeMatch(wire)!), hashState(state));
  assert.ok(JSON.stringify(wire).length < 210_000);
});
test("terrain run decoding rejects zero, short, excessive, malformed and incompatible payloads", () => {
  const state = match();
  for (const bits of [
    "r1:AAAA",
    "r1:AAEA",
    "r1:////".padEnd(3 + 16, "/"),
    "r1:A===",
    "b1:AAAA",
    "x1:AAAA",
    "r1:",
    "r1:" + "A".repeat(196612),
  ]) {
    assert.equal(
      decodeMatch({ ...state, terrain: { ...state.terrain, bits } }),
      undefined,
      bits.slice(0, 20),
    );
  }
});
