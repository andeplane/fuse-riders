import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  syncKeepers,
  stepArena,
  encodeArena,
  decodeArena,
  type Arena,
  type Keeper,
} from "../src/engine/arena.js";
import {
  CLASSIC_TUNING,
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  type Input,
  type Tuning,
} from "../src/engine/world.js";
import { POWER_PADS, grantPower, padList } from "../src/engine/power-ups.js";
import {
  ALL_POWERS,
  CLUSTER_CHARGES,
  CLUSTER_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  PAD_TICKS,
  POWER_KINDS,
  POWER_TICKS,
  drawPower,
  powerPool,
  powerTicks,
  type PowerKind,
} from "../src/engine/power-rules.js";
import {
  BOMBLET_FUSE,
  COOLDOWN_TICKS,
  FUSE_TICKS,
  KO_RESPAWN,
  MAX_BOMBS,
} from "../src/engine/bomb-rules.js";
import type { Bomb } from "../src/engine/bomb.js";
import { parseTuning } from "../src/engine/codec.js";
import { supported } from "../src/engine/collision.js";
import { MAPS } from "../src/engine/maps.js";
import { COUNTDOWN_TICKS, ROUND_TICKS } from "../src/engine/contest.js";
import { toView } from "../src/engine/view.js";
import {
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  hookGame,
  type Entry,
} from "../src/online/game.js";
import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";

const POWERS: Tuning = {
  ...CLASSIC_TUNING,
  bomb: "fuse",
  powerUps: ALL_POWERS,
  jumpMode: "double",
};
const members = ["amber", "blue", "green"].map((id, slot) => ({
  id,
  slot,
  connected: true,
  generation: 1,
}));
function arena(n = 2, tuning: Tuning = POWERS, seed = 0): Arena {
  const a = createArena(tuning, 0, seed);
  syncKeepers(a, members.slice(0, n));
  if (tuning.rules !== "free")
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(a);
  for (const k of a.keepers) k.spawnGuard = 0;
  return a;
}
/** Stand a keeper on a ledge top at x (world units). */
function stand(k: Keeper, x: number, top = 810): void {
  Object.assign(k.world, {
    x: x * S,
    feet: top * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
  });
}
/** In the air at rest, air jump ready. */
function hover(k: Keeper, x: number, feet: number): void {
  Object.assign(k.world, {
    x: x * S,
    feet: feet * S,
    vx: 0,
    vy: 0,
    grounded: false,
    coyote: 0,
    airJump: k.world.tuning.jumpMode === "double",
  });
}
function press(a: Arena, k: Keeper, input: Partial<Input>, ticks = 1): void {
  k.world.input = { ...NEUTRAL, ...input };
  for (let i = 0; i < ticks; i++) stepArena(a);
}
/** A bomb placed by a test, with the owner's cooldown it would have. */
function plant(
  a: Arena,
  owner: Keeper,
  x: number,
  y: number,
  fuse = 1,
  kind: Bomb["kind"] = "plain",
): Bomb {
  const bomb: Bomb = {
    id: a.tick * 32 + owner.slot * 4 + (kind === "bomblet" ? 1 : 0),
    owner: owner.id,
    kind,
    x: Math.round(x * S),
    y: Math.round(y * S),
    vx: 0,
    vy: 0,
    fuse,
  };
  owner.bomb.cooldown = COOLDOWN_TICKS;
  a.bombs.push(bomb);
  a.bombs.sort((p, q) => p.id - q.id);
  return bomb;
}
const roundTrip = (a: Arena) => decodeArena(encodeArena(a));

