import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  createDialogRegistry,
  type DialogRegistry,
  type DialogSurface,
  type RoomDialogId,
} from "../src/online/dialogs/registry.js";
import { createDialogShell, outside } from "../src/online/dialogs/shell.js";
import { createRadioDialog } from "../src/online/dialogs/radio.js";
import { createRecapDialog } from "../src/online/dialogs/recap.js";
import { createSettingsDialog } from "../src/online/dialogs/settings.js";
import { createShortcutsDialog } from "../src/online/dialogs/shortcuts.js";
import { createVoiceDialog } from "../src/online/dialogs/voice.js";
import {
  createMenuDialog,
  sortedStandings,
  type MenuDialogOptions,
} from "../src/online/dialogs/menu.js";

/** A button's click handler, as a click runs it. */
const press = (button: HTMLElement) =>
  button.onclick?.call(button, new Event("click") as PointerEvent);

/** A `<dialog>` as the registry sees it. `close` events wait in a queue until `flush`, as the browser's task queue does. */
class FakeDialog implements DialogSurface {
  open = false;
  shown = 0;
  private queued = 0;
  private readonly listeners: (() => void)[] = [];
  showModal() {
    if (this.open) throw new Error("showModal on an open dialog");
    this.open = true;
    this.shown++;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.queued++;
  }
  addEventListener(_type: "close", listener: () => void) {
    this.listeners.push(listener);
  }
  flush() {
    for (; this.queued > 0; this.queued--)
      for (const listener of this.listeners) listener();
  }
}

function registry() {
  const dialogs = createDialogRegistry<RoomDialogId>();
  const fakes = new Map<RoomDialogId, FakeDialog>();
  const changes: [RoomDialogId | undefined, RoomDialogId | undefined][] = [];
  dialogs.onChange((open, previous) => changes.push([open, previous]));
  const fake = (id: RoomDialogId) => {
    const dialog = new FakeDialog();
    fakes.set(id, dialog);
    dialogs.add(id, dialog);
    return dialog;
  };
  const flush = () => {
    for (const dialog of fakes.values()) dialog.flush();
  };
  return { dialogs, fake, flush, changes };
}

/**
 * The dialog modules build real markup (linkedom's document) and register it; the registry they get swaps each
 * element for a `FakeDialog`, since linkedom has no `showModal`.
 */
function modules() {
  const { document } = parseHTML("<html><body></body></html>");
  const { dialogs: real, fake, flush, changes } = registry();
  const dialogs: DialogRegistry<RoomDialogId> = {
    ...real,
    add: (id) => void fake(id),
  };
  return { document, dialogs, flush, changes };
}

test("the registry knows which dialog is open, and a second one swaps with it without a gap", () => {
  const { dialogs, fake, flush, changes } = registry();
  const settings = fake("settings"),
    radio = fake("radio");
  assert.equal(dialogs.current(), undefined);
  dialogs.open("settings");
  assert.equal(dialogs.current(), "settings");
  // ♫ RADIO inside SETTINGS: the radio takes its place, as replacing the shared dialog's contents used to.
  dialogs.open("radio");
  assert.equal(dialogs.current(), "radio");
  assert.equal(settings.open, false);
  assert.equal(radio.open, true);
  flush();
  assert.equal(dialogs.current(), "radio", "the swapped-out close is stale");
  assert.deepEqual(changes, [
    ["settings", undefined],
    ["radio", "settings"],
  ]);
});

test("Escape or CLOSE ends the open dialog at once, and listeners hear it from the close event", () => {
  const { dialogs, fake, flush, changes } = registry();
  const menu = fake("menu");
  dialogs.open("menu");
  menu.close(); // Escape, the backdrop or the bar's CLOSE: the element closes itself.
  assert.equal(dialogs.current(), undefined, "as `dialog.open` did");
  assert.deepEqual(changes, [["menu", undefined]]);
  flush();
  assert.deepEqual(changes, [
    ["menu", undefined],
    [undefined, "menu"],
  ]);
});

test("closing by identity leaves any other dialog alone", () => {
  const { dialogs, fake, flush } = registry();
  fake("recap");
  const settings = fake("settings");
  dialogs.open("settings");
  // The room left the results while SETTINGS was up (#318), or the lobby ended with no picker open: nothing to close.
  dialogs.close("recap");
  dialogs.close("avatar");
  assert.equal(dialogs.current(), "settings");
  dialogs.close();
  flush();
  assert.equal(settings.open, false);
  assert.equal(dialogs.current(), undefined);
  dialogs.close();
  assert.equal(dialogs.current(), undefined, "closing nothing is harmless");
});

