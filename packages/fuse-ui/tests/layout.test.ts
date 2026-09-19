import assert from "node:assert/strict";
import { test } from "node:test";
import { createLobbyShell, createRoster } from "fuse-ui";
import { HOSTILE, page } from "./dom-fixture.js";

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
