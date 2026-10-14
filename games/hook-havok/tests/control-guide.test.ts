import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createGameMenu } from "fuse-ui";
import {
  HOOK_CONTROLS,
  HOOK_TOUCH_CONTROLS,
  showHookRoundControls,
} from "../src/app/control-guide.js";
import { KeyboardInput } from "../src/app/keyboard-input.js";
import { TouchInput } from "../src/app/touch-input.js";
import { createWorld, DEFAULT_TUNING } from "../src/engine/world.js";
import { toView } from "../src/engine/view.js";

test("Hook competitive controls show during each countdown and disappear for play and results", () => {
  for (const rules of ["score", "elimination"] as const) {
    const view = toView(createWorld({ ...DEFAULT_TUNING, rules }));
    for (const phase of [
      "waiting",
      "countdown",
      "active",
      "over",
      "countdown",
    ] as const) {
      view.contest.phase = phase;
      assert.equal(showHookRoundControls(view), phase === "countdown");
    }
  }
});

test("Hook free play repeats its five-second control guide for every fresh round", () => {
  for (let round = 0; round < 2; round++) {
    const world = createWorld();
    assert.equal(showHookRoundControls(toView(world)), true);
    world.tick = 299;
    assert.equal(showHookRoundControls(toView(world)), true);
    world.tick = 300;
    assert.equal(showHookRoundControls(toView(world)), false);
  }
});

test("rendered keyboard guide matches Space jump, J hook and K charge/release inputs", () => {
  const document = parseHTML("<html><body></body></html>")
    .document as unknown as Document;
  const menu = createGameMenu({ document, controls: HOOK_CONTROLS });
  const hints = [...menu.element.querySelectorAll(".fui-controls-row")].map(
    (row) => ({
      keys: row.querySelector("dt")!.textContent,
      action: row.querySelector("dd")!.textContent,
    }),
  );
  const keyboard = new KeyboardInput();
  keyboard.key("Space", true);
  assert.equal(keyboard.sample(800, 500).jump, true);
  assert.equal(
    hints.find((hint) => hint.action?.startsWith("Jump"))?.keys,
    "SPACE",
  );
  keyboard.clear();
  keyboard.key("ArrowUp", true);
  keyboard.key("KeyJ", true);
  const hook = keyboard.sample(800, 500);
  assert.equal(hook.fire, true);
  assert.equal(hook.jump, false);
  assert.equal(hook.aimY, -500, "the arrow alias aims the hook upward");
  assert.equal(
    hints.find((hint) => hint.action?.includes("hook in Keyboard"))?.keys,
    "WASD / ARROWS + J",
  );
  keyboard.clear();
  keyboard.key("KeyK", true);
  assert.equal(keyboard.sample(800, 500).bomb, true);
  assert.equal(keyboard.sample(800, 500).fire, false);
  keyboard.key("KeyK", false);
  assert.equal(keyboard.sample(800, 500).bomb, false);
  const bomb = hints.find((hint) => hint.keys === "WASD / ARROWS + K");
  assert.match(bomb!.action!, /charge.*release to throw/);
  assert.ok(hints.some((hint) => hint.keys === "MOUSE + RIGHT CLICK"));
  menu.dispose();
});

test("rendered touch guide includes the separate charge/release bomb button", () => {
  const document = parseHTML("<html><body></body></html>")
    .document as unknown as Document;
  const menu = createGameMenu({
    document,
    controls: HOOK_CONTROLS,
    touchControls: HOOK_TOUCH_CONTROLS,
  });
  menu.update({ canLobby: true, touch: true });
  const bomb = [...menu.element.querySelectorAll(".fui-controls-row")].find(
    (row) => row.querySelector("dt")!.textContent === "BOMB BUTTON",
  );
  assert.ok(bomb);
  assert.match(
    bomb.querySelector("dd")!.textContent!,
    /Hold to charge, release to throw/,
  );
  const touch = new TouchInput();
  assert.equal(touch.begin("bomb", 3), true);
  touch.update("bomb", 3, 0, 0);
  assert.equal(touch.state.bomb, true);
  assert.equal(touch.state.fire, false);
  touch.end("bomb", 3);
  assert.equal(touch.state.bomb, false);
  menu.dispose();
});
