import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  BALL_SPEED,
  COUNTDOWN,
  MAX_BALLS,
  paddleScale,
  SUBSTEPS,
  type Impact,
  type PowerKind,
} from "../src/engine/state.js";
import {
  collect,
  spawnPowers,
  breakBlock,
  explode,
} from "../src/engine/powers.js";
import { step } from "../src/engine/step.js";
import { decodeArena, encodeArena } from "../src/engine/codec.js";
import { present } from "../src/app/presenter.js";
import { view } from "../src/engine/view.js";
import { AVATAR_IDS } from "../src/engine/avatars.js";
import { AVATAR_ATLAS } from "fuse-ui/assets";
import { botControl } from "../src/engine/bots.js";
import { control } from "../src/engine/state.js";

test("blast boundary is inclusive and recovered powered worlds replay identically", () => {
  const s = playing(),
    base = s.bases[1]!,
    ball = s.balls[0]!,
    block = base.blocks[0]!;
  ball.x = base.x + block.x + 38 + 1e-6;
  ball.y = base.y + block.y;
  explode(s, ball, []);
  assert.equal(block.alive, true);
  ball.x -= 1e-6;
  explode(s, ball, []);
  assert.equal(block.alive, false);
  Object.assign(ball, { x: 500, y: 500, vx: BALL_SPEED, vy: 0, held: null });
  for (const kind of ["bomb", "split", "sticky", "thief", "shrink"] as const)
    grant(s, kind);
  const restored = decodeArena(encodeArena(s))!;
  assert.ok(restored);
  for (let i = 0; i < 350; i++) {
    for (const world of [s, restored]) {
      for (const b of world.bases) control(world, b.id, botControl(world, b));
      step(world);
    }
    assert.deepEqual(restored, s);
  }
});

function playing() {
  const s = createArena([
    { id: "a", name: "A", slot: 0, bot: false, avatarId: "cat" },
    { id: "b", name: "B", slot: 1, bot: false },
  ]);
  s.tick = COUNTDOWN;
  s.formationStep = COUNTDOWN * SUBSTEPS;
  s.phase = "playing";
  return s;
}
function grant(s: ReturnType<typeof playing>, kind: PowerKind, index = 0) {
  const pickup = { id: 0, kind, x: 500, y: 500, expires: s.tick + 400 };
  s.pickups = [pickup];
  const events: Impact[] = [];
  collect(s, s.balls[index]!, pickup, events);
  return events;
}

test("pickup deck is bounded, expires, cycles every power and uses shared portrait cells", () => {
  assert.deepEqual(AVATAR_IDS, AVATAR_ATLAS.frames);
  const s = playing();
  const types = new Set();
  for (let tick = 0; tick <= 1200; tick++) {
    s.tick = tick;
    spawnPowers(s);
    s.pickups.forEach((p) => types.add(p.kind));
    assert.ok(s.pickups.length <= 3);
    assert.ok(s.pickups.every((p) => p.expires > tick));
  }
  assert.equal(types.size, 5);
  s.tick = 2401;
  spawnPowers(s);
  assert.equal(s.pickups.length, 0);
});

test("swept ball contact awards a pickup to its current owner, neutral balls do not consume it", () => {
  const s = playing(),
    ball = s.balls[0]!;
  Object.assign(ball, {
    x: 470,
    y: 500,
    vx: BALL_SPEED,
    vy: 0,
    held: null,
    owner: null,
  });
  s.pickups = [{ id: 0, kind: "bomb", x: 500, y: 500, expires: 400 }];
  step(s);
  assert.equal(s.pickups.length, 1);
  assert.equal(ball.bomb, false);
  ball.owner = "b";
  const events = step(s);
  assert.equal(ball.bomb, true);
  assert.equal(s.pickups.length, 0);
  assert.equal(events.find((e) => e.kind === "pickup")?.slot, 1);
  ball.owner = null;
  assert.equal(grant(s, "sticky").length, 0);
});

test("shrink stacks twice, expires separately and leaves collector unchanged", () => {
  const s = playing();
  grant(s, "shrink");
  assert.equal(paddleScale(s.bases[0]!), 1);
  assert.equal(paddleScale(s.bases[1]!), 0.75);
  s.tick += 10;
  grant(s, "shrink");
  s.tick += 10;
  grant(s, "shrink");
  assert.equal(paddleScale(s.bases[1]!), 0.5625);
  s.tick = 230;
  spawnPowers(s);
  assert.equal(paddleScale(s.bases[1]!), 0.75);
  s.tick = 240;
  spawnPowers(s);
  assert.equal(paddleScale(s.bases[1]!), 1);
});

test("sticky catches and Space releases; auto release avoids indefinite hoarding", () => {
  for (const manual of [true, false]) {
    const s = playing(),
      base = s.bases[0]!,
      ball = s.balls[0]!;
    base.angle = 0;
    grant(s, "sticky");
    Object.assign(ball, {
      x: base.x + base.radius + 13,
      y: base.y,
      vx: -BALL_SPEED,
      vy: 0,
      held: null,
      owner: "b",
    });
    step(s);
    assert.equal(ball.held, "a");
    assert.equal(ball.vx, 0);
    const until = ball.heldUntil;
    if (manual) base.launch = true;
    else s.tick = until - 1;
    step(s);
    assert.equal(ball.held, null);
    assert.ok(ball.vx > 0);
  }
});