test("a dialog reopened before its old close event arrives stays open", () => {
  const { dialogs, fake, flush, changes } = registry();
  const recap = fake("recap");
  dialogs.open("recap");
  dialogs.close("recap");
  dialogs.open("recap"); // a replay ended and reopened the results in the same task
  flush();
  assert.equal(dialogs.current(), "recap");
  assert.equal(recap.shown, 2);
  assert.deepEqual(changes, [
    ["recap", undefined],
    ["recap", undefined],
  ]);
});

test("opening the open dialog again leaves it as it is", () => {
  const { dialogs, fake, changes } = registry();
  const radio = fake("radio");
  dialogs.open("radio");
  dialogs.open("radio");
  assert.equal(radio.shown, 1);
  assert.deepEqual(changes, [["radio", undefined]]);
});

test("every identity is registered once, and an unknown one is an error", () => {
  const { dialogs, fake } = registry();
  fake("menu");
  assert.throws(() => dialogs.add("menu", new FakeDialog()), /twice/);
  assert.throws(() => dialogs.open("voice"), /Unknown dialog: voice/);
});

test("the shell is the markup the shared dialog had", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const room = createDialogShell({
    title: "SETTINGS",
    label: "Settings",
    document,
  });
  // tag.class[attributes] "text" > children, in document order (linkedom's serializer reorders attributes).
  const shape = (element: Element): unknown => [
    `${element.tagName.toLowerCase()}.${element.className}`,
    Object.fromEntries(
      [...element.attributes]
        .filter((attribute) => attribute.name !== "class")
        .map((attribute) => [attribute.name, attribute.value]),
    ),
    element.children.length
      ? [...element.children].map(shape)
      : element.textContent,
  ];
  assert.deepEqual(shape(room.dialog), [
    "dialog.game-dialog",
    { "aria-label": "Settings" },
    [
      [
        "header.dialog-bar",
        {},
        [
          ["strong.", {}, "SETTINGS"],
          [
            "span.dialog-actions",
            {},
            [
              [
                "button.dialog-close",
                { type: "button", "aria-label": "CLOSE" },
                "✕  CLOSE",
              ],
            ],
          ],
        ],
      ],
      ["div.dialog-body", {}, ""],
    ],
  ]);
  // The landing page's SETTINGS had a CLOSE with no class.
  const landing = createDialogShell({
    title: "SETTINGS",
    label: "Settings",
    closeClass: "",
    document,
  });
  assert.equal(landing.close.className, "");
});

test("a click closes the dialog only outside its box", () => {
  const box = { left: 10, right: 110, top: 20, bottom: 220 };
  assert.equal(outside(box, 60, 100), false);
  assert.equal(outside(box, 10, 20), false, "the edge is inside");
  for (const [x, y] of [
    [9, 100],
    [111, 100],
    [60, 19],
    [60, 221],
  ] as const)
    assert.equal(outside(box, x, y), true, `${x},${y}`);
});

test("Ctrl+A opens the radio, closes it, and leaves the results alone", () => {
  const { document, dialogs, flush } = modules();
  const controls = document.createElement("details");
  let unlocked = 0;
  const radio = createRadioDialog(
    dialogs,
    {
      controls,
      unlock: () => {
        unlocked++;
      },
    },
    document,
  );
  const recap = createRecapDialog(dialogs, {
    isHost: () => false,
    rematch: () => {},
    backToLobby: () => {},
    document,
  });
  radio.toggle();
  assert.equal(dialogs.current(), "radio");
  assert.equal(unlocked, 1);
  assert.equal(controls.hasAttribute("open"), true);
  assert.equal(controls.parentElement?.className, "dialog-body");
  assert.equal(
    radio.element.querySelector(".dialog-body h2")?.textContent,
    "Fuse Riders Radio",
  );
  radio.toggle();
  flush();
  assert.equal(dialogs.current(), undefined);
  recap.open(document.createElement("section"), false);
  radio.toggle();
  assert.equal(dialogs.current(), "recap", "radio over the results is a no-op");
});

