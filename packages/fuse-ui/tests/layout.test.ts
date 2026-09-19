import assert from "node:assert/strict";
import { test } from "node:test";
import { createLobbyShell, createPhoneLayout, createRoster } from "fuse-ui";
import { HOSTILE, event, page } from "./dom-fixture.js";

test("lobby shell: intro, invitation, roster and footer in order, with part classes", () => {
  const { document } = page();
  const heading = document.createElement("h1"),
    invite = document.createElement("div"),
    roster = document.createElement("div"),
    count = document.createElement("span");
  const shell = createLobbyShell({
    intro: [heading],
    invite,
    roster,
    footer: [count],
    label: HOSTILE,
    classes: { root: "room-lobby", footer: "room-lobby-footer" },
    document,
  });
  assert.equal(shell.element.tagName, "SECTION");
  assert.equal(shell.element.className, "room-lobby");
  assert.equal(shell.element.getAttribute("aria-label"), HOSTILE);
  assert.deepEqual(
    [...shell.element.children],
    [shell.intro, invite, roster, shell.footer],
  );
  assert.equal(shell.intro!.className, "fui-lobby-intro");
  assert.deepEqual([...shell.intro!.children], [heading]);
  assert.equal(shell.footer!.tagName, "FOOTER");
  assert.equal(shell.footer!.className, "room-lobby-footer");
  assert.deepEqual([...shell.footer!.children], [count]);

  const bare = createLobbyShell({ document });
  assert.equal(bare.intro, undefined);
  assert.equal(bare.footer, undefined);
  assert.equal(bare.element.children.length, 0);
  assert.equal(bare.element.hasAttribute("aria-label"), false);
});

test("roster title: a heading before the rows and the empty line, kept by updates", () => {
  const { document } = page();
  const roster = createRoster({
    title: "WATCHING",
    emptyText: "Nobody",
    avatar: () => document.createElement("i"),
    classes: { title: "room-watchers-title", info: "" },
    document,
  });
  const [title, empty] = roster.element.children;
  assert.equal(title!.tagName, "P");
  assert.equal(title!.className, "room-watchers-title");
  assert.equal(title!.textContent, "WATCHING");
  assert.equal(empty, roster.empty);
  roster.update([
    { id: "a", name: HOSTILE, status: "WATCHING", avatar: "eye" },
  ]);
  roster.update([]);
  assert.equal(roster.element.firstElementChild, title);
  assert.equal(roster.element.children.length, 2);
  const untitled = createRoster({ document });
  assert.equal(untitled.element.children.length, 0);
});

test("phone layout: MENU opens the tools, a round closes them and replays the hints, results open them", () => {
  const { document, window } = page();
  const root = document.createElement("main"),
    dialog = document.createElement("dialog");
  root.append(dialog);
  let cleared = 0;
  const layout = createPhoneLayout({
    root,
    clearControls: () => cleared++,
    hints: ["LEFT", HOSTILE],
    dialogs: [dialog],
    classes: { open: "tools-open" },
  });
  assert.equal(layout.toggle.className, "fui-tools-toggle");
  assert.equal(layout.toggle.textContent, "☰ MENU");
  assert.equal(layout.toggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(
    [...layout.hints.children].map((hint) => hint.getAttribute("data-hint")),
    ["LEFT", HOSTILE],
  );
  assert.equal(layout.hints.textContent, "", "hints carry no text nodes");
  assert.deepEqual([...root.children], [dialog, layout.hints, layout.toggle]);

  const phone = { active: true, portrait: true };
  layout.update(phone, { phase: "lobby", live: false, results: false });
  layout.toggle.click();
  assert.equal(layout.blocked(), true);
  assert.ok(root.classList.contains("tools-open"));
  assert.equal(layout.toggle.getAttribute("aria-expanded"), "true");
  const before = cleared;
  dialog.dispatchEvent(event(window, "close"));
  assert.equal(layout.blocked(), true, "an own-screen lobby keeps its tools");

  layout.update(phone, { phase: "playing", live: true, results: false });
  assert.equal(layout.blocked(), false, "a round closes the tools");
  assert.equal(root.lastElementChild, layout.hints, "hints re-appended");
  layout.toggle.click();
  dialog.dispatchEvent(event(window, "close"));
  assert.equal(layout.blocked(), false, "live play returns to the pads");

  layout.update(
    { active: true, portrait: false },
    { phase: "playing", live: true, results: false },
    true,
  );
  assert.ok(cleared > before, "a rotation cancels held input");

  layout.update(phone, { phase: "over", live: false, results: true });
  assert.equal(
    layout.blocked(),
    true,
    "results open an own-screen phone's tools",
  );
  layout.update(
    phone,
    { phase: "over", live: false, results: true },
    false,
    true,
  );
  assert.equal(
    layout.blocked(),
    true,
    "the same screen again is no transition",
  );
  layout.update(
    phone,
    { phase: "playing", live: true, results: false },
    false,
    true,
  );
  layout.update(
    phone,
    { phase: "over", live: false, results: true },
    false,
    true,
  );
  assert.equal(layout.blocked(), false, "a controller gets its rematch screen");
  layout.toggle.click();
  dialog.dispatchEvent(event(window, "close"));
  assert.equal(layout.blocked(), false, "a controller returns to its pads");

  const text = document.createTextNode("x");
  root.append(text);
  const press = event(window, "contextmenu");
  text.dispatchEvent(press);
  assert.ok(press.defaultPrevented, "no callout on the controls in play");
  const inDialog = event(window, "selectstart");
  dialog.dispatchEvent(inDialog);
  assert.equal(inDialog.defaultPrevented, false, "dialogs keep selection");
  layout.update(
    { active: false, portrait: true },
    { phase: "lobby", live: false, results: false },
  );
  const idle = event(window, "contextmenu");
  text.dispatchEvent(idle);
  assert.equal(
    idle.defaultPrevented,
    false,
    "outside play the page behaves normally",
  );
});

test("roster: an unchanged member is written to the DOM once, not every update", () => {
  const { document } = page();
  const roster = createRoster({ document, emptyText: "Nobody yet" });
  const member = {
    id: "a",
    name: "Bo",
    status: "READY",
    host: true,
    ready: true,
  };
  roster.update([member]);
  const row = roster.row("a")!;
  const status = row.querySelector("small")!,
    name = row.querySelector("strong")!;
  let writes = 0;
  // Counting the assignments the update makes: the DOM's own mutation records are the browser's, not linkedom's.
  for (const [element, key] of [
    [status, "textContent"],
    [name, "textContent"],
  ] as const) {
    let value = element[key];
    Object.defineProperty(element, key, {
      get: () => value,
      set: (next) => {
        writes++;
        value = next;
      },
    });
  }
  roster.update([member]);
  roster.update([{ ...member }]);
  assert.equal(writes, 0, "same values, no writes");
  assert.equal(roster.empty!.hidden, true);
  roster.update([{ ...member, status: "OFFLINE", name: "Cy" }]);
  assert.equal(writes, 2);
  assert.equal(status.textContent, "OFFLINE");
  assert.equal(name.textContent, "Cy");
});
