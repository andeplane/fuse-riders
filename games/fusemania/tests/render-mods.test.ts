import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACKOUT,
  BOOMERANG,
  COLUMNS,
  DOUBLE,
  DRUNK,
  FLIP,
  HIDDEN,
  LAG,
  MINES,
  TORNADO,
  TURBO,
  WAVE,
  type Effect,
} from "../src/engine/view-kit.js";
import {
  BASE_WINDOW_MS,
  EASE_MS,
  aheadMs,
  behindMs,
  blackoutAt,
  modsAt,
  noMods,
  notePlacement,
  targetX,
  type LaneGeometry,
  type Mods,
} from "../src/render/mods.js";
import { quantOf } from "../src/render/palette.js";
import { firstEndingAt } from "../src/render/chart.js";

const KEYS = [
  "drunk",
  "wave",
  "boomerang",
  "tornado",
  "hidden",
  "flip",
  "turbo",
  "blackout",
  "lag",
] as const;
const KINDS: Record<(typeof KEYS)[number], number> = {
  drunk: DRUNK,
  wave: WAVE,
  boomerang: BOOMERANG,
  tornado: TORNADO,
  hidden: HIDDEN,
  flip: FLIP,
  turbo: TURBO,
  blackout: BLACKOUT,
  lag: LAG,
};
const lane = (down: boolean): LaneGeometry => ({
  columnWidth: 64,
  targetY: down ? 560 : 80,
  length: 520,
  runout: 46,
  windowMs: BASE_WINDOW_MS,
  down,
});
const only = (key: (typeof KEYS)[number], strength = 1): Mods => ({
  ...noMods(),
  [key]: strength,
});
const everything = (): Mods => {
  const mods = noMods();
  for (const key of KEYS) mods[key] = 1;
  return mods;
};

test("an attack's strength is 0 outside it, 1 in its middle, and eases over its edges", () => {
  for (const key of KEYS) {
    const effects: Effect[] = [[KINDS[key], 10_000, 18_000, 1]];
    const at = (ms: number) => modsAt(effects, ms)[key];
    assert.equal(at(9_000), 0, key);
    assert.equal(at(10_000), 0, `${key} at its start`);
    assert.equal(at(18_000), 0, `${key} at its end`);
    assert.equal(at(19_000), 0, key);
    assert.equal(at(14_000), 1, key);
    assert.equal(at(10_000 + EASE_MS), 1, `${key} once eased in`);
    assert.equal(at(18_000 - EASE_MS), 1, `${key} before easing out`);
    const half = at(10_000 + EASE_MS / 2);
    assert.ok(Math.abs(half - 0.5) < 1e-9, `${key} half way in`);
    assert.ok(
      Math.abs(at(18_000 - EASE_MS / 2) - 0.5) < 1e-9,
      `${key} half way out`,
    );
    let before = 0;
    for (let ms = 10_000; ms <= 10_000 + EASE_MS; ms += 10) {
      const now = at(ms);
      assert.ok(now >= before && now >= 0 && now <= 1, `${key} rises`);
      // No jump: a 10 ms step moves the strength a little.
      assert.ok(now - before < 0.06, `${key} eases`);
      before = now;
    }
    // Only its own mod moves.
    const mods = modsAt(effects, 14_000);
    for (const other of KEYS) if (other !== key) assert.equal(mods[other], 0);
  }
});

test("modsAt takes the strongest of a kind, ignores what is not a visual attack, and refills what it is given", () => {
  const out = everything();
  assert.deepEqual(modsAt([], 0, out), noMods());
  assert.equal(modsAt([], 0, out), out, "the same object comes back");
  const effects: Effect[] = [
    [DRUNK, 0, 5000, 1],
    [DRUNK, 4900, 9000, 2],
    [MINES, 0, 9000, 1],
    [DOUBLE, 0, 9000, 0],
    [99, 0, 9000, 0],
  ];
  const mods = modsAt(effects, 4950);
  assert.equal(mods.drunk, modsAt([[DRUNK, 0, 5000, 1]], 4950).drunk);
  assert.deepEqual({ ...mods, drunk: 0 }, noMods());
  // A short effect never reaches full strength but stays within bounds.
  const brief = modsAt([[FLIP, 0, 200, 1]], 100).flip;
  assert.ok(brief > 0 && brief < 1);
});

test("under every mod at full strength a note at ahead = 0 sits exactly on its target", () => {
  const cases: [string, Mods][] = [
    ["none", noMods()],
    ...KEYS.map((key): [string, Mods] => [key, only(key)]),
    ["everything", everything()],
    ["half of everything", { ...everything(), flip: 0.5, tornado: 0.5 }],
  ];
  for (const [name, mods] of cases)
    for (const down of [false, true])
      for (const songMs of [0, 1234, 98_765.4])
        for (let column = 0; column < COLUMNS; column++) {
          const geometry = lane(down);
          const at = notePlacement(mods, column, 0, songMs, geometry);
          const where = `${name}, column ${column}, down ${down}`;
          assert.equal(at.x, targetX(mods.flip, column, geometry), where);
          assert.equal(at.y, geometry.targetY, where);
          assert.equal(at.rotation, 0, where);
          assert.equal(at.scale, 1, where);
        }
});

