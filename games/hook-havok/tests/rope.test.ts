import test from "node:test";
import assert from "node:assert/strict";
import {
  BODY,
  CLASSIC_TUNING,
  DEFAULT_TUNING,
  HOOK_SPEED,
  NEUTRAL,
  ROPE_MIN,
  S,
  createWorld,
  type Input,
  type World,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { overlaps } from "../src/engine/collision.js";
import { MAPS } from "../src/engine/maps.js";
import { decodeWorld, parseTuning } from "../src/engine/codec.js";
import { KeyboardInput } from "../src/app/keyboard-input.js";
import { assistAim } from "../src/app/aim-assist.js";

const CAP = Math.round((1000 * S) / 60);
const chest = (w: World) => w.feet - Math.round(BODY * 0.6);
const hold = (w: World, input: Partial<Input>, ticks: number) => {
  w.input = { ...NEUTRAL, ...input };
  for (let i = 0; i < ticks; i++) step(w);
};
/** A keeper in mid-air below belfry ledge 6 ([1170, 270, 250, 28]). */
function underLedge(tuning = CLASSIC_TUNING): World {
  const w = createWorld(tuning);
  Object.assign(w, { x: 1250 * S, feet: 460 * S, grounded: false, coyote: 0 });
  return w;
}
const UP = { fire: true, aimX: 1250, aimY: 250 };

test("held hooks catch falling keepers, never stretch, and hold until landing on the hooked ledge", () => {
  let seed = 7;
  const random = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const tuning = { ...CLASSIC_TUNING, map: "crossroads" as const };
  const platforms = MAPS.crossroads.platforms;
  let attached = 0,
    released = 0,
    worstSag = 0;
  for (let trial = 0; trial < 1500; trial++) {
    const w = createWorld(tuning);
    Object.assign(w, {
      x: Math.round((40 + random() * 1520) * S),
      feet: Math.round((150 + random() * 600) * S),
      vx: Math.round((random() * 2 - 1) * 6 * S),
      vy: Math.round((random() * 1.2 - 0.2) * 16 * S),
      grounded: false,
      coyote: 0,
    });
    if (overlaps(w.x, w.feet, platforms)) continue;
    const p = platforms[Math.floor(random() * platforms.length)]!;
    const aim = {
      aimX: Math.round(p[0] + random() * p[2]),
      aimY: p[1] + p[3] - 2,
    };
    if (aim.aimY > chest(w) / S - 40) continue;
    let caught: number | undefined,
      rope = Infinity;
    for (let t = 0; t < 120 && !w.respawn; t++) {
      const was = w.hook.phase;
      hold(w, { fire: true, ...aim }, 1);
      if (w.hook.phase === "attached") {
        caught ??= w.feet;
        worstSag = Math.max(worstSag, w.feet - caught);
        const capped = Math.max(Math.abs(w.vx), Math.abs(w.vy)) >= CAP - 1;
        assert.ok(
          w.hook.distance <= rope || capped,
          `rope lengthened below the speed cap at trial ${trial}`,
        );
        rope = w.hook.distance;
        assert.deepEqual(
          decodeWorld(w),
          w,
          `attached checkpoint at trial ${trial}`,
        );
      }
      if (was === "attached" && w.hook.phase === "retracting") {
        released++;
        // The only held release is landing on the hooked ledge.
        const [px, py, pw] = platforms[w.hook.platform]!;
        assert.ok(
          w.grounded &&
            Math.abs(w.feet - py * S) <= 1 &&
            w.x > px * S - 16 * S &&
            w.x < (px + pw) * S + 16 * S,
          `unexpected release at trial ${trial}`,
        );
        break;
      }
    }
    if (caught !== undefined) attached++;
  }
  assert.ok(attached > 100, `enough samples (${attached})`);
  assert.ok(
    released / attached < 0.05,
    `held release rate ${released}/${attached}`,
  );
  // The old constant pull let keepers sink up to 262 units after a catch.
  assert.ok(worstSag < 90 * S, `worst sag ${worstSag / S} units`);
});

test("holding reels in to the minimum rope and settles into a hang", () => {
  const w = underLedge();
  hold(w, UP, 60);
  assert.equal(w.hook.phase, "attached");
  assert.equal(w.hook.platform, 6);
  assert.equal(w.hook.distance, ROPE_MIN * S);
  assert.ok(Math.hypot(w.vx, w.vy) < S / 4, "hanging, not whirling");
  assert.ok(w.feet - BODY > 298 * S, "hangs below the ledge");
  assert.deepEqual(decodeWorld(w), w, "attached rope checkpoint");
});

test("jumping while hooked leaps off, restores the air jump and never refires a held hook", () => {
  const w = underLedge({ ...CLASSIC_TUNING, jumpMode: "double" });
  hold(w, UP, 40);
  w.airJump = false;
  hold(w, { ...UP, jump: true }, 1);
  assert.equal(w.hook.phase, "retracting");
  assert.ok(w.vy <= -Math.round((CLASSIC_TUNING.jump * S) / 60) + S);
  assert.equal(w.airJump, true);
  hold(w, { ...UP, jump: true }, 40);
  assert.equal(w.hook.phase, "ready", "held fire does not shoot again");
  hold(w, {}, 30);
  assert.equal(w.grounded, true);
  assert.ok(Math.abs(w.feet / S - 270) < 0.01, "leapt up through the ledge");
});

test("the rope lets go on landing atop the hooked ledge, not while swinging beneath it", () => {
  const sideways = underLedge();
  hold(sideways, UP, 40);
  hold(sideways, { ...UP, move: -1 }, 30);
  assert.equal(sideways.hook.phase, "attached", "swinging keeps the rope");

  const landing = createWorld(CLASSIC_TUNING);
  Object.assign(landing, {
    x: 1250 * S,
    feet: 262 * S,
    grounded: false,
    coyote: 0,
  });
  landing.hook = {
    phase: "attached",
    x: 1250 * S,
    y: 298 * S + 1,
    vx: 0,
    vy: 0,
    life: 0,
    distance: 80 * S,
    platform: 6,
  };
  landing.input = landing.previous = { ...NEUTRAL, fire: true };
  for (let t = 0; t < 10 && !landing.grounded; t++) step(landing);
  assert.equal(landing.grounded, true);
  assert.equal(landing.hook.phase, "retracting", "arrival lets go");
});

test("steering swings a hooked keeper, and air steering never brakes faster momentum", () => {
  const still = underLedge(),
    pumped = underLedge();
  hold(still, UP, 20);
  hold(pumped, UP, 20);
  hold(still, UP, 30);
  hold(pumped, { ...UP, move: 1 }, 30);
  assert.equal(pumped.hook.phase, "attached");
  assert.ok(pumped.x > still.x, "pumping moves the swing the steered way");

  const coast = createWorld(CLASSIC_TUNING);
  Object.assign(coast, {
    feet: 600 * S,
    grounded: false,
    coyote: 0,
    vx: 14 * S,
  });
  hold(coast, { move: 1 }, 5);
  assert.equal(coast.vx, 14 * S, "held direction keeps swing momentum");
  hold(coast, { move: -1 }, 5);
  assert.ok(coast.vx < 14 * S, "opposite steering still brakes");
});

test("checkpoints bound faster hooks and reel tuning", () => {
  const w = underLedge();
  hold(w, UP, 2);
  assert.equal(w.hook.phase, "flying");
  assert.equal(Math.abs(w.hook.vy), HOOK_SPEED * S);
  assert.deepEqual(decodeWorld(w), w);
  assert.equal(
    decodeWorld({ ...w, hook: { ...w.hook, vy: -(HOOK_SPEED + 1) * S } }),
    undefined,
  );
  hold(w, UP, 30);
  assert.equal(w.hook.phase, "attached");
  for (const distance of [ROPE_MIN * S - 1, CLASSIC_TUNING.range * S + 1])
    assert.equal(
      decodeWorld({ ...w, hook: { ...w.hook, distance } }),
      undefined,
    );
  assert.equal(parseTuning({ ...DEFAULT_TUNING, pull: 2800 }), undefined);
  assert.equal(parseTuning({ ...DEFAULT_TUNING, pull: 200 }), undefined);
});

test("standard defaults: Crossroads, double jump, bouncing balls and keyboard-plus-mouse controls", () => {
  assert.deepEqual(parseTuning(DEFAULT_TUNING), DEFAULT_TUNING);
  const w = createWorld(DEFAULT_TUNING);
  assert.equal(w.tuning.map, "crossroads");
  assert.equal(w.airJump, true);
  assert.equal(w.combat.balls.length, 1);
  const k = new KeyboardInput();
  assert.equal(k.mode, "keyboard");
  k.key("ArrowDown", true);
  assert.equal(k.sample(0, 0).drop, false, "down alone aims");
  assert.deepEqual(k.direction, { x: 0, y: 1 });
  k.key("Space", true);
  const both = k.sample(0, 0);
  assert.equal(both.drop, true, "down + jump drops");
  assert.equal(both.jump, true);
  k.aimSource = "mouse";
  assert.equal(k.sample(0, 0).aimX, undefined, "a click owns the aim");
  k.key("KeyK", true);
  assert.equal(k.aimSource, "keys", "K takes the aim back");
});

test("down + jump on a ledge drops through it instead of jumping", () => {
  const w = createWorld(CLASSIC_TUNING);
  hold(w, { drop: true, jump: true }, 1);
  assert.equal(w.grounded, false);
  assert.ok(w.vy > 0, "falling, not jumping");
  hold(w, { drop: true, jump: true }, 40);
  assert.ok(w.feet > 810 * S || w.respawn, "left the starting terrace");
});

test("keyboard aim assist bends only upward near misses onto a ledge, within 15 degrees", () => {
  const platforms = MAPS.belfry.platforms;
  // From beside ledge 6's right end, straight up misses; a few degrees left hits.
  const bent = assistAim(platforms, 1440, 420, 0, -1, 650);
  assert.ok(bent.x < 0 && bent.y < 0, "bent toward the ledge");
  assert.ok(
    Math.abs(Math.atan2(bent.x, -bent.y)) <= (15 * Math.PI) / 180 + 1e-9,
  );
  assert.deepEqual(assistAim(platforms, 1250, 420, 0, -1, 650), {
    x: 0,
    y: -1,
  });
  assert.deepEqual(assistAim(platforms, 1560, 850, 1, 0, 650), { x: 1, y: 0 });
  // A level shot at a rival beside a floor is not bent into the floor.
  assert.deepEqual(assistAim(platforms, 310, 779, 1, 0, 650), { x: 1, y: 0 });
  assert.deepEqual(assistAim(platforms, 310, 779, 1, 1, 650), { x: 1, y: 1 });
});
