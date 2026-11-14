import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createRoomLayout, createRoster } from "fuse-ui";
import { createLobbyBar } from "../src/app/lobby-bar.js";
import { createPlayOptions } from "../src/app/options.js";
import { SESSION_LENGTHS } from "../src/online/game.js";

/**
 * The lobby as `main.ts` builds it for a host, a guest or a player alone: the room layout with the lobby bar's
 * parts. These are the rules that have regressed before: a speed row in the lobby, and START under the song select.
 */
function lobby(kind: "host" | "guest" | "solo") {
  const { document } = parseHTML("<html><body></body></html>");
  const root = document.createElement("section"),
    picker = document.createElement("div"),
    session = document.createElement("div"),
    start = document.createElement("button");
  picker.className = "fm-picker";
  start.textContent = "START";
  start.className = "fm-start";
  // A guest has no START to press: the room hides it, as `main.ts` does from the presenter's `showStart`.
  start.hidden = kind === "guest";
  const options = createPlayOptions({
    document,
    ...(kind === "solo" ? {} : { lengths: SESSION_LENGTHS }),
    onSpeed() {},
    onRandomSong() {},
  });
  options.update({ speed: 3, host: kind !== "guest", songs: 1, random: false });
  const bar = createLobbyBar({
    document,
    picker,
    options: options.element,
    session,
  });
  document.body.append(root);
  createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 5,
    primaryAction: start,
    headerActions: bar.headerActions,
    modes: bar.modes,
    ...(kind === "solo"
      ? { compact: true, heading: "Single player" }
      : { invite: document.createElement("div"), heading: "Room" }),
  });
  const all = [...root.querySelectorAll<HTMLElement>("*")];
  const before = (a: Element, b: Element) =>
    all.indexOf(a as HTMLElement) < all.indexOf(b as HTMLElement);
  return { root, bar, picker, start, before };
}

for (const kind of ["host", "guest", "solo"] as const) {
  test(`${kind} lobby: the speeds are behind OPTIONS, never a row in the lobby`, () => {
    const { root, bar } = lobby(kind);
    const speeds = [...root.querySelectorAll(".fm-option-speed")];
    assert.equal(speeds.length, 8);
    assert.equal(
      speeds.every((speed) => bar.menu.panel.contains(speed)),
      true,
      "every speed is inside the OPTIONS panel",
    );
    assert.equal(bar.menu.panel.hidden, true, "and the panel starts closed");
    assert.equal(
      root.querySelector(".fui-room-modes .fm-option-speed"),
      null,
      "no speed among the lobby's own choices",
    );
    assert.equal(
      root.querySelector(".fui-room-modes .fm-options"),
      null,
      "nor the options block they come in",
    );
  });

  test(`${kind} lobby: OPTIONS and START are in the room's header, above the song select`, () => {
    const { root, bar, picker, start, before } = lobby(kind);
    const head = root.firstElementChild!;
    assert.equal(head.classList.contains("fui-room-head"), true);
    assert.equal(head.contains(bar.menu.button), true);
    assert.equal(head.contains(start), true);
    assert.equal(before(bar.menu.button, picker), true);
    assert.equal(before(start, picker), true);
    assert.equal(
      before(bar.menu.button, start),
      true,
      "START is the last action, at the right",
    );
    assert.equal(head.querySelector(".fui-back")!.textContent, "Back");
  });
}