test("a sticky paddle holds only one ball and a bomb stuns instead of sticking", () => {
  const s = playing(),
    base = s.bases[0]!,
    ball = s.balls[1]!;
  base.angle = 0;
  grant(s, "sticky");
  Object.assign(ball, {
    x: base.x + base.radius + 13,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
    held: null,
  });
  step(s);
  assert.equal(ball.held, null);
  assert.equal(ball.owner, "a");
  Object.assign(ball, {
    x: base.x + base.radius + 13,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
    bomb: true,
  });
  assert.ok(step(s).some((e) => e.kind === "bomb"));
  assert.equal(ball.bomb, false);
  assert.equal(ball.held, null);
  assert.equal(base.stunUntil, s.tick + 20);
  const saves = base.saves;
  Object.assign(ball, {
    x: base.x + base.radius + 13,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
  });
  step(s);
  assert.equal(base.saves, saves);
  s.tick = base.stunUntil;
  Object.assign(ball, {
    x: base.x + base.radius + 13,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
  });
  step(s);
  assert.ok(base.saves > saves);
});

test("bomb block hit splashes armor, never the core, and thief restores real missing blocks", () => {
  const s = playing(),
    attacker = s.bases[0]!,
    victim = s.bases[1]!,
    ball = s.balls[0]!;
  grant(s, "thief");
  attacker.blocks.slice(0, 4).forEach((b) => (b.alive = false));
  victim.angle = Math.PI;
  Object.assign(ball, {
    x: victim.x + 80,
    y: victim.y,
    vx: -BALL_SPEED,
    vy: 0,
    held: null,
    bomb: true,
  });
  const events = step(s);
  assert.ok(events.some((e) => e.kind === "bomb"));
  assert.ok(victim.blocks.filter((b) => !b.alive).length > 1);
  assert.ok(attacker.blocks.filter((b) => !b.alive).length < 4);
  assert.equal(victim.alive, true);
  assert.equal(ball.bomb, false);
  const broken = attacker.broken;
  breakBlock(s, ball, attacker, 10);
  assert.equal(attacker.broken, broken);
  attacker.thiefUntil = s.tick;
  const armor = attacker.blocks.filter((b) => b.alive).length;
  breakBlock(s, ball, victim, 0);
  assert.equal(attacker.blocks.filter((b) => b.alive).length, armor);
  const before = victim.blocks.filter((b) => b.alive).length;
  ball.x = victim.x;
  ball.y = victim.y;
  explode(s, ball, []);
  assert.equal(victim.alive, true);
  assert.ok(victim.blocks.filter((b) => b.alive).length < before);
});

test("split fans forward at constant speed, keeps ownership/charge and respects depth/count limits", () => {
  const s = playing(),
    ball = s.balls[0]!;
  Object.assign(ball, {
    held: null,
    x: 500,
    y: 500,
    vx: BALL_SPEED,
    vy: 0,
    bomb: true,
  });
  grant(s, "split");
  const child = s.balls.at(-1)!;
  assert.equal(s.balls.length, 3);
  assert.equal(child.owner, "a");
  assert.equal(child.bomb, true);
  assert.ok(ball.vx > 0 && child.vx > 0 && ball.vy > 0 && child.vy < 0);
  assert.ok(Math.abs(Math.hypot(child.vx, child.vy) - BALL_SPEED) < 1e-8);
  grant(s, "split");
  grant(s, "split");
  assert.equal(s.balls.length, 4);
  while (s.balls.length < MAX_BALLS)
    s.balls.push({ ...child, id: s.balls.length });
  grant(s, "split", 2);
  assert.equal(s.balls.length, MAX_BALLS);
});

test("phase3 checkpoints round-trip and reject malformed power state before installation", () => {
  const s = playing();
  Object.assign(s.balls[0]!, {
    x: 500,
    y: 500,
    held: null,
    vx: BALL_SPEED,
    vy: 0,
  });
  for (const kind of ["shrink", "sticky", "thief", "bomb", "split"] as const)
    grant(s, kind);
  s.tick = 80;
  s.formationStep = 80 * SUBSTEPS;
  spawnPowers(s);
  assert.deepEqual(decodeArena(encodeArena(s)), s);
  const corruptions: ((state: typeof s) => void)[] = [
    (x) => (x.bases[0]!.stickyUntil = 99999),
    (x) => (x.bases[0]!.stunUntil = x.tick + 21),
    (x) => (x.bases[0]!.shrink = [99, 98]),
    (x) => (x.bases[0]!.shrink = [99, 99, 99]),
    (x) => (x.bases[0]!.avatarId = "missing"),
    (x) => (x.balls[0]!.splits = 3),
    (x) => (x.balls[0]!.heldUntil = 99999),
    (x) => (x.pickups[0]!.expires = x.tick),
    (x) => (x.pickups[0]!.x = 10000),
    (x) => x.pickups.push({ ...x.pickups[0]! }),
    (x) => (x.balls[1]!.id = 77),
  ];
  for (const change of corruptions) {
    const bad = structuredClone(s);
    change(bad);
    assert.equal(decodeArena(encodeArena(bad)), undefined);
  }
  const hud = present(view(80, "match", s), "a")!;
  assert.match(hud.effects, /STICKY.*THIEF.*BOMB/);
  assert.match(hud.cards[1]!.label, /SHRINK/);
});
