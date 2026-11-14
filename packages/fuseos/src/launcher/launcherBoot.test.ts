import type { AppState, WindowState } from "../state/appState";
import { activeWindowId, DEFAULT_STATE } from "../state/appState";
import { MemoryStateStore } from "../state/stateStore";

import {
  withBootWindows,
  withLauncherOnBoot,
  withLauncherOnTop,
} from "./launcherBoot";
import { LAUNCHER_WINDOW_ID } from "./launcherFacts";

const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const window = (id: string, content: Partial<WindowState> = {}): WindowState =>
  ({
    id,
    kind: "paint",
    minimized: false,
    maximized: false,
    ...content,
  }) as WindowState;

describe(withLauncherOnTop.name, () => {
  it("adds the one launcher window on top of an empty desktop, restored on a laptop", () => {
    const state = withLauncherOnTop(DEFAULT_STATE, LAPTOP);
    expect(state.windows).toEqual([
      {
        id: LAUNCHER_WINDOW_ID,
        kind: "launcher",
        minimized: false,
        maximized: false,
      },
    ]);
    expect(activeWindowId(state)).toBe(LAUNCHER_WINDOW_ID);
  });

  it("opens maximized on a phone", () => {
    expect(withLauncherOnTop(DEFAULT_STATE, PHONE).windows[0]).toMatchObject({
      kind: "launcher",
      maximized: true,
    });
  });

  it("puts the launcher above the stored windows", () => {
    const stored: AppState = {
      version: 1,
      windows: [window("w1"), window("w2", { kind: "winamp" })],
      assistantHidden: true,
    };
    const state = withLauncherOnTop(stored, LAPTOP);
    expect(state.windows.map((item) => item.id)).toEqual([
      "w1",
      "w2",
      LAUNCHER_WINDOW_ID,
    ]);
    expect(state.assistantHidden).toBe(true);
  });

  it("focuses a stored launcher instead of adding a second, keeping its size state", () => {
    const stored: AppState = {
      version: 1,
      windows: [
        window(LAUNCHER_WINDOW_ID, {
          kind: "launcher",
          minimized: true,
          maximized: true,
        }),
        window("w1"),
      ],
    };
    const state = withLauncherOnTop(stored, LAPTOP);
    expect(state.windows.map((item) => item.id)).toEqual([
      "w1",
      LAUNCHER_WINDOW_ID,
    ]);
    expect(state.windows[1]).toMatchObject({
      minimized: false,
      maximized: true,
    });
    expect(activeWindowId(state)).toBe(LAUNCHER_WINDOW_ID);
  });

  it("recognises a launcher a deep link opened under a generated id", () => {
    const stored: AppState = {
      version: 1,
      windows: [window("w1", { kind: "launcher" }), window("w2")],
    };
    const state = withLauncherOnTop(stored, LAPTOP);
    expect(state.windows.map((item) => item.id)).toEqual(["w2", "w1"]);
    expect(
      state.windows.filter((item) => item.kind === "launcher"),
    ).toHaveLength(1);
  });
});

describe(withBootWindows.name, () => {
  it("opens Winamp with the launcher focused above it on an empty desktop", () => {
    const state = withBootWindows(DEFAULT_STATE, LAPTOP);
    expect(state.windows).toEqual([
      { id: "w1", kind: "winamp", minimized: false, maximized: false },
      {
        id: LAUNCHER_WINDOW_ID,
        kind: "launcher",
        minimized: false,
        maximized: false,
      },
    ]);
    expect(activeWindowId(state)).toBe(LAUNCHER_WINDOW_ID);
  });

  it("brings up the stored Winamp and launcher instead of adding second ones, above the other windows", () => {
    const stored: AppState = {
      version: 1,
      windows: [
        window("w3", { kind: "winamp", minimized: true }),
        window(LAUNCHER_WINDOW_ID, { kind: "launcher" }),
        window("w1"),
      ],
    };
    const state = withBootWindows(stored, LAPTOP);
    expect(state.windows.map((item) => [item.id, item.minimized])).toEqual([
      ["w1", false],
      ["w3", false],
      [LAUNCHER_WINDOW_ID, false],
    ]);
    // Booting again changes nothing: one of each.
    expect(withBootWindows(state, LAPTOP)).toEqual(state);
  });

  it("boots a phone with the launcher alone, maximized", () => {
    expect(withBootWindows(DEFAULT_STATE, PHONE).windows).toEqual([
      {
        id: LAUNCHER_WINDOW_ID,
        kind: "launcher",
        minimized: false,
        maximized: true,
      },
    ]);
  });
});

describe(withLauncherOnBoot.name, () => {
  it("decorates load and passes save through untouched", () => {
    const inner = new MemoryStateStore({
      version: 1,
      windows: [window("w1")],
    });
    const store = withLauncherOnBoot(inner, () => LAPTOP);
    const loaded = store.load();
    expect(loaded.windows.map((item) => item.id)).toEqual([
      "w1",
      "w2",
      LAUNCHER_WINDOW_ID,
    ]);
    expect(loaded.windows[1]).toMatchObject({ kind: "winamp" });
    const closed: AppState = { version: 1, windows: [window("w1")] };
    store.save(closed);
    expect(inner.saved).toBe(1);
    expect(inner.load()).toEqual(closed);
    // The next boot brings them back.
    expect(store.load().windows.map((item) => item.kind)).toEqual([
      "paint",
      "winamp",
      "launcher",
    ]);
  });
});
