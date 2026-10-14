import assert from "node:assert/strict";
import { test } from "node:test";
import { createGameMenu, createRoundControls } from "fuse-ui";
import { event, HOSTILE, page } from "./dom-fixture.js";

test("game menu: shared navigation respects capabilities and closes before actions", () => {
  const { document } = page();
  const calls: string[] = [];
  const menu = createGameMenu({
    document,
    controls: [{ keys: "← / →", action: "Turn" }],
    onLobby: () => calls.push(`lobby:${menu.isOpen()}`),
    onLeave: () => calls.push(`leave:${menu.isOpen()}`),
    onOpenChange: (open) => calls.push(`open:${open}`),
  });
  document.body.append(menu.element);
  const trigger = menu.element.querySelector<HTMLButtonElement>(
    ".fui-game-menu-trigger",
  )!;
  const panel = menu.element.querySelector<HTMLElement>(
    ".fui-game-menu-panel",
  )!;
  const actions = [
    ...menu.element.querySelectorAll<HTMLButtonElement>(
      ".fui-game-menu-navigation button",
    ),
  ];
  const [resume, controls, lobby, leave] = actions;
  assert.deepEqual(
    actions.map((action) => action.textContent),
    ["BACK TO GAME", "CONTROLS", "BACK TO LOBBY", "LEAVE GAME"],
  );
  assert.equal(trigger.getAttribute("aria-controls"), panel.id);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(lobby!.hidden, true);
  assert.equal(leave!.hidden, false);
  menu.update({ canLobby: true, canLeave: false });
  assert.equal(lobby!.hidden, false);
  assert.equal(leave!.hidden, true);
  leave!.click();
  assert.deepEqual(calls, [], "an unavailable action cannot call back");
  trigger.click();
  assert.equal(menu.isOpen(), true);
  assert.equal(panel.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  controls!.click();
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-game-menu-navigation")!
      .hidden,
    true,
  );
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-game-menu-controls")!.hidden,
    false,
  );
  assert.equal(menu.element.querySelector("dt")!.textContent, "← / →");
  menu.element
    .querySelector<HTMLButtonElement>(".fui-game-menu-controls button")!
    .click();
  assert.equal(
    menu.element.querySelector<HTMLElement>(".fui-game-menu-navigation")!
      .hidden,
    false,
  );
  lobby!.click();
  assert.equal(menu.isOpen(), false);
  assert.deepEqual(calls, ["open:true", "open:false", "lobby:false"]);
  menu.update({ canLobby: true });
  trigger.click();
  leave!.click();
  assert.deepEqual(calls.slice(-3), ["open:true", "open:false", "leave:false"]);
  trigger.click();
  resume!.click();
  assert.equal(menu.isOpen(), false);
  menu.dispose();
});

test("game menu: Escape, outside pointer, close and disposal restore focus without duplicate callbacks", () => {
  const { document, window } = page();
  const changes: boolean[] = [];
  const menu = createGameMenu({
    document,
    controls: [],
    onOpenChange: (open) => changes.push(open),
  });
  document.body.append(menu.element);
  const trigger = menu.element.querySelector<HTMLButtonElement>("button")!;
  let restored = 0;
  trigger.focus = () => {
    restored++;
  };
  trigger.click();
  const escape = event(window, "keydown", { key: "Escape" });
  document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(menu.isOpen(), false);
  assert.equal(restored, 1);
  menu.close();
  assert.equal(restored, 1);
  trigger.click();
  trigger.dispatchEvent(event(window, "pointerdown"));
  assert.equal(
    menu.isOpen(),
    true,
    "inside interaction keeps the disclosure open",
  );
  document.body.dispatchEvent(event(window, "pointerdown"));
  assert.equal(menu.isOpen(), false);
  assert.equal(restored, 2);
  trigger.click();
  menu.dispose();
  assert.equal(menu.isOpen(), false);
  assert.equal(restored, 3);
  trigger.click();
  document.dispatchEvent(event(window, "keydown", { key: "Escape" }));
  assert.deepEqual(changes, [true, false, true, false, true, false]);
});