test("the pool is a validated bit mask, filtered by the bomb setting, drawn statelessly", () => {
  assert.equal(DEFAULT_TUNING.powerUps, ALL_POWERS, "new rooms: all five");
  assert.equal(CLASSIC_TUNING.powerUps, 0);
  for (const powerUps of [-1, ALL_POWERS + 1, 1.5, "on", "off", null])
    assert.equal(parseTuning({ ...DEFAULT_TUNING, powerUps }), undefined);
  assert.ok(parseTuning({ ...DEFAULT_TUNING, powerUps: 0 }));
  assert.deepEqual(powerPool(POWERS), POWER_KINDS);
  assert.deepEqual(powerPool({ ...POWERS, bomb: "off" }), [
    "triple",
    "harpoon",
    "dash",
  ]);
  assert.deepEqual(powerPool({ ...POWERS, powerUps: 0b10010 }), [
    "shield",
    "dash",
  ]);
  assert.deepEqual(powerPool({ ...POWERS, powerUps: 0 }), []);
  const seen = new Set<PowerKind | undefined>();
  for (let cycle = 0; cycle < 200; cycle++) {
    const kind = drawPower(1234, 2, cycle, POWER_KINDS);
    assert.equal(kind, drawPower(1234, 2, cycle, POWER_KINDS));
    seen.add(kind);
  }
  assert.equal(seen.size, POWER_KINDS.length, "every kind turns up");
  assert.equal(drawPower(9, 0, 7, ["dash"]), "dash");
  assert.equal(drawPower(9, 0, 7, []), undefined);
  for (const map of ["belfry", "crossroads"] as const) {
    const one = padList(createArena({ ...POWERS, map }, 0, 77));
    assert.deepEqual(one, padList(createArena({ ...POWERS, map }, 0, 77)));
    assert.equal(one.length, 4, `${map} pad count`);
    assert.ok(one.every((p) => p.ready));
    // Every pad sits 28 units above a ledge a keeper can stand on.
    for (const p of POWER_PADS[map])
      assert.ok(
        supported(p.x * S, (p.y + 28) * S - 1, MAPS[map].platforms),
        `${map} pad at ${p.x}`,
      );
  }
  const kinds = (seed: number) =>
    padList(createArena(POWERS, 0, seed))
      .map((p) => p.kind)
      .join();
  assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(kinds)).size > 1);
  assert.deepEqual(padList(createArena({ ...POWERS, powerUps: 0 })), []);
});
test("a collected pad gives its draw, recharges for ten active seconds and returns with a new draw", () => {
  const a = arena(2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  const shown = padList(a)[0]!.kind;
  stand(amber, 790, 610);
  stand(blue, 790, 610);
  stepArena(a);
  assert.deepEqual(a.pickupEvents, [
    { tick: a.tick, by: "amber", pad: 0, kind: shown },
  ]);
  assert.equal(amber.power.kind, shown, "first slot wins a contested pad");
  assert.equal(amber.power.taken, 1);
  assert.equal(blue.power.kind, "");
  assert.deepEqual(a.pads[0], { cooldown: PAD_TICKS, cycle: 1 });
  const next = drawPower(a.seed, 0, 1, powerPool(a.tuning));
  assert.deepEqual(padList(a)[0], {
    ...POWER_PADS.belfry[0]!,
    kind: next,
    ready: false,
  });
  // The lobby freezes the timer.
  stepArena(a, false);
  assert.equal(a.pads[0]!.cooldown, PAD_TICKS);
  stand(amber, 200);
  stand(blue, 300);
  press(a, amber, {}, PAD_TICKS - 1);
  assert.equal(a.pads[0]!.cooldown, 1);
  assert.equal(amber.power.kind, "", "long expired");
  stand(blue, 790, 610);
  stepArena(a);
  assert.equal(a.pads[0]!.cooldown, PAD_TICKS);
  assert.equal(blue.power.kind, next);
  assert.deepEqual(a.pads[0], { cooldown: PAD_TICKS, cycle: 2 });
  assert.ok(roundTrip(a));
});
test("eliminated, watching, returning and disconnected keepers cannot collect; a round start refreshes every pad", () => {
  const a = arena(2, { ...POWERS, rules: "elimination" });
  syncKeepers(a, members);
  const [amber, blue, green] = a.keepers as [Keeper, Keeper, Keeper];
  a.contest.entries[0]!.out = true;
  stand(amber, 790, 610);
  stand(green, 1180, 480);
  // A returning keeper does not move, so it stays on the pad it is placed on.
  stand(blue, 1395, 270);
  Object.assign(blue.world, { respawn: 10, airJump: false });
  stepArena(a);
  assert.deepEqual(
    a.pads.map((p) => p.cooldown),
    [0, 0, 0, 0],
  );
  assert.deepEqual(a.pickupEvents, []);
  assert.equal(blue.world.x, 1395 * S, "still on the pad");
  // The same spots do collect for a keeper in play.
  const control = arena(1);
  stand(control.keepers[0]!, 1395, 270);
  stepArena(control);
  assert.equal(control.pads[2]!.cooldown, PAD_TICKS);
  const away = arena(2);
  syncKeepers(away, [{ ...members[0]!, connected: false }, members[1]!]);
  stand(away.keepers[0]!, 790, 610);
  stepArena(away);
  assert.equal(away.pads[0]!.cooldown, 0, "disconnected");
  const b = createArena({ ...POWERS, rules: "score" });
  syncKeepers(b, members.slice(0, 2));
  b.pads[1] = { cooldown: 300, cycle: 5 };
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(b);
  assert.equal(b.contest.phase, "active");
  assert.deepEqual(b.pads[1], { cooldown: 0, cycle: 6 });
  assert.deepEqual(b.pads[0], { cooldown: 0, cycle: 1 });
});
test("Triple jump gives two air jumps in either jump mode, refills on landing and expires", () => {
  for (const jumpMode of ["double", "single"] as const) {
    const a = arena(1, { ...POWERS, jumpMode }),
      k = a.keepers[0]!,
      launch = -Math.round((POWERS.jump * S) / 60);
    stand(k, 300);
    grantPower(k, "triple", jumpMode);
    const pips = () =>
      Number(toView(k.world).airJump) + toView(k.world).bonusJumps;
    assert.equal(pips(), 2, `${jumpMode}: two air jumps ready`);
    let jumps = 0;
    for (let i = 0; i < 5; i++) {
      press(a, k, { jump: true });
      if (k.world.vy === launch) jumps++;
      press(a, k, {});
    }
    assert.equal(jumps, 3, `${jumpMode}: a ground jump and two air jumps`);
    assert.equal(pips(), 0);
    press(a, k, {}, 150);
    assert.ok(k.world.grounded);
    assert.equal(pips(), 2, `${jumpMode}: refilled on landing`);
    k.power.ticks = 1;
    stepArena(a);
    assert.equal(k.power.kind, "");
    assert.equal(pips(), jumpMode === "double" ? 1 : 0, "back to normal");
  }
  // Without it a double jump is still two jumps.
  const plain = arena(1),
    k = plain.keepers[0]!;
  stand(k, 300);
  let jumps = 0;
  for (let i = 0; i < 4; i++) {
    press(plain, k, { jump: true });
    if (k.world.vy < -12 * S) jumps++;
    press(plain, k, {});
  }
  assert.equal(jumps, 2);
});
test("Shield survives exactly one blast, the keeper's own included, and pops", () => {
  const a = arena(3);
  const [amber, blue, green] = a.keepers as [Keeper, Keeper, Keeper];
  stand(amber, 200);
  stand(blue, 330);
  stand(green, 450);
  grantPower(blue, "shield", "double");
  plant(a, amber, 330, 790);
  stepArena(a);
  assert.equal(blue.world.respawn, 0, "absorbed");
  assert.equal(blue.power.kind, "", "popped");
  assert.equal(blue.bomb.bombed, 0);
  assert.deepEqual(
    a.shieldPops.map((e) => [e.target, e.tick, e.x]),
    [["blue", a.tick, 330 * S]],
  );
  assert.ok(roundTrip(a));
  press(a, blue, {}, 5);
  plant(a, green, 330, 790);
  stepArena(a);
  assert.equal(blue.world.respawn, KO_RESPAWN, "the next blast knocks out");
  assert.equal(blue.bomb.by, "green");
  // A self-blast is absorbed too.
  const own = arena(2);
  const [other, self] = own.keepers as [Keeper, Keeper];
  stand(other, 150);
  stand(self, 330);
  grantPower(self, "shield", "double");
  plant(own, self, 330, 790);
  stepArena(own);
  assert.equal(self.world.respawn, 0);
  assert.equal(self.bomb.selfKnockouts, 0);
  // Blasts in the tick it pops are one blast: a cluster's bomblets go off together.
  const pair = arena(3);
  const [p0, p1, p2] = pair.keepers as [Keeper, Keeper, Keeper];
  stand(p0, 150);
  stand(p1, 330);
  stand(p2, 500);
  grantPower(p1, "shield", "double");
  plant(pair, p0, 320, 790);
  plant(pair, p2, 340, 790);
  stepArena(pair);
  assert.equal(p1.world.respawn, 0);
  assert.equal(pair.shieldPops.length, 1);
  assert.equal(pair.blasts.length, 2);
});
test("Shield blocks bombs only: rival hooks still knock a shielded keeper", () => {
  const a = arena(2);
  const [victim, attacker] = a.keepers as [Keeper, Keeper];
  stand(victim, 130);
  stand(attacker, 240);
  grantPower(victim, "shield", "double");
  attacker.world.input = { ...NEUTRAL, fire: true, aimX: 130, aimY: 780 };
  for (let i = 0; i < 20 && !attacker.hits; i++) stepArena(a);
  assert.equal(attacker.hits, 1);
  assert.ok(victim.world.vx < 0, "knocked back as before");
  assert.equal(victim.power.kind, "shield", "a hook does not pop it");
});
test("Cluster bomb: the next three throws split into three bomblets on first contact, then plain bombs", () => {
  const a = arena(2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  stand(amber, 1000, 480);
  stand(blue, 1150, 480);
  grantPower(amber, "cluster", "double");
  const kinds: Bomb["kind"][] = [];
  for (let i = 0; i < CLUSTER_CHARGES + 1; i++) {
    press(a, amber, { bomb: true }, 2);
    press(a, amber, { bomb: false, aimX: 700, aimY: 100 });
    kinds.push(a.bombs.find((b) => b.owner === "amber")!.kind);
    a.bombs = [];
    amber.bomb.cooldown = 0;
  }
  assert.deepEqual(kinds, ["cluster", "cluster", "cluster", "plain"]);
  assert.equal(amber.power.kind, "", "spent after three");
  // A cluster bomb falling onto the low ledge splits on touching it.
  const bomb = plant(a, amber, 330, 780, FUSE_TICKS, "cluster");
  bomb.vy = 4 * S;
  let split = 0;
  for (let i = 0; i < 20 && !a.bombs.some((b) => b.kind === "bomblet"); i++) {
    stepArena(a);
    split = a.tick;
  }
  const bomblets = a.bombs.filter((b) => b.kind === "bomblet");
  assert.equal(bomblets.length, 3);
  assert.equal(a.bombs.length, 3, "the parent is gone");
  assert.deepEqual(
    bomblets.map((b) => b.id),
    [1, 2, 3].map((n) => split * 32 + amber.slot * 4 + n),
  );
  assert.ok(bomblets.every((b) => b.owner === "amber" && b.vy < 0));
  assert.equal(new Set(bomblets.map((b) => b.vx)).size, 3, "spread out");
  assert.ok(bomblets.every((b) => b.fuse === BOMBLET_FUSE));
  assert.ok(roundTrip(a), "bomblets checkpoint");
  press(a, amber, {}, BOMBLET_FUSE);
  assert.equal(a.bombs.length, 0);
  assert.deepEqual(
    a.blasts.map((e) => e.kind),
    ["bomblet", "bomblet", "bomblet"],
  );
});
test("bomblets blast 0.6× as far, hit their thrower, and a split respects the live-bomb cap", () => {
  const a = arena(3);
  const [amber, blue, green] = a.keepers as [Keeper, Keeper, Keeper];
  stand(amber, 290);
  stand(blue, 386);
  stand(green, 406);
  plant(a, amber, 330, 790, 1, "bomblet");
  stepArena(a);
  assert.equal(amber.world.respawn, KO_RESPAWN, "friendly fire");
  assert.equal(blue.world.respawn, KO_RESPAWN, "40 units from the edge");
  assert.equal(
    green.world.respawn,
    0,
    "60 units: a bomb would reach, a bomblet does not",
  );
  const b = arena(1);
  const k = b.keepers[0]!;
  stand(k, 1000, 480);
  press(b, k, {}, 5);
  for (let i = 0; i < MAX_BOMBS - 2; i++)
    b.bombs.push({
      id: i * 4,
      owner: `ghost${i}`,
      kind: "plain",
      x: 1500 * S,
      y: -2000 * S,
      vx: 0,
      vy: 0,
      fuse: FUSE_TICKS,
    });
  const cluster = plant(b, k, 330, 799, FUSE_TICKS, "cluster");
  cluster.vy = 5 * S;
  stepArena(b);
  assert.equal(b.bombs.length, MAX_BOMBS);
  assert.equal(b.bombs.filter((x) => x.kind === "bomblet").length, 2);
  assert.deepEqual(
    b.bombs.map((x) => x.id),
    [...b.bombs.map((x) => x.id)].sort((p, q) => p - q),
  );
});
test("Harpoon pulls a hit rival toward the hook's owner; spawn protection still stops it", () => {
  const velocity = (harpoon: boolean, guard = 0) => {
    const a = arena(2);
    const [victim, attacker] = a.keepers as [Keeper, Keeper];
    stand(victim, 130);
    stand(attacker, 240);
    victim.spawnGuard = guard;
    if (harpoon) grantPower(attacker, "harpoon", "double");
    let hit = false;
    attacker.world.input = { ...NEUTRAL, fire: true, aimX: 130, aimY: 780 };
    for (let i = 0; i < 20 && !hit; i++) {
      stepArena(a);
      hit = attacker.hits > 0;
    }
    return { hit, vx: victim.world.vx, vy: victim.world.vy };
  };
  const push = velocity(false),
    pull = velocity(true);
  assert.ok(push.hit && pull.hit);
  assert.ok(push.vx < 0, "an ordinary hit pushes away");
  assert.ok(pull.vx > 8 * S, "a harpoon hit pulls toward the owner");
  assert.ok(pull.vy < 0, "and lifts off the ledge");
  assert.ok(Math.hypot(pull.vx, pull.vy) <= Math.round((1000 * S) / 60) * 1.5);
  assert.equal(velocity(true, 20).hit, false, "spawn protection");
});
test("Dash bump: the air jump dashes along the aim at a fixed speed for 0.2 s, refilling like the air jump", () => {
  const a = arena(2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  stand(blue, 1300, 270);
  hover(amber, 300, 600);
  grantPower(amber, "dash", "double");
  const speed = Math.round((DASH_SPEED * S) / 60),
    x0 = amber.world.x,
    aim = { aimX: 1000, aimY: 569 };
  press(a, amber, { jump: true, ...aim });
  assert.equal(amber.world.dash, DASH_TICKS);
  assert.ok(
    Math.abs(amber.world.vx - speed) < S / 8,
    "fixed speed along the aim",
  );
  assert.ok(Math.abs(amber.world.vy) < S / 8);
  assert.equal(amber.world.airJump, false);
  press(a, amber, aim, DASH_TICKS - 1);
  assert.equal(amber.world.dash, 1);
  assert.ok(Math.abs(amber.world.vx - speed) < S / 8, "no drag");
  assert.ok(Math.abs(amber.world.vy) < S / 8, "no gravity");
  press(a, amber, aim);
  assert.equal(amber.world.dash, 0);
  assert.equal(amber.world.vx, Math.round(speed / 2), "half the speed kept");
  assert.ok(amber.world.x - x0 > 170 * S && amber.world.x - x0 < 200 * S);
  press(a, amber, { jump: true, ...aim });
  assert.equal(amber.world.dash, 0, "one dash per landing");
  // Straight up works too, and landing refills it.
  press(a, amber, {}, 200);
  assert.ok(amber.world.grounded);
  hover(amber, 300, 600);
  grantPower(amber, "dash", "double");
  press(a, amber, { jump: true, aimX: 300, aimY: 0 });
  assert.ok(amber.world.vy < -speed + S / 8);
  // A single-jump room has no air jump, so the dash comes from the power.
  const single = arena(1, { ...POWERS, jumpMode: "single" }),
    k = single.keepers[0]!;
  hover(k, 300, 600);
  grantPower(k, "dash", "single");
  assert.equal(k.world.bonusJumps, 1);
  press(single, k, { jump: true, ...aim });
  assert.equal(k.world.dash, DASH_TICKS);
  assert.equal(k.world.bonusJumps, 0);
});
test("a dash that touches a rival knocks them away hard, once, and ends; spawn protection stops it", () => {
  const bump = (guard: number) => {
    const a = arena(2);
    const [amber, blue] = a.keepers as [Keeper, Keeper];
    stand(blue, 345);
    blue.spawnGuard = guard;
    hover(amber, 300, 790);
    grantPower(amber, "dash", "double");
    press(a, amber, { jump: true, aimX: 900, aimY: 759 });
    return { a, amber, blue };
  };
  const { a, amber, blue } = bump(0);
  assert.equal(amber.hits, 1);
  assert.equal(amber.world.dash, 0, "the dash ends on contact");
  assert.ok(blue.world.vx > 9 * S, "harder than a hook's push");
  assert.ok(blue.world.vy <= -5 * S);
  assert.equal(a.hit?.target, "blue");
  press(a, amber, {});
  assert.equal(amber.hits, 1, "one bump per dash");
  const guarded = bump(20);
  assert.equal(guarded.amber.hits, 0);
  assert.equal(guarded.blue.world.vx, 0);
  assert.ok(roundTrip(a));
});
test("a cluster bomb that meets a rival in impact mode, or whose fuse ends first, blasts as a bomb", () => {
  const impact = arena(2, { ...POWERS, bomb: "impact" });
  const [thrower, rival] = impact.keepers as [Keeper, Keeper];
  stand(thrower, 150);
  stand(rival, 330);
  plant(impact, thrower, 330, 780, FUSE_TICKS, "cluster");
  stepArena(impact);
  assert.deepEqual(
    impact.blasts.map((e) => e.kind),
    ["cluster"],
  );
  assert.equal(impact.bombs.length, 0, "no bomblets");
  assert.equal(rival.world.respawn, KO_RESPAWN);
  const fuse = arena(3);
  const [owner, under, near] = fuse.keepers as [Keeper, Keeper, Keeper];
  stand(owner, 150);
  stand(under, 330);
  stand(near, 416);
  plant(fuse, owner, 330, 740, 1, "cluster");
  stepArena(fuse);
  assert.equal(fuse.bombs.length, 0, "no bomblets");
  assert.equal(near.world.respawn, KO_RESPAWN, "70 units: a bomb's reach");
});
test("a new pickup replaces the power held, and Harpoon scores like any hit", () => {
  const a = arena(1, { ...POWERS, powerUps: 2 }),
    k = a.keepers[0]!;
  stand(k, 300);
  grantPower(k, "triple", "double");
  assert.equal(k.world.bonusJumps, 1);
  stand(k, 790, 610);
  stepArena(a);
  assert.equal(k.power.kind, "shield");
  assert.equal(k.world.bonusJumps, 0, "Triple jump's extra jump went with it");
  assert.equal(k.power.taken, 2);
  const s = arena(2, { ...POWERS, rules: "score" });
  const [victim, attacker] = s.keepers as [Keeper, Keeper];
  stand(victim, 130);
  stand(attacker, 240);
  grantPower(attacker, "harpoon", "double");
  attacker.world.input = { ...NEUTRAL, fire: true, aimX: 130, aimY: 780 };
  for (let i = 0; i < 20 && !attacker.hits; i++) stepArena(s);
  assert.equal(s.contest.entries.find((e) => e.id === "blue")!.score, 1);
  assert.ok(victim.spawnGuard > 0, "the victim is protected after the hit");
  assert.ok(victim.world.vx > 0, "pulled in");
});
test("a dash ends on landing, on a rope that catches, and when Dash bump runs out", () => {
  const land = arena(1),
    k = land.keepers[0]!;
  hover(k, 300, 700);
  grantPower(k, "dash", "double");
  press(land, k, { jump: true, aimX: 300, aimY: 2000 });
  let ticks = 1;
  for (; ticks < DASH_TICKS && !k.world.grounded; ticks++) press(land, k, {});
  assert.ok(k.world.grounded && ticks < DASH_TICKS, "landed mid-dash");
  assert.equal(k.world.dash, 0);
  const rope = arena(1),
    r = rope.keepers[0]!;
  hover(r, 300, 600);
  grantPower(r, "dash", "double");
  press(rope, r, { jump: true, aimX: 300, aimY: 0 });
  let caught = 1;
  for (; caught < DASH_TICKS && r.world.hook.phase !== "attached"; caught++)
    press(rope, r, { fire: true, aimX: 300, aimY: 0 });
  assert.equal(r.world.hook.phase, "attached");
  assert.ok(caught < DASH_TICKS);
  assert.equal(r.world.dash, 0, "the swing takes over");
  const out = arena(1),
    o = out.keepers[0]!;
  hover(o, 300, 600);
  grantPower(o, "dash", "double");
  press(out, o, { jump: true, aimX: 1000, aimY: 569 });
  const speed = o.world.vx;
  o.power.ticks = 1;
  press(out, o, {});
  assert.equal(o.power.kind, "");
  assert.equal(o.world.dash, 0);
  assert.equal(o.world.vx, Math.round(speed / 2));
});
test("every power ends with the round, keeping the round's pickup count", () => {
  const a = arena(2, { ...POWERS, rules: "score" });
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  stand(amber, 300);
  stand(blue, 400);
  while (a.contest.elapsed < ROUND_TICKS - 3) stepArena(a);
  grantPower(amber, "cluster", "double");
  grantPower(blue, "dash", "double");
  while (a.contest.phase === "active") stepArena(a);
  assert.equal(a.contest.phase, "over");
  assert.deepEqual(
    a.keepers.map((k) => [k.power.kind, k.power.taken]),
    [
      ["", 1],
      ["", 1],
    ],
  );
  assert.ok(roundTrip(a));
});
test("every power ends on time, on a fall, a reset, a knockout, a disconnect or a new generation", () => {
  for (const kind of POWER_KINDS) {
    const a = arena(1),
      k = a.keepers[0]!;
    stand(k, 300);
    grantPower(k, kind, "double");
    press(a, k, {}, powerTicks(kind) - 1);
    assert.equal(k.power.kind, kind, `${kind} still on`);
    stepArena(a);
    assert.equal(k.power.kind, "", `${kind} expired`);
  }
  assert.equal(powerTicks("shield"), POWER_TICKS);
  assert.equal(powerTicks("cluster"), CLUSTER_TICKS);
  const fall = arena(1),
    faller = fall.keepers[0]!;
  hover(faller, 300, 700);
  grantPower(faller, "dash", "double");
  press(fall, faller, { jump: true, aimX: 300, aimY: 2000 });
  assert.ok(faller.world.dash > 0);
  faller.world.feet = 960 * S;
  stepArena(fall);
  assert.ok(faller.world.respawn > 0);
  assert.deepEqual(
    [faller.power.kind, faller.world.dash, faller.world.bonusJumps],
    ["", 0, 0],
  );
  assert.equal(faller.power.taken, 1, "the tally stays");
  const reset = arena(1),
    resetter = reset.keepers[0]!;
  stand(resetter, 300);
  grantPower(resetter, "triple", "double");
  press(reset, resetter, { reset: true });
  assert.deepEqual([resetter.power.kind, resetter.world.bonusJumps], ["", 0]);
  const blast = arena(2),
    [thrower, victim] = blast.keepers as [Keeper, Keeper];
  stand(thrower, 150);
  stand(victim, 330);
  grantPower(victim, "harpoon", "double");
  plant(blast, thrower, 330, 790);
  stepArena(blast);
  assert.equal(victim.world.respawn, KO_RESPAWN);
  assert.equal(victim.power.kind, "");
  assert.ok(roundTrip(blast));
  const away = arena(2);
  grantPower(away.keepers[0]!, "shield", "double");
  grantPower(away.keepers[1]!, "triple", "double");
  syncKeepers(away, [
    { ...members[0]!, connected: false },
    { ...members[1]!, generation: 2 },
  ]);
  assert.deepEqual(
    away.keepers.map((k) => [k.power.kind, k.world.bonusJumps]),
    [
      ["", 0],
      ["", 0],
    ],
  );
});
function script(slot: number, tick: number): Input {
  const phase = (tick + slot * 41) % 200;
  return {
    ...NEUTRAL,
    move: (phase < 50 ? 1 : phase < 110 ? -1 : 0) as Input["move"],
    jump: phase % 23 < 3,
    fire: phase > 120 && phase < 150,
    bomb: phase % 90 < 3 + slot * 8,
    aimX: 700 + slot * 150,
    aimY: 300 + slot * 90,
  };
}
test("deterministic replay through pickups and active powers, restoring checkpoints mid-effect on both maps", () => {
  for (const map of ["belfry", "crossroads"] as const) {
    const a = createArena(
      { ...DEFAULT_TUNING, map, experiment: "movement" },
      0,
      4242,
    );
    syncKeepers(a, members);
    let b = roundTrip(a)!;
    let restoredActive = 0,
      split = 0;
    for (let tick = 0; tick < 2400; tick++) {
      for (const arena of [a, b]) {
        arena.keepers.forEach((k) => (k.world.input = script(k.slot, tick)));
        // Carry keepers to the pads so every power turns up.
        if (tick % 120 === 0) {
          const k = arena.keepers[(tick / 120) % 3]!,
            pad = POWER_PADS[map][(tick / 120) % POWER_PADS[map].length]!;
          if (!k.world.respawn) stand(k, pad.x, pad.y + 28);
        }
      }
      stepArena(a);
      stepArena(b);
      if (a.bombs.some((x) => x.kind === "bomblet")) split++;
      assert.ok(roundTrip(a), `${map} tick ${tick} checkpoints`);
      if (tick % 23 === 0) {
        if (b.keepers.some((k) => k.power.kind)) restoredActive++;
        b = roundTrip(b)!;
      }
    }
    assert.deepEqual(encodeArena(a), encodeArena(b), map);
    const taken = a.keepers.reduce((n, k) => n + k.power.taken, 0);
    assert.ok(taken >= 10, `${map}: ${taken} pickups`);
    assert.ok(restoredActive > 20, `${map}: restored with a power active`);
    assert.ok(split > 0, `${map}: a cluster bomb split`);
  }
});

const host = "host";
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
/** The encoded arena, loosely typed so tests can corrupt it. */
interface Encoded {
  tick: number;
  seed: unknown;
  tuning: Tuning;
  pads: Record<string, unknown>[];
  pickupEvents: Record<string, unknown>[];
  shieldPops: Record<string, unknown>[];
  bombs: Record<string, unknown>[];
  blasts: Record<string, unknown>[];
  keepers: {
    connected: boolean;
    power: Record<string, unknown>;
    body: Record<string, unknown>;
  }[];
}
test("checkpoints reject corrupt or out-of-bounds power-up state and leave the healthy room unchanged", () => {
  const r = createRoom("lobby", { ...DEFAULT_TUNING, experiment: "movement" });
  foldTick(
    r,
    host,
    stream([
      [1, 1, JOIN, host, "Keeper", 0, "keeper", 1],
      [2, 1, ACTION, "start", "match"],
    ]),
  );
  for (let t = 2; t < 30; t++)
    foldTick(r, host, stream([at(t, { bomb: t < 20, aimX: 700, aimY: 500 })]));
  const s = r.simulation,
    k = s.keepers[0]!;
  assert.equal(s.bombs.length, 1);
  grantPower(k, "cluster", "double");
  k.power.charges = 2;
  s.pads[1] = { cooldown: 200, cycle: 3 };
  s.pickupEvents = [{ tick: s.tick, by: host, pad: 1, kind: "cluster" }];
  s.shieldPops = [{ tick: s.tick, target: host, x: 800 * S, y: 700 * S }];
  const good = encode(r),
    saved = hash(r);
  assert.equal(hash(decode(good, r.tick)!), saved);
  const view = hookGame.view(r);
  assert.equal(view.pickups.length, 4);
  assert.equal(view.pickups[1]!.kind, "", "a recharging pad hides its draw");
  assert.equal(view.pickups[1]!.cooldown, 4);
  assert.deepEqual(view.keepers[0]!.power, {
    kind: "cluster",
    left: 1,
    seconds: CLUSTER_TICKS / 60,
    charges: 2,
  });
  assert.equal(view.keepers[0]!.tally.powerUps, 1);
  assert.deepEqual(view.powers, POWER_KINDS);
  const edit = (change: (s: Encoded) => void) => {
    const fields = structuredClone(good);
    change(fields[5] as Encoded);
    return fields;
  };
  const cases: [string, (s: Encoded) => void][] = [
    ["unknown power", (s) => (s.keepers[0]!.power.kind = "lift")],
    ["power too long", (s) => (s.keepers[0]!.power.ticks = CLUSTER_TICKS + 1)],
    ["power without time", (s) => (s.keepers[0]!.power.ticks = 0)],
    ["cluster charges 4", (s) => (s.keepers[0]!.power.charges = 4)],
    ["cluster without charges", (s) => (s.keepers[0]!.power.charges = 0)],
    [
      "charges on a shield",
      (s) => Object.assign(s.keepers[0]!.power, { kind: "shield", ticks: 10 }),
    ],
    [
      "shield too long",
      (s) =>
        Object.assign(s.keepers[0]!.power, {
          kind: "shield",
          ticks: POWER_TICKS + 1,
          charges: 0,
        }),
    ],
    [
      "time without a power",
      (s) => Object.assign(s.keepers[0]!.power, { kind: "", charges: 0 }),
    ],
    ["fractional tally", (s) => (s.keepers[0]!.power.taken = 1.5)],
    ["extra power key", (s) => (s.keepers[0]!.power.extra = 1)],
    [
      "missing power",
      (s) => delete (s.keepers[0] as Partial<Encoded["keepers"][0]>).power,
    ],
    [
      "bonus jumps without the power",
      (s) => (s.keepers[0]!.body.bonusJumps = 1),
    ],
    [
      "too many bonus jumps",
      (s) => {
        Object.assign(s.keepers[0]!.power, {
          kind: "triple",
          ticks: 9,
          charges: 0,
        });
        s.keepers[0]!.body.bonusJumps = 2;
      },
    ],
    [
      "a dash without Dash bump",
      (s) => Object.assign(s.keepers[0]!.body, { dash: 5, grounded: false }),
    ],
    [
      "a dash on the ground",
      (s) => {
        Object.assign(s.keepers[0]!.power, {
          kind: "dash",
          ticks: 9,
          charges: 0,
        });
        s.keepers[0]!.body.dash = 5;
      },
    ],
    [
      "power while returning",
      (s) =>
        Object.assign(s.keepers[0]!.body, {
          respawn: 10,
          feet: 1000 * S,
          vx: 0,
          vy: 0,
          grounded: false,
          airJump: false,
        }),
    ],
    ["pads short", (s) => s.pads.pop()],
    ["pad cooldown too long", (s) => (s.pads[0]!.cooldown = PAD_TICKS + 1)],
    ["pad cycle negative", (s) => (s.pads[0]!.cycle = -1)],
    ["extra pad key", (s) => (s.pads[0]!.kind = "dash")],
    ["pickup on no pad", (s) => (s.pickupEvents[0]!.pad = 4)],
    ["pickup of an unknown kind", (s) => (s.pickupEvents[0]!.kind = "ward")],
    ["future pickup", (s) => (s.pickupEvents[0]!.tick = s.tick + 1)],
    ["stale shield pop", (s) => (s.shieldPops[0]!.tick = s.tick - 40)],
    ["shield pop off the map", (s) => (s.shieldPops[0]!.x = -1)],
    ["missing shield pops", (s) => delete (s as Partial<Encoded>).shieldPops],
    ["negative seed", (s) => (s.seed = -1)],
    ["fractional seed", (s) => (s.seed = 0.5)],
    ["unknown bomb kind", (s) => (s.bombs[0]!.kind = "sticky")],
    ["bomblet with a throw id", (s) => (s.bombs[0]!.kind = "bomblet")],
    [
      "bomblet fuse too long",
      (s) =>
        Object.assign(s.bombs[0]!, {
          kind: "bomblet",
          id: (s.bombs[0]!.id as number) + 1,
          fuse: BOMBLET_FUSE + 1,
        }),
    ],
    [
      "four bomblets, one owner",
      (s) => {
        const first = s.bombs[0]!,
          id = first.id as number;
        // Three from one split and a fourth from a later tick's: all valid ids.
        s.bombs = [1, 2, 3, 33].map((n) => ({
          ...first,
          kind: "bomblet",
          id: id + n,
          fuse: 10,
        }));
      },
    ],
    [
      "two bombs, one owner",
      (s) =>
        s.bombs.push({ ...s.bombs[0]!, id: (s.bombs[0]!.id as number) + 32 }),
    ],
    [
      "unknown blast kind",
      (s) =>
        s.blasts.push({
          tick: s.tick,
          id: 0,
          owner: host,
          kind: "sticky",
          x: 0,
          y: 0,
        }),
    ],
  ];
  for (const [name, change] of cases) {
    assert.equal(decode(edit(change), r.tick), undefined, name);
    assert.equal(hash(r), saved, `${name}: healthy state unchanged`);
  }
  // Bomblets from a valid split are accepted.
  const valid = edit((s) => {
    const first = s.bombs[0]!,
      id = first.id as number;
    s.bombs = [1, 2, 3].map((n) => ({
      ...first,
      kind: "bomblet",
      id: id + n,
      fuse: 10,
    }));
  });
  assert.ok(decode(valid, r.tick), "three bomblets");
  const dashing = edit((s) => {
    Object.assign(s.keepers[0]!.power, { kind: "dash", ticks: 9, charges: 0 });
    Object.assign(s.keepers[0]!.body, { dash: 5, grounded: false });
  });
  assert.ok(decode(dashing, r.tick), "a dash in the air with Dash bump");
  // State the pool cannot hold: the arena itself rejects it.
  const arenaOf = (change: (s: Encoded) => void) => {
    const fields = edit(change);
    return decodeArena(fields[5]);
  };
  assert.ok(arenaOf(() => {}));
  // Without Cluster bomb in the pool: one reason at a time.
  const noCluster = (s: Encoded) => {
    s.tuning.powerUps = ALL_POWERS & ~4;
    s.keepers[0]!.power = { kind: "", ticks: 0, charges: 0, taken: 1 };
    s.pickupEvents = [];
  };
  assert.ok(arenaOf(noCluster), "the same state without cluster anything");
  for (const [name, change] of [
    [
      "a cluster power outside the pool",
      (s: Encoded) =>
        (s.keepers[0]!.power = {
          kind: "cluster",
          ticks: 9,
          charges: 1,
          taken: 1,
        }),
    ],
    [
      "a cluster pickup outside the pool",
      (s: Encoded) =>
        (s.pickupEvents = [
          { tick: s.tick, by: host, pad: 1, kind: "cluster" },
        ]),
    ],
    [
      "a cluster bomb outside the pool",
      (s: Encoded) => (s.bombs[0]!.kind = "cluster"),
    ],
  ] as const)
    assert.equal(
      arenaOf((s) => {
        noCluster(s);
        change(s);
      }),
      undefined,
      name,
    );
  // Bombs off takes Shield out of the pool, and with it any Shield pop.
  const noBombs = (s: Encoded) => {
    s.tuning.bomb = "off";
    s.keepers[0]!.power = { kind: "", ticks: 0, charges: 0, taken: 1 };
    s.keepers[0]!.body.charge = 0;
    (s.keepers[0] as unknown as { bomb: Record<string, unknown> }).bomb = {
      cooldown: 0,
      thrown: 0,
      knockouts: 0,
      selfKnockouts: 0,
      bombed: 0,
      fate: "",
      by: "",
    };
    s.pickupEvents = [];
    s.shieldPops = [];
    s.bombs = [];
  };
  assert.ok(arenaOf(noBombs), "bombs off, no Shield pop");
  assert.equal(
    arenaOf((s) => {
      noBombs(s);
      s.shieldPops = [{ tick: s.tick, target: host, x: 800 * S, y: 700 * S }];
    }),
    undefined,
    "a Shield pop with no Shield in the pool",
  );
  assert.equal(
    arenaOf((s) => (s.keepers[0]!.connected = false)),
    undefined,
    "a power while away",
  );
  assert.equal(
    arenaOf((s) => {
      s.tuning.powerUps = 0;
      s.keepers[0]!.power = { kind: "", ticks: 0, charges: 0, taken: 0 };
      s.pickupEvents = [];
      s.shieldPops = [];
      s.pads[1]!.cooldown = 0;
    })?.pads.length,
    4,
    "the off setting with nothing held decodes",
  );
  assert.equal(
    arenaOf((s) => {
      s.tuning.powerUps = 0;
      s.keepers[0]!.power = { kind: "", ticks: 0, charges: 0, taken: 0 };
      s.pickupEvents = [];
      s.shieldPops = [];
    }),
    undefined,
    "a recharging pad while off",
  );
  const settings = structuredClone(good);
  (settings[3] as Tuning).powerUps = 1;
  assert.equal(decode(settings, r.tick), undefined, "settings disagree");
  assert.equal(hash(r), saved);
});
