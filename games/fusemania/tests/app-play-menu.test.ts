import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  FLASH_MS,
  HOST_RESTARTED,
  HOST_TO_SELECT,
  RESTART_WINDOW_MS,
  SPEED_KEYS,
  createFlash,
  createHostWatch,
  createPlayMenu,
  stepSpeed,
  type PlayMenuKind,
} from "../src/app/play-menu.js";
import {
  DEFAULT_PREFS,
  MAX_SPEED,
  MIN_SPEED,
  SPEEDS,
  actionOf,
  parsePrefs,
} from "../src/app/prefs.js";

/**
 * The menu over a song as `main.ts` opens it: alone (a pause), for a room's host and for a room's other players.
 * The rules: only the host has what takes the whole room along, everybody has their own speed, and the arrow keys
 * and Enter are enough to use it.
 */
function setup(kind: PlayMenuKind, speed = 1.5) {
  const { document, window } = parseHTML("<html><body></body></html>");
  const asked: unknown[][] = [];
  const menu = createPlayMenu({
    document,
    onResume: () => asked.push(["resume"]),
    onRestart: () => asked.push(["restart"]),
    onSelect: () => asked.push(["select"]),
    onLeave: () => asked.push(["leave"]),
    onSpeed: (value) => asked.push(["speed", value]),
  });
  document.body.append(menu.element);
  // linkedom keeps no focus: the menu's buttons record it.
  let focused: Element | null = document.body;
  for (const node of menu.element.querySelectorAll("button"))
    Object.defineProperty(node, "focus", { value: () => (focused = node) });
  Object.defineProperty(document, "activeElement", { get: () => focused });
  const press = (key: string) => {
    const event = new window.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "key", { value: key });
    (focused ?? document.body).dispatchEvent(event);
  };
  const one = (selector: string) =>
    menu.element.querySelector<HTMLButtonElement>(selector)!;
  const shown = () =>
    [...menu.element.querySelectorAll<HTMLButtonElement>("button")]
      .filter((node) => !node.closest("[hidden]"))
      .map((node) => node.textContent);
  menu.open({ kind, title: "Neon Chase", speed });
  return {
    menu,
    asked,
    press,
    one,
    shown,
    focus: () => (focused as HTMLElement | null)?.textContent ?? "",
    text: (selector: string) =>
      menu.element.querySelector(selector)?.textContent ?? "",
  };
}

test("alone the menu is a pause: resume, restart, song select and the speed, no way out of a room", () => {
  const f = setup("solo");
  assert.equal(f.menu.isOpen, true);
  assert.equal(f.text("h2"), "PAUSED");
  assert.equal(f.text(".fm-pause-song"), "Neon Chase");
  assert.deepEqual(f.shown(), ["RESUME", "RESTART", "SONG SELECT", "−", "+"]);
  f.one(".fm-pause-restart").click();
  f.one(".fm-pause-select").click();
  assert.deepEqual(f.asked, [["restart"], ["select"]]);
});

test("a room's host can restart the song and go back to the song select, and is told it is for everyone", () => {
  const f = setup("host");
  assert.equal(f.text("h2"), "MENU");
  assert.deepEqual(f.shown(), [
    "RESUME",
    "RESTART FOR EVERYONE",
    "SONG SELECT FOR EVERYONE",
    "−",
    "+",
    "LEAVE ROOM",
  ]);
  assert.match(f.text(".fm-pause-state"), /keeps playing/);
  f.one(".fm-pause-restart").click();
  f.one(".fm-pause-select").click();
  f.one(".fm-pause-leave").click();
  assert.deepEqual(f.asked, [["restart"], ["select"], ["leave"]]);
});

test("a room's other players have no restart and no song select: their speed, and the way out", () => {
  const f = setup("guest");
  assert.deepEqual(f.shown(), ["RESUME", "−", "+", "LEAVE ROOM"]);
  assert.match(f.text(".fm-pause-state"), /Only the host/);
  // Nor do the arrow keys reach what is hidden.
  for (let step = 0; step < 6; step++) {
    f.press("ArrowDown");
    assert.doesNotMatch(f.focus(), /RESTART|SONG SELECT/);
  }
});

test("the menu opens on RESUME, the arrows walk it and Enter's button is the one in focus", () => {
  const f = setup("host");
  assert.equal(f.focus(), "RESUME");
  f.press("ArrowDown");
  assert.equal(f.focus(), "RESTART FOR EVERYONE");
  f.press("ArrowDown");
  assert.equal(f.focus(), "SONG SELECT FOR EVERYONE");
  f.press("ArrowDown");
  assert.equal(f.focus(), "+", "the speed row is one stop");
  f.press("ArrowDown");
  assert.equal(f.focus(), "LEAVE ROOM");
  f.press("ArrowDown");
  assert.equal(f.focus(), "RESUME", "wraps");
  f.press("ArrowUp");
  assert.equal(f.focus(), "LEAVE ROOM");
});

