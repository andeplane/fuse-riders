import type { AppState, WindowState } from "./appState";
import {
  activeWindowId,
  appStateReducer,
  DEFAULT_STATE,
  isAppState,
  isControlPanelApplet,
  nextWindowId,
  parseAppState,
  serializeAppState,
} from "./appState";

const paint = (id: string): WindowState => ({
  id,
  kind: "paint",
  minimized: false,
  maximized: false,
});

function open(state: AppState, content: WindowState["kind"]): AppState {
  switch (content) {
    case "paint":
      return appStateReducer(state, {
        type: "open",
        content: { kind: "paint" },
      });
    case "winamp":
      return appStateReducer(state, {
        type: "open",
        content: { kind: "winamp" },
      });
    default:
      return appStateReducer(state, {
        type: "open",
        content: { kind: "fusegame", gameId: "fuseball" },
      });
  }
}

describe("DEFAULT_STATE", () => {
  it("has no open windows and leaves the assistant shown", () => {
    expect(DEFAULT_STATE).toEqual({ version: 1, windows: [] });
    expect(activeWindowId(DEFAULT_STATE)).toBeNull();
  });
});

describe(appStateReducer.name, () => {
  it("opens windows with incrementing ids and focuses the newest", () => {
    const state = open(open(DEFAULT_STATE, "paint"), "winamp");
    expect(state.windows.map((window) => window.id)).toEqual(["w1", "w2"]);
    expect(activeWindowId(state)).toBe("w2");
    expect(nextWindowId(state.windows)).toBe("w3");
  });

  it("re-focuses an existing window when opened with the same id", () => {
    const state = open(open(DEFAULT_STATE, "paint"), "winamp");
    const again = appStateReducer(state, {
      type: "open",
      content: { kind: "paint" },
      id: "w1",
    });
    expect(again.windows.map((window) => window.id)).toEqual(["w2", "w1"]);
  });

  it("focus moves a window to the top and restores it", () => {
    let state = open(open(DEFAULT_STATE, "paint"), "winamp");
    state = appStateReducer(state, { type: "minimize", id: "w1" });
    expect(state.windows[0]?.minimized).toBe(true);
    state = appStateReducer(state, { type: "focus", id: "w1" });
    expect(state.windows.map((window) => window.id)).toEqual(["w2", "w1"]);
    expect(state.windows[1]?.minimized).toBe(false);
  });

  it("minimize keeps the window but makes the next one active", () => {
    const state = appStateReducer(
      open(open(DEFAULT_STATE, "paint"), "winamp"),
      { type: "minimize", id: "w2" },
    );
    expect(state.windows).toHaveLength(2);
    expect(activeWindowId(state)).toBe("w1");
  });

  it("close removes the window and ignores unknown ids", () => {
    const state = open(DEFAULT_STATE, "paint");
    expect(appStateReducer(state, { type: "close", id: "w1" }).windows).toEqual(
      [],
    );
    expect(appStateReducer(state, { type: "close", id: "w9" })).toEqual(state);
    expect(appStateReducer(state, { type: "focus", id: "w9" })).toEqual(state);
  });

  it("toggles maximize and focuses", () => {
    let state = open(open(DEFAULT_STATE, "paint"), "winamp");
    state = appStateReducer(state, { type: "toggleMaximize", id: "w1" });
    expect(state.windows.map((window) => window.id)).toEqual(["w2", "w1"]);
    expect(state.windows[1]?.maximized).toBe(true);
    state = appStateReducer(state, { type: "toggleMaximize", id: "w1" });
    expect(state.windows[1]?.maximized).toBe(false);
  });

  it("patches a window", () => {
    const state = appStateReducer(open(DEFAULT_STATE, "paint"), {
      type: "patch",
      id: "w1",
      patch: (window) =>
        window.kind === "paint" ? { ...window, fileName: "cat.png" } : window,
    });
    expect(state.windows[0]).toMatchObject({
      kind: "paint",
      fileName: "cat.png",
    });
  });

  it("hides and shows the Office Assistant, leaving nothing in the state while shown", () => {
    const hidden = appStateReducer(DEFAULT_STATE, {
      type: "setAssistantHidden",
      hidden: true,
    });
    expect(hidden.assistantHidden).toBe(true);
    const shown = appStateReducer(hidden, {
      type: "setAssistantHidden",
      hidden: false,
    });
    expect("assistantHidden" in shown).toBe(false);
  });

  it("replaces the state", () => {
    const next: AppState = { version: 1, windows: [paint("w4")] };
    expect(
      appStateReducer(open(DEFAULT_STATE, "paint"), {
        type: "replace",
        state: next,
      }),
    ).toBe(next);
  });
});

