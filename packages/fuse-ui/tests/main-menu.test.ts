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

test("Single player retains a game's additional local mode after opening and closing its details", () => {
  const { document, window } = page();
  let solo = 0,
    local = 0;
  const landing = createLandingCard({
    title: "Fuse",
    document,
    onCreate() {},
    onSolo: () => {
      solo++;
    },
    valid: () => false,
    onJoin() {},
  });
  const localButton = document.createElement("button");
  localButton.textContent = "Everyone at this screen";
  localButton.onclick = () => {
    local++;
  };
  landing.solo!.after(localButton);
  document.body.append(landing.element);
  dialogs(landing.menu.dialog, window);
  landing.menu.play.click();
  landing.menu.singlePlayer.click();
  assert.equal(landing.solo!.closest("dialog"), landing.menu.dialog);
  assert.equal(localButton.closest("dialog"), landing.menu.dialog);
  localButton.click();
  assert.equal(local, 1);
  assert.equal(solo, 0);
  landing.menu.dialog.close();
  landing.menu.singlePlayer.click();
  landing.solo!.click();
  assert.equal(solo, 1);
});

test("main menu: Play chooses a mode, Host room creates once and a rejection stays retryable", async () => {
  const { document } = page();
  let attempts = 0,
    solos = 0;
  const landing = createLandingCard({
    title: "Fuse",
    document,
    onCreate: async () => {
      if (++attempts === 1) throw new Error(HOSTILE);
    },
    valid: () => false,
    onSolo: () => {
      solos++;
    },
    onJoin() {},
  });
  document.body.append(landing.element);
  landing.menu.play.click();
  assert.equal(attempts, 0, "opening Play never creates a room");
  landing.menu.hostRoom.click();
  assert.equal(landing.menu.hostRoom.disabled, true);
  landing.menu.singlePlayer.click();
  assert.equal(solos, 0, "another mode cannot race an in-flight room creation");
  await settle();
  assert.equal(landing.menu.hostRoom.disabled, false);
  assert.equal(
    landing.element.querySelector(".fui-menu-error")?.textContent,
    HOSTILE,
  );
  assert.equal(
    landing.element.querySelector(".fui-menu-error")?.children.length,
    0,
  );
  landing.menu.hostRoom.click();
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
      ".fui-main-menu-nav:not(.fui-play-menu) button",
    ),
  ];
  assert.deepEqual(
    nav.map((b) => b.textContent),
    ["Play", "How to play", "About", "Settings"],
  );
  assert.equal(nav[3]!.hidden, true);
  nav[0]!.click();
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-play-menu")!.hidden,
    false,
  );
  assert.notEqual(menu.dialog.open, true);
  menu.joinRoom.click();
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
  menu.joinRoom.click();
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
      ".fui-main-menu-nav:not(.fui-play-menu) button",
    ),
  ];
  nav[1]!.click();
  nav[3]!.click();
  assert.deepEqual(calls, ["help", "settings"]);
  menu.play.click();
  menu.hostRoom.click();
  await settle();
  assert.equal(
    menu.element.querySelector(".fui-menu-error")?.textContent,
    "offline",
  );
  assert.equal(menu.play.textContent, "Play");
});

test("Play submenu separates single player, host and join while Escape returns to the unchanged main button", async () => {
  const { document, window } = page();
  const calls: string[] = [],
    join = document.createElement("input");
  const menu = createMainMenu({
    title: "Fuse",
    play: document.createElement("div"),
    document,
    onPlay: () => {
      calls.push("host");
    },
    onSinglePlayer: () => {
      calls.push("solo");
    },
    joinContent: [join],
  });
  document.body.append(menu.element);
  dialogs(menu.dialog, window);
  menu.play.click();
  assert.deepEqual(
    [...menu.element.querySelectorAll(".fui-play-menu button")].map(
      (node) => node.textContent,
    ),
    ["Single player", "Host room", "Join room", "Back"],
  );
  menu.singlePlayer.click();
  await settle();
  assert.deepEqual(calls, ["solo"]);
  menu.joinRoom.click();
  assert.equal(join.closest("dialog"), menu.dialog);
  menu.dialog.close();
  assert.equal(menu.play.textContent, "Play");
  const escape = event(window, "keydown");
  Object.defineProperty(escape, "key", { value: "Escape" });
  menu.element.dispatchEvent(escape);
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-play-menu")!.hidden,
    true,
  );
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-main-menu-nav")!.hidden,
    false,
  );
  assert.equal(menu.element.querySelector(".fui-main-menu-other"), null);
  assert.equal(menu.play.className, "fui-menu-primary");
});

test("main menu: a game's own screen sits on the front door after Play and opens when asked", () => {
  const { document } = page();
  const menu = createMainMenu({
    title: "Fuse",
    play: document.createElement("section"),
    document,
  });
  let opened = 0;
  const entry = menu.addEntry("Sync timing", () => opened++);
  assert.deepEqual(
    [
      ...menu.element.querySelectorAll<HTMLButtonElement>(
        ".fui-main-menu-nav:not(.fui-play-menu) button",
      ),
    ]
      .filter((node) => !node.hidden)
      .map((node) => node.textContent),
    ["Play", "Sync timing", "How to play", "About"],
  );
  assert.equal(entry.type, "button");
  entry.click();
  assert.equal(opened, 1);
});
