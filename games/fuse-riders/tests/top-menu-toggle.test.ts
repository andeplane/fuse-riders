import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { createTopMenuToggle } from "../src/online/top-menu-toggle.js";

function fixture() {
  const { document, window, Event } = parseHTML(
    "<html><body><div class='online-app'><header class='online-header'>" +
      "<nav class='game-top-menu'><button>SETTINGS</button></nav>" +
      "</header><canvas></canvas></div></body></html>",
  );
  const header = document.querySelector("header")!,
    menu = document.querySelector("nav")!,
    toggle = createTopMenuToggle(header, menu, document);
  header.append(toggle.button);
  return {
    document,
    window,
    header,
    menu,
    toggle,
    open: () => header.dataset.menuOpen === "true",
    settings: menu.querySelector("button")!,
    press(key: string) {
      // linkedom has no KeyboardEvent constructor; the handler reads `key` and nothing else.
      const event = new Event("keydown");
      Object.assign(event, { key });
      document.dispatchEvent(event);
    },
    pointerAt: (target: Element) =>
      target.dispatchEvent(new Event("pointerdown", { bubbles: true })),
  };
}

test("the bar's actions open and shut behind one button, and say so", () => {
  const f = fixture();
  assert.equal(f.toggle.button.getAttribute("aria-expanded"), "false");
  // The button names the element it opens, so a screen reader can follow it.
  assert.equal(f.toggle.button.getAttribute("aria-controls"), f.menu.id);
  assert.notEqual(f.menu.id, "");
  assert.equal(f.open(), false);

  f.toggle.button.click();
  assert.equal(f.open(), true);
  assert.equal(f.toggle.button.getAttribute("aria-expanded"), "true");

  f.toggle.button.click();
  assert.equal(f.open(), false);
  assert.equal(f.toggle.button.getAttribute("aria-expanded"), "false");
});

test("choosing an action, Escape, a tap outside or a rotation all put the sheet away", () => {
  for (const [name, shut] of [
    ["an action", (f: ReturnType<typeof fixture>) => f.settings.click()],
    ["Escape", (f: ReturnType<typeof fixture>) => f.press("Escape")],
    [
      "a tap outside",
      (f: ReturnType<typeof fixture>) =>
        f.pointerAt(f.document.querySelector("canvas")!),
    ],
    [
      "a rotation",
      (f: ReturnType<typeof fixture>) =>
        f.window.dispatchEvent(new f.window.Event("resize")),
    ] as const,
  ] as const) {
    const f = fixture();
    f.toggle.button.click();
    assert.equal(f.open(), true, name);
    shut(f);
    assert.equal(f.open(), false, name);
    assert.equal(f.toggle.button.getAttribute("aria-expanded"), "false", name);
  }
});

test("a tap on the bar itself is not a tap outside it, and a shut sheet ignores Escape", () => {
  const f = fixture();
  f.toggle.button.click();
  f.pointerAt(f.toggle.button);
  assert.equal(f.open(), true);
  f.press("Escape");
  assert.equal(f.open(), false);
  // Escape belongs to whatever is on screen once the sheet is gone; this must not claim it again.
  f.press("Escape");
  assert.equal(f.open(), false);
});

test("a disposed toggle leaves no listener on the document behind it", () => {
  const f = fixture();
  f.toggle.button.click();
  f.toggle.dispose();
  f.press("Escape");
  // The listeners are gone, so the state is exactly what the button last set.
  assert.equal(f.open(), true);
  f.toggle.close();
  assert.equal(f.open(), false);
});

test("two bars on one page each control their own sheet", () => {
  const a = fixture(),
    second = createTopMenuToggle(
      a.document.querySelector("header")!.cloneNode(true) as HTMLElement,
      a.document.createElement("nav"),
      a.document,
    );
  assert.notEqual(second.button.getAttribute("aria-controls"), a.menu.id);
});
