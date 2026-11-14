import assert from "node:assert/strict";
import { test } from "node:test";
import { menuKeys } from "fuse-ui";
import { event, page } from "./dom-fixture.js";

function fixture() {
  const { document, window } = page();
  const menu = document.createElement("nav");
  const buttons = ["Resume", "Restart", "Song select"].map((text) => {
    const button = document.createElement("button");
    button.textContent = text;
    menu.append(button);
    return button;
  });
  document.body.append(menu);
  // linkedom keeps no focus: these buttons record it, and the fixture reports the last one.
  let focused: Element | null = document.body;
  for (const node of [...buttons, document.body])
    Object.defineProperty(node, "focus", { value: () => (focused = node) });
  Object.defineProperty(document, "activeElement", { get: () => focused });
  const press = (key: string, target: EventTarget = document) => {
    const pressed = event(window, "keydown", { key });
    target.dispatchEvent(pressed);
    return pressed;
  };
  return {
    document,
    window,
    menu,
    buttons,
    press,
    focus: () =>
      focused && focused !== document.body ? (focused.textContent ?? "") : "",
    blur: () => (focused = document.body),
  };
}

test("arrows walk a menu's buttons from wherever the focus is, wrap at the ends, and Home and End jump", () => {
  const f = fixture();
  const release = menuKeys(f.menu);
  const first = f.press("ArrowDown");
  assert.equal(
    f.focus(),
    "Resume",
    "the first arrow lands on the first button",
  );
  assert.equal(first.defaultPrevented, true);
  f.press("ArrowDown");
  assert.equal(f.focus(), "Restart");
  f.press("ArrowRight");
  assert.equal(f.focus(), "Song select");
  f.press("ArrowDown");
  assert.equal(f.focus(), "Resume", "wraps");
  f.press("ArrowUp");
  assert.equal(f.focus(), "Song select");
  f.press("ArrowLeft");
  assert.equal(f.focus(), "Restart");
  f.press("Home");
  assert.equal(f.focus(), "Resume");
  f.press("End");
  assert.equal(f.focus(), "Song select");
  f.blur();
  f.press("ArrowUp");
  assert.equal(
    f.focus(),
    "Song select",
    "going up from nowhere starts at the end",
  );

  const enter = f.press("Enter");
  assert.equal(enter.defaultPrevented, false, "Enter is the browser's own");
  release();
  f.blur();
  f.press("ArrowDown");
  assert.equal(f.focus(), "", "released");
});

test("arrows skip what cannot be pressed and stay out of the way of everything else", () => {
  const f = fixture();
  let enabled = true;
  menuKeys(f.menu, { enabled: () => enabled });
  f.buttons[1]!.disabled = true;
  f.press("ArrowDown");
  f.press("ArrowDown");
  assert.equal(f.focus(), "Song select", "a disabled button is not a stop");
  f.buttons[1]!.disabled = false;
  f.buttons[0]!.hidden = true;
  f.press("Home");
  assert.equal(f.focus(), "Restart", "nor a hidden one");
  f.buttons[0]!.hidden = false;

  f.blur();
  const used = event(f.window, "keydown", { key: "ArrowDown" });
  used.preventDefault();
  f.document.dispatchEvent(used);
  assert.equal(f.focus(), "", "a key something else used");

  const field = f.document.createElement("input");
  f.document.body.append(field);
  f.press("ArrowDown", field);
  assert.equal(f.focus(), "", "a field keeps its arrows");

  enabled = false;
  f.press("ArrowDown");
  assert.equal(f.focus(), "", "the page can say the arrows are busy");
  enabled = true;

  const dialog = f.document.createElement("dialog");
  dialog.setAttribute("open", "");
  f.document.body.append(dialog);
  f.press("ArrowDown");
  assert.equal(f.focus(), "", "a dialog the menu is not in has the keys");
  dialog.append(f.menu);
  f.press("ArrowDown");
  assert.equal(f.focus(), "Resume", "a menu inside the open dialog takes them");
  dialog.remove();
  f.document.body.append(f.menu);

  f.menu.hidden = true;
  f.blur();
  f.press("ArrowDown");
  assert.equal(f.focus(), "", "a hidden menu takes nothing");
});

test("a scope hears the keys itself, for a bar that keeps them from the page", () => {
  const f = fixture();
  const scope = f.document.createElement("div");
  scope.append(f.menu);
  f.document.body.append(scope);
  scope.addEventListener("keydown", (pressed) => pressed.stopPropagation());
  menuKeys(f.menu, { scope });
  f.press("ArrowDown", f.menu);
  assert.equal(f.focus(), "Resume");
});
