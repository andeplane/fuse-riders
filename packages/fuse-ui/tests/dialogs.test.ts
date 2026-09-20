import assert from "node:assert/strict";
import { test } from "node:test";
import { createConfirm, createDialog, createKeyList } from "fuse-ui";
import { HOSTILE, event, page } from "./dom-fixture.js";

test("dialog views: one shell shows each menu, opens once, and resets its title on close", () => {
  const { document, window } = page();
  const shell = createDialog({
    title: "GAME MENU",
    label: "Game menu",
    document,
  });
  let opened = 0;
  Object.defineProperty(shell.dialog, "showModal", {
    value: () => {
      opened++;
      shell.dialog.setAttribute("open", "");
    },
  });
  Object.defineProperty(shell.dialog, "open", {
    get: () => shell.dialog.hasAttribute("open"),
  });
  const first = document.createElement("p");
  shell.show({ title: HOSTILE, content: [first] });
  assert.equal(opened, 1);
  assert.equal(shell.title.textContent, HOSTILE);
  assert.equal(shell.title.children.length, 0, "a title is text");
  assert.equal(shell.dialog.getAttribute("aria-label"), HOSTILE);
  assert.deepEqual([...shell.body.children], [first]);

  const second = document.createElement("div");
  shell.show({ title: "RADIO", label: "Radio", content: [second] });
  assert.equal(opened, 1, "an open dialog is not opened again");
  assert.equal(shell.dialog.getAttribute("aria-label"), "Radio");
  assert.deepEqual([...shell.body.children], [second]);

  shell.show({ title: "ROOM SETTINGS" });
  assert.deepEqual(
    [...shell.body.children],
    [second],
    "no content keeps the body the game filled",
  );

  shell.dialog.dispatchEvent(event(window, "close"));
  assert.equal(shell.title.textContent, "GAME MENU");
  assert.equal(shell.dialog.getAttribute("aria-label"), "Game menu");
});

test("key list: a heading and a definition list per group, all text", () => {
  const { document } = page();
  const nodes = createKeyList(
    [
      { title: "Driving", entries: [["← / A", HOSTILE]] },
      { title: HOSTILE, entries: [] },
    ],
    { classes: { group: "shortcut-group" }, document },
  );
  assert.deepEqual(
    nodes.map((node) => `${node.tagName}.${node.className}`),
    [
      "H3.shortcut-group",
      "DL.fui-key-list",
      "H3.shortcut-group",
      "DL.fui-key-list",
    ],
  );
  const [, list, heading] = nodes;
  assert.deepEqual(
    [...list!.children].map((child) => [child.tagName, child.textContent]),
    [
      ["DT", "← / A"],
      ["DD", HOSTILE],
    ],
  );
  assert.equal(list!.querySelector("img"), null);
  assert.equal(heading!.textContent, HOSTILE);
});

test("confirm: question, cancel then confirm, each calling back", () => {
  const { document } = page();
  const calls: string[] = [];
  const confirm = createConfirm({
    question: HOSTILE,
    confirmText: "LEAVE ROOM",
    cancelText: "STAY",
    onConfirm: async () => {
      calls.push("confirm");
    },
    onCancel: () => calls.push("cancel"),
    classes: { question: "", choices: "exit-choices" },
    document,
  });
  assert.equal(confirm.question.textContent, HOSTILE);
  assert.equal(confirm.question.className, "");
  assert.equal(confirm.choices.className, "exit-choices");
  assert.deepEqual(
    [...confirm.choices.children],
    [confirm.cancel, confirm.confirm],
  );
  assert.equal(confirm.confirm.className, "fui-confirm-yes");
  assert.equal(confirm.confirm.type, "button");
  assert.equal(confirm.cancel.textContent, "STAY");
  confirm.cancel.click();
  confirm.confirm.click();
  assert.deepEqual(calls, ["cancel", "confirm"]);
});
