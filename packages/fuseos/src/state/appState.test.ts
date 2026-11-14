import type { AppState, WindowState } from "./appState";
import {
  activeWindowId,
  appStateReducer,
  DEFAULT_STATE,
  isAppState,
  isControlPanelApplet,
  mergeInstance,
  nextWindowId,
  parseAppState,
  sameInstance,
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

  it("keeps single-instance programs to one window and focuses it instead", () => {
    const state = open(open(DEFAULT_STATE, "winamp"), "paint");
    const again = open(state, "winamp");
    expect(again.windows.map((window) => window.kind)).toEqual([
      "paint",
      "winamp",
    ]);
    expect(activeWindowId(again)).toBe("w1");
    const minimized = appStateReducer(again, { type: "minimize", id: "w1" });
    expect(open(minimized, "winamp").windows[1]?.minimized).toBe(false);
  });

  it("opens Paint and dialogs as often as asked, but one window per game and per applet", () => {
    const twoPaints = open(open(DEFAULT_STATE, "paint"), "paint");
    expect(twoPaints.windows).toHaveLength(2);
    const dialog = {
      kind: "dialog",
      title: "T",
      message: "M",
      icon: "info",
    } as const;
    const twoDialogs = appStateReducer(
      appStateReducer(DEFAULT_STATE, { type: "open", content: dialog }),
      { type: "open", content: dialog },
    );
    expect(twoDialogs.windows).toHaveLength(2);

    const games = open(open(DEFAULT_STATE, "fusegame"), "fusegame");
    expect(games.windows).toHaveLength(1);
    const retro = { kind: "retro", game: "doom" } as const;
    const retros = appStateReducer(
      appStateReducer(
        appStateReducer(DEFAULT_STATE, { type: "open", content: retro }),
        { type: "open", content: retro },
      ),
      { type: "open", content: { kind: "retro", game: "skifree" } },
    );
    expect(
      retros.windows.map((window) => window.kind === "retro" && window.game),
    ).toEqual(["doom", "skifree"]);
    const display = { kind: "controlpanel", applet: "display" } as const;
    const applets = appStateReducer(
      appStateReducer(
        appStateReducer(DEFAULT_STATE, { type: "open", content: display }),
        { type: "open", content: display },
      ),
      { type: "open", content: { kind: "controlpanel", applet: "games" } },
    );
    expect(applets.windows).toHaveLength(2);
    expect(sameInstance({ kind: "about" }, { kind: "about" })).toBe(true);
    const explorer = { kind: "explorer", location: "C:" } as const;
    expect(sameInstance(explorer, explorer)).toBe(true);
    expect(sameInstance(explorer, { kind: "explorer", location: "A:" })).toBe(
      false,
    );

    expect(sameInstance({ kind: "wallpaper" }, { kind: "about" })).toBe(false);
    expect(sameInstance({ kind: "retroFolder" }, { kind: "retroFolder" })).toBe(
      true,
    );
    expect(sameInstance({ kind: "launcher" }, { kind: "launcher" })).toBe(true);
    expect(sameInstance({ kind: "launcher" }, { kind: "about" })).toBe(false);
  });

  it("opens under a fixed id and maximized when asked, and still keeps the launcher to one window", () => {
    const launcher = { kind: "launcher" } as const;
    const options = { id: "launcher", maximized: true };
    const booted = appStateReducer(open(DEFAULT_STATE, "paint"), {
      type: "open",
      content: launcher,
      options,
    });
    expect(booted.windows[1]).toEqual({
      id: "launcher",
      kind: "launcher",
      minimized: false,
      maximized: true,
    });
    // Again by id: focused, not duplicated, and its size state is its own.
    const again = appStateReducer(
      appStateReducer(booted, { type: "toggleMaximize", id: "launcher" }),
      { type: "open", content: launcher, options },
    );
    expect(again.windows.map((window) => window.id)).toEqual([
      "w1",
      "launcher",
    ]);
    expect(again.windows[1]?.maximized).toBe(false);
    // A launcher a deep link once stored under a generated id counts as the same window.
    const stored = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: launcher,
    });
    const reopened = appStateReducer(stored, {
      type: "open",
      content: launcher,
      options,
    });
    expect(reopened.windows.map((window) => window.id)).toEqual(["w1"]);
    // A new window under an explicit id that nothing holds yet.
    const named = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: { kind: "paint" },
      options: { id: "sketch" },
    });
    expect(named.windows[0]).toMatchObject({
      id: "sketch",
      kind: "paint",
      maximized: false,
    });
  });

  it("re-opens the Display dialog on the tab asked for and adds files to the one Notepad++ as tabs", () => {
    const display = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: { kind: "controlpanel", applet: "display" },
    });
    const onTab = appStateReducer(display, {
      type: "open",
      content: { kind: "controlpanel", applet: "display", tab: "screensaver" },
    });
    expect(onTab.windows).toEqual([
      { ...display.windows[0], tab: "screensaver" },
    ]);
    // Without a tab the window is left on whichever tab it shows.
    expect(
      appStateReducer(onTab, {
        type: "open",
        content: { kind: "controlpanel", applet: "display" },
      }).windows,
    ).toEqual(onTab.windows);

    const notepad = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: {
        kind: "notepadpp",
        paths: ["README.md"],
        activePath: "README.md",
      },
    });
    const more = appStateReducer(notepad, {
      type: "open",
      content: { kind: "notepadpp", paths: ["README.md", "AGENTS.md"] },
    });
    expect(more.windows).toHaveLength(1);
    expect(more.windows[0]).toMatchObject({
      paths: ["README.md", "AGENTS.md"],
      activePath: "README.md",
    });
    expect(mergeInstance(paint("w1"), { kind: "paint" })).toEqual(paint("w1"));
  });

  it("re-focuses an existing window when opened with the same id", () => {
    const state = open(open(DEFAULT_STATE, "paint"), "winamp");
    const again = appStateReducer(state, {
      type: "open",
      content: { kind: "paint" },
      options: { id: "w1" },
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
    expect(
      isAppState(
        window({ kind: "controlpanel", applet: "display", tab: "screensaver" }),
      ),
    ).toBe(true);
    expect(
      isAppState(window({ kind: "controlpanel", applet: "display", tab: 3 })),
    ).toBe(false);
    expect(isAppState(window({ kind: "controlpanel", applet: "users" }))).toBe(
      false,
    );
    expect(isAppState(window({ kind: "wallpaper" }))).toBe(true);
    expect(isAppState(window({ kind: "about" }))).toBe(true);
    expect(isAppState(window({ kind: "winamp" }))).toBe(true);
    expect(isAppState(window({ kind: "launcher" }))).toBe(true);
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