for (const kind of ["solo", "host", "guest"] as const)
  test(`${kind}: on the speed row Left and Right change this player's own speed`, () => {
    const f = setup(kind, 2);
    assert.equal(f.text(".fm-pause-speed-value"), "SPEED 2x");
    f.one(".fm-pause-faster").focus();
    f.press("ArrowRight");
    f.press("ArrowLeft");
    f.press("ArrowLeft");
    assert.deepEqual(f.asked, [
      ["speed", 2.5],
      ["speed", 2],
      ["speed", 1.5],
    ]);
    assert.equal(f.text(".fm-pause-speed-value"), "SPEED 1.5x");
    f.one(".fm-pause-slower").click();
    assert.deepEqual(f.asked.at(-1), ["speed", 1]);
    // Nothing else was asked of the room.
    assert.ok(f.asked.every(([what]) => what === "speed"));
  });

test("the speed stops at its ends, and the focus moves to the button that still works", () => {
  const f = setup("solo", 4);
  f.one(".fm-pause-faster").focus();
  f.press("ArrowRight");
  assert.deepEqual(f.asked, [["speed", 5]]);
  assert.equal(f.one(".fm-pause-faster").disabled, true);
  assert.equal(f.focus(), "−");
  f.press("ArrowRight");
  assert.deepEqual(f.asked, [["speed", 5]], "nothing past the fastest");
});

test("a count-in takes the buttons' place, and closing hides the menu", () => {
  const f = setup("solo");
  f.menu.count("3");
  assert.equal(f.text(".fm-pause-count"), "3");
  assert.deepEqual(f.shown(), []);
  f.menu.count(undefined);
  assert.equal(f.shown().length, 5);
  f.menu.close();
  assert.equal(f.menu.isOpen, false);
});

test("a speed step goes along the speeds on offer, from a slider's speed between them too, and stays a speed the settings keep", () => {
  assert.equal(stepSpeed(1.5, 1), 2);
  assert.equal(stepSpeed(1.5, -1), 1);
  assert.equal(stepSpeed(1.7, 1), 2);
  assert.equal(stepSpeed(1.7, -1), 1.5);
  assert.equal(stepSpeed(MAX_SPEED, 1), MAX_SPEED);
  assert.equal(stepSpeed(MIN_SPEED, -1), MIN_SPEED);
  let speed = MIN_SPEED;
  const up: number[] = [];
  while (stepSpeed(speed, 1) !== speed) up.push((speed = stepSpeed(speed, 1)));
  assert.deepEqual([MIN_SPEED, ...up], SPEEDS);
  for (const each of up) assert.equal(parsePrefs({ speed: each }).speed, each);
});

test("the speed keys are − and +, and none of them is a step key out of the box", () => {
  assert.equal(SPEED_KEYS.Minus, -1);
  assert.equal(SPEED_KEYS.Equal, 1);
  assert.equal(SPEED_KEYS.NumpadSubtract, -1);
  assert.equal(SPEED_KEYS.NumpadAdd, 1);
  for (const code of Object.keys(SPEED_KEYS))
    assert.equal(actionOf(DEFAULT_PREFS, code), undefined);
});

test("a flash shows for a moment and then goes, and a new one starts its time again", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const flash = createFlash(document);
  assert.equal(flash.element.hidden, true);
  flash.show("SPEED 2x", 1000);
  flash.frame(1000 + FLASH_MS - 1);
  assert.equal(flash.element.hidden, false);
  assert.equal(flash.element.textContent, "SPEED 2x");
  flash.show("SPEED 2.5x", 2000);
  flash.frame(1000 + FLASH_MS);
  assert.equal(flash.element.hidden, false);
  flash.frame(2000 + FLASH_MS);
  assert.equal(flash.element.hidden, true);
});

test("a player who is not the host is told the host went back to the song select, or restarted the song", () => {
  const watch = createHostWatch();
  assert.equal(watch("lobby", 0), undefined);
  assert.equal(
    watch("running", 1000),
    undefined,
    "a first start is no restart",
  );
  assert.equal(watch("running", 2000), undefined);
  assert.equal(watch("lobby", 3000), HOST_TO_SELECT);
  assert.equal(watch("running", 3200), HOST_RESTARTED);
  // A song that ends on its own, and a new one picked at leisure, say nothing.
  assert.equal(watch("over", 9000), undefined);
  assert.equal(watch("lobby", 9500), undefined);
  assert.equal(watch("running", 9600), undefined);
  assert.equal(watch("lobby", 10000), HOST_TO_SELECT);
  assert.equal(watch("running", 10000 + RESTART_WINDOW_MS), undefined);
});
