import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  S,
  BODY,
  NEUTRAL,
  DEFAULT_TUNING,
  type Input,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { move, overlaps, sweep } from "../src/engine/collision.js";
import { decodeWorld, parseInput, parseTuning } from "../src/engine/codec.js";
import {
  createRoom,
  foldTick,
  encode,
  decode,
  hash,
  isEntry,
  type Entry,
} from "../src/online/game.js";
import {
  JOIN,
  ACTION,
  PRESENCE,
  SETTINGS,
  type StreamEntries,
} from "fuse-netcode";

test("planted feet stay stable; running accelerates and stops", () => {
  const w = createWorld();
  for (let i = 0; i < 120; i++) step(w);
  assert.equal(w.feet, 810 * S - 1);
  assert.equal(w.x, 310 * S);
  w.input.move = 1;
  for (let i = 0; i < 15; i++) step(w);
  assert.ok(w.x > 340 * S);
  assert.equal(w.vx, 6 * S);
  w.input.move = 0;
  for (let i = 0; i < 20; i++) step(w);
  assert.equal(w.vx, 0);
  assert.equal(w.grounded, true);
});
test("early jump release lowers height, coyote time and buffered landing work", () => {
  const jump = (release: number) => {
    const w = createWorld();
    w.x = 490 * S;
    let top = w.feet;
    for (let i = 0; i < 55; i++) {
      w.input.jump = i < release;
      step(w);
      top = Math.min(top, w.feet);
    }
    return top;
  };
  assert.ok(jump(2) > jump(30) + 40 * S);
  const w = createWorld();
  w.x = 537 * S;
  w.grounded = false;
  w.coyote = 4;
  w.input.jump = true;
  step(w);
  assert.ok(w.vy < 0);
  const b = createWorld();
  b.feet = 805 * S;
  b.grounded = false;
  b.coyote = 0;
  b.vy = 6 * S;
  b.input.jump = true;
  step(b);
  assert.equal(b.grounded, true);
  step(b);
  assert.ok(b.vy < 0);
});
test("swept collision catches high speed landings, underside and wall; corner tie stable", () => {
  const w = createWorld();
  w.feet = 700 * S;
  w.vy = 200 * S;
  move(w);
  assert.equal(w.feet, 810 * S - 1);
  assert.equal(w.grounded, true);
  w.feet = 780 * S;
  w.vy = -150 * S;
  move(w);
  assert.equal(w.feet, 698 * S + BODY + 1);
  assert.equal(w.vy, 0);
  w.x = 180 * S;
  w.feet = 710 * S;
  w.vx = 100 * S;
  w.vy = 0;
  move(w);
  assert.equal(w.x, 204 * S - 1);
  assert.equal(overlaps(w.x, w.feet), false);
  const a = sweep(200 * S, 650 * S, 20 * S, 20 * S);
  assert.deepEqual(a, { time: 1, nx: 0, ny: -1, platform: 1 });
});
test("hook attaches to first ledge, pulls upward, releases and misses without stuck states", () => {
  const w = createWorld();
  w.input = { ...NEUTRAL, fire: true, aimX: 310, aimY: 100 };
  for (let i = 0; i < 12; i++) step(w);
  assert.equal(w.hook.phase, "attached");
  assert.equal(w.hook.platform, 1);
  assert.ok(w.feet < 810 * S);
  w.input.fire = false;
  for (let i = 0; i < 8; i++) step(w);
  assert.equal(w.hook.phase, "ready");
  w.input = { ...NEUTRAL, fire: true, aimX: 1600, aimY: 850 };
  for (let i = 0; i < 100; i++) step(w);
  assert.equal(w.hook.phase, "ready");
});
test("falls respawn once and reset releases an active hook", () => {
  const w = createWorld();
  w.x = 1550 * S;
  w.feet = 960 * S;
  step(w);
  assert.equal(w.deaths, 1);
  assert.equal(w.respawn, 30);
  for (let i = 0; i < 30; i++) step(w);
  assert.equal(w.x, 310 * S);
  assert.equal(w.deaths, 1);
  assert.equal(w.respawn, 0);
  w.input.fire = true;
  step(w);
  w.input.reset = true;
  step(w);
  assert.equal(w.hook.phase, "ready");
  assert.equal(w.x, 310 * S);
});
test("an intervening platform breaks the tether instead of pulling through terrain", () => {
  const w = createWorld();
  w.x = 700 * S;
  w.input.fire = true;
  w.previous.fire = true;
  w.hook = {
    phase: "attached",
    x: 700 * S,
    y: 330 * S - 1,
    vx: 0,
    vy: 0,
    life: 50,
    distance: 0,
    platform: 5,
  };
  step(w);
  assert.equal(w.hook.phase, "retracting");
});
const host = "host";
function setup() {
  const r = createRoom("lobby", DEFAULT_TUNING);
  foldTick(
    r,
    host,
    new Map([
      [
        host,
        {
          generation: 1,
          entries: [
            [1, 1, JOIN, host, "Keeper", 0, "keeper", 1],
            [2, 1, ACTION, "start", "match"],
          ],
        },
      ],
    ]),
  );
  return r;
}
function controls(
  tick: number,
  input: Input,
  match = "match",
  round = 1,
): Entry {
  return [tick + 2, tick, 0, match, round, input];
}
function stream(
  entry: Entry,
  generation = 1,
): Map<string, StreamEntries<Entry>> {
  return new Map([[host, { generation, entries: [entry] }]]);
}
test("replay and checkpoint continuation match through movement, grappling and reset", () => {
  const a = setup(),
    b = setup();
  for (let t = 2; t <= 160; t++) {
    const input = {
      ...NEUTRAL,
      move: (t < 35 ? 1 : t < 70 ? -1 : 0) as Input["move"],
      jump: t >= 18 && t < 35,
      fire: t >= 65 && t < 90,
      aimX: 630,
      aimY: 330,
      reset: t === 120,
    };
    foldTick(a, host, stream(controls(t, input)));
    foldTick(b, host, stream(controls(t, input)));
    assert.equal(hash(a), hash(b));
    assert.equal(
      overlaps(
        a.simulation.keepers[0]!.world.x,
        a.simulation.keepers[0]!.world.feet,
      ),
      false,
    );
    const restored = decode(encode(a), a.tick);
    assert.ok(restored, `valid checkpoint tick ${t}`);
    assert.equal(hash(restored), hash(a));
    if (t === 80) Object.assign(b, restored);
  }
});
test("drop tap survives press and release within one log tick", () => {
  const r = setup();
  foldTick(
    r,
    host,
    new Map([
      [
        host,
        {
          generation: 1,
          entries: [
            controls(2, { ...NEUTRAL, drop: true }),
            [5, 2, 0, "match", 1, { ...NEUTRAL }],
          ],
        },
      ],
    ]),
  );
  const w = r.simulation.keepers[0]!.world;
  assert.ok(w.feet > 810 * S);
  assert.equal(w.grounded, false);
  assert.ok(decode(encode(r), r.tick));
});
test("short tap survives log batching; stale scope/generation ignored; disconnect cancels", () => {
  const r = setup();
  foldTick(
    r,
    host,
    new Map([
      [
        host,
        {
          generation: 1,
          entries: [
            controls(2, { ...NEUTRAL, jump: true }),
            [5, 2, 0, "match", 1, { ...NEUTRAL }],
          ],
        },
      ],
    ]),
  );
  assert.ok(r.simulation.keepers[0]!.world.vy < 0);
  const x = r.simulation.keepers[0]!.world.x;
  foldTick(r, host, stream(controls(3, { ...NEUTRAL, move: 1 }, "old")));
  assert.equal(r.simulation.keepers[0]!.world.x, x);
  foldTick(r, host, stream(controls(4, { ...NEUTRAL, move: 1 }), 2));
  assert.equal(r.simulation.keepers[0]!.world.x, x);
  foldTick(r, host, stream(controls(5, { ...NEUTRAL, move: 1, fire: true })));
  assert.equal(r.simulation.keepers[0]!.world.input.move, 1);
  foldTick(r, host, stream([8, 6, PRESENCE, host, false, 1]));
  assert.deepEqual(r.simulation.keepers[0]!.world.input, { ...NEUTRAL });
  assert.equal(r.simulation.keepers[0]!.world.hook.phase, "ready");
});
test("tuning reset is scoped, bounded and checkpointed; corrupt snapshots reject atomically", () => {
  const r = setup();
  foldTick(
    r,
    host,
    stream([3, 2, SETTINGS, { ...DEFAULT_TUNING, speed: 400 }]),
  );
  assert.equal(r.round, 2);
  assert.equal(r.simulation.tuning.speed, 400);
  const saved = hash(r);
  const fields = encode(r);
  fields[5] = { ...r.simulation, keepers: [] };
  assert.equal(decode(fields, r.tick), undefined);
  assert.equal(hash(r), saved);
  assert.equal(
    decodeWorld({ ...r.simulation.keepers[0]!.world, feet: 820 * S }),
    undefined,
  );
  assert.equal(parseInput({ ...NEUTRAL, aimX: Infinity }), undefined);
  assert.equal(parseTuning({ ...DEFAULT_TUNING, pull: -1 }), undefined);
  assert.equal(isEntry([1, 1, 0, "match", 1, { ...NEUTRAL, extra: 1 }]), false);
});
