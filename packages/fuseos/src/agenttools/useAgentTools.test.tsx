import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import { createWrapper, PHONE_DEVICE } from "../__mocks__/renderWithProviders";
import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import { LAUNCHER_WINDOW_ID } from "../launcher/launcherFacts";

import type { RunPort } from "./agentOs";
import { AgentRunContext } from "./agentRunContext";
import { useAgentTools } from "./useAgentTools";

function renderAgent(options: ProviderOptions = {}, run?: RunPort) {
  const context = createWrapper(options);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <context.Wrapper>
      <AgentRunContext.Provider value={run}>
        {children}
      </AgentRunContext.Provider>
    </context.Wrapper>
  );
  const hook = renderHook(() => useAgentTools(), { wrapper });
  return { ...context, ...hook, os: () => hook.result.current.os };
}

describe(useAgentTools.name, () => {
  it("opens, lists and arranges the real desktop's windows", () => {
    const { os, store } = renderAgent();
    expect(os().windows.list()).toEqual([]);
    act(() => os().windows.open({ kind: "paint" }));
    act(() => os().windows.open({ kind: "explorer", location: "C:/docs" }));
    // The ports read the desktop as it is now, through the same `os` object.
    expect(os().windows.list()).toEqual([
      {
        id: "w1",
        kind: "paint",
        title: "untitled - Paint",
        minimized: false,
        maximized: false,
        focused: false,
      },
      {
        id: "w2",
        kind: "explorer",
        title: "Exploring - C:\\docs",
        minimized: false,
        maximized: false,
        focused: true,
      },
    ]);
    act(() => os().windows.minimize("w2"));
    act(() => os().windows.toggleMaximize("w1"));
    expect(
      os()
        .windows.list()
        .map((window) => [
          window.id,
          window.minimized,
          window.maximized,
          window.focused,
        ]),
    ).toEqual([
      ["w2", true, false, false],
      ["w1", false, true, true],
    ]);
    act(() => os().windows.focus("w2"));
    expect(os().windows.list().at(-1)).toMatchObject({
      id: "w2",
      focused: true,
    });
    act(() => os().windows.close("w1"));
    act(() => os().windows.showInfo("Clippy", "hello"));
    // A dialog is on the desktop but not in the stored one.
    expect(
      os()
        .windows.list()
        .map((window) => window.title),
    ).toEqual(["Exploring - C:\\docs", "Clippy"]);
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "explorer",
    ]);
  });

  it("opens the launcher under its own id, maximized on a display it does not fit", () => {
    const { os, store } = renderAgent();
    act(() => os().windows.open({ kind: "launcher" }));
    expect(store.load().windows).toMatchObject([
      { id: LAUNCHER_WINDOW_ID, kind: "launcher" },
    ]);
  });

  it("presses Start, and lists every program, game and retro game as a target", () => {
    const { os } = renderAgent();
    expect(os().startMenu.isOpen()).toBe(false);
    act(() => os().startMenu.setOpen(true));
    expect(os().startMenu.isOpen()).toBe(true);
    expect(os().targets.map((target) => target.id)).toEqual(
      expect.arrayContaining(["fuseball", "doom", "paint", "fusteam"]),
    );
    expect(os().games.fuse()[0]).toEqual({
      id: "fuseball",
      name: "Fuseball",
      tagline: "Five-a-side with rockets",
    });
    expect(os().games.retro()).toContainEqual({ id: "doom", name: "DOOM" });
  });

  it("starts a Fuse game the way the Games applet says, or the way asked, and reports the launch", () => {
    const { os, store, desktopDeps, osAnalytics } = renderAgent();
    expect(os().games.launchMode()).toBe("window");
    let mode = "";
    act(() => {
      mode = os().games.launch("fuseball");
    });
    expect(mode).toBe("window");
    act(() => {
      mode = os().games.launch("fuse-riders", "window");
    });
    // Asking for a window that is already open focuses it and reports nothing new.
    act(() => {
      os().games.launch("fuse-riders", "window");
    });
    act(() => {
      mode = os().games.launch("fuse-birds", "tab");
    });
    expect(mode).toBe("tab");
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuse-birds/",
    );
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "fusegame",
      "fusegame",
    ]);
    expect(osAnalytics.launches).toEqual([
      { game: "fuseball", launch: "window" },
      { game: "fuse-riders", launch: "window" },
      { game: "fuse-birds", launch: "tab" },
    ]);
    // An id the registry does not know goes the launcher's way: a window that explains itself.
    act(() => {
      os().games.launch("mystery", "tab");
    });
    expect(store.load().windows).toHaveLength(3);
  });

  it("follows the device default: a phone opens games in a tab", () => {
    const { os, desktopDeps } = renderAgent({ launchDevice: PHONE_DEVICE });
    expect(os().games.launchMode()).toBe("tab");
    act(() => {
      expect(os().games.launch("fuseball")).toBe("tab");
    });
    expect(desktopDeps.openExternal).toHaveBeenCalledTimes(1);
  });

  it("reads and writes files through the editor commands, on this browser's own drive", async () => {
    const { os, diskDeps, store } = renderAgent();
    expect(await os().editor.readFile("README.md")).toBe(
      "# Fuse Riders\n\nLight cycles for five.\n",
    );
    await act(() => os().editor.writeFile("README.md", "mine"));
    expect(await os().editor.listModified()).toEqual(["README.md"]);
    expect(await diskDeps.overlay.read("README.md")).toBe("mine");
    await act(() => os().editor.revert("README.md"));
    expect(await os().editor.listModified()).toEqual([]);
    act(() => os().editor.open("docs/notes.txt"));
    expect(store.load().windows).toMatchObject([
      { kind: "notepadpp", activePath: "docs/notes.txt" },
    ]);
    const docs = await os().disk.stat("C:/docs");
    expect(docs?.kind).toBe("folder");
  });

  it("opens Winamp and presses Play once it has loaded, then hands out its transport", () => {
    const { os, winampRegistry, store } = renderAgent();
    expect(os().music.controls()).toBeUndefined();
    act(() => os().music.openAndPlay());
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "winamp",
    ]);
    // Nothing renders the window in this harness, so the player registers by hand, as the window would.
    const pressed: string[] = [];
    const controls = {
      status: () => ({
        trackCount: 0,
        tracks: [],
        currentTrack: undefined,
        playing: false,
      }),
      play: () => pressed.push("play"),
      pause: () => pressed.push("pause"),
      stop: () => pressed.push("stop"),
      next: () => pressed.push("next"),
      previous: () => pressed.push("previous"),
    };
    winampRegistry.set("w1", controls);
    expect(pressed).toEqual(["play"]);
    expect(os().music.controls()).toBe(controls);
    // Only the registration that followed the request presses Play.
    winampRegistry.set("w2", controls);
    expect(pressed).toEqual(["play"]);
  });

  it("changes the display, the background and the screen saver through the desktop's own state", () => {
    const { os, displayPrefsStore, effectsStore, wallpaperStore } =
      renderAgent();
    wallpaperStore.set("data:image/png;base64,AAAA");
    act(() => os().display.setColorMode("256-colors"));
    act(() => os().display.setResolution("800x600"));
    act(() => os().display.setLargeFonts(true));
    act(() => os().display.setCrt("full"));
    act(() => os().display.setCurvature(true));
    act(() => os().display.setScheme("hot-dog-stand"));
    expect(os().display.get()).toEqual({
      colorMode: "256-colors",
      resolution: "800x600",
      crt: "full",
      curvature: true,
      scheme: "hot-dog-stand",
      largeFonts: true,
    });
    expect(displayPrefsStore.get()).toMatchObject({
      colorMode: "256-colors",
      desktopArea: "800x600",
      largeFonts: true,
    });
    expect(effectsStore.get()).toEqual({
      crt: "full",
      curvature: true,
      scheme: "hot-dog-stand",
    });
    act(() => os().wallpaper.setColor("#ff0000"));
    expect(os().wallpaper.get()).toEqual({
      color: "#ff0000",
      hasPicture: false,
    });
    expect(wallpaperStore.get()).toBeUndefined();

    expect(os().screenSaver.active()).toBe(false);
    act(() => os().screenSaver.preview());
    expect(os().screenSaver.active()).toBe(true);
  });

  it("offers the run tool only where a Run dialog is provided", () => {
    expect(
      renderAgent().result.current.tools.map((tool) => tool.name),
    ).not.toContain("run");
    const run: RunPort = { run: (command) => ({ ok: true, message: command }) };
    const withRun = renderAgent({}, run);
    expect(withRun.result.current.tools.map((tool) => tool.name)).toContain(
      "run",
    );
    expect(withRun.os().run).toBe(run);
  });
});
