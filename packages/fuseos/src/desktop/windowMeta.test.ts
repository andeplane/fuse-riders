import { createTestGames } from "../__mocks__/renderWithProviders";
import { LAUNCHER_WINDOW_SIZE } from "../launcher/launcherFacts";
import type { WindowContent, WindowState } from "../state/appState";

import {
  FUSE_GAME_WINDOW_SIZE,
  NAPSTER_WINDOW_SIZE,
  NETWORK_WINDOW_SIZE,
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
  it("names a Fuse game window after the game with its icon, falling back to the id and the generic icon", () => {
    expect(
      windowMeta(window({ kind: "fusegame", gameId: "fuseball" }), games),
    ).toEqual({
      title: "Fuseball",
      icon: {
        kind: "image",
        src: "/fuse-riders/fuseos/game-icons/fuseball.png",
        smallSrc: "/fuse-riders/fuseos/game-icons/fuseball-16.png",
      },
      resizable: true,
      size: FUSE_GAME_WINDOW_SIZE,
    });
    expect(
      windowMeta(window({ kind: "fusegame", gameId: "fuse-riders" }), games),
    ).toMatchObject({ title: "Fuse Riders", icon: "fusegame" });
    expect(
      windowMeta(window({ kind: "fusegame", gameId: "gone" }), games),
    ).toMatchObject({ title: "gone", icon: "fusegame" });
  });

  it("names a room window after the game and the room, and the Network Neighborhood after itself", () => {
    expect(
      windowMeta(
        window({ kind: "roomgame", gameId: "fuseball", code: "AB42" }),
        games,
      ),
    ).toEqual({
      title: "Fuseball - Room AB42",
      icon: "network",
      resizable: true,
      size: FUSE_GAME_WINDOW_SIZE,
    });
    expect(
      windowMeta(
        window({ kind: "roomgame", gameId: "gone", code: "AB42" }),
        games,
      ).title,
    ).toBe("gone - Room AB42");
    expect(windowMeta(window({ kind: "network" }), games)).toEqual({
      title: "Network Neighborhood",
      icon: "network",
      resizable: true,
      size: NETWORK_WINDOW_SIZE,
    });
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
    expect(windowMeta(window({ kind: "launcher" }), games)).toEqual({
      title: "Fusteam",
      icon: "fusteam",
      resizable: true,
      size: LAUNCHER_WINDOW_SIZE,
    });
    expect(windowMeta(window({ kind: "napster" }), games)).toEqual({
      title: "Napster v2.0 BETA 7",
      icon: "napster",
      resizable: true,
      size: NAPSTER_WINDOW_SIZE,
    });
  });
});