test("without mods a note scrolls in a straight line towards its target, from the far end", () => {
  const up = lane(false),
    down = lane(true);
  for (let column = 0; column < COLUMNS; column++) {
    const far = notePlacement(noMods(), column, BASE_WINDOW_MS, 0, up);
    assert.equal(far.x, (column + 0.5) * 64);
    assert.ok(Math.abs(far.y - (80 + 520)) < 1e-9, "rises from the bottom");
    assert.equal(far.alpha, 0, "comes in faint");
    const half = notePlacement(noMods(), column, BASE_WINDOW_MS / 2, 0, up);
    assert.ok(Math.abs(half.y - (80 + 260)) < 1e-9);
    assert.equal(half.alpha, 1);
    const falling = notePlacement(
      noMods(),
      column,
      BASE_WINDOW_MS / 2,
      0,
      down,
    );
    assert.ok(Math.abs(falling.y - (560 - 260)) < 1e-9, "falls from the top");
  }
  // Past the target a note that was not hit runs on and fades out by the lane's edge.
  const past = notePlacement(noMods(), 0, -100, 0, up);
  assert.ok(past.y < 80 && past.alpha > 0 && past.alpha < 1);
  const gone = notePlacement(noMods(), 0, -behindMs(noMods(), up), 0, up);
  assert.equal(gone.alpha, 0);
  assert.equal(aheadMs(noMods(), up), BASE_WINDOW_MS);
});

test("a note's place is continuous in how far ahead it is, under every mod", () => {
  const cases = [...KEYS.map((key) => only(key)), everything()];
  for (const mods of cases)
    for (const down of [false, true]) {
      const geometry = lane(down);
      const far = aheadMs(mods, geometry),
        near = -behindMs(mods, geometry);
      for (let column = 0; column < COLUMNS; column++) {
        let before = notePlacement(mods, column, near, 5000, geometry, {
          x: 0,
          y: 0,
          alpha: 0,
          rotation: 0,
          scale: 1,
        });
        before = { ...before };
        for (let ahead = near + 1; ahead <= far; ahead += 1) {
          const at = notePlacement(mods, column, ahead, 5000, geometry);
          assert.ok(Math.abs(at.x - before.x) < 3, "x does not jump");
          assert.ok(Math.abs(at.y - before.y) < 3, "y does not jump");
          assert.ok(Math.abs(at.alpha - before.alpha) < 0.05, "no pop");
          assert.ok(Math.abs(at.rotation - before.rotation) < 0.02);
          assert.ok(Math.abs(at.scale - before.scale) < 0.02);
          assert.ok(at.alpha >= 0 && at.alpha <= 1);
          before = at;
        }
      }
    }
});

test("boomerang: arrows leave from the target side, fly out, turn round and come back on time", () => {
  const geometry = lane(false),
    mods = only("boomerang");
  const distance = (ahead: number) =>
    notePlacement(mods, 1, ahead, 0, geometry).y - geometry.targetY;
  const far = aheadMs(mods, geometry);
  assert.equal(far, BASE_WINDOW_MS * 1.5, "they come into view early");
  assert.ok(Math.abs(distance(far)) < 1e-6, "they start at the target");
  assert.equal(notePlacement(mods, 1, far, 0, geometry).alpha, 0);
  // Out, then back: the distance grows as the note's time nears, peaks, then shrinks to nothing.
  let peak = 0,
    peakAt = far,
    turned = false,
    before = distance(far);
  for (let ahead = far - 10; ahead >= 0; ahead -= 10) {
    const now = distance(ahead);
    if (now > peak) {
      peak = now;
      peakAt = ahead;
    }
    if (now < before) turned = true;
    else assert.ok(!turned, "once it has turned it only comes closer");
    before = now;
  }
  assert.ok(turned);
  assert.ok(peakAt > 0.6 * BASE_WINDOW_MS && peakAt < 0.9 * BASE_WINDOW_MS);
  assert.ok(peak > geometry.length * 0.5 && peak < geometry.length * 0.6);
  assert.equal(distance(0), 0);
});

test("flip mirrors the columns and their targets; half way they cross", () => {
  const geometry = lane(false);
  for (let column = 0; column < COLUMNS; column++) {
    const mirror = COLUMNS - 1 - column;
    assert.equal(targetX(1, column, geometry), targetX(0, mirror, geometry));
    for (const ahead of [0, 300, 900]) {
      const flipped = notePlacement(only("flip"), column, ahead, 0, geometry),
        plain = notePlacement(noMods(), mirror, ahead, 0, geometry);
      assert.equal(flipped.x, plain.x);
      assert.equal(flipped.y, plain.y);
    }
    assert.equal(targetX(0.5, column, geometry), geometry.columnWidth * 2);
  }
});

