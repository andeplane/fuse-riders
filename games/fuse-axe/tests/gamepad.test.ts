import test from "node:test";
import assert from "node:assert/strict";
import { HeldControls } from "../src/app/controls.js";
import {
  GamepadInput,
  STICK_DEAD_ZONE,
  browserGamepads,
  gamepadBits,
  type GamepadLike,
  type GamepadSource,
} from "../src/app/gamepad.js";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  UP,
} from "../src/engine/input.js";

/** A pad at `index` with the standard mapping: `down` lists the buttons held, `axes` the left stick. */
function gamepad(
  index: number,
  down: readonly number[] = [],
  axes: readonly number[] = [0, 0, 0, 0],
  extra: Partial<GamepadLike> = {},
): GamepadLike {
  return {
    index,
    connected: true,
    mapping: "standard",
    axes,
    buttons: Array.from({ length: 17 }, (_, button) => ({
      pressed: down.includes(button),
      value: down.includes(button) ? 1 : 0,
    })),
    ...extra,
  };
}

/** The pads the browser reports, set by the test before each poll. */
class FakeGamepads implements GamepadSource {
  list: (GamepadLike | null)[] = [];
  pads() {
    return this.list;
  }
}

test("a standard pad: A attacks, B jumps, X and Y cast magic, the d-pad and left stick walk", () => {
  assert.equal(gamepadBits(gamepad(0)), 0);
  assert.equal(gamepadBits(gamepad(0, [0])), ATTACK, "A / Cross");
  assert.equal(gamepadBits(gamepad(0, [1])), JUMP, "B / Circle");
  assert.equal(gamepadBits(gamepad(0, [2])), MAGIC, "X / Square");
  assert.equal(gamepadBits(gamepad(0, [3])), MAGIC, "Y / Triangle");
  assert.equal(gamepadBits(gamepad(0, [12])), UP);
  assert.equal(gamepadBits(gamepad(0, [13])), DOWN);
  assert.equal(gamepadBits(gamepad(0, [14, 12])), LEFT | UP);
  assert.equal(gamepadBits(gamepad(0, [15, 0, 1])), RIGHT | ATTACK | JUMP);
  // Shoulders, triggers, Start and Back do nothing in a fight.
  assert.equal(gamepadBits(gamepad(0, [4, 5, 6, 7, 8, 9, 16])), 0);
  // A button read by its value (an analog face button) counts past half way.
  const soft = gamepad(0);
  const buttons = soft.buttons.map((button, index) =>
    index === 0 ? { pressed: false, value: 0.7 } : button,
  );
  assert.equal(gamepadBits({ ...soft, buttons }), ATTACK);
  const light = buttons.map((button, index) =>
    index === 0 ? { pressed: false, value: 0.3 } : button,
  );
  assert.equal(gamepadBits({ ...soft, buttons: light }), 0);
});

test("the left stick walks 8 ways past its dead zone; a resting or broken stick does not", () => {
  const stick = (x: number, y: number) => gamepadBits(gamepad(0, [], [x, y]));
  assert.equal(stick(1, 0), RIGHT);
  assert.equal(stick(-1, 0), LEFT);
  assert.equal(stick(0, -1), UP, "up on the stick is up the road");
  assert.equal(stick(0, 1), DOWN);
  assert.equal(stick(0.7, 0.7), DOWN | RIGHT);
  assert.equal(stick(-0.7, -0.7), UP | LEFT);
  assert.equal(stick(STICK_DEAD_ZONE - 0.05, 0), 0, "inside the dead zone");
  assert.equal(stick(0.2, 0.2), 0, "a worn stick resting off centre");
  assert.equal(stick(STICK_DEAD_ZONE + 0.05, 0), RIGHT);
  assert.equal(stick(Number.NaN, 1), 0);
  assert.equal(gamepadBits({ ...gamepad(0), axes: [] }), 0, "no axes");
  assert.equal(
    gamepadBits(gamepad(0, [12], [0.9, 0])),
    RIGHT | UP,
    "the stick and the d-pad together",
  );
});

test("an unmapped pad: its stick and first four buttons count, but not buttons in the standard d-pad's places", () => {
  const odd = (down: number[], axes = [0, 0]) =>
    gamepadBits(gamepad(0, down, axes, { mapping: "" }));
  assert.equal(odd([0]), ATTACK);
  assert.equal(odd([1, 3]), JUMP | MAGIC);
  assert.equal(odd([12, 15]), 0);
  assert.equal(odd([], [-1, 0]), LEFT);
});

test("one gamepad drives this device's hero: the one in use, until it lets go; a pad that goes away lets go", () => {
  const source = new FakeGamepads(),
    sent: number[] = [];
  const controls = new HeldControls((bits) => sent.push(bits));
  const input = new GamepadInput(source, (bits) =>
    controls.hold("gamepad", bits),
  );
  input.poll();
  assert.deepEqual(sent, [], "no pads");
  // Pad 0 rests (a phantom pad, say) while pad 1 presses: pad 1 drives.
  source.list = [gamepad(0), null, gamepad(1, [15])];
  input.poll();
  input.poll();
  assert.deepEqual(sent, [RIGHT], "a held button is heard once");
  // Pad 0 presses while pad 1 still holds: pad 1 keeps driving.
  source.list = [gamepad(0, [0]), gamepad(1, [15, 1])];
  input.poll();
  assert.deepEqual(sent, [RIGHT, RIGHT | JUMP]);
  // Pad 1 lets go; pad 0 is still pressing, so it takes over.
  source.list = [gamepad(0, [0]), gamepad(1)];
  input.poll();
  assert.deepEqual(sent, [RIGHT, RIGHT | JUMP, ATTACK]);
  // Pad 0 is unplugged mid-press: everything it held is let go.
  source.list = [null, gamepad(1)];
  input.poll();
  assert.deepEqual(sent, [RIGHT, RIGHT | JUMP, ATTACK, 0]);
  // A disconnected pad counts as gone.
  source.list = [gamepad(0, [0], undefined, { connected: false })];
  input.poll();
  assert.deepEqual(sent.at(-1), 0);
  assert.equal(controls.bits, 0);
});

test("a gamepad's fresh Attack is a press like a key's, and it holds alongside the keys", () => {
  const source = new FakeGamepads(),
    sent: number[] = [];
  const controls = new HeldControls((bits) => sent.push(bits));
  const input = new GamepadInput(source, (bits) =>
    controls.hold("gamepad", bits),
  );
  controls.press("KeyW");
  source.list = [gamepad(0, [0])];
  input.poll();
  source.list = [gamepad(0)];
  input.poll();
  controls.release("KeyW");
  assert.deepEqual(sent, [UP, UP | ATTACK, UP, 0]);
});

test("the browser's gamepads: none without the API or when a permissions policy forbids it", () => {
  assert.deepEqual(browserGamepads({}).pads(), []);
  assert.deepEqual(
    browserGamepads({
      getGamepads: () => {
        throw new Error("SecurityError");
      },
    }).pads(),
    [],
  );
  const pads = [null, gamepad(1)];
  assert.equal(browserGamepads({ getGamepads: () => pads }).pads(), pads);
});
