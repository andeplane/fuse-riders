import test from "node:test";
import assert from "node:assert/strict";
import { HOVER_HZ, MAPS, QUEEN_EGGS } from "../src/engine/index.js";
import {
  CONTROLS,
  DEVICE_CONTROLS,
  DEVICE_KEYS,
  HIVE_HOLES,
  HOLD_TO_FLAP,
  PLAY_CONTROLS,
  HOVER_TAPS,
  RULES,
  TOUCH_CONTROLS,
  UNITS,
  WINS,
  WIN_LINE,
} from "../src/app/guide.js";

test("the figures come from the engine's tuning", () => {
  assert.equal(HOVER_TAPS, HOVER_HZ, "the engine's hover rate");
  assert.equal(HOVER_TAPS, 3, "about three taps a second hover");
  assert.equal(HIVE_HOLES, MAPS[1].holes[0].length);
  for (const id of [1, 2, 3] as const)
    assert.equal(MAPS[id].holes[0].length, HIVE_HOLES, "every hive alike");
  assert.match(WINS[0]!.how, new RegExp(`${QUEEN_EGGS} times`));
  assert.match(WINS[1]!.how, new RegExp(`${HIVE_HOLES} holes`));
  assert.match(WIN_LINE, new RegExp(`Queen ${QUEEN_EGGS}×`));
  const snail = RULES.find((section) => section.title === "SNAIL")!;
  assert.match(
    snail.lines.join(" "),
    /eats it for 5 s \(3\.5 s with a speed rider\)/,
  );
  assert.match(snail.lines.join(" "), /can't hop off while it eats/);
  const gates = RULES.find((section) => section.title === "GATES")!.lines.join(
    " ",
  );
  assert.match(gates, /stands still in a gate for about 2\.5 s/);
  assert.match(
    gates,
    /0\.5 s to offer it \(moving or jumping cancels, and it can still be killed\), then 2 s locked in and safe/,
  );
  assert.match(gates, /enemy-coloured gate does nothing/);
  const berries = RULES.find(
    (section) => section.title === "BERRIES AND HIVE",
  )!.lines.join(" ");
  assert.match(
    berries,
    /from the ground or the air: 1\.5 s inside, safe, then it pops out/,
  );
  assert.match(berries, /pops it straight up/);
  const flying = RULES.find((section) => section.title === "FLYING")!;
  assert.ok(flying.lines.some((line) => line.includes(`${HOVER_TAPS} taps`)));
});

test("the guide covers every unit, and every rule section has lines", () => {
  assert.deepEqual(
    UNITS.map((unit) => unit.art),
    ["worker", "speed-worker", "warrior", "speed-warrior", "queen"],
  );
  for (const unit of UNITS) assert.ok(unit.can && unit.cannot, unit.name);
  assert.deepEqual(
    RULES.map((section) => section.title),
    [
      "COMBAT",
      "BERRIES AND HIVE",
      "GATES",
      "SNAIL",
      "FLYING",
      "THE CLOCK AND THE BOTS",
    ],
  );
  for (const section of RULES) assert.ok(section.lines.length > 0);
});

test("the controls name the bindings of controls.ts and no platform drop", () => {
  const all = [
    ...CONTROLS,
    ...TOUCH_CONTROLS,
    ...DEVICE_CONTROLS.pad,
    ...DEVICE_CONTROLS.keys,
  ];
  assert.ok(!all.some((hint) => /drop through/i.test(hint.action)));
  assert.equal(DEVICE_CONTROLS.keys[1]!.keys, "Space");
  assert.match(DEVICE_CONTROLS.keys[1]!.action, /tap repeatedly to fly/);
  assert.match(
    DEVICE_CONTROLS.keys[3]!.action,
    /Dive \(Queen, in the air\): hold/,
  );
  assert.equal(DEVICE_CONTROLS.pad[1]!.keys, "A / Cross");
  assert.match(HOLD_TO_FLAP.how, /7\.5 times a second/);
  assert.equal(TOUCH_CONTROLS, DEVICE_CONTROLS.touch);
  assert.deepEqual(Object.keys(DEVICE_KEYS), ["keys", "pad", "touch"]);
});

test("combat is the sword's, berries do not regrow, and banking takes time", () => {
  const all = [
    ...RULES.flatMap((section) => section.lines),
    ...UNITS.flatMap((unit) => [unit.can, unit.cannot]),
  ].join("\n");
  assert.doesNotMatch(all, /higher one wins|on contact|no attack button/i);
  assert.match(all, /Kills come from the sword/);
  assert.match(all, /dash the way you face/);
  assert.match(all, /in front of the blade/);
  assert.match(all, /hit from behind always kills/);
  assert.match(all, /dive kills whatever her blade touches below her/);
  assert.match(all, /meet head-on glance off/);
  assert.match(all, /Landing on a head only bounces/);
  assert.match(all, /Workers have no weapon/);
  assert.match(all, /about 2\.5 s/);
  assert.match(all, /eats it for 5 s/);
  assert.match(all, /never regrow/);
  assert.match(all, /1\.5 s inside/);
});

test("attack is X, B / Circle or X / Square, a bumper or a trigger, and the touch ATTACK button", () => {
  assert.deepEqual(
    [DEVICE_KEYS.keys.attack, DEVICE_KEYS.pad.attack, DEVICE_KEYS.touch.attack],
    ["X", "B / Circle", "ATTACK"],
  );
  assert.equal(DEVICE_CONTROLS.keys[2]!.keys, "X or Z (also Shift or J)");
  assert.match(DEVICE_CONTROLS.pad[2]!.keys, /any bumper or trigger/);
  assert.match(DEVICE_CONTROLS.pad[2]!.keys, /X \/ Square/);
  for (const device of ["keys", "pad", "touch"] as const)
    assert.ok(
      DEVICE_CONTROLS[device].some((hint) =>
        /Attack \(Warrior, Queen\): sword dash the way you face/.test(
          hint.action,
        ),
      ),
      device,
    );
  assert.match(
    CONTROLS.at(-1)!.action,
    /B \/ Circle, X \/ Square, either bumper or either trigger to attack/,
  );
  assert.deepEqual(
    PLAY_CONTROLS.map((hint) => hint.keys),
    [
      "← / → or A / D · stick / D-pad",
      "Space · A / Cross",
      "↓ or S · stick / D-pad ↓",
      "X or Z (also Shift or J) · B / Circle, X / Square, bumper or trigger",
    ],
  );
  assert.match(PLAY_CONTROLS[1]!.action, /tap repeatedly to fly/);
});

test("the keyboard leads with the arrows, Space and X", () => {
  assert.deepEqual(DEVICE_KEYS.keys, {
    move: "← → / A D",
    button: "Space",
    attack: "X",
    down: "↓ / S",
  });
  assert.deepEqual(
    DEVICE_CONTROLS.keys.map((hint) => hint.keys),
    ["← / → or A / D", "Space", "X or Z (also Shift or J)", "↓ or S"],
  );
});
