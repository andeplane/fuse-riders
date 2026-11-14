import { createTestGames } from "../__mocks__/renderWithProviders";
import {
  MEDIA_PLAYER_WINDOW_SIZE,
  RECYCLE_BIN_WINDOW_SIZE,
  windowMeta,
} from "../desktop/windowMeta";
import type { WindowContent, WindowState } from "../state/appState";
import { isWindowState, parseAppState } from "../state/appState";
import { deepLinkContents } from "../state/deepLink";

const games = createTestGames();
const window = (content: WindowContent): WindowState => ({
  id: "w1",
  minimized: false,
  maximized: false,
  ...content,
});

describe("Recycle Bin and Media Player registration", () => {
  it("gives the two windows their title, icon and size", () => {
    expect(windowMeta(window({ kind: "recyclebin" }), games)).toEqual({
      title: "Recycle Bin",
      icon: "recycle",
      resizable: true,
      size: RECYCLE_BIN_WINDOW_SIZE,
    });
    expect(
      windowMeta(
        window({ kind: "mediaplayer", file: "clip.avi", launches: "x" }),
        games,
      ),
    ).toEqual({
      title: "clip.avi - Windows Media Player",
      icon: "mediaplayer",
      resizable: false,
      size: MEDIA_PLAYER_WINDOW_SIZE,
    });
  });

  it("validates stored windows of both kinds", () => {
    expect(isWindowState(window({ kind: "recyclebin" }))).toBe(true);
    expect(isWindowState(window({ kind: "mediaplayer", file: "a.avi" }))).toBe(
      true,
    );
    expect(
      isWindowState(
        window({ kind: "mediaplayer", file: "a.avi", launches: "fuse-volley" }),
      ),
    ).toBe(true);
    expect(
      isWindowState({ ...window({ kind: "recyclebin" }), kind: "mediaplayer" }),
    ).toBe(false);
    expect(
      isWindowState({
        ...window({ kind: "mediaplayer", file: "a.avi" }),
        file: "",
      }),
    ).toBe(false);
    expect(
      isWindowState({
        ...window({ kind: "mediaplayer", file: "a.avi" }),
        launches: 7,
      }),
    ).toBe(false);
    const stored = parseAppState(
      JSON.stringify({
        version: 1,
        windows: [window({ kind: "mediaplayer", file: "a.avi" })],
      }),
    );
    expect(stored.windows).toHaveLength(1);
  });

  it("opens the bin from ?open=recyclebin", () => {
    expect(deepLinkContents(["recyclebin"], games)).toEqual([
      { kind: "recyclebin" },
    ]);
  });
});
