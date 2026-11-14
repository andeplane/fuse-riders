import { act, renderHook } from "@testing-library/react";

import {
  createTestGames,
  createWrapper,
} from "../__mocks__/renderWithProviders";
import type { WindowContent } from "../state/appState";

import { MemoryRecentRoomsStore } from "./recentRooms";
import type { RoomLauncher } from "./roomLauncher";
import { createRoomLauncher, useRoomLauncher } from "./roomLauncher";

const NOW = Date.UTC(1998, 5, 25, 12, 34);

function launcherWith(launch: "window" | "tab") {
  const opened: Array<[WindowContent, string | undefined]> = [];
  const openExternal = vi.fn();
  const recentRooms = new MemoryRecentRoomsStore();
  const launcher = createRoomLauncher({
    games: createTestGames(),
    launch: () => launch,
    commands: { open: (content, id) => opened.push([content, id]) },
    openExternal,
    recentRooms,
    now: () => NOW,
  });
  return { launcher, opened, openExternal, recentRooms };
}

describe(createRoomLauncher.name, () => {
  it("opens a room window on this desktop and remembers the room", () => {
    const { launcher, opened, openExternal, recentRooms } =
      launcherWith("window");
    expect(launcher.join({ gameId: "fuseball", code: "AB42" })).toEqual({
      ok: true,
      launch: "window",
    });
    expect(opened).toEqual([
      [{ kind: "roomgame", gameId: "fuseball", code: "AB42" }, undefined],
    ]);
    expect(openExternal).not.toHaveBeenCalled();
    expect(recentRooms.list()).toEqual([
      { gameId: "fuseball", code: "AB42", lastSeen: NOW },
    ]);
  });

  it("opens the game's page with ?room= in a tab when that is the preference", () => {
    const { launcher, opened, openExternal } = launcherWith("tab");
    expect(launcher.join({ gameId: "fuse-riders", code: "CD07" })).toEqual({
      ok: true,
      launch: "tab",
    });
    expect(openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuse-riders/?room=CD07",
    );
    expect(opened).toEqual([]);
  });

  it("refuses a game that is not installed without remembering anything", () => {
    const { launcher, opened, openExternal, recentRooms } =
      launcherWith("window");
    expect(launcher.join({ gameId: "pong", code: "AB42" })).toEqual({
      ok: false,
      reason: "unknown-game",
    });
    expect(opened).toEqual([]);
    expect(openExternal).not.toHaveBeenCalled();
    expect(recentRooms.list()).toEqual([]);
  });
});

describe(useRoomLauncher.name, () => {
  it("builds the launcher over the OS's own launch preference and the desktop's tab opener", () => {
    const context = createWrapper();
    context.prefsStore.set({ gameLaunch: "tab" });
    const { result } = renderHook(() => useRoomLauncher(), {
      wrapper: context.Wrapper,
    });
    act(() => {
      result.current.join({ gameId: "fuseball", code: "AB42" });
    });
    expect(context.desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/?room=AB42",
    );
    expect(context.recentRooms.list().map((room) => room.code)).toEqual([
      "AB42",
    ]);
  });

  it("defaults to a window on a wide mouse-driven desktop and stores the room window", () => {
    const context = createWrapper();
    const { result } = renderHook(() => useRoomLauncher(), {
      wrapper: context.Wrapper,
    });
    act(() => {
      result.current.join({ gameId: "fuseball", code: "AB42" });
    });
    expect(context.desktopDeps.openExternal).not.toHaveBeenCalled();
    expect(context.store.load().windows.map((window) => window.kind)).toEqual([
      "roomgame",
    ]);
  });

  it("defaults to a tab on a touch device", () => {
    const context = createWrapper({
      networkDeps: { finePointer: () => false },
    });
    const { result } = renderHook(() => useRoomLauncher(), {
      wrapper: context.Wrapper,
    });
    act(() => {
      result.current.join({ gameId: "fuseball", code: "AB42" });
    });
    expect(context.desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/?room=AB42",
    );
  });

  it("hands over to an injected launcher untouched", () => {
    const injected: RoomLauncher = {
      join: vi.fn(() => ({ ok: true, launch: "window" }) as const),
    };
    const context = createWrapper({ roomLauncher: injected });
    const { result } = renderHook(() => useRoomLauncher(), {
      wrapper: context.Wrapper,
    });
    expect(result.current).toBe(injected);
  });
});
