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
  // Back is the page's first control, top left, and is not there on the front door.
  const head = menu.element.firstElementChild as HTMLElement,
    back = head.querySelector<HTMLButtonElement>(".fui-back")!;
  assert.equal(head.className, "fui-page-head");
  assert.equal(back.textContent, "Back");
  assert.equal(head.hidden, true);
  menu.play.click();
  assert.equal(head.hidden, false);
  assert.deepEqual(
    [...menu.element.querySelectorAll(".fui-play-menu button")].map((node) => [
      node.textContent,
      node.className,
    ]),
    [
      // The first choice takes Play's place as the page's primary action.
      ["Single player", "fui-menu-primary"],
      ["Host room", ""],
      ["Join room", ""],
    ],
  );
  back.click();
  assert.equal(head.hidden, true);
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-play-menu")!.hidden,
    true,
  );
  menu.play.click();
  menu.singlePlayer.click();
  await settle();
  assert.deepEqual(calls, ["solo"]);
  menu.joinRoom.click();
  assert.equal(join.closest("dialog"), menu.dialog);
  menu.dialog.close();
  assert.equal(menu.play.textContent, "Play");
  const escape = event(window, "keydown");
  Object.defineProperty(escape, "key", { value: "Escape" });
  // Escape is Back wherever the focus is: the page hears it, not only the menu.
  document.dispatchEvent(escape);
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-play-menu")!.hidden,
    true,
  );
  assert.equal(head.hidden, true);
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

test("soloInBar keeps what starts the game in the dialog's bar, Back at its left, above details that scroll", () => {
  const { document, window } = page();
  let solos = 0;
  const optionsButton = document.createElement("button");
  optionsButton.textContent = "OPTIONS";
  const landing = createLandingCard({
    title: "Fuse",
    document,
    onCreate() {},
    onSolo: () => {
      solos++;
    },
    soloInBar: true,
    soloActions: [optionsButton],
    valid: () => false,
    onJoin() {},
  });
  const details = document.createElement("section");
  details.textContent = "A long song select";
  landing.soloDetails.append(details);
  document.body.append(landing.element);
  dialogs(landing.menu.dialog, window);
  const bar = landing.menu.dialog.querySelector(".fui-dialog-bar")!,
    actions = bar.querySelector(".fui-dialog-actions")!,
    body = landing.menu.dialog.querySelector(".fui-dialog-body")!;
  const inBar = () => [...actions.children].map((node) => node.textContent);
  assert.deepEqual(inBar(), [], "nothing in the bar before it opens");
  // Back is the bar's first control, in this view and in every other: there is no CLOSE to look for.
  assert.equal(bar.firstElementChild!.className, "fui-back fui-dialog-back");
  assert.equal(bar.querySelectorAll(".fui-back").length, 1);

  landing.menu.play.click();
  landing.menu.singlePlayer.click();
  // The bar is the dialog's header and does not scroll: OPTIONS, then the solo button last, as the primary action.
  assert.deepEqual(inBar(), ["OPTIONS", "PLAY SOLO"]);
  assert.equal(bar.firstElementChild!.textContent, "Back");
  assert.equal(body.contains(landing.solo!), false);
  assert.equal(body.contains(details), true);
  landing.solo!.click();
  assert.equal(solos, 1);

  // Another view of the same dialog has no solo button, and it comes back with the single-player view.
  landing.menu.dialog.close();
  assert.deepEqual(inBar(), []);
  landing.menu.joinRoom.click();
  assert.deepEqual(inBar(), []);
  landing.menu.dialog.close();
  landing.menu.singlePlayer.click();
  assert.deepEqual(inBar(), ["OPTIONS", "PLAY SOLO"]);
  assert.equal(body.contains(details), true);
});
