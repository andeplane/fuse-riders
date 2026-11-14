import { act, renderHook } from "@testing-library/react";

import {
  createWrapper,
  createTestGames,
} from "../__mocks__/renderWithProviders";
import type { WindowContent } from "../state/appState";
import type { WinampControls } from "../winamp/winampControls";
import { createWinampRegistry } from "../winamp/winampRegistry";

import {
  createMusicTool,
  createOpenTool,
  desktopTargets,
  intentCatalog,
  promptCatalog,
  resolveTarget,
  useDesktopTools,
} from "./desktopTools";

const games = createTestGames();
const targets = desktopTargets(games);

function fakeWinamp(): WinampControls & { pressed: string[] } {
  const pressed: string[] = [];
  return {
    pressed,
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
}

describe(desktopTargets.name, () => {
  it("lists the Fuse games first, then the retro games, then the apps, each with its window", () => {
    expect(targets.slice(0, 3).map((target) => target.id)).toEqual([
      "fuseball",
      "fuse-riders",
      "fuse-birds",
    ]);
    expect(targets[0]?.content).toEqual({
      kind: "fusegame",
      gameId: "fuseball",
    });
    expect(targets.find((target) => target.id === "doom")).toMatchObject({
      kind: "retro",
      name: "DOOM",
      content: { kind: "retro", game: "doom" },
    });
    expect(targets.find((target) => target.id === "keen1")?.aliases).toContain(
      "keen",
    );
    expect(
      targets.filter((target) => target.kind === "app").map((t) => t.id),
    ).toEqual([
      "paint",
      "winamp",
      "settings",
      "display",
      "about",
      "notepad",
      "explorer",
      "fusteam",
      "retro-games",
      "screensaver",
      "system",
      "assistant",
      "keyboard",
      "games-settings",
    ]);
    expect(
      targets.find((target) => target.id === "screensaver")?.content,
    ).toEqual({ kind: "controlpanel", applet: "display", tab: "screensaver" });
    expect(new Set(targets.map((target) => target.id)).size).toBe(
      targets.length,
    );
  });

  it("gives the rules the game names and the prompt the taglines, retro names and app ids", () => {
    expect(intentCatalog(targets).gameNames).toEqual([
      "Fuseball",
      "Fuse Riders",
      "Fuse Birds",
    ]);
    const prompt = promptCatalog(games, targets);
    expect(prompt.games[0]).toEqual({
      name: "Fuseball",
      tagline: "Five-a-side with rockets",
    });
    expect(prompt.retroGames).toContain("Wolfenstein 3D");
    expect(prompt.apps).toContain("Control Panel (settings)");
  });
});

describe(resolveTarget.name, () => {
  it("finds a target by id, name or alias, ignoring case and quotes", () => {
    expect(resolveTarget("fuseball", targets)?.id).toBe("fuseball");
    expect(resolveTarget(' "Fuse Riders" ', targets)?.id).toBe("fuse-riders");
    expect(resolveTarget("KEEN", targets)?.id).toBe("keen1");
    expect(resolveTarget("settings", targets)?.id).toBe("settings");
    expect(resolveTarget("wallpaper", targets)?.id).toBe("display");
    expect(resolveTarget("", targets)).toBeUndefined();
    expect(resolveTarget("excel", targets)).toBeUndefined();
  });
});

describe(createOpenTool.name, () => {
  it("describes every id, opens the window of a known target and refuses an unknown one", () => {
    const opened: WindowContent[] = [];
    const tool = createOpenTool(targets, {
      open: (content) => opened.push(content),
    });
    expect(tool.describe()).toContain(
      "fuseball, fuse-riders, fuse-birds, doom",
    );
    expect(tool.sentence({ name: "open", arg: "paint" })).toBe("Opening Paint");
    expect(tool.sentence({ name: "open", arg: "excel" })).toBe("Opening excel");
    expect(tool.run({ name: "open", arg: "fuse-birds" })).toEqual({
      ok: true,
      sentence: "Opened Fuse Birds",
    });
    expect(tool.run({ name: "open", arg: "about" })).toEqual({
      ok: true,
      sentence: "Opened About FuseOS",
    });
    expect(opened).toEqual([
      { kind: "fusegame", gameId: "fuse-birds" },
      { kind: "about" },
    ]);
    expect(tool.run({ name: "open", arg: "excel" })).toEqual({
      ok: false,
      sentence: 'There is nothing called "excel" on this desktop',
    });
    expect(opened).toHaveLength(2);
  });
});

describe(createMusicTool.name, () => {
  it("presses the transport of the open Winamp", async () => {
    const winamp = fakeWinamp();
    const registry = createWinampRegistry();
    registry.set("w1", winamp);
    const opened: WindowContent[] = [];
    const tool = createMusicTool(registry, {
      open: (content) => opened.push(content),
    });
    expect(tool.describe()).toContain(
      "[music:<play|pause|stop|next|previous>]",
    );
    expect(await tool.run({ name: "music", arg: "play" })).toEqual({
      ok: true,
      sentence: "Playing music in Winamp",
    });
    expect(await tool.run({ name: "music", arg: " NEXT " })).toEqual({
      ok: true,
      sentence: "Skipping to the next track",
    });
    expect(winamp.pressed).toEqual(["play", "next"]);
    expect(opened).toEqual([]);
    expect(tool.sentence({ name: "music", arg: "pause" })).toBe(
      "Pausing Winamp",
    );
  });

  it("opens Winamp for play when none is open and presses Play once it has loaded; the other actions say so", async () => {
    const opened: WindowContent[] = [];
    const registry = createWinampRegistry();
    const tool = createMusicTool(registry, {
      open: (content) => opened.push(content),
    });
    expect(await tool.run({ name: "music", arg: "next" })).toEqual({
      ok: false,
      sentence: "Winamp is not open",
    });
    expect(await tool.run({ name: "music", arg: "play" })).toEqual({
      ok: true,
      sentence: "Starting Winamp with the Fuse soundtrack",
    });
    expect(opened).toEqual([{ kind: "winamp" }]);
    // The player registers once Webamp has loaded: that is when Play is pressed, and only that once.
    const winamp = fakeWinamp();
    registry.set("w1", winamp);
    expect(winamp.pressed).toEqual(["play"]);
    registry.delete("w1");
    const again = fakeWinamp();
    registry.set("w2", again);
    expect(again.pressed).toEqual([]);
  });

  it("refuses an action Winamp has no button for, and a volume it has no slider for", async () => {
    const registry = createWinampRegistry();
    registry.set("w1", fakeWinamp());
    const tool = createMusicTool(registry, { open: () => undefined });
    const refusal =
      'music has no action "dance"; use one of: play, pause, stop, next, previous, volume';
    expect(tool.sentence({ name: "music", arg: "dance" })).toBe(refusal);
    expect(await tool.run({ name: "music", arg: "dance" })).toEqual({
      ok: false,
      sentence: refusal,
    });
    expect(await tool.run({ name: "music", arg: "volume,40" })).toEqual({
      ok: false,
      sentence: "This Winamp has no volume control",
    });
  });
});

describe(useDesktopTools.name, () => {
  it("builds the marker tools and the typed tools over the desktop's registries and window commands", async () => {
    const context = createWrapper();
    const { result } = renderHook(() => useDesktopTools(), {
      wrapper: context.Wrapper,
    });
    // `[open:<id>]` first, then every typed tool as a marker.
    expect(result.current.tools.map((tool) => tool.name)).toEqual([
      "open",
      ...result.current.agentTools.map((tool) => tool.name),
    ]);
    expect(result.current.agentTools.map((tool) => tool.name)).toContain(
      "set_display",
    );
    // A small model is told about two markers only, in the short form.
    expect(result.current.promptTools.map((tool) => tool.describe())).toEqual([
      expect.stringMatching(
        /^\[open:<id>\] opens a game or app\. Ids: fuseball, /,
      ),
      "[music:<play|pause|stop|next|previous>] controls Winamp, the music player.",
    ]);
    expect(result.current.intents.gameNames).toEqual([
      "Fuseball",
      "Fuse Riders",
      "Fuse Birds",
    ]);
    expect(result.current.prompt.apps).toContain("Paint (paint)");

    const open = result.current.tools[0];
    act(() => {
      expect(open?.run({ name: "open", arg: "paint" })).toEqual({
        ok: true,
        sentence: "Opened Paint",
      });
    });
    expect(context.store.load().windows.map((window) => window.kind)).toEqual([
      "paint",
    ]);

    const music = result.current.tools.find((tool) => tool.name === "music");
    expect(await music?.run({ name: "music", arg: "pause" })).toEqual({
      ok: false,
      sentence: "Winamp is not open",
    });
    const winamp = fakeWinamp();
    context.winampRegistry.set("w9", winamp);
    expect(await music?.run({ name: "music", arg: "pause" })).toEqual({
      ok: true,
      sentence: "Pausing Winamp",
    });
    expect(winamp.pressed).toEqual(["pause"]);
  });
});
