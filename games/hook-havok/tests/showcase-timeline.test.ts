import test from "node:test";
import assert from "node:assert/strict";
import {
  showcasePose,
  DURATION,
  ANCHOR,
} from "../src/render/showcase-timeline.js";

test("idle remains horizontally registered with planted feet across the whole breathing cycle", () => {
  for (let time = 0; time <= 6000; time += 25) {
    const pose = showcasePose(time, true);
    assert.equal(pose.x, 310);
    assert.equal(pose.feet, 810);
    assert.equal(pose.frame, 0);
    assert.ok(pose.scaleY >= 0.991 && pose.scaleY <= 1.009);
    assert.equal(pose.hook, null);
  }
});
test("hook flies before attachment, stays anchored during pull and detaches on release", () => {
  assert.equal(showcasePose(5299).hook, null);
  const flying = showcasePose(5450).hook!;
  assert.equal(flying.attached, false);
  assert.ok(flying.y > ANCHOR.y);
  for (const time of [5650, 6000, 7000, 7499])
    assert.deepEqual(showcasePose(time).hook, { ...ANCHOR, attached: true });
  assert.equal(showcasePose(7500).hook, null);
});
test("authored movement is position-continuous at transitions and loop reset is hidden", () => {
  for (const time of [1800, 3000, 4100, 5300, 5650, 5900, 7500, 8600]) {
    const a = showcasePose(time - 0.01),
      b = showcasePose(time);
    assert.ok(Math.abs(a.x - b.x) < 0.1);
    assert.ok(Math.abs(a.feet - b.feet) < 0.1);
  }
  assert.equal(showcasePose(DURATION).alpha, 0);
  assert.ok(showcasePose(DURATION - 0.01).alpha < 0.001);
  assert.equal(showcasePose(8600).feet, 330);
});
