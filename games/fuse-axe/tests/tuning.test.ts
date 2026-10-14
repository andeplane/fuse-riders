import test from "node:test";
import assert from "node:assert/strict";
import {
  BACK_WINDOW,
  CAMERA_SPEED,
  CAPACITY,
  COMBO,
  DASH,
  ENEMY_HP,
  ENEMY_KINDS,
  HERO_KINDS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  SUB,
  VIEW_H,
  TIERS,
  VIEW_W,
  RUN,
  WALK,
  enemyMaxHp,
  px,
} from "../src/engine/tuning.js";

test("the native screen is 16:9 and a log tick folds 50 ms of steps", () => {
  assert.equal(VIEW_W * 9, VIEW_H * 16);
  assert.equal((STEPS_PER_TICK * 1000) / STEPS_PER_SECOND, 50);
  assert.equal(CAPACITY, 5);
});

test("px turns pixels into whole sub-units", () => {
  assert.equal(px(1), SUB);
  assert.equal(px(0.5), SUB / 2);
  assert.ok(Number.isInteger(px(1.3)));
});

test("px mirrors across zero and never returns -0", () => {
  const half = 0.5 / SUB; // Exactly half a sub-unit, where rounding direction shows.
  assert.equal(px(half), 1);
  assert.equal(px(-half), -1);
  assert.equal(px(-1.5), -px(1.5));
  assert.ok(Object.is(px(-0.0001), 0));
  assert.ok(Object.is(px(-0), 0));
});

test("the camera outruns every hero, so a hero held at the screen's edge is never slowed while the camera catches up", () => {
  for (const kind of HERO_KINDS) {
    const top = Math.max(WALK[kind].x, RUN[kind], DASH[kind].speed);
    assert.ok(CAMERA_SPEED > top, kind);
  }
});

test("Attack and Jump in neighbouring log ticks pair as the back attack, a slash it turns never had its blade out, and a running jump outpaces a walk", () => {
  assert.ok(BACK_WINDOW >= STEPS_PER_TICK);
  for (const kind of HERO_KINDS) {
    assert.ok(BACK_WINDOW < COMBO[kind][0].startup, kind);
    assert.ok(RUN[kind] > WALK[kind].x, kind);
  }
});

test("an enemy's hit points are whole numbers that grow with each hero, from the base alone to twice it at five", () => {
  for (const kind of ENEMY_KINDS)
    for (const tier of TIERS) {
      let before = 0;
      for (let heroes = 1; heroes <= CAPACITY; heroes++) {
        const hp = enemyMaxHp(kind, tier, heroes);
        assert.ok(Number.isInteger(hp) && hp > before, `${kind} ${tier}`);
        before = hp;
      }
      // An empty world counts one hero and a crowd no more than a full room.
      assert.equal(enemyMaxHp(kind, tier, 0), enemyMaxHp(kind, tier, 1));
      assert.equal(enemyMaxHp(kind, tier, 9), before);
    }
  assert.equal(enemyMaxHp("ravager", 0, 1), ENEMY_HP.ravager);
  assert.equal(enemyMaxHp("ravager", 0, CAPACITY), 2 * ENEMY_HP.ravager);
});