test("turbo doubles the speed, hidden fades the last third, lag is the scene's and leaves the place alone", () => {
  const geometry = lane(false);
  const plain = notePlacement(noMods(), 0, 400, 0, geometry).y,
    turbo = notePlacement(only("turbo"), 0, 400, 0, geometry).y;
  assert.ok(
    Math.abs(turbo - geometry.targetY - 2 * (plain - geometry.targetY)) < 1e-9,
  );
  assert.equal(aheadMs(only("turbo"), geometry), BASE_WINDOW_MS / 2);

  const hidden = (ahead: number) =>
    notePlacement(only("hidden"), 2, ahead, 0, geometry).alpha;
  assert.equal(hidden(BASE_WINDOW_MS * 0.6), 1, "plain to see far out");
  assert.equal(hidden(BASE_WINDOW_MS * 0.36), 1);
  assert.ok(
    hidden(BASE_WINDOW_MS * 0.2) > 0 && hidden(BASE_WINDOW_MS * 0.2) < 1,
  );
  assert.equal(hidden(BASE_WINDOW_MS * 0.05), 0, "gone before the target");
  assert.equal(
    notePlacement(only("hidden"), 2, 500, 0, geometry).y,
    notePlacement(noMods(), 2, 500, 0, geometry).y,
    "it only fades",
  );
  for (const key of ["lag", "blackout"] as const)
    assert.deepEqual(
      notePlacement(only(key), 2, 500, 77, geometry),
      notePlacement(noMods(), 2, 500, 77, geometry),
    );
});

test("wave bunches and stretches the arrows but never runs them backwards; drunk sways with distance and time; a tornado swirls the columns", () => {
  const geometry = lane(false);
  // Wave: the spacing between evenly timed notes varies, and the order never changes.
  let before = notePlacement(only("wave"), 0, 0, 0, geometry).y,
    least = Infinity,
    most = 0;
  for (let ahead = 20; ahead <= BASE_WINDOW_MS; ahead += 20) {
    const y = notePlacement(only("wave"), 0, ahead, 0, geometry).y;
    assert.ok(y > before, "still coming");
    least = Math.min(least, y - before);
    most = Math.max(most, y - before);
    before = y;
  }
  assert.ok(most > least * 4, "it surges and stalls");

  // Drunk: off its column out in the field, changing with time and with distance, true at the target.
  const sway = (ahead: number, songMs: number) =>
    notePlacement(only("drunk"), 1, ahead, songMs, geometry).x - 1.5 * 64;
  let widest = 0;
  for (let ms = 0; ms < 2000; ms += 50)
    widest = Math.max(widest, Math.abs(sway(1200, ms)));
  assert.ok(widest > 20 && widest <= 0.55 * 64 + 1e-9);
  assert.notEqual(sway(1200, 0), sway(1200, 400));
  assert.notEqual(sway(1200, 0), sway(800, 0));
  assert.equal(sway(0, 400), 0);

  // Tornado: columns leave their own lane further out, and stay inside the field.
  let moved = 0;
  for (let column = 0; column < COLUMNS; column++)
    for (let ahead = 0; ahead <= BASE_WINDOW_MS; ahead += 25) {
      const x = notePlacement(only("tornado"), column, ahead, 0, geometry).x;
      assert.ok(x >= 0.5 * 64 - 1e-9 && x <= 3.5 * 64 + 1e-9);
      moved = Math.max(moved, Math.abs(x - (column + 0.5) * 64));
    }
  assert.ok(moved > 64 * 2, "they cross the field");
});

test("a blackout is dark between beats and flashes on each one", () => {
  assert.equal(blackoutAt(0, 3.5), 0);
  assert.equal(blackoutAt(1, 4), 0, "the flash on the beat");
  assert.equal(blackoutAt(1, 4.5), 1);
  assert.equal(blackoutAt(1, 4.99), 1);
  assert.ok(blackoutAt(1, 4.08) > 0 && blackoutAt(1, 4.08) < 1);
  assert.equal(blackoutAt(0.5, 4.5), 0.5);
  assert.equal(blackoutAt(1, -0.5), 1, "before the song too");
});

test("a note's colour is its place in the beat", () => {
  assert.deepEqual(
    [
      0,
      7,
      0.5,
      3.5,
      1 / 3,
      5 + 2 / 3,
      0.25,
      0.75,
      1 / 6,
      0.125,
      0.875,
      0.1,
      0.37,
    ].map(quantOf),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5],
  );
});

test("the first note that can be on screen is found without scanning the chart", () => {
  const notes = Array.from({ length: 1000 }, (_, i) => ({
    ms: i * 100,
    endMs: i * 100 + (i % 7 === 0 ? 60 : 0),
    column: 0,
    kind: 0,
    beat: i,
  }));
  const ids = notes.map((_, id) => id);
  for (const ms of [-50, 0, 1, 60, 61, 99, 100, 49_999, 99_900, 99_901, 1e9]) {
    const expected = notes.findIndex((note) => note.endMs >= ms);
    assert.equal(
      firstEndingAt(notes, ids, ms),
      expected < 0 ? ids.length : expected,
      String(ms),
    );
  }
  assert.equal(firstEndingAt(notes, [], 5), 0);
});
