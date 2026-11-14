import test from "node:test";
import assert from "node:assert/strict";
import {
  DOUBLE,
  FLIP,
  FULL_RATING,
  ITEM_BASE,
  ITEM_GAP_FLOOR,
  ITEM_GAP_FULL_PCT,
  ITEM_KINDS,
  ITEM_POWER,
  NO_ITEM,
  SHIELD,
  STAR,
  WAVE,
  isAttack,
  itemEdge,
  itemWeights,
  rollItem,
  type PlayContext,
  type Steps,
} from "../src/engine/index.js";

/** Each item's share of the drops at an edge, out of 1. */
function shares(edge: number, alone = false): number[] {
  const weights = itemWeights(edge, alone);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

/** The average power of a drop at an edge. */
const meanPower = (edge: number): number =>
  shares(edge).reduce((sum, share, kind) => sum + share * ITEM_POWER[kind]!, 0);

const STEPS: Steps = {
  notes: [],
  lanes: [[], [], [], []],
  mines: [[], [], [], []],
  steps: 0,
  holds: 0,
  full: 1,
  firstMs: 0,
  lastMs: 0,
};
const context = (edge: number, of = 2, slot = 0, seed = 7): PlayContext => ({
  steps: STEPS,
  seed,
  slot,
  edge,
  of,
});

test("the tuning table covers every item with a power from 1 to 10", () => {
  assert.equal(ITEM_BASE.length, ITEM_KINDS);
  assert.equal(ITEM_POWER.length, ITEM_KINDS);
  assert.equal(ITEM_BASE[NO_ITEM], 0);
  for (let kind = 1; kind < ITEM_KINDS; kind++) {
    assert.ok(ITEM_BASE[kind]! > 0, `item ${kind} can drop`);
    assert.ok(ITEM_POWER[kind]! >= 1 && ITEM_POWER[kind]! <= 10);
  }
  // Flip is the one Anders called out: nothing is rated harder.
  assert.equal(ITEM_POWER[FLIP], Math.max(...ITEM_POWER));
});

test("the edge follows the score gap: level is 0, it grows with the gap and saturates", () => {
  assert.equal(itemEdge([0, 0], 0), 0);
  assert.equal(itemEdge([400_000, 400_000, 400_000], 1), 0);
  assert.equal(itemEdge([123_456], 0), 0);
  // Two riders: the same gap, opposite signs.
  assert.equal(itemEdge([500_000, 450_000], 0), -500);
  assert.equal(itemEdge([500_000, 450_000], 1), 500);
  // A full gap is ITEM_GAP_FULL_PCT of the best rating; beyond it nothing more happens.
  const full = (500_000 * ITEM_GAP_FULL_PCT) / 100;
  assert.equal(itemEdge([500_000, 500_000 - full], 1), 1000);
  assert.equal(itemEdge([500_000, 100_000], 1), 1000);
  assert.equal(itemEdge([500_000, 100_000], 0), -1000);
  // Monotonic in the gap.
  let last = 0;
  for (let gap = 0; gap <= 150_000; gap += 5000) {
    const edge = itemEdge([500_000, 500_000 - gap], 1);
    assert.ok(edge >= last);
    last = edge;
  }
  // Early in a song the floor keeps one miss from being a landslide.
  assert.ok(
    itemEdge([2000, 0], 1) <=
      (2000 * 100_000) / (ITEM_GAP_FLOOR * ITEM_GAP_FULL_PCT),
  );
  assert.ok(itemEdge([2000, 0], 1) < 250);
  // Never outside the range, whatever the ratings.
  assert.equal(itemEdge([FULL_RATING, 0, 0, 0], 0), -1000);
  assert.equal(itemEdge([FULL_RATING, 0, 0, 0], 3), 1000);
});

test("in a larger match the edge follows the gap to the others, not the place", () => {
  const ratings = [600_000, 590_000, 540_000, 520_000];
  const edges = ratings.map((_, slot) => itemEdge(ratings, slot));
  // Leader and a close second are both ahead, by nearly the same amount; the two at the back are behind.
  assert.ok(edges[0]! < 0 && edges[1]! < 0);
  assert.ok(Math.abs(edges[0]! - edges[1]!) < 150);
  assert.ok(edges[2]! > 0 && edges[3]! > edges[2]!);
  assert.deepEqual(
    [...edges].sort((a, b) => a - b),
    edges,
  );
});

test("level riders draw the base table", () => {
  const level = itemWeights(0, false);
  for (let kind = 0; kind < ITEM_KINDS; kind++)
    assert.equal(level[kind], ITEM_BASE[kind]! * 1000);
});

test("the further ahead, the weaker the drops; the further behind, the stronger", () => {
  let last = -Infinity;
  for (let edge = -1000; edge <= 1000; edge += 100) {
    const power = meanPower(edge);
    assert.ok(power > last, `mean power rises at edge ${edge}`);
    last = power;
  }
  // The table moves by a real amount, not a rounding error.
  assert.ok(meanPower(1000) - meanPower(-1000) > 2);
  assert.ok(meanPower(-1000) < meanPower(0) && meanPower(0) < meanPower(1000));
});

test("each item moves smoothly with the gap, the strong ones up and the mild ones down", () => {
  for (let kind = 1; kind < ITEM_KINDS; kind++) {
    const strong = ITEM_POWER[kind]! > 5;
    let last = shares(-1000)[kind]!;
    for (let edge = -900; edge <= 1000; edge += 100) {
      const share = shares(edge)[kind]!;
      assert.ok(
        strong ? share >= last : share <= last,
        `item ${kind} at edge ${edge}`,
      );
      // No hard switch: a tenth of the gap never moves an item by more than three points of share.
      assert.ok(Math.abs(share - last) < 0.03);
      last = share;
    }
  }
});

test("flip is rare for a clear leader and common for a rider well behind", () => {
  assert.ok(shares(-1000)[FLIP]! < 0.01);
  assert.ok(shares(0)[FLIP]! > 0.05);
  assert.ok(shares(1000)[FLIP]! > 0.11);
  // Half a gap is halfway there, not all or nothing.
  assert.ok(shares(-500)[FLIP]! > shares(-1000)[FLIP]!);
  assert.ok(shares(-500)[FLIP]! < shares(0)[FLIP]!);
  // The leader's table leans on the mild ones.
  assert.ok(shares(-1000)[WAVE]! > 2 * shares(1000)[WAVE]!);
  assert.ok(shares(-1000)[SHIELD]! > 2 * shares(1000)[SHIELD]!);
  assert.ok(shares(1000)[STAR]! > 5 * shares(-1000)[STAR]!);
});

test("a rider alone only draws the items it uses on itself", () => {
  const alone = itemWeights(0, true);
  for (let kind = 0; kind < ITEM_KINDS; kind++)
    assert.equal(alone[kind]! > 0, kind !== NO_ITEM && !isAttack(kind));
  for (let id = 0; id < 200; id++) {
    const item = rollItem(context(0, 1), id);
    assert.ok(item === DOUBLE || item === STAR || item === SHIELD);
  }
});

test("rolled drops match the table and are the same on every device", () => {
  const SAMPLES = 20_000;
  for (const edge of [-1000, -400, 0, 400, 1000]) {
    const counts = Array.from({ length: ITEM_KINDS }, () => 0);
    for (let id = 0; id < SAMPLES; id++) {
      const item = rollItem(context(edge), id);
      assert.notEqual(item, NO_ITEM);
      // The same seed, note and seat give the same item, however often it is asked.
      assert.equal(rollItem(context(edge), id), item);
      counts[item]!++;
    }
    const expected = shares(edge);
    for (let kind = 1; kind < ITEM_KINDS; kind++)
      assert.ok(
        Math.abs(counts[kind]! / SAMPLES - expected[kind]!) < 0.012,
        `item ${kind} at edge ${edge}: ${counts[kind]! / SAMPLES} against ${expected[kind]}`,
      );
  }
  // A different seed or seat is a different draw.
  const row = (seed: number, slot: number) =>
    Array.from({ length: 64 }, (_, id) =>
      rollItem(context(0, 2, slot, seed), id),
    );
  assert.notDeepEqual(row(7, 0), row(8, 0));
  assert.notDeepEqual(row(7, 0), row(7, 1));
});