test("the results bar: REMATCH and Back to lobby for the host, full stats when there are any", () => {
  const { document, dialogs, flush } = modules();
  let host = true,
    rematches = 0;
  const calls: string[] = [];
  const recap = createRecapDialog(dialogs, {
    isHost: () => host,
    rematch: () => {
      rematches++;
    },
    backToLobby: () => calls.push(`lobby while ${dialogs.current()}`),
    document,
  });
  assert.equal(recap.element.className, "game-dialog recap-dialog");
  assert.equal(recap.element.getAttribute("aria-label"), "Match results");
  const bar = recap.element.querySelector(".dialog-bar")!;
  assert.deepEqual(
    [...bar.children].map((child) => child.className),
    ["", "recap-stats-toggle", "dialog-actions"],
  );
  const [lobby, rematch, close] = [
    ...bar.querySelector(".dialog-actions")!.children,
  ] as HTMLButtonElement[];
  assert.deepEqual(
    [lobby!.textContent, rematch!.textContent, close!.textContent],
    ["Back to lobby", "REMATCH", "✕"],
  );
  assert.equal(close!.getAttribute("aria-label"), "CLOSE");
  const report = document.createElement("section"),
    details = document.createElement("div");
  details.className = "recap-details";
  details.hidden = true;
  report.append(details);
  recap.open(report, true);
  assert.equal(dialogs.current(), "recap");
  const toggle = bar.querySelector<HTMLButtonElement>(".recap-stats-toggle")!;
  assert.deepEqual(
    [lobby!.hidden, rematch!.hidden, toggle.hidden],
    [false, false, false],
  );
  (details as { scrollIntoView?: () => void }).scrollIntoView = () => {};
  press(toggle);
  assert.equal(details.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.textContent, "Hide full stats ↗");
  press(toggle);
  assert.equal(details.hidden, true);
  assert.equal(toggle.textContent, "View full stats ↗");
  press(rematch!);
  assert.equal(rematches, 1);
  press(lobby!);
  flush();
  assert.deepEqual(calls, ["lobby while undefined"], "it closes first");
  host = false;
  recap.open(document.createElement("section"), false);
  assert.deepEqual(
    [lobby!.hidden, rematch!.hidden, toggle.hidden],
    [true, true, true],
  );
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("SETTINGS takes the voice controls back and refreshes before it opens", () => {
  const { document, dialogs } = modules();
  const content = document.createElement("div"),
    voiceControls = document.createElement("section");
  const order: string[] = [];
  const settings = createSettingsDialog(dialogs, {
    content,
    voiceControls,
    beforeOpen: () => order.push("refresh"),
    document,
  });
  const voice = createVoiceDialog(dialogs, voiceControls, document);
  voice.open();
  assert.equal(dialogs.current(), "voice");
  assert.equal(
    voice.element.querySelector(".dialog-body")?.firstElementChild,
    voiceControls,
  );
  settings.open();
  assert.deepEqual(order, ["refresh"]);
  assert.equal(dialogs.current(), "settings");
  assert.equal(voiceControls.parentElement, content);
  assert.equal(
    settings.element.querySelector(".dialog-body")?.firstElementChild,
    content,
  );
  assert.equal(settings.element.getAttribute("aria-label"), "Settings");
});

test("SHORTCUTS lists the key groups, ROOM SETTINGS keys only for whoever may configure", () => {
  const { document, dialogs } = modules();
  let host = false;
  const shortcuts = createShortcutsDialog(dialogs, {
    mac: false,
    solo: false,
    canConfigure: () => host,
    document,
  });
  const text = () =>
    shortcuts.element.querySelector(".dialog-body")!.textContent;
  shortcuts.open();
  assert.equal(dialogs.current(), "shortcuts");
  assert.match(text()!, /^Keyboard shortcuts/);
  assert.ok(shortcuts.element.querySelectorAll(".shortcut-list").length >= 1);
  const guest = text();
  host = true;
  shortcuts.open();
  assert.notEqual(text(), guest);
});

function menuOptions(
  document: Document,
  over: Partial<MenuDialogOptions> = {},
): MenuDialogOptions {
  return {
    solo: true,
    isHost: () => false,
    playerId: () => "me",
    standings: () => [],
    linkDiagnostics: () => undefined,
    statsHidden: () => true,
    toggleStats: () => {},
    leave: async () => {},
    document,
    ...over,
  };
}

test("EXIT in a solo run: END RUN or KEEP PLAYING, with the session standings", async () => {
  const { document, dialogs, flush } = modules();
  let left = 0;
  const menu = createMenuDialog(
    dialogs,
    menuOptions(document, {
      standings: () => [
        {
          id: "b",
          name: "Bo",
          totalScoreUnits: 90,
          matchWins: 1,
          roundWins: 2,
        },
        {
          id: "me",
          name: "Me",
          totalScoreUnits: 120,
          matchWins: 0,
          roundWins: 1,
        },
        {
          id: "a",
          name: "Al",
          totalScoreUnits: 90,
          matchWins: 1,
          roundWins: 1,
        },
      ],
      leave: async () => {
        left++;
      },
    }),
  );
  assert.equal(menu.element.getAttribute("aria-label"), "Exit");
  menu.open();
  assert.equal(dialogs.current(), "menu");
  const body = menu.element.querySelector(".dialog-body")!;
  assert.equal(
    body.querySelector("p")?.textContent,
    "End this solo run and go back to the menu?",
  );
  assert.deepEqual(
    [...body.querySelectorAll(".session-row")].map((row) => row.textContent),
    [
      "#1Me (you)2 PTS0 MATCHES · 1 ROUND",
      "#2Al1.5 PTS1 MATCH · 1 ROUND",
      "#2Bo1.5 PTS1 MATCH · 2 ROUNDS",
    ],
  );
  assert.equal(
    body.querySelector(".is-you")?.textContent?.startsWith("#1"),
    true,
  );
  assert.equal(
    body.querySelector(".link-diagnostics"),
    null,
    "solo has no link",
  );
  const [stay, leave] = [
    ...body.querySelectorAll(".exit-choices button"),
  ] as HTMLButtonElement[];
  assert.deepEqual(
    [stay!.textContent, leave!.textContent],
    ["KEEP PLAYING", "END RUN"],
  );
  await press(leave!);
  assert.equal(left, 1);
  assert.equal(leave!.textContent, "LEAVING…");
  assert.equal(leave!.disabled && stay!.disabled, true);
  press(stay!);
  flush();
  assert.equal(dialogs.current(), undefined);
});

test("ROOM in a room: the host ends it for everyone, and the network stats toggle closes the menu", () => {
  const { document, dialogs, flush } = modules();
  let host = true,
    hidden = true;
  const menu = createMenuDialog(
    dialogs,
    menuOptions(document, {
      solo: false,
      isHost: () => host,
      linkDiagnostics: () => "peer a: direct",
      statsHidden: () => hidden,
      toggleStats: () => {
        hidden = !hidden;
      },
    }),
  );
  assert.equal(menu.element.getAttribute("aria-label"), "Room");
  menu.open();
  const body = menu.element.querySelector(".dialog-body")!;
  assert.equal(
    body.querySelector("p")?.textContent,
    "End this room for everyone?",
  );
  assert.equal(body.querySelector(".exit-confirm")?.textContent, "END ROOM");
  assert.equal(body.querySelector(".session-board"), null, "no standings yet");
  assert.equal(
    body.querySelector(".link-diagnostics")?.textContent,
    "peer a: direct",
  );
  const toggle = [...body.querySelectorAll(":scope > button")].find((button) =>
    button.textContent!.includes("NETWORK STATS"),
  ) as HTMLButtonElement;
  assert.equal(toggle.textContent, "SHOW NETWORK STATS");
  press(toggle);
  flush();
  assert.equal(hidden, false);
  assert.equal(dialogs.current(), undefined);
  host = false;
  menu.open();
  assert.equal(body.querySelector("p")?.textContent, "Leave this room?");
  assert.equal(body.querySelector(".exit-confirm")?.textContent, "LEAVE ROOM");
  assert.equal(
    [...body.querySelectorAll(":scope > button")].some(
      (button) => button.textContent === "HIDE NETWORK STATS",
    ),
    true,
  );
  dialogs.close("menu"); // lets the diagnostics refresh stop at its next tick
});

test("session standings sort by points, then match wins, then name", () => {
  const rows = [
    { id: "1", name: "Cy", totalScoreUnits: 60, matchWins: 0, roundWins: 0 },
    { id: "2", name: "Bo", totalScoreUnits: 60, matchWins: 1, roundWins: 0 },
    { id: "3", name: "Al", totalScoreUnits: 60, matchWins: 0, roundWins: 0 },
    { id: "4", name: "Di", totalScoreUnits: 120, matchWins: 0, roundWins: 0 },
  ];
  assert.deepEqual(
    sortedStandings(rows).map((row) => row.name),
    ["Di", "Bo", "Al", "Cy"],
  );
  assert.equal(rows[0]!.name, "Cy", "the input is not reordered");
});
