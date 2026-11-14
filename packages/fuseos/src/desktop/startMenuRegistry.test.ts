import type { WindowCommands } from "../windows/useWindowCommands";

import type { StartMenuRegistration } from "./startMenuRegistry";
import {
  registrationsFor,
  START_MENU_REGISTRATIONS,
} from "./startMenuRegistry";

describe("START_MENU_REGISTRATIONS", () => {
  it("has a unique id, a label and an icon for every entry", () => {
    const ids = START_MENU_REGISTRATIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    START_MENU_REGISTRATIONS.forEach((entry) => {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.icon.length).toBeGreaterThan(0);
    });
  });

  it("lists the accessories, Fusteam, the Retro Games folder and the screen saver, with Notepad++ and My Computer disabled until their package lands", () => {
    expect(
      START_MENU_REGISTRATIONS.map((entry) => [
        entry.slot,
        entry.id,
        !!entry.open,
      ]),
    ).toEqual([
      ["accessories", "paint", true],
      ["accessories", "winamp", true],
      ["accessories", "notepadpp", false],
      ["accessories", "wallpaper", true],
      ["programs", "fusteam", true],
      ["retro-games", "retro-folder", true],
      ["my-computer", "my-computer", false],
      ["settings", "screensaver", true],
    ]);
  });

  function recordingCommands(): WindowCommands & { opened: unknown[] } {
    const opened: unknown[] = [];
    return {
      opened,
      open: (content, options) => {
        opened.push(options === undefined ? content : [content, options]);
      },
      close: () => undefined,
      focus: () => undefined,
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      showError: () => undefined,
      showInfo: () => undefined,
    };
  }

  it("opens each registered program through the window commands", () => {
    const commands = recordingCommands();
    START_MENU_REGISTRATIONS.forEach((entry) =>
      entry.open?.(commands, { width: 1280, height: 800 }),
    );
    expect(commands.opened).toEqual([
      { kind: "paint" },
      { kind: "winamp" },
      { kind: "wallpaper" },
      [{ kind: "launcher" }, { id: "launcher", maximized: false }],
      { kind: "retroFolder" },
      { kind: "controlpanel", applet: "display", tab: "screensaver" },
    ]);
  });

  it("opens Fusteam maximized on a display it would not fit", () => {
    const commands = recordingCommands();
    const fusteam = START_MENU_REGISTRATIONS.find(
      (entry) => entry.id === "fusteam",
    );
    fusteam?.open?.(commands, { width: 390, height: 844 });
    expect(commands.opened).toEqual([
      [{ kind: "launcher" }, { id: "launcher", maximized: true }],
    ]);
  });
});

describe(registrationsFor.name, () => {
  const entries: StartMenuRegistration[] = [
    { slot: "games", id: "z", label: "Z", icon: "games" },
    { slot: "games", id: "b", label: "B", icon: "games", order: 20 },
    { slot: "help", id: "h", label: "H", icon: "help", order: 1 },
    { slot: "games", id: "a", label: "A", icon: "games", order: 10 },
    { slot: "games", id: "y", label: "Y", icon: "games" },
    { slot: "games", id: "c", label: "C", icon: "games", order: 20 },
  ];

  it("keeps one slot, ordered entries first by order then list order, unordered ones after in list order", () => {
    expect(registrationsFor(entries, "games").map((entry) => entry.id)).toEqual(
      ["a", "b", "c", "z", "y"],
    );
    expect(registrationsFor(entries, "help").map((entry) => entry.id)).toEqual([
      "h",
    ]);
    expect(registrationsFor(entries, "settings")).toEqual([]);
  });
});
