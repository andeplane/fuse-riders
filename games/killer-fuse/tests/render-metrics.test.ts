import test from "node:test";
import assert from "node:assert/strict";
import {
  frontOf,
  heightOver,
  opaqueBox,
  sizesOf,
  type Box,
} from "../src/render/metrics.js";
import { manifest } from "./render-kit.js";

/** RGBA of a frame drawn from rows of text: any character but a dot is paint. */
function pixels(rows: readonly string[]): number[] {
  return rows.flatMap((row) =>
    [...row].flatMap((cell) => (cell === "." ? [0, 0, 0, 0] : [9, 9, 9, 255])),
  );
}

test("the painted box of a frame is the bounds of its pixels", () => {
  const rows = [".....", "..#..", ".###.", "....."];
  assert.deepEqual(opaqueBox(pixels(rows), 5, 4), {
    left: 1,
    top: 1,
    right: 3,
    bottom: 2,
  });
  assert.equal(opaqueBox(pixels(["...", "..."]), 3, 2), null);
  assert.equal(opaqueBox([], 3, 2), null, "missing data is clear");
  assert.deepEqual(opaqueBox(pixels(["#"]), 1, 1), {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  });
});

test("height and reach are counted from the anchor", () => {
  const def = { anchor: [20, 19] as const, frameWidth: 40 };
  const box: Box = { left: 2, top: 5, right: 37, bottom: 19 };
  assert.equal(heightOver(def, box), 15);
  assert.equal(frontOf(def, box), 17);
  assert.equal(heightOver(def, null), 20, "the whole cell when unmeasured");
  assert.equal(frontOf(def, null), 19);
});

test("sizes follow the manifest and whatever was measured", () => {
  const art = manifest();
  const unmeasured = sizesOf(art, () => null);
  for (const [name, id] of [
    ["worker", "worker-cyan"],
    ["warrior", "warrior-cyan"],
    ["queen", "queen-cyan"],
    ["gate", "gate-warrior"],
    ["snail", "snail"],
  ] as const) {
    const def = art.assets[id];
    assert.ok(def, id);
    assert.equal(unmeasured[name], def.anchor[1] + 1);
  }
  const asked: string[] = [];
  const measured = sizesOf(art, (id) => {
    asked.push(id);
    return { left: 3, top: 7, right: 30, bottom: 99 };
  });
  const queen = art.assets["queen-cyan"];
  const snail = art.assets.snail;
  assert.ok(queen && snail);
  assert.equal(measured.queen, queen.anchor[1] - 6);
  assert.equal(measured.snailFront, 30 - snail.anchor[0]);
  assert.ok(asked.includes("gate-warrior"));
  const empty = sizesOf({ ...art, assets: {} }, () => null);
  assert.deepEqual(empty, {
    worker: 0,
    warrior: 0,
    queen: 0,
    gate: 0,
    snail: 0,
    snailFront: 0,
  });
});
