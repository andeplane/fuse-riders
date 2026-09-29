import test from "node:test";
import assert from "node:assert/strict";
import { MAPS, blocks, ledges, type MapId } from "../src/engine/maps.js";
import {
  BODY,
  CLASSIC_TUNING,
  DEFAULT_TUNING,
  HALF,
  NEUTRAL,
  S,
  ballField,
  createWorld,
  type Input,
  type Tuning,
  type World,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { movePlayer, overlaps, supported } from "../src/engine/collision.js";
import { decodeWorld, parseTuning } from "../src/engine/codec.js";
import {
  createArena,
  decodeArena,
  encodeArena,
  stepArena,
  syncKeepers,
  type Arena,
  type Keeper,
} from "../src/engine/arena.js";
import { COUNTDOWN_TICKS, ROUND_TICKS } from "../src/engine/contest.js";
import { KO_RESPAWN, KO_SHIELD } from "../src/engine/bomb-rules.js";
import {
  LIFT_VY,
  PAD_VY,
  ZONE_KEYS,
  field,
  floorTop,
  laserBand,
} from "../src/engine/zones.js";
import {
  LASER_LIVE,
  LASER_PERIOD,
  LASER_TELEGRAPH,
  PUSH_TICKS,
} from "../src/engine/zone-rules.js";
import { toView, zoneView } from "../src/engine/view.js";
import {
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  type Entry,
} from "../src/online/game.js";
import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";

const SPIRE: Tuning = {
  ...DEFAULT_TUNING,
  map: "spire",
  experiment: "movement",
  bomb: "off",
};
const OFF = Object.fromEntries(ZONE_KEYS.map((k) => [k, "off"])) as Pick<
  Tuning,
  (typeof ZONE_KEYS)[number]
>;
const CAP = Math.round((1000 * S) / 60);
const members = ["amber", "blue", "green", "violet", "rose"].map(
  (id, slot) => ({ id, slot, connected: true, generation: 1 }),
);
/** A keeper world standing (or, with `air`, floating) with feet at `feet`. */
function body(x: number, feet: number, t: Tuning = SPIRE, air = false): World {
  const w = createWorld(t);
  Object.assign(w, {
    x: x * S,
    feet: feet * S - 1,
    vx: 0,
    vy: 0,
    grounded: !air,
    coyote: air ? 0 : 6,
  });
  return w;
}
function run(w: World, ticks: number, input: Partial<Input> = {}): void {
  w.input = { ...NEUTRAL, ...input };
  for (let i = 0; i < ticks; i++) step(w);
}
/** Highest rise above the start while `ticks` steps run. */
function rise(w: World, ticks: number, input: Partial<Input> = {}): number {
  const start = w.feet;
  let top = w.feet;
  w.input = { ...NEUTRAL, ...input };
  for (let i = 0; i < ticks; i++) {
    step(w);
    top = Math.min(top, w.feet);
  }
  return (start - top) / S;
}
function arena(n = 1, tuning: Tuning = SPIRE, tick = 0): Arena {
  const a = createArena(tuning, tick);
  syncKeepers(a, members.slice(0, n));
  if (tuning.rules !== "free") {
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(a);
    assert.equal(a.contest.phase, "active");
  }
  for (const k of a.keepers) k.shield = 0;
  return a;
}
function stand(k: Keeper, x: number, feet: number): void {
  Object.assign(k.world, {
    x: x * S,
    feet: feet * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
  });
}
const roundTrip = (a: Arena) =>
  decodeArena(JSON.parse(JSON.stringify(encodeArena(a))));

// 12A: per-map size.

test("each map owns its size; the old maps keep exactly 1600 × 900", () => {
  assert.deepEqual(
    [MAPS.belfry.width, MAPS.belfry.height],
    [1600, 900],
    "belfry",
  );
  assert.deepEqual(
    [MAPS.crossroads.width, MAPS.crossroads.height],
    [1600, 900],
  );
  assert.deepEqual([MAPS.spire.width, MAPS.spire.height], [2240, 1260]);
  assert.equal(MAPS.spire.width / MAPS.spire.height, 16 / 9);
  // Old maps: same ricochet field, orb spawn, spawns and no zones or blocks.
  for (const map of ["belfry", "crossroads"] as const) {
    assert.deepEqual(ballField("ricochet", map), [0, 0, 1600, 870]);
    assert.equal(MAPS[map].arenaBall[1], 740);
    assert.deepEqual(MAPS[map].solid, []);
    assert.equal(blocks(map).length, 0);
    assert.equal(ledges(map), ledges(map));
    assert.deepEqual(ledges(map), MAPS[map].platforms);
    const z = zoneView({ ...DEFAULT_TUNING, map }, 1, {
      phase: "active",
      elapsed: 0,
    });
    assert.deepEqual(
      [z.pads, z.lifts, z.lowGravity, z.floor, z.lasers, z.bonus],
      [[], [], [], null, [], null],
    );
  }
  assert.deepEqual(ballField("ricochet", "spire"), [0, 0, 2240, 1230]);
  assert.equal(
    DEFAULT_TUNING.map,
    "crossroads",
    "Neon Spire is not the default",
  );
  const view = toView(createWorld(SPIRE));
  assert.deepEqual(view.size, { width: 2240, height: 1260 });
  assert.deepEqual(view.solid, MAPS.spire.solid);
});

test("walls, the fall line and checkpoint bounds follow the selected map", () => {
  // The right wall.
  for (const [map, wall] of [
    ["crossroads", 1600],
    ["spire", 2240],
  ] as const) {
    const w = body(wall - 40, 100, { ...SPIRE, map }, true);
    run(w, 20, { move: 1 });
    assert.equal(w.x, wall * S - HALF, `${map} wall`);
  }
  // The out-of-bounds line: below the map's height.
  for (const [map, height] of [
    ["crossroads", 900],
    ["spire", 1260],
  ] as const) {
    const t: Tuning = { ...SPIRE, ...OFF, map };
    const w = body(40, height + 40, t, true);
    w.vy = 10 * S;
    run(w, 1);
    assert.equal(w.deaths, 0, `${map}: still above the line`);
    run(w, 10);
    assert.equal(w.deaths, 1, `${map}: fell out`);
    assert.ok(w.feet - BODY > height * S);
    assert.ok(decodeWorld(w), `${map}: a returning keeper checkpoints`);
  }
  // Checkpoint positions are bounded by the map.
  const wide = body(2000, 100, SPIRE, true);
  assert.ok(decodeWorld(wide), "x 2000 fits the spire");
  assert.equal(
    decodeWorld({ ...wide, tuning: { ...SPIRE, map: "crossroads" } }),
    undefined,
    "x 2000 is outside Crossroads",
  );
  assert.equal(
    decodeWorld({ ...wide, x: 2240 * S - HALF + 1 }),
    undefined,
    "beyond the spire's wall",
  );
  const deep = body(300, 1340, SPIRE, true);
  assert.ok(decodeWorld(deep), "feet 1340 is inside the spire's margin");
  assert.equal(
    decodeWorld({ ...deep, tuning: { ...SPIRE, map: "belfry" } }),
    undefined,
    "and outside the belfry's",
  );
});

// 12A: solid platforms.

const CORE = MAPS.spire.platforms[12]!; // [1080, 440, 80, 368]
const HURDLE = MAPS.spire.platforms[13]!; // [1080, 980, 80, 130]
const OVERHANG = MAPS.spire.platforms[14]!; // [120, 560, 260, 24]
test("solid blocks stop keepers on all four faces and hold them on top", () => {
  assert.deepEqual(CORE, [1080, 440, 80, 368]);
  // From the left and right, walking on the catwalks into the core.
  const left = body(1000, 780);
  run(left, 60, { move: 1 });
  assert.equal(left.x, 1080 * S - HALF - 1, "left face");
  assert.equal(left.grounded, true);
  const right = body(1240, 780);
  run(right, 60, { move: -1 });
  assert.equal(right.x, 1160 * S + HALF + 1, "right face");
  // From above: land on the hurdle and stand there.
  const above = body(1120, 900, SPIRE, true);
  run(above, 40);
  assert.equal(above.feet, HURDLE[1] * S - 1, "top face");
  assert.equal(above.grounded, true);
  assert.ok(supported(above.x, above.feet, blocks("spire")));
  run(above, 30, { drop: true });
  assert.equal(above.feet, HURDLE[1] * S - 1, "a block never drops a keeper");
  run(above, 1, { drop: false });
  run(above, 1, { drop: true });
  assert.equal(above.feet, HURDLE[1] * S - 1);
  // From below: a jump under the overhang bumps its ceiling.
  const below = body(250, 780);
  const height = rise(below, 60, { jump: true });
  assert.ok(
    Math.abs(below.feet - 780 * S) <= 1,
    "back on the ledge after the bump",
  );
  assert.ok(
    Math.abs(780 - height - BODY / S - (OVERHANG[1] + OVERHANG[3])) < 1.5,
    `head stopped at the overhang (rose ${height})`,
  );
  // The same jump clear of the overhang rises a full jump.
  assert.ok(rise(body(450, 780), 60, { jump: true }) > 160);
});

test("corners resolve to a face and no speed tunnels through a block", () => {
  // Diagonally down-right onto the hurdle's top-left corner: it lands.
  const corner = body(1058, 975, SPIRE, true);
  corner.vx = 6 * S;
  corner.vy = 6 * S;
  movePlayer(corner, ledges("spire"), blocks("spire"), 2240);
  assert.ok(!overlaps(corner.x, corner.feet, blocks("spire")));
  // Straight at a thin pylon (20 units) or the roof (20 units) far past the
  // keeper speed cap: the swept test still stops the body.
  const pylon = MAPS.spire.platforms[16]!;
  const fast = body(pylon[0] - 200, pylon[1] + 60, SPIRE, true);
  fast.vx = 400 * S;
  movePlayer(fast, [], blocks("spire"), 2240);
  assert.equal(fast.x, pylon[0] * S - HALF - 1, "stopped at the pylon");
  const roof = MAPS.spire.platforms[18]!;
  const up = body(1100, roof[1] + roof[3] + BODY / S + 300, SPIRE, true);
  up.vy = -400 * S;
  movePlayer(up, [], blocks("spire"), 2240);
  assert.equal(up.feet, (roof[1] + roof[3]) * S + BODY + 1, "under the roof");
  // Deterministic fuzz: bodies near every block, any direction, up to the cap
  // and beyond, never end a move inside one.
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let checked = 0;
  for (const [bx, by, bw, bh] of blocks("spire"))
    for (let i = 0; i < 400; i++) {
      const w = body(
        bx - 60 + rand() * (bw + 120),
        by - 30 + rand() * (bh + 110),
        SPIRE,
        true,
      );
      if (overlaps(w.x, w.feet, blocks("spire"))) continue;
      w.vx = Math.round((rand() * 2 - 1) * CAP * 2);
      w.vy = Math.round((rand() * 2 - 1) * CAP * 2);
      movePlayer(w, ledges("spire"), blocks("spire"), 2240);
      assert.ok(!overlaps(w.x, w.feet, blocks("spire")), `block ${bx},${by}`);
      checked++;
    }
  assert.ok(checked > 1500, `${checked} samples`);
});

test("one-way ledges are unchanged beside blocks: through from below, onto from above, drop through", () => {
  // A catwalk passes a keeper jumping up through it (from the bottom deck).
  const w = body(960, 1110);
  run(w, 1);
  assert.equal(w.grounded, true);
  run(w, 90, { jump: true, move: 1 });
  assert.equal(w.deaths, 0);
  // Onto a top-tier ledge from above, then drop through it.
  const top = body(300, 380, SPIRE, true);
  run(top, 30);
  assert.equal(top.feet, 420 * S - 1);
  assert.ok(top.grounded && supported(top.x, top.feet, ledges("spire")));
  run(top, 1, { drop: true });
  assert.ok(top.feet > 420 * S, "dropped through the ledge");
  // The ledge-only solver is exactly the old one on a map without blocks.
  for (let i = 0; i < 200; i++) {
    const a = body(200 + i * 5, 600, CLASSIC_TUNING, true),
      b = structuredClone(a);
    a.vx = b.vx = ((i % 7) - 3) * 2000;
    a.vy = b.vy = ((i % 11) - 3) * 1500;
    movePlayer(a, MAPS.belfry.platforms);
    movePlayer(b, MAPS.belfry.platforms, [], 1600);
    assert.deepEqual(a, b);
  }
});

test("hooks attach to walls and ceilings and the checkpoint accepts it", () => {
  const w = body(980, 780);
  w.input = { ...NEUTRAL, fire: true, aimX: 1100, aimY: 600 };
  for (let i = 0; i < 12 && w.hook.phase !== "attached"; i++) step(w);
  assert.equal(w.hook.phase, "attached");
  assert.equal(w.hook.platform, 12, "the core pillar");
  assert.equal(w.hook.x, 1080 * S - 1, "on its left face");
  assert.ok(decodeWorld(w));
  // Reel in: pulled against the wall, never into it.
  for (let i = 0; i < 90; i++) {
    step(w);
    assert.ok(!overlaps(w.x, w.feet, blocks("spire")));
    assert.ok(decodeWorld(w), `tick ${i}`);
  }
  // A ceiling's underside.
  const c = body(200, 780);
  c.input = { ...NEUTRAL, fire: true, aimX: 200, aimY: 500 };
  for (let i = 0; i < 12 && c.hook.phase !== "attached"; i++) step(c);
  assert.equal(c.hook.platform, 14, "the left overhang");
  assert.equal(c.hook.y, 584 * S + 1, "its underside");
  assert.ok(decodeWorld(c));
});

test("bombs and orbs bounce off walls and ceilings", () => {
  // A bomb thrown right at the core pillar comes back.
  const a = arena(1, { ...SPIRE, bomb: "fuse", lifts: "off" });
  const k = a.keepers[0]!;
  stand(k, 1000, 780);
  k.world.input = { ...NEUTRAL, bomb: true };
  stepArena(a);
  k.world.input = { ...NEUTRAL, aimX: 1100, aimY: 740 };
  stepArena(a);
  const bomb = a.bombs[0]!;
  assert.ok(bomb.vx > 0);
  for (let i = 0; i < 12 && bomb.vx > 0; i++) stepArena(a);
  assert.ok(bomb.vx < 0, "bounced off the wall");
  assert.ok(bomb.x < 1080 * S);
  // A bomb thrown up under the overhang comes back down.
  const b = arena(1, { ...SPIRE, bomb: "fuse", lifts: "off" });
  const u = b.keepers[0]!;
  stand(u, 250, 780);
  u.world.input = { ...NEUTRAL, bomb: true };
  for (let i = 0; i < 40; i++) stepArena(b);
  u.world.input = { ...NEUTRAL, aimX: 250, aimY: 100 };
  stepArena(b);
  const up = b.bombs[0]!;
  assert.ok(up.vy < 0);
  for (let i = 0; i < 40 && up.vy < 0; i++) stepArena(b);
  assert.ok(up.vy > 0, "bounced off the ceiling");
  assert.ok(up.y > (584 + 9) * S);
  // A ricochet orb meets the core pillar and turns round.
  const r = arena(1, { ...SPIRE, experiment: "ricochet", ...OFF });
  const ball = r.combat.balls[0]!;
  Object.assign(ball, { x: 1000 * S, y: 600 * S, vx: 2 * S, vy: 0 });
  for (let i = 0; i < 40 && ball.vx > 0; i++) stepArena(r);
  assert.ok(ball.vx < 0, "orb bounced off the pillar");
  assert.ok(ball.x + 40 * S <= 1080 * S);
});

// 12B: zones.

test("a jump pad launches 2.5× a normal jump and refills the air jump", () => {
  const normal = rise(body(760, 1110), 80, { jump: true });
  const pad = body(860, 1110);
  pad.airJump = false;
  run(pad, 1);
  assert.equal(pad.vy, PAD_VY, "launched on touching the pad's top");
  assert.ok(PAD_VY < -CAP, "past the ordinary speed cap");
  assert.equal(pad.airJump, true, "air jump refilled");
  assert.ok(decodeWorld(pad), "a launched keeper checkpoints");
  const launched = body(860, 1110),
    height = rise(launched, 120);
  assert.ok(
    Math.abs(height / normal - 2.5) < 0.05,
    `pad ${height} vs jump ${normal}`,
  );
  assert.equal(launched.feet, 780 * S - 1, "landed on the catwalk above");
  // Switched off, the pad is floor.
  const off = body(860, 1110, { ...SPIRE, jumpPads: "off" });
  run(off, 30);
  assert.equal(off.feet, 1110 * S - 1);
  assert.equal(off.grounded, true);
  // A launch speed without pads is corrupt.
  assert.equal(
    decodeWorld({ ...pad, tuning: { ...SPIRE, jumpPads: "off" } }),
    undefined,
  );
});

test("lift beams rise to a capped speed with steering, for keepers, bombs and orbs", () => {
  const w = body(660, 900, SPIRE, true);
  const speeds: number[] = [];
  for (let i = 0; i < 30; i++) {
    run(w, 1);
    speeds.push(w.vy);
  }
  assert.equal(speeds.at(-1), LIFT_VY, "capped at 300 units/s");
  assert.equal(LIFT_VY, -Math.round((300 * S) / 60));
  assert.ok(speeds.every((v) => v >= LIFT_VY));
  // Rising faster (a jump) eases down to the cap instead of stopping.
  const fast = body(660, 900, SPIRE, true);
  fast.vy = -12 * S;
  run(fast, 1);
  assert.ok(fast.vy > -12 * S && fast.vy < LIFT_VY);
  // Steering works inside the beam.
  const steer = body(620, 900, SPIRE, true);
  run(steer, 10, { move: 1 });
  assert.ok(steer.x > 630 * S && steer.vy < 0);
  // Off: ordinary gravity.
  const off = body(660, 900, { ...SPIRE, lifts: "off" }, true);
  run(off, 5);
  assert.ok(off.vy > 0);
  // A bomb and an orb in a beam rise too.
  const a = arena(1, { ...SPIRE, bomb: "fuse" });
  const k = a.keepers[0]!;
  stand(k, 560, 1100);
  k.world.input = { ...NEUTRAL, bomb: true };
  stepArena(a);
  k.world.input = { ...NEUTRAL, aimX: 680, aimY: 1060 };
  stepArena(a);
  const bomb = a.bombs[0]!;
  Object.assign(bomb, { x: 660 * S, y: 900 * S, vx: 0, vy: 0 });
  for (let i = 0; i < 20; i++) stepArena(a);
  assert.equal(bomb.vy, LIFT_VY, "bomb lifted");
  const r = arena(1, { ...SPIRE, experiment: "ricochet" });
  const ball = r.combat.balls[0]!;
  Object.assign(ball, { x: 640 * S, y: 900 * S, vx: S, vy: 0 });
  stepArena(r);
  assert.ok(ball.vy < 0, "orb lifted");
  assert.equal(Math.abs(ball.vx), S, "speed across unchanged");
});

test("the low-gravity wing keeps 40% of gravity for keepers, bombs and orbs", () => {
  const normal = rise(body(450, 780), 80, { jump: true });
  const light = rise(body(1780, 780), 140, { jump: true });
  assert.ok(Math.abs(light / normal - 2.5) < 0.15, `${light} vs ${normal}`);
  const w = body(1780, 700, SPIRE, true);
  assert.equal(field(SPIRE, w.x, w.feet - BODY / 2), "low");
  run(w, 1);
  assert.equal(w.vy, Math.round(512 * 0.4));
  const off = body(1780, 700, { ...SPIRE, lowGravity: "off" }, true);
  run(off, 1);
  assert.equal(off.vy, 512);
  const a = arena(1, { ...SPIRE, bomb: "fuse" });
  const k = a.keepers[0]!;
  stand(k, 1900, 780);
  k.world.input = { ...NEUTRAL, bomb: true };
  stepArena(a);
  k.world.input = { ...NEUTRAL, aimX: 1900, aimY: 700 };
  stepArena(a);
  const bomb = a.bombs[0]!;
  Object.assign(bomb, { x: 1900 * S, y: 650 * S, vx: 0, vy: 0 });
  stepArena(a);
  assert.equal(bomb.vy, Math.round(512 * 0.4), "bomb falls light");
  const r = arena(1, { ...SPIRE, experiment: "ricochet" });
  const ball = r.combat.balls[0]!;
  Object.assign(ball, { x: 1900 * S, y: 650 * S, vx: S, vy: 0 });
  stepArena(r);
  assert.equal(ball.vy, Math.round((S / 8) * 0.4), "orb falls light");
});

test("the electrified floor knocks out through the bomb path, respecting spawn protection", () => {
  const a = arena(2);
  const [k, guard] = a.keepers as [Keeper, Keeper];
  for (const [x, keeper] of [
    [300, k],
    [400, guard],
  ] as const) {
    Object.assign(keeper.world, {
      x: x * S,
      feet: 1215 * S,
      vy: 8 * S,
      grounded: false,
    });
  }
  guard.shield = 5;
  stepArena(a);
  assert.equal(k.world.respawn, KO_RESPAWN, "knocked out");
  assert.equal(k.bomb.fate, "hazard");
  assert.equal(k.bomb.by, "");
  assert.equal(k.bomb.zapped, 1);
  assert.equal(k.world.deaths, 1);
  const [event] = a.knockouts;
  assert.deepEqual(
    { ...event, x: 0, y: 0 },
    { tick: a.tick, by: "", target: "amber", x: 0, y: 0, cause: "hazard" },
  );
  assert.equal(guard.world.respawn, 0, "spawn protection holds");
  assert.ok(roundTrip(a), "a hazard knockout checkpoints");
  for (let i = 0; i < KO_RESPAWN; i++) stepArena(a);
  assert.equal(k.world.respawn, 0);
  assert.equal(k.shield, KO_SHIELD, "returns protected like a bomb knockout");
  const view = toView(k.world);
  assert.equal(view.respawn, 0);
  // Off: the same drop is an ordinary fall out of the bottom.
  const off = arena(1, { ...SPIRE, electricFloor: "off" });
  const f = off.keepers[0]!;
  Object.assign(f.world, {
    x: 300 * S,
    feet: 1215 * S,
    vy: 8 * S,
    grounded: false,
  });
  for (let i = 0; i < 20 && !f.world.respawn; i++) stepArena(off);
  assert.equal(f.bomb.fate, "fall");
  assert.equal(off.knockouts.length, 0);
});

test("in timed rules the floor rises over the last 20 s to its cap, telegraphed", () => {
  const score: Tuning = { ...SPIRE, rules: "score" };
  const at = (elapsed: number, phase: "active" | "over" = "active") =>
    floorTop(score, { phase, elapsed })! / S;
  assert.equal(at(0), 1220);
  assert.equal(at(ROUND_TICKS - 1200), 1220, "rest until 40 s");
  assert.equal(at(ROUND_TICKS - 600), 1025, "halfway at 50 s");
  assert.equal(at(ROUND_TICKS), 830, "cap at 60 s");
  assert.equal(at(ROUND_TICKS, "over"), 830);
  assert.equal(
    floorTop(score, { phase: "countdown", elapsed: 100 })! / S,
    1220,
  );
  assert.equal(
    floorTop(SPIRE, { phase: "active", elapsed: ROUND_TICKS })! / S,
    1220,
    "free play never rises",
  );
  assert.equal(
    floorTop(
      { ...score, electricFloor: "off" },
      { phase: "active", elapsed: 0 },
    ),
    undefined,
  );
  const warn = zoneView(score, 1, {
    phase: "active",
    elapsed: ROUND_TICKS - 1300,
  });
  assert.equal(warn.floor!.warning, 2, "warned seconds ahead");
  assert.equal(warn.floor!.rising, false);
  const rising = zoneView(score, 1, {
    phase: "active",
    elapsed: ROUND_TICKS - 100,
  });
  assert.equal(rising.floor!.rising, true);
  assert.equal(rising.floor!.warning, 0);
  // Every spawn stays above the cap: sudden death never spawns into the floor.
  for (const [, feet] of MAPS.spire.spawns) assert.ok(feet < 830);
  // Live: a keeper on a bottom deck is caught as the floor passes it.
  const a = arena(2, score);
  const [k] = a.keepers as [Keeper];
  a.contest.elapsed = ROUND_TICKS - 1200;
  let caught = 0;
  for (let i = 0; i < 1100 && !caught; i++) {
    stand(k, 300, 1100);
    stepArena(a);
    if (k.world.respawn) caught = a.contest.elapsed;
  }
  // The floor reaches the deck (1100) after (1220 − 1100) / 390 of the rise.
  const expected = ROUND_TICKS - 1200 + Math.ceil((120 / 390) * 1200);
  assert.ok(Math.abs(caught - expected) <= 2, `${caught} vs ${expected}`);
  assert.equal(k.bomb.fate, "hazard");
  assert.equal(a.contest.entries[0]!.score, -2);
});

test("laser gates telegraph for 1 s, then sweep live for 0.5 s, every 8 s", () => {
  const [gate] = MAPS.spire.zones.lasers;
  assert.equal(LASER_TELEGRAPH, 60);
  assert.equal(LASER_LIVE, 30);
  assert.equal(LASER_PERIOD, 480);
  for (let t = 0; t < LASER_PERIOD; t++)
    assert.equal(!!laserBand(gate!, t), t >= 60 && t < 90, `tick ${t}`);
  const view = zoneView(SPIRE, 30, { phase: "active", elapsed: 0 });
  assert.equal(view.lasers[0]!.phase, "telegraph");
  assert.equal(view.lasers[1]!.phase, "idle", "the second gate is offset");
  // A keeper standing on the left top tier inside the gate's section.
  const a = arena(1);
  const k = a.keepers[0]!;
  let knocked = 0;
  for (let i = 0; i < LASER_PERIOD && !knocked; i++) {
    stand(k, 300, 420);
    stepArena(a);
    if (k.world.respawn) knocked = a.tick;
  }
  assert.ok(
    knocked > LASER_TELEGRAPH && knocked <= LASER_TELEGRAPH + LASER_LIVE,
    `live at ${knocked}`,
  );
  assert.equal(k.bomb.fate, "hazard");
  assert.equal(a.knockouts[0]!.cause, "hazard");
  // Beside the section, or with lasers off, nothing happens.
  for (const [x, tuning] of [
    [700, SPIRE],
    [300, { ...SPIRE, lasers: "off" as const }],
  ] as const) {
    const b = arena(1, tuning);
    const s = b.keepers[0]!;
    for (let i = 0; i < LASER_PERIOD; i++) {
      stand(s, x, 420);
      if (x === 700) Object.assign(s.world, { feet: 380 * S, grounded: false });
      stepArena(b);
    }
    assert.equal(s.world.deaths, 0);
  }
  // The band covers the tick's whole sweep, so a fast beam cannot skip a body.
  const [, sweep] = MAPS.spire.zones.lasers;
  let covered = sweep!.x * S;
  for (let t = 0; t < LASER_PERIOD; t++) {
    const band = laserBand(sweep!, t);
    if (!band) continue;
    assert.ok(band[0] <= covered, `contiguous at ${t}`);
    covered = band[2];
  }
  assert.ok(covered >= (sweep!.x + sweep!.travel) * S);
});

/** Stand two keepers on the crown deck or below it and let `by` hook `target`. */
function hookHit(
  a: Arena,
  by: Keeper,
  target: Keeper,
  byX: number,
  byFeet: number,
): void {
  stand(by, byX, byFeet);
  stand(target, byX + 160, byFeet);
  target.shield = 0;
  const hits = by.hits;
  for (let i = 0; i < 20 && by.hits === hits; i++) {
    stand(target, byX + 160, byFeet);
    by.world.input = {
      ...NEUTRAL,
      fire: i < 10,
      aimX: byX + 160,
      aimY: byFeet - 28,
    };
    stepArena(a);
  }
  assert.equal(by.hits, hits + 1, "hook hit");
}
test("the crown zone triples score gains in score rules", () => {
  const score: Tuning = { ...SPIRE, rules: "score" };
  const a = arena(2, score);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  hookHit(a, amber, blue, 960, 240);
  assert.equal(a.contest.entries[0]!.score, 3, "inside the crown");
  const b = arena(2, score);
  hookHit(b, b.keepers[0]!, b.keepers[1]!, 1200, 780);
  assert.equal(b.contest.entries[0]!.score, 1, "outside it");
  const off = arena(2, { ...score, bonusZone: "off" });
  hookHit(off, off.keepers[0]!, off.keepers[1]!, 960, 240);
  assert.equal(off.contest.entries[0]!.score, 1, "switched off");
  assert.equal(
    zoneView(SPIRE, 1, { phase: "active", elapsed: 0 }).multiplier,
    1,
    "free play shows no multiplier",
  );
  assert.equal(
    zoneView(score, 1, { phase: "active", elapsed: 0 }).multiplier,
    3,
  );
  assert.ok(roundTrip(a), "a tripled score checkpoints");
});

test("a hazard credits the rival whose hook hit the victim within 2 s, else nobody", () => {
  const score: Tuning = { ...SPIRE, rules: "score" };
  const zap = (a: Arena, k: Keeper) => {
    Object.assign(k.world, {
      x: 300 * S,
      feet: 1215 * S,
      vy: 8 * S,
      grounded: false,
    });
    k.shield = 0;
    stepArena(a);
  };
  const a = arena(2, score);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  hookHit(a, amber, blue, 1200, 780);
  assert.equal(blue.pushedBy, "amber");
  assert.ok(blue.pushed > PUSH_TICKS - 20);
  assert.ok(roundTrip(a), "a push checkpoints");
  zap(a, blue);
  assert.equal(blue.bomb.fate, "hazard");
  assert.equal(blue.bomb.by, "amber", "pushed into the floor");
  assert.equal(amber.bomb.knockouts, 1);
  assert.equal(a.knockouts.at(-1)!.by, "amber");
  assert.deepEqual(
    a.contest.entries.map((e) => e.score),
    [2, -2],
    "hit +1, push credit +1; victim −2",
  );
  assert.equal(blue.pushed, 0, "a push dies with the keeper");
  // Beyond 2 s nobody is credited.
  const b = arena(2, score);
  const [amber2, blue2] = b.keepers as [Keeper, Keeper];
  hookHit(b, amber2, blue2, 1200, 780);
  for (let i = 0; i < PUSH_TICKS; i++) {
    stand(blue2, 1360, 780);
    blue2.shield = 0;
    stepArena(b);
  }
  assert.equal(blue2.pushedBy, "");
  zap(b, blue2);
  assert.equal(blue2.bomb.by, "");
  assert.equal(amber2.bomb.knockouts, 0);
  assert.deepEqual(
    b.contest.entries.map((e) => e.score),
    [1, -2],
  );
});

test("zone settings are validated with exact keys and all default on", () => {
  for (const key of ZONE_KEYS) {
    assert.equal(DEFAULT_TUNING[key], "on", key);
    assert.equal(parseTuning({ ...DEFAULT_TUNING, [key]: "maybe" }), undefined);
    assert.equal(parseTuning({ ...DEFAULT_TUNING, [key]: true }), undefined);
    const { [key]: _gone, ...missing } = DEFAULT_TUNING;
    assert.equal(parseTuning(missing), undefined, `missing ${key}`);
    assert.deepEqual(parseTuning({ ...DEFAULT_TUNING, [key]: "off" }), {
      ...DEFAULT_TUNING,
      [key]: "off",
    });
  }
  assert.equal(parseTuning({ ...DEFAULT_TUNING, map: "tower" }), undefined);
  assert.ok(parseTuning({ ...DEFAULT_TUNING, map: "spire" }));
  const view = zoneView({ ...SPIRE, ...OFF }, 60, {
    phase: "active",
    elapsed: 0,
  });
  assert.deepEqual(
    [
      view.pads,
      view.lifts,
      view.lowGravity,
      view.floor,
      view.lasers,
      view.bonus,
    ],
    [[], [], [], null, [], null],
  );
});

test("spawns are safe: supported, clear of blocks and every zone, above the floor's cap", () => {
  const z = MAPS.spire.zones;
  const inside = (r: readonly number[], x: number, y: number) =>
    x + 16 > r[0]! &&
    x - 16 < r[0]! + r[2]! &&
    y > r[1]! &&
    y - 52 < r[1]! + r[3]!;
  for (const [x, feet] of MAPS.spire.spawns) {
    assert.ok(supported(x * S, feet * S - 1, MAPS.spire.platforms));
    assert.ok(!overlaps(x * S, feet * S - 1, blocks("spire")));
    for (const r of [...z.lifts, ...z.lowGravity.filter(() => false), z.bonus!])
      assert.ok(!inside(r, x, feet), `spawn ${x} in a zone`);
    for (const [px, py, w] of z.pads)
      assert.ok(feet !== py || x + 16 <= px || x - 16 >= px + w);
    for (const l of z.lasers) {
      const area =
        l.axis === "h"
          ? [l.x, l.y - 4, l.length, l.travel + 8]
          : [l.x - 4, l.y, l.travel + 8, l.length];
      assert.ok(!inside(area, x, feet), `spawn ${x} in a laser`);
    }
    assert.ok(feet < z.floor!.cap);
  }
  // No block overlaps a ledge; every block is at least a keeper apart from the next.
  for (const b of blocks("spire"))
    for (const l of ledges("spire"))
      assert.ok(
        !(
          b[0] < l[0] + l[2] &&
          b[0] + b[2] > l[0] &&
          b[1] < l[1] + l[3] &&
          b[1] + b[3] > l[1]
        ),
        `${b} overlaps ${l}`,
      );
  // Five keepers idle on the spire for 20 s: nobody is hurt.
  const a = arena(5);
  for (let i = 0; i < 1200; i++) stepArena(a);
  assert.deepEqual(
    a.keepers.map((k) => k.world.deaths),
    [0, 0, 0, 0, 0],
  );
});

function script(slot: number, tick: number): Input {
  const phase = (tick + slot * 53) % 300;
  return {
    ...NEUTRAL,
    move: (phase < 90
      ? slot % 2
        ? 1
        : -1
      : phase < 170
        ? slot % 2
          ? -1
          : 1
        : 0) as Input["move"],
    jump: phase % 45 === 3 || phase % 45 === 20,
    drop: phase % 70 === 40,
    fire: phase > 200 && phase < 230,
    bomb: phase % 110 < 3 + slot * 5,
    aimX: 600 + slot * 300,
    aimY: 300 + ((tick >> 4) % 5) * 150,
  };
}
test("deterministic replay on Neon Spire with checkpoints taken inside every zone", () => {
  const tuning: Tuning = {
    ...SPIRE,
    rules: "score",
    bomb: "fuse",
    experiment: "ricochet",
  };
  const a = createArena(tuning);
  syncKeepers(a, members);
  let b = structuredClone(a);
  const seen = {
    lift: 0,
    low: 0,
    launched: 0,
    hazard: 0,
    credited: 0,
    bonus: 0,
  };
  for (let tick = 0; tick < COUNTDOWN_TICKS + ROUND_TICKS + 60; tick++) {
    for (const arena of [a, b])
      arena.keepers.forEach((k) => (k.world.input = script(k.slot, tick)));
    const before = a.knockouts.length;
    stepArena(a);
    stepArena(b);
    assert.deepEqual(encodeArena(a), encodeArena(b), `tick ${tick}`);
    const restored = roundTrip(a);
    assert.ok(restored, `tick ${tick} checkpoints`);
    assert.deepEqual(encodeArena(restored), encodeArena(a));
    if (tick % 17 === 0) b = restored;
    for (const k of a.keepers) {
      const f = field(tuning, k.world.x, k.world.feet - BODY / 2);
      if (!k.world.respawn && f === "lift") seen.lift++;
      if (!k.world.respawn && f === "low") seen.low++;
      if (k.world.vy < -CAP) seen.launched++;
    }
    for (const e of a.knockouts.slice(before))
      if (e.cause === "hazard") {
        seen.hazard++;
        if (e.by) seen.credited++;
      }
  }
  assert.equal(a.contest.phase, "over");
  for (const [name, count] of Object.entries(seen))
    if (name !== "credited" && name !== "bonus")
      assert.ok(count > 0, `${name} exercised (${JSON.stringify(seen)})`);
});

// Checkpoints on a live room.

const host = "host";
function room(tuning: Tuning) {
  const r = createRoom("lobby", tuning);
  foldTick(
    r,
    host,
    stream([
      [1, 1, JOIN, host, "Keeper", 0, "keeper", 1],
      [2, 1, ACTION, "start", "match"],
    ]),
  );
  return r;
}
function stream(entries: Entry[]): Map<string, StreamEntries<Entry>> {
  return new Map([[host, { generation: 1, entries }]]);
}
const at = (tick: number, input: Partial<Input>): Entry => [
  tick * 4 + 10,
  tick,
  0,
  "match",
  1,
  { ...NEUTRAL, ...input },
];
interface Encoded {
  tuning: Tuning;
  knockouts: Record<string, unknown>[];
  keepers: {
    pushed: number;
    pushedBy: string;
    bomb: Record<string, unknown>;
    body: {
      x: number;
      feet: number;
      vy: number;
      grounded: boolean;
      respawn: number;
    };
  }[];
}
test("a live Neon Spire room rejects corrupt or out-of-bounds zone state and keeps its healthy state", () => {
  const r = room({ ...SPIRE, bomb: "fuse" });
  // Walk off the left mid tier into the lift shaft and ride it.
  for (let t = 2; t < 60; t++) foldTick(r, host, stream([at(t, { move: 1 })]));
  const twin = decode(encode(r), r.tick)!;
  assert.ok(twin);
  const good = encode(r),
    saved = hash(r);
  // Settings travel beside the snapshot's tuning; keep them agreeing so each
  // case is rejected for its own reason.
  const corrupt = (edit: (s: Encoded) => void) => {
    const fields = structuredClone(good);
    edit(fields[5] as Encoded);
    fields[3] = structuredClone((fields[5] as Encoded).tuning);
    return decode(fields, r.tick);
  };
  const zapped = (s: Encoded) => {
    Object.assign(s.keepers[0]!.bomb, { zapped: 1, fate: "hazard", by: "" });
    const b = s.keepers[0]!.body as Encoded["keepers"][0]["body"] & {
      deaths: number;
    };
    b.deaths = 1;
  };
  /** Knocked out by a hazard and still returning. */
  const returning = (s: Encoded) => {
    zapped(s);
    Object.assign(s.keepers[0]!.body, {
      respawn: 10,
      feet: 1313 * S,
      vx: 0,
      vy: 0,
      grounded: false,
      airJump: false,
    });
  };
  // Controls: the same edits made valid are accepted.
  for (const [name, edit] of [
    [
      "a push by a departed rival",
      (s: Encoded) =>
        Object.assign(s.keepers[0]!, { pushed: 5, pushedBy: "blue" }),
    ],
    ["a hazard fate", zapped],
    ["a pad launch", (s: Encoded) => (s.keepers[0]!.body.vy = PAD_VY)],
  ] as const)
    assert.ok(corrupt(edit), `control: ${name}`);
  const cases: [string, (s: Encoded) => void][] = [
    ["beyond the spire's wall", (s) => (s.keepers[0]!.body.x = 2240 * S)],
    ["below the spire's margin", (s) => (s.keepers[0]!.body.feet = 1361 * S)],
    [
      "inside the core pillar",
      (s) =>
        Object.assign(s.keepers[0]!.body, {
          x: 1120 * S,
          feet: 600 * S,
          grounded: false,
        }),
    ],
    ["rising past a pad launch", (s) => (s.keepers[0]!.body.vy = PAD_VY - 1)],
    [
      "a launch with pads off",
      (s) => {
        s.tuning.jumpPads = "off";
        s.keepers[0]!.body.vy = PAD_VY;
      },
    ],
    [
      "unknown zone switch",
      (s) =>
        ((s.tuning as unknown as Record<string, unknown>).lasers = "maybe"),
    ],
    ["push without a pusher", (s) => (s.keepers[0]!.pushed = 10)],
    ["pusher without a push", (s) => (s.keepers[0]!.pushedBy = "blue")],
    [
      "push too long",
      (s) =>
        Object.assign(s.keepers[0]!, {
          pushed: PUSH_TICKS + 1,
          pushedBy: "blue",
        }),
    ],
    [
      "pushed by self",
      (s) => Object.assign(s.keepers[0]!, { pushed: 5, pushedBy: host }),
    ],
    [
      "missing push",
      (s) => delete (s.keepers[0] as Partial<Encoded["keepers"][0]>).pushed,
    ],
    ["zapped beyond deaths", (s) => (s.keepers[0]!.bomb.zapped = 1)],
    ["bad fate", (s) => (s.keepers[0]!.bomb.fate = "lava")],
    [
      "hazard event with an unknown cause",
      (s) =>
        s.knockouts.push({
          tick: r.simulation.tick,
          by: "",
          target: host,
          x: 0,
          y: 0,
          cause: "lava",
        }),
    ],
    [
      "hazard event without a cause",
      (s) =>
        s.knockouts.push({
          tick: r.simulation.tick,
          by: "",
          target: host,
          x: 0,
          y: 0,
        }),
    ],
    [
      "bomb event naming nobody",
      (s) =>
        s.knockouts.push({
          tick: r.simulation.tick,
          by: "",
          target: host,
          x: 0,
          y: 0,
          cause: "bomb",
        }),
    ],
    [
      "hazard event with hazards off",
      (s) => {
        s.tuning.electricFloor = "off";
        s.tuning.lasers = "off";
        s.knockouts.push({
          tick: r.simulation.tick,
          by: "",
          target: host,
          x: 0,
          y: 0,
          cause: "hazard",
        });
      },
    ],
    [
      "hazard fate with hazards off",
      (s) => {
        s.tuning.electricFloor = "off";
        s.tuning.lasers = "off";
        zapped(s);
      },
    ],
    [
      "hazard knockouts beyond deaths",
      (s) => {
        zapped(s);
        s.keepers[0]!.bomb.bombed = 1;
      },
    ],
    [
      "a push while returning",
      (s) => {
        returning(s);
        Object.assign(s.keepers[0]!, { pushed: 5, pushedBy: "blue" });
      },
    ],
  ];
  assert.ok(corrupt(returning), "control: returning without a push");
  for (const [name, edit] of cases) {
    assert.equal(corrupt(edit), undefined, name);
    assert.equal(hash(r), saved, `${name}: healthy state unchanged`);
  }
  // The room plays on exactly as its untouched twin.
  for (let t = r.tick + 1, end = r.tick + 40; t < end; t++) {
    const s = stream([at(t, { move: -1, jump: t % 9 === 0 })]);
    foldTick(r, host, s);
    foldTick(twin, host, s);
  }
  assert.equal(hash(r), hash(twin));
  // A valid hazard event decodes.
  const fields = structuredClone(encode(r));
  (fields[5] as Encoded).knockouts.push({
    tick: r.simulation.tick,
    by: "",
    target: host,
    x: 0,
    y: 0,
    cause: "hazard",
  });
  assert.ok(decode(fields, r.tick));
});

test("the rules are a fresh number", async () => {
  const { RULES } = await import("../src/engine/world.js");
  assert.equal(RULES, "hook-havok-15");
  const ids: MapId[] = ["belfry", "crossroads", "spire"];
  for (const id of ids) assert.ok(MAPS[id].spawns.length === 5);
});
