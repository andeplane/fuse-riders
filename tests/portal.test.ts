import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortalPair,
  findPortalTransit,
  fitPortalPair,
  MAX_PORTAL_PAIRS,
  type PortalPair,
  type PortalTransitOptions,
} from "../src/shared/portal.ts";

const bounds = { minX: 20, minY: 20, maxX: 1580, maxY: 880 };
const pair: PortalPair = {
  id: "p",
  gates: [
    { x: 200, y: 200, halfLength: 100 },
    { x: 1000, y: 600, halfLength: 100 },
  ],
  expiresAtTick: 200,
};
const transit = (overrides: Partial<PortalTransitOptions> = {}) =>
  findPortalTransit({
    pairs: [pair],
    tick: 30,
    from: { x: 150, y: 200 },
    to: { x: 250, y: 200 },
    heading: 0.75,
    cooldownUntilTick: 0,
    bounds,
    riderRadius: 7,
    isSafeExit: () => true,
    ...overrides,
  });
/** A second pair far from the first, so the two never contest the same step unless placed to. */
const other: PortalPair = {
  id: "q",
  gates: [
    { x: 500, y: 200, halfLength: 100 },
    { x: 1300, y: 600, halfLength: 100 },
  ],
  expiresAtTick: 200,
};

test("placement sizes walls to one third of field, caps at 300 and reserves full corridor", () => {
  for (const maxY of [880, 1220]) {
    const values = [0, 0, 1, 1];
    const checked: Array<{ y: number; radius: number }> = [];
    const result = createPortalPair({
      id: "new",
      tick: 45,
      bounds: { ...bounds, maxY },
      riderRadius: 7,
      random: () => values.shift()!,
      isSafe: (point, radius) => {
        checked.push({ y: point.y, radius });
        return true;
      },
    });
    assert.ok(result);
    const length = Math.min(300, (maxY - 20) / 3);
    assert.equal(result.gates[0].halfLength * 2, length);
    assert.equal(result.gates[0].x, 32);
    assert.equal(result.gates[1].x, 1568);
    assert.equal(result.gates[0].y, 32 + length / 2);
    assert.equal(result.expiresAtTick, 245);
    assert.ok(checked.length > 20);
    assert.ok(
      checked.every((check) => check.radius >= 12 && check.radius <= 18),
    );
    assert.equal(checked[0]!.y, 32);
  }
});

test("placement remains bounded for unsafe or insufficiently separated sites", () => {
  for (const safe of [false, true]) {
    let draws = 0;
    let checks = 0;
    assert.equal(
      createPortalPair({
        id: "p",
        tick: 0,
        bounds,
        riderRadius: 7,
        random: () => {
          draws++;
          return 0.5;
        },
        isSafe: () => {
          checks++;
          return safe;
        },
      }),
      undefined,
    );
    assert.equal(draws, 48);
    assert.ok(checks >= 24 && checks <= 24 * 26);
  }
  for (const [maxX, maxY] of [
    [21, 880],
    [1580, 21],
    [100, 100],
  ] as const) {
    assert.equal(
      createPortalPair({
        id: "p",
        tick: 0,
        bounds: { ...bounds, maxX, maxY },
        riderRadius: 7,
        random: () => {
          throw new Error("should not draw");
        },
        isSafe: () => true,
      }),
      undefined,
    );
  }
});

test("full wall safety catches a hazard between sampled center and endpoints", () => {
  let checks = 0;
  const result = createPortalPair({
    id: "p",
    tick: 0,
    bounds,
    riderRadius: 7,
    random: () => 0.5,
    isSafe: (point, radius) => {
      checks++;
      return Math.abs(point.y - 385) > radius;
    },
  });
  assert.equal(result, undefined);
  assert.ok(checks > 24);
});

test("swept wall entry preserves heading and relative linked height", () => {
  assert.deepEqual(transit(), {
    pairId: "p",
    entryGateIndex: 0,
    entryPoint: { x: 189, y: 200 },
    exitPoint: { x: 1012, y: 600 },
    heading: 0.75,
    cooldownUntilTick: 45,
    graceUntilTick: 40,
  });
  assert.equal(
    transit({ from: { x: 150, y: 250 }, to: { x: 250, y: 250 } })?.exitPoint.y,
    650,
  );
  const short = {
    ...pair,
    gates: [pair.gates[0], { ...pair.gates[1], halfLength: 50 }] as const,
  };
  assert.equal(
    transit({
      pairs: [short],
      from: { x: 150, y: 250 },
      to: { x: 250, y: 250 },
    })?.exitPoint.y,
    625,
  );
});

test("both directions and earliest intersected wall work", () => {
  assert.deepEqual(
    transit({ from: { x: 1050, y: 600 }, to: { x: 950, y: 600 } })?.exitPoint,
    { x: 188, y: 200 },
  );
  const aligned = {
    ...pair,
    gates: [pair.gates[0], { ...pair.gates[1], y: 200 }] as const,
  };
  assert.equal(
    transit({
      pairs: [aligned],
      from: { x: 1100, y: 200 },
      to: { x: 100, y: 200 },
    })?.entryGateIndex,
    1,
  );
});

