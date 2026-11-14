import { createTestGames } from "../__mocks__/renderWithProviders";
import {
  EXPLORER_WINDOW_SIZE,
  NOTEPADPP_WINDOW_SIZE,
  windowMeta,
} from "../desktop/windowMeta";
import {
  isWindowState,
  parseAppState,
  serializeAppState,
} from "../state/appState";
import type { AppState, WindowState } from "../state/appState";

import { MY_COMPUTER } from "./diskPath";

const base = { id: "w1", minimized: false, maximized: false };

describe("the disk's window kinds", () => {
  it("validate their stored shape", () => {
    expect(
      isWindowState({ ...base, kind: "explorer", location: "C:/docs" }),
    ).toBe(true);
    expect(isWindowState({ ...base, kind: "explorer" })).toBe(false);
    expect(
      isWindowState({
        ...base,
        kind: "notepadpp",
        paths: ["a.ts"],
        activePath: "a.ts",
      }),
    ).toBe(true);
    expect(isWindowState({ ...base, kind: "notepadpp", paths: [] })).toBe(true);
    expect(isWindowState({ ...base, kind: "notepadpp", paths: [1] })).toBe(
      false,
    );
    expect(
      isWindowState({
        ...base,
        kind: "notepadpp",
        paths: ["a"],
        activePath: 2,
      }),
    ).toBe(false);
    // Pictures open in Paint, not a window kind of their own.
    expect(isWindowState({ ...base, kind: "imageviewer", path: "x.png" })).toBe(
      false,
    );
  });

  it("survive a round trip through storage", () => {
    const state: AppState = {
      version: 1,
      windows: [
        { ...base, kind: "explorer", location: "A:/porn" },
        {
          ...base,
          id: "w2",
          kind: "notepadpp",
          paths: ["README.md"],
          activePath: "README.md",
        },
        {
          ...base,
          id: "w3",
          kind: "paint",
          fileName: "logo.png",
          sourceUrl: "memory://x/logo.png",
        },
      ],
    };
    expect(parseAppState(serializeAppState(state))).toEqual(state);
  });

  it("have titles, icons and sizes", () => {
    const games = createTestGames();
    const meta = (window: WindowState) => windowMeta(window, games);
    expect(meta({ ...base, kind: "explorer", location: MY_COMPUTER })).toEqual({
      title: "My Computer",
      icon: "computer",
      resizable: true,
      size: EXPLORER_WINDOW_SIZE,
    });
    expect(
      meta({ ...base, kind: "explorer", location: "C:/packages" }),
    ).toMatchObject({
      title: "Exploring - C:\\packages",
      icon: "explorer",
    });
    expect(
      meta({
        ...base,
        kind: "notepadpp",
        paths: ["a/b.ts", "c.md"],
        activePath: "a/b.ts",
      }),
    ).toEqual({
      title: "b.ts - Notepad++",
      icon: "notepadpp",
      resizable: true,
      size: NOTEPADPP_WINDOW_SIZE,
    });
    expect(
      meta({ ...base, kind: "notepadpp", paths: ["a/b.ts", "c.md"] }).title,
    ).toBe("c.md - Notepad++");
    expect(meta({ ...base, kind: "notepadpp", paths: [] }).title).toBe(
      "new 1 - Notepad++",
    );
  });
});
