import assert from "node:assert/strict";
import { test } from "node:test";
import { createLandingCard, createMainMenu, VIBE_CODING_GANG } from "fuse-ui";
import { event, HOSTILE, page } from "./dom-fixture.js";

function dialogs(dialog: HTMLDialogElement, window: { Event: typeof Event }) {
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(event(window, "close"));
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("main menu: one room per Play, rejected creation is visible and retryable", async () => {
  const { document } = page();
  let attempts = 0;
  const landing = createLandingCard({
    title: "Fuse",
    document,
    onCreate: async () => {
      if (++attempts === 1) throw new Error(HOSTILE);
    },
    valid: () => false,
    onJoin() {},
  });
  document.body.append(landing.element);
  landing.menu.play.click();
  assert.equal(landing.menu.play.disabled, true);
  await settle();
  assert.equal(landing.menu.play.disabled, false);
  assert.equal(
    landing.element.querySelector(".fui-menu-error")?.textContent,
    HOSTILE,
  );
  assert.equal(
    landing.element.querySelector(".fui-menu-error")?.children.length,
    0,
  );
  landing.menu.play.click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(
    landing.element.querySelector(".fui-menu-error")?.textContent,
    "",
  );
});

test("main menu: credits, rules and preferences preserve the original controls and handlers", () => {
  const { document, window } = page();
  const play = document.createElement("section"),
    control = document.createElement("button");
  let clicked = 0;
  control.onclick = () => clicked++;
  play.append(control);
  const help = document.createElement("p");
  help.textContent = HOSTILE;
  const menu = createMainMenu({
    title: HOSTILE,
    play,
    howToPlay: [help],
    document,
  });
  document.body.append(menu.element);
  dialogs(menu.dialog, window);
  const nav = [
    ...menu.element.querySelectorAll<HTMLButtonElement>(
      ".fui-main-menu-nav button",
    ),
  ];
  assert.deepEqual(
    nav.map((b) => b.textContent),
    ["Play", "How to play", "About", "Settings"],
  );
  assert.equal(nav[3]!.hidden, true);
  nav[0]!.click();
  assert.equal(menu.dialog.open, true);
  assert.equal(play.closest("dialog"), menu.dialog);
  control.click();
  assert.equal(clicked, 1);
  menu.dialog.close();
  assert.equal(play.parentElement?.hidden, true);
  nav[1]!.click();
  assert.equal(help.closest("dialog"), menu.dialog);
  assert.equal(help.children.length, 0);
  nav[2]!.click();
  assert.deepEqual(
    [...menu.dialog.querySelectorAll("li")].map((n) => n.textContent),
    [...VIBE_CODING_GANG],
  );
  assert.ok(menu.dialog.textContent.includes("Sindre Aarsaether"));
  assert.ok(!menu.dialog.textContent.includes("bedeho"));
  const settings = document.createElement("select");
  menu.addSettings(settings);
  assert.equal(nav[3]!.hidden, false);
  nav[3]!.click();
  assert.equal(settings.closest("dialog"), menu.dialog);
  menu.dialog.dispatchEvent(event(window, "close"));
  menu.element
    .querySelector<HTMLButtonElement>(".fui-main-menu-other")!
    .click();
  assert.equal(play.closest("dialog"), menu.dialog);
  control.click();
  assert.equal(clicked, 2);
});

test("main menu: custom screens reuse game-owned preferences, help and failures", async () => {
  const { document } = page();
  const calls: string[] = [];
  const menu = createMainMenu({
    title: "Fuse",
    play: document.createElement("div"),
    document,
    onHowToPlay: () => calls.push("help"),
    onSettings: () => calls.push("settings"),
    onPlay: () => {
      throw "offline";
    },
    settings: [document.createElement("input")],
  });
  const nav = [
    ...menu.element.querySelectorAll<HTMLButtonElement>(
      ".fui-main-menu-nav button",
    ),
  ];
  nav[1]!.click();
  nav[3]!.click();
  assert.deepEqual(calls, ["help", "settings"]);
  menu.play.click();
  await settle();
  assert.equal(
    menu.element.querySelector(".fui-menu-error")?.textContent,
    "offline",
  );
  assert.equal(menu.play.textContent, "Play");
});
