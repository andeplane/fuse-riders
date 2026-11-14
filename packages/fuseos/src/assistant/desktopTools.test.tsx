import { act, renderHook } from "@testing-library/react";

import {
  createWrapper,
  createTestGames,
} from "../__mocks__/renderWithProviders";
import type { WindowContent } from "../state/appState";
import type { WinampControls } from "../winamp/winampControls";

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
    ).toEqual(["paint", "winamp", "settings", "display", "about"]);
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
  it("presses the transport of the open Winamp", () => {
    const winamp = fakeWinamp();
    const opened: WindowContent[] = [];
    const tool = createMusicTool(() => winamp, {
      open: (content) => opened.push(content),
    });
    expect(tool.describe()).toContain(
      "[music:<play|pause|stop|next|previous>]",
    );
    expect(tool.run({ name: "music", arg: "play" })).toEqual({
      ok: true,
      sentence: "Playing music in Winamp",
    });
    expect(tool.run({ name: "music", arg: " NEXT " })).toEqual({
      ok: true,
      sentence: "Skipping to the next track",
    });
    expect(winamp.pressed).toEqual(["play", "next"]);
    expect(opened).toEqual([]);
    expect(tool.sentence({ name: "music", arg: "pause" })).toBe(
      "Pausing Winamp",
    );
  });

  it("opens Winamp for play when none is open, and says so for the other actions", () => {
    const opened: WindowContent[] = [];
    const tool = createMusicTool(() => undefined, {
      open: (content) => opened.push(content),
    });
    expect(tool.run({ name: "music", arg: "play" })).toEqual({
      ok: true,
      sentence: "Opened Winamp",
    });
    expect(opened).toEqual([{ kind: "winamp" }]);
    expect(tool.run({ name: "music", arg: "next" })).toEqual({
      ok: false,
      sentence: "Winamp is not open",
    });
  });

  it("refuses an action Winamp has no button for", () => {
    const tool = createMusicTool(fakeWinamp, { open: () => undefined });
    expect(tool.sentence({ name: "music", arg: "louder" })).toBe(
      'Winamp cannot "louder"',
    );
    expect(tool.run({ name: "music", arg: "louder" })).toEqual({
      ok: false,
      sentence: 'Winamp cannot "louder"; try play, pause, stop, next, previous',
    });
  });
});

describe(useDesktopTools.name, () => {
  it("builds the tools over the desktop's registries and window commands", () => {
    const context = createWrapper();
    const { result } = renderHook(() => useDesktopTools(), {
      wrapper: context.Wrapper,
    });
    expect(result.current.tools.map((tool) => tool.name)).toEqual([
      "open",
      "music",
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

    const music = result.current.tools[1];
    expect(music?.run({ name: "music", arg: "pause" })).toEqual({
      ok: false,
      sentence: "Winamp is not open",
    });
    const winamp = fakeWinamp();
    context.winampRegistry.set("w9", winamp);
    expect(music?.run({ name: "music", arg: "pause" })).toEqual({
      ok: true,
      sentence: "Pausing Winamp",
    });
    expect(winamp.pressed).toEqual(["pause"]);
  });
});