describe(parseAppState.name, () => {
  it("returns the default for missing, malformed or invalid input", () => {
    expect(parseAppState(undefined)).toBe(DEFAULT_STATE);
    expect(parseAppState(null)).toBe(DEFAULT_STATE);
    expect(parseAppState("")).toBe(DEFAULT_STATE);
    expect(parseAppState("{not json")).toBe(DEFAULT_STATE);
    expect(parseAppState(JSON.stringify({ version: 2, windows: [] }))).toBe(
      DEFAULT_STATE,
    );
    expect(
      parseAppState(
        JSON.stringify({ version: 1, windows: [{ kind: "explorer" }] }),
      ),
    ).toBe(DEFAULT_STATE);
  });

  it("round trips a serialized state and drops dialogs", () => {
    let state = open(open(DEFAULT_STATE, "fusegame"), "paint");
    state = appStateReducer(state, {
      type: "open",
      content: {
        kind: "dialog",
        title: "Oops",
        message: "No",
        icon: "warning",
      },
    });
    state = appStateReducer(state, {
      type: "setAssistantHidden",
      hidden: true,
    });
    const parsed = parseAppState(serializeAppState(state));
    expect(parsed.windows.map((window) => window.kind)).toEqual([
      "fusegame",
      "paint",
    ]);
    expect(parsed.assistantHidden).toBe(true);
  });
});

describe(isAppState.name, () => {
  const window = (content: Record<string, unknown>) => ({
    version: 1,
    windows: [{ id: "w1", minimized: false, maximized: false, ...content }],
  });

  it("validates each window kind strictly", () => {
    expect(isAppState(window({ kind: "fusegame", gameId: "fuseball" }))).toBe(
      true,
    );
    expect(isAppState(window({ kind: "fusegame", gameId: "" }))).toBe(false);
    expect(isAppState(window({ kind: "retro", game: "doom" }))).toBe(true);
    expect(isAppState(window({ kind: "retro", game: "pong" }))).toBe(false);
    expect(isAppState(window({ kind: "controlpanel", applet: "games" }))).toBe(
      true,
    );
    expect(isAppState(window({ kind: "controlpanel", applet: "users" }))).toBe(
      false,
    );
    expect(isAppState(window({ kind: "wallpaper" }))).toBe(true);
    expect(isAppState(window({ kind: "about" }))).toBe(true);
    expect(isAppState(window({ kind: "winamp" }))).toBe(true);
    expect(
      isAppState(
        window({ kind: "dialog", title: "t", message: "m", icon: "info" }),
      ),
    ).toBe(true);
    expect(
      isAppState(
        window({ kind: "dialog", title: "t", message: "m", icon: "x" }),
      ),
    ).toBe(false);
    expect(isAppState(window({ kind: "paint" }))).toBe(true);
    expect(isAppState(window({ kind: "paint", fileName: "a.png" }))).toBe(true);
    expect(isAppState(window({ kind: "paint", fileName: 3 }))).toBe(false);
    expect(isAppState(window({ kind: "notepad" }))).toBe(false);
  });

  it("rejects a bad envelope", () => {
    expect(isAppState(null)).toBe(false);
    expect(isAppState({ version: 1 })).toBe(false);
    expect(
      isAppState({ version: 1, windows: [], assistantHidden: "yes" }),
    ).toBe(false);
    expect(isAppState({ version: 1, windows: [{ id: 1 }] })).toBe(false);
  });

  it("knows the Control Panel applets", () => {
    expect(isControlPanelApplet("display")).toBe(true);
    expect(isControlPanelApplet("home")).toBe(true);
    expect(isControlPanelApplet("screensaver")).toBe(false);
    expect(isControlPanelApplet(1)).toBe(false);
  });
});