test("game menu: contextual controls stay text, with touch, dynamic seats and spectators", () => {
  const { document } = page();
  const menu = createGameMenu({
    document,
    title: HOSTILE,
    goal: HOSTILE,
    controls: [{ keys: "A / D", action: HOSTILE }],
    touchControls: [{ keys: "LEFT / RIGHT", action: "Hold to turn" }],
  });
  menu.update({ canLobby: true });
  assert.equal(
    menu.element.querySelector<HTMLElement>(
      ".fui-game-menu-navigation button:nth-child(3)",
    )!.hidden,
    true,
    "no callback means no lobby action",
  );
  assert.equal(
    menu.element.querySelector<HTMLElement>(
      ".fui-game-menu-navigation button:nth-child(4)",
    )!.hidden,
    true,
  );
  assert.equal(menu.element.querySelector("img"), null);
  menu.update({ canLobby: false, touch: true });
  assert.equal(menu.element.querySelector("dt")!.textContent, "LEFT / RIGHT");
  menu.update({
    canLobby: false,
    controls: [
      { keys: "P1: arrows", action: "Move" },
      { keys: "P2: WASD", action: "Move" },
    ],
  });
  assert.equal(menu.element.querySelectorAll("dt").length, 2);
  menu.update({ canLobby: false, spectator: true });
  assert.equal(menu.element.querySelector("dt"), null);
  assert.match(menu.element.textContent!, /Watch the arena/);
  menu.dispose();
});

test("round controls: every countdown announces once, never hijacks focus and hides during play", () => {
  const { document } = page();
  const controls = createRoundControls({
    document,
    goal: "Be the last rider.",
    controls: [{ keys: "← / →", action: "Turn" }],
  });
  assert.equal(controls.element.hidden, true);
  assert.equal(controls.element.getAttribute("role"), "status");
  controls.update({ round: 1, visible: true });
  const first = controls.element.querySelector("strong");
  assert.equal(controls.element.hidden, false);
  assert.equal(controls.element.dataset.round, "1");
  assert.equal(controls.element.querySelector("dt")!.textContent, "← / →");
  const dismiss = controls.element.querySelector<HTMLButtonElement>("button")!;
  assert.equal(dismiss.getAttribute("aria-label"), "Dismiss controls");
  controls.update({ round: 1, visible: true });
  assert.equal(
    controls.element.querySelector("strong"),
    first,
    "repeated frames do not reannounce",
  );
  dismiss.click();
  assert.equal(controls.element.hidden, true);
  controls.update({ round: 1, visible: true });
  controls.update({ round: 1, visible: true, touch: true });
  assert.equal(
    controls.element.hidden,
    true,
    "ticks and device changes do not reopen dismissed controls",
  );
  controls.update({ round: 1, visible: false });
  assert.equal(controls.element.hidden, true);
  controls.update({ round: 2, visible: true });
  assert.equal(controls.element.hidden, false);
  assert.notEqual(
    controls.element.querySelector("strong"),
    first,
    "a new round refreshes the live announcement",
  );
  const second = controls.element.querySelector("strong");
  dismiss.click();
  controls.update({ round: 2, visible: false });
  controls.update({ round: 2, visible: true });
  assert.notEqual(
    controls.element.querySelector("strong"),
    second,
    "a fresh countdown with a reused round id also refreshes",
  );
});

test("round controls: touch and spectators get relevant guidance, including changing seat bindings", () => {
  const { document } = page();
  const controls = createRoundControls({
    document,
    controls: [{ keys: "WASD", action: "Move" }],
    touchControls: [{ keys: "D-pad", action: "Move" }],
  });
  controls.update({ round: "match:1", visible: true, touch: true });
  assert.equal(controls.element.querySelector("dt")!.textContent, "D-pad");
  controls.update({
    round: "match:1",
    visible: true,
    controls: [{ keys: "Arrows", action: HOSTILE }],
  });
  assert.equal(controls.element.querySelector("dt")!.textContent, "Arrows");
  assert.equal(controls.element.querySelector("dd")!.textContent, HOSTILE);
  assert.equal(controls.element.querySelector("img"), null);
  controls.update({ round: "match:1", visible: true, spectator: true });
  assert.equal(
    controls.element.querySelector("strong")!.textContent,
    "WATCHING THIS ROUND",
  );
  assert.equal(controls.element.querySelector("dt"), null);
  controls.update({
    round: "match:1",
    visible: true,
    spectator: true,
    display: true,
  });
  assert.equal(
    controls.element.querySelector("strong")!.textContent,
    "GET READY · PHONE CONTROLS",
  );
  assert.equal(controls.element.querySelector("dt")!.textContent, "D-pad");
  assert.match(
    controls.element.textContent!,
    /Players use their own phones or devices/,
  );
  const fallback = createRoundControls({ document, controls: [] });
  fallback.update({ round: 1, visible: true, touch: true });
  assert.match(fallback.element.textContent!, /On-screen buttons/);
});
