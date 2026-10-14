import test from "node:test";
import assert from "node:assert/strict";
import { CITY } from "../src/game/index.js";
import { cloudAt, evening, glintLight, glints } from "../src/app/ambience.js";
import { inside } from "../src/app/layout.js";

test("the sun glints only on Fusetown's open water, never on its boats or piers", () => {
  const spots = glints();
  assert.ok(spots.length >= 60, `only ${spots.length} glints`);
  for (const glint of spots) {
    assert.ok(inside(CITY.water!.shape, glint.at), `${glint.at} is on land`);
    for (const hole of CITY.water!.holes)
      assert.ok(!inside(hole, glint.at), `${glint.at} is on a boat`);
  }
  assert.deepEqual(glints(), spots, "the same spots every time");
});

test("a city without water has no glints", () => {
  assert.deepEqual(glints({ ...CITY, water: undefined }), []);
});

test("a glint twinkles: dark most of a period, bright for a moment", () => {
  const glint = glints()[0]!;
  const samples = Array.from({ length: 200 }, (_, k) =>
    glintLight(glint, (k / 200) * glint.period),
  );
  const lit = samples.filter((light) => light > 0).length;
  assert.ok(lit > 0 && lit < 60, `${lit} of 200 samples lit`);
  assert.ok(samples.every((light) => light >= 0 && light <= 1));
});

test("the week's light stays daylight until 40 % of the hours are left, then turns to evening", () => {
  assert.equal(evening(1), 0);
  assert.equal(evening(0.4), 0);
  assert.ok(evening(0.2) > 0 && evening(0.2) < 1);
  assert.equal(evening(0), 1);
});

test("cloud shadows drift across the town and come round again", () => {
  for (let k = 0; k < 3; k++)
    for (const time of [0, 30, 600, 5000]) {
      const cloud = cloudAt(k, time);
      assert.ok(cloud.at[0] >= -cloud.radius);
      assert.ok(cloud.at[0] <= CITY.map.width + cloud.radius);
    }
  assert.notDeepEqual(cloudAt(0, 0).at, cloudAt(0, 10).at);
});
