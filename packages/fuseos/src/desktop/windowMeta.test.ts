import { createTestGames } from "../__mocks__/renderWithProviders";
import type { WindowContent, WindowState } from "../state/appState";

import {
  FUSE_GAME_WINDOW_SIZE,
  PAINT_WINDOW_SIZE,
  WINAMP_WINDOW_SIZE,
  windowMeta,
} from "./windowMeta";

const games = createTestGames();
const window = (content: WindowContent): WindowState => ({
  id: "w1",
  minimized: false,
  maximized: false,
  ...content,
});

describe(windowMeta.name, () => {
  it("names a Fuse game window after the game, falling back to the id", () => {
    expect(
      windowMeta(window({ kind: "fusegame", gameId: "fuseball" }), games),
    ).toEqual({
      title: "Fuseball",
      icon: "fusegame",
      resizable: true,
      size: FUSE_GAME_WINDOW_SIZE,
    });
    expect(
      windowMeta(window({ kind: "fusegame", gameId: "gone" }), games).title,
    ).toBe("gone");
  });

  it("gives each retro game its own icon and size", () => {
    const doom = windowMeta(window({ kind: "retro", game: "doom" }), games);
    expect(doom).toMatchObject({
      title: "DOOM",
      icon: "doom",
      resizable: true,
    });
    expect(
      windowMeta(window({ kind: "retro", game: "solitaire" }), games).icon,
    ).toBe("solitaire");
  });

  it("describes the apps and dialogs", () => {
    expect(windowMeta(window({ kind: "paint" }), games)).toEqual({
      title: "untitled - Paint",
      icon: "paint",
      resizable: true,
      size: PAINT_WINDOW_SIZE,
    });
    expect(
      windowMeta(window({ kind: "paint", fileName: "cat.png" }), games).title,
    ).toBe("cat.png - Paint");
    expect(windowMeta(window({ kind: "winamp" }), games)).toMatchObject({
      title: "Winamp",
      resizable: false,
      size: WINAMP_WINDOW_SIZE,
    });
    expect(
      windowMeta(window({ kind: "controlpanel", applet: "home" }), games),
    ).toEqual({
      title: "Control Panel",
      icon: "settings",
      resizable: true,
    });
    expect(windowMeta(window({ kind: "wallpaper" }), games).resizable).toBe(
      false,
    );
    expect(windowMeta(window({ kind: "about" }), games).title).toBe(
      "About FuseOS",
    );
    expect(
      windowMeta(
        window({
          kind: "dialog",
          title: "Oops",
          message: "m",
          icon: "warning",
        }),
        games,
      ),
    ).toEqual({ title: "Oops", icon: "warning", resizable: false });
  });
});
