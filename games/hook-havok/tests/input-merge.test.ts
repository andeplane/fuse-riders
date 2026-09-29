import test from "node:test";
import assert from "node:assert/strict";
import { ButtonMerge, mouseAims, touchInput } from "../src/app/input-merge.js";
import { KeyboardInput, RELEASE_GRACE_MS } from "../src/app/keyboard-input.js";
import { TouchInput } from "../src/app/touch-input.js";
import { parseInput } from "../src/engine/codec.js";
import { NEUTRAL } from "../src/engine/world.js";

test("mouse chords: left hooks, right bombs, both together, and releasing one keeps the other", () => {
  const m = new ButtonMerge();
  assert.deepEqual(m.pointer(ButtonMerge.pressed(0, 1)), {
    fire: true,
    bomb: false,
  });
  // The right button pressed while the left is held arrives as a move.
  assert.deepEqual(m.pointer(3), { fire: true, bomb: true });
  assert.equal(m.pointer(3), undefined, "an unchanged mask is no change");
  assert.deepEqual(m.pointer(2), { fire: false, bomb: true }, "left let go");
  assert.deepEqual(m.pointer(0), { fire: false, bomb: false });
  // A right click alone never fires the hook, even with other bits set.
  assert.deepEqual(m.pointer(ButtonMerge.pressed(2, 0)), {
    fire: false,
    bomb: true,
  });
  assert.deepEqual(m.pointer(2 | 4 | 8), undefined, "back/forward ignored");
  assert.equal(m.held.fire, false);
  m.pointer(0);
  assert.equal(ButtonMerge.pressed(2, 2), 2);
  assert.equal(ButtonMerge.pressed(0, 0), 1, "an empty mask falls back");
});
test("keys and mouse hold the same buttons: either keeps them held, and blur clears both", () => {
  const m = new ButtonMerge();
  assert.deepEqual(m.keys(true, false), { fire: true, bomb: false });
  assert.deepEqual(m.pointer(2), { fire: true, bomb: true });
  // Releasing K does not release the right button, and the reverse.
  assert.deepEqual(m.keys(true, false), { fire: true, bomb: true });
  assert.deepEqual(m.pointer(0), { fire: true, bomb: false });
  m.keys(false, true);
  m.pointer(1);
  m.clear();
  assert.deepEqual(m.held, { fire: false, bomb: false }, "blur");
  assert.equal(m.buttons, 0);
  assert.equal(m.pointer(0), undefined, "nothing left to release");
});
test("the mouse aims in the classic scheme and after a click takes the aim from the keys", () => {
  const k = new KeyboardInput();
  assert.equal(mouseAims(k), false, "standard scheme: the keys aim");
  k.aimSource = "mouse";
  assert.equal(mouseAims(k), true);
  k.key("KeyK", true, 0);
  assert.equal(mouseAims(k), false, "K takes the aim back");
  k.mode = "mouse";
  assert.equal(mouseAims(k), true);
});
test("touch: the hook aims on its press, the bomb on its release, from the chest", () => {
  const t = new TouchInput(),
    chest = { x: 300, y: 700, facing: 1 as const };
  t.begin("aim", 1);
  t.update("aim", 1, 0.8, 0);
  let input = touchInput({ ...NEUTRAL }, t.state, chest);
  assert.equal(input.fire, true);
  assert.deepEqual([input.aimX, input.aimY], [1300, 700], "hooked rightward");
  t.end("aim", 1);
  input = touchInput(input, t.state, chest);
  t.begin("bomb", 2);
  t.update("bomb", 2, 0, 0);
  input = touchInput(input, t.state, { ...chest, x: 500 });
  assert.equal(input.bomb, true);
  assert.equal(input.aimX, 1300, "no new aim while charging");
  t.end("bomb", 2);
  input = touchInput(input, t.state, { ...chest, x: 500 });
  assert.equal(input.bomb, false);
  assert.deepEqual(
    [input.aimX, input.aimY],
    [1500, 700],
    "thrown along the aim pad from where the keeper is now",
  );
  assert.ok(parseInput(input));
  // Before any aim the throw lobs forward and up from the facing.
  const fresh = new TouchInput();
  fresh.begin("bomb", 3);
  fresh.update("bomb", 3, 0, 0);
  const held = touchInput({ ...NEUTRAL }, fresh.state, chest);
  fresh.clear();
  const lob = touchInput(held, fresh.state, { ...chest, facing: -1 });
  assert.equal(lob.bomb, false, "a cleared button releases");
  assert.ok(lob.aimX < 300 && lob.aimY < 700);
});
test("a diagonal charge keeps its aim while its keys are lifted one at a time", () => {
  const k = new KeyboardInput();
  k.key("KeyW", true, 0);
  k.key("KeyD", true, 10);
  k.key("KeyK", true, 20);
  assert.deepEqual(k.aimDirection(500), { x: 1, y: -1 });
  // D lifts first; the arc preview and the throw still read the diagonal.
  k.key("KeyD", false, 1000);
  assert.deepEqual(k.aimDirection(1010), { x: 1, y: -1 });
  const charging = k.sample(0, 0, undefined, 1010);
  assert.deepEqual([charging.aimX, charging.aimY], [1000, -1000]);
  k.key("KeyW", false, 1030);
  k.key("KeyK", false, 1040);
  const thrown = k.sample(0, 0);
  assert.equal(thrown.bomb, false);
  assert.deepEqual(
    [thrown.aimX, thrown.aimY],
    [1000, -1000],
    "W + D, K down, D up, K up: a diagonal throw",
  );
  // A deliberate change of aim is kept: lifted longer ago than the grace.
  const late = new KeyboardInput();
  late.key("KeyW", true, 0);
  late.key("KeyD", true, 0);
  late.key("KeyK", true, 0);
  late.key("KeyD", false, 1000);
  late.key("KeyK", false, 1000 + RELEASE_GRACE_MS + 1);
  assert.deepEqual(late.sample(0, 0), {
    ...late.sample(0, 0),
    aimX: 0,
    aimY: -1000,
  });
  // So is a new direction pressed during the grace.
  const turn = new KeyboardInput();
  turn.key("KeyW", true, 0);
  turn.key("KeyD", true, 0);
  turn.key("KeyK", true, 0);
  turn.key("KeyD", false, 1000);
  turn.key("KeyA", true, 1010);
  turn.key("KeyK", false, 1020);
  assert.deepEqual(turn.aimDirection(), { x: -1, y: -1 });
  // The hook is not steered by the grace: it reads its aim on the press.
  const hook = new KeyboardInput();
  hook.key("KeyW", true, 0);
  hook.key("KeyD", true, 0);
  hook.key("KeyD", false, 1000);
  hook.key("KeyJ", true, 1010);
  assert.deepEqual(hook.aimDirection(), { x: 0, y: -1 });
  hook.clear();
  assert.deepEqual(hook.aimDirection(), { x: 0, y: -1 });
});