test("rounded endpoints detect vertical and tangent contact without phantom end extensions", () => {
  assert.deepEqual(
    transit({ from: { x: 200, y: 70 }, to: { x: 200, y: 110 } })?.entryPoint,
    { x: 200, y: 89 },
  );
  assert.deepEqual(
    transit({ from: { x: 200, y: 70 }, to: { x: 200, y: 110 } })?.exitPoint,
    { x: 1012, y: 500 },
  );
  assert.ok(transit({ from: { x: 150, y: 89 }, to: { x: 250, y: 89 } }));
  assert.equal(
    transit({ from: { x: 150, y: 88 }, to: { x: 250, y: 88 } }),
    undefined,
  );
  assert.equal(
    transit({ from: { x: 150, y: 312 }, to: { x: 250, y: 312 } }),
    undefined,
  );
});

test("cooldown, expiry, inside, stationary, moving away and short movement do not retrigger", () => {
  assert.equal(transit({ cooldownUntilTick: 31 }), undefined);
  assert.ok(transit({ cooldownUntilTick: 30 }));
  assert.equal(
    transit({ pairs: [{ ...pair, id: "second" }], cooldownUntilTick: 31 }),
    undefined,
  );
  assert.equal(transit({ tick: 200 }), undefined);
  assert.equal(transit({ pairs: [] }), undefined);
  for (const [from, to] of [
    [
      { x: 200, y: 200 },
      { x: 210, y: 200 },
    ],
    [
      { x: 150, y: 200 },
      { x: 150, y: 200 },
    ],
    [
      { x: 150, y: 200 },
      { x: 100, y: 200 },
    ],
    [
      { x: 150, y: 200 },
      { x: 180, y: 200 },
    ],
  ] as const)
    assert.equal(transit({ from, to }), undefined);
});

test("unsafe and out-of-field exits defer transit and safety receives actual offset exit", () => {
  assert.equal(transit({ isSafeExit: () => false }), undefined);
  const checks: unknown[] = [];
  transit({
    isSafeExit: (point, radius, pairId) => {
      checks.push([point, radius, pairId]);
      return true;
    },
  });
  assert.deepEqual(checks, [[{ x: 1012, y: 600 }, 7, "p"]]);
  for (const changed of [
    { maxX: 900 },
    { maxY: 500 },
    { minX: 1100 },
    { minY: 700 },
    { maxX: 21 },
    { maxY: 21 },
  ]) {
    assert.equal(transit({ bounds: { ...bounds, ...changed } }), undefined);
  }
});

test("shrinking trims walls and removes pairs whose centerline or usable ends are reclaimed", () => {
  assert.deepEqual(fitPortalPair(pair, bounds, 7), pair);
  const fitted = fitPortalPair(pair, { ...bounds, minY: 150, maxY: 700 }, 7)!;
  assert.equal(fitted.gates[0].y - fitted.gates[0].halfLength, 162);
  assert.ok(fitted.gates.every((gate) => gate.halfLength * 2 <= 550 / 3));
  for (const changed of [
    { minX: 190 },
    { maxX: 1010 },
    { minY: 350 },
    { maxY: 100 },
  ]) {
    assert.equal(fitPortalPair(pair, { ...bounds, ...changed }, 7), undefined);
  }
  assert.equal(
    pair.gates[0].halfLength,
    100,
    "original pair remains immutable",
  );
});

test("several live pairs each keep their own partner, whichever wall the step meets first", () => {
  const pairs = [pair, other];
  assert.deepEqual(
    transit({ pairs, from: { x: 150, y: 200 }, to: { x: 550, y: 200 } }),
    {
      pairId: "p",
      entryGateIndex: 0,
      entryPoint: { x: 189, y: 200 },
      exitPoint: { x: 1012, y: 600 },
      heading: 0.75,
      cooldownUntilTick: 45,
      graceUntilTick: 40,
    },
  );
  // The second pair's own gate, entered leftwards, leads to the second pair's own partner.
  assert.deepEqual(
    transit({ pairs, from: { x: 560, y: 200 }, to: { x: 450, y: 200 } })
      ?.exitPoint,
    { x: 1288, y: 600 },
  );
  // Distance along the step decides, not position in the list.
  assert.equal(
    transit({
      pairs: [other, pair],
      from: { x: 150, y: 200 },
      to: { x: 550, y: 200 },
    })?.pairId,
    "p",
  );
});

test("an exactly tied entry resolves by list order, which replay preserves", () => {
  const twin: PortalPair = {
    ...pair,
    id: "twin",
    gates: [{ ...pair.gates[0] }, { x: 1300, y: 600, halfLength: 100 }],
  };
  assert.equal(transit({ pairs: [pair, twin] })?.pairId, "p");
  assert.equal(transit({ pairs: [twin, pair] })?.pairId, "twin");
  assert.equal(transit({ pairs: [twin, pair] })?.exitPoint.x, 1312);
});

test("an expired pair is skipped while its neighbours stay open", () => {
  const pairs = [{ ...pair, expiresAtTick: 30 }, other];
  assert.deepEqual(
    transit({ pairs, from: { x: 150, y: 200 }, to: { x: 550, y: 200 } })
      ?.exitPoint,
    { x: 1312, y: 600 },
  );
  assert.equal(
    transit({ pairs: pairs.map((open) => ({ ...open, expiresAtTick: 30 })) }),
    undefined,
  );
});

test("every pair of a full list is scanned, including the last", () => {
  const filler = Array.from(
    { length: MAX_PORTAL_PAIRS - 1 },
    (_unused, index): PortalPair => ({
      id: `filler-${index}`,
      gates: [
        { x: 700 + index, y: 800, halfLength: 20 },
        { x: 1500, y: 800, halfLength: 20 },
      ],
      expiresAtTick: 200,
    }),
  );
  assert.equal(transit({ pairs: [...filler, pair] })?.pairId, "p");
});
