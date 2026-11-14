import type { FakeAgentOs } from "../__mocks__/agentOs";
import { createFakeAgentOs } from "../__mocks__/agentOs";
import { WIN98_PALETTE } from "../paint/palette";

import type { AgentTool, AgentToolResult } from "./agentTool";
import { coerceArgs } from "./agentTool";
import { desktopSummary, resolveTarget } from "./appTools";
import { createAgentTools } from "./createAgentTools";
import type { AgentEditUndo } from "./diskTools";
import {
  MAX_LISTED_ENTRIES,
  MAX_READ_CHARS,
  resolveLocation,
} from "./diskTools";
import { BACKGROUND_COLORS } from "./displayTools";
import { describeWindow, findWindow } from "./windowTools";

type Harness = {
  os: FakeAgentOs;
  tools: AgentTool[];
  undo: { current: AgentEditUndo | undefined };
  /** Runs a tool the way the loop does: arguments checked first, then `run`. */
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<AgentToolResult>;
  /** What the step log shows while the tool runs. */
  doing: (name: string, args?: Record<string, unknown>) => string;
};

function harness(
  options: Parameters<typeof createFakeAgentOs>[0] = {},
): Harness {
  const os = createFakeAgentOs(options);
  const undo: Harness["undo"] = { current: undefined };
  const tools = createAgentTools(os, undo);
  const find = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool;
  };
  const checked = (name: string, args: Record<string, unknown>) => {
    const tool = find(name);
    const coerced = coerceArgs(tool, args);
    if (!coerced.ok) throw new Error(coerced.error);
    return { tool, args: coerced.args };
  };
  return {
    os,
    tools,
    undo,
    call: async (name, args = {}) => {
      const { tool, args: coerced } = checked(name, args);
      return tool.run(coerced);
    },
    doing: (name, args = {}) => {
      const { tool, args: coerced } = checked(name, args);
      return tool.sentence(coerced);
    },
  };
}

describe(createAgentTools.name, () => {
  it("offers every tool once, and `run` only on a desktop with a Run dialog", () => {
    const names = harness().tools.map((tool) => tool.name);
    expect(names).toEqual([
      "get_desktop_state",
      "open_app",
      "launch_game",
      "list_games",
      "focus_window",
      "close_window",
      "minimize_window",
      "maximize_window",
      "open_start_menu",
      "explorer_open",
      "list_dir",
      "read_file",
      "edit_file",
      "undo_edit",
      "music",
      "set_display",
      "set_wallpaper",
      "screensaver_preview",
      "show_message",
    ]);
    expect(harness({ withRun: true }).tools.map((tool) => tool.name)).toContain(
      "run",
    );
  });
});

describe("open_app, launch_game and list_games", () => {
  it("opens a program in a window and a Fuse game the way the Games applet says", async () => {
    const { os, call, doing } = harness();
    expect(doing("open_app", { id: "paint" })).toBe("Opening Paint");
    expect(await call("open_app", { id: "paint" })).toEqual({
      ok: true,
      sentence: "Opened Paint",
    });
    expect(await call("open_app", { id: "fuseball" })).toEqual({
      ok: true,
      sentence: "Opened Fuseball",
    });
    os.state.launchMode = "tab";
    expect(await call("open_app", { id: "FUSE-RIDERS" })).toEqual({
      ok: true,
      sentence: "Opened Fuse Riders in a new browser tab",
    });
    expect(os.log).toEqual([
      "open untitled - Paint",
      "launch fuseball window",
      "launch fuse-riders tab",
    ]);
  });

  it("refuses an id that is not on the desktop, before and after the argument check", async () => {
    const { tools, call } = harness();
    await expect(call("open_app", { id: "excel" })).rejects.toThrow(
      /open_app has no id "excel"; use one of: fuseball/,
    );
    const open = tools.find((tool) => tool.name === "open_app");
    expect(await open?.run({ id: "excel" })).toEqual({
      ok: false,
      sentence: 'There is nothing called "excel" on this desktop',
    });
    expect(open?.sentence({})).toBe("Opening ");
  });

  it("starts a Fuse game in the mode asked for, by id or by name", async () => {
    const { os, tools, call, doing } = harness();
    expect(doing("launch_game", { id: "fuseball" })).toBe("Starting Fuseball");
    expect(await call("launch_game", { id: "fuseball", mode: "tab" })).toEqual({
      ok: true,
      sentence: "Started Fuseball in a new browser tab",
    });
    expect(await call("launch_game", { id: "fuse-birds" })).toEqual({
      ok: true,
      sentence: "Started Fuse Birds in a window",
    });
    expect(os.log).toEqual(["launch fuseball tab", "launch fuse-birds window"]);
    const launch = tools.find((tool) => tool.name === "launch_game");
    expect(await launch?.run({ id: "Fuse Riders" })).toMatchObject({
      ok: true,
    });
    expect(await launch?.run({ id: "doom" })).toEqual({
      ok: false,
      sentence: 'There is no Fuse game called "doom"',
    });
    expect(launch?.sentence({})).toBe("Starting ");
  });

  it("lists the Fuse games with taglines and the retro games", async () => {
    const result = await harness().call("list_games");
    expect(result.sentence).toBe("Found 3 Fuse games and 2 retro games");
    expect(result.observation).toBe(
      "Fuse games: Fuseball [fuseball]: Five-a-side with rockets; Fuse Riders [fuse-riders]: Light cycles for five; Fuse Birds [fuse-birds]: Flap, dodge, survive. Retro games: DOOM [doom], Minesweeper [minesweeper].",
    );
    const empty = createFakeAgentOs();
    empty.games.fuse = () => [];
    empty.games.retro = () => [];
    const [list] = createAgentTools(empty, { current: undefined }).filter(
      (tool) => tool.name === "list_games",
    );
    expect((await list?.run({}))?.observation).toBe(
      "No Fuse games are installed.",
    );
    expect(list?.sentence({})).toBe("Looking at the games");
  });

  it("resolves a target by id, name or alias, and nothing for an empty argument", () => {
    const { os } = harness();
    expect(resolveTarget("PAINT", os.targets)?.id).toBe("paint");
    expect(resolveTarget('"mspaint"', os.targets)?.id).toBe("paint");
    expect(resolveTarget("control panel", os.targets)?.id).toBe("settings");
    expect(resolveTarget("  ", os.targets)).toBeUndefined();
    expect(resolveTarget("excel", os.targets)).toBeUndefined();
  });
});

describe("get_desktop_state", () => {
  it("describes an empty desktop, then the windows, the display and the music", async () => {
    const { os, call, doing } = harness();
    expect(doing("get_desktop_state")).toBe("Looking at the desktop");
    expect(await call("get_desktop_state")).toEqual({
      ok: true,
      sentence: "No windows are open",
      observation:
        "No windows are open. Start menu closed. Display: true-color, native resolution, scheme windows-standard, CRT off. Winamp is not running. Fuse games open in a window.",
    });
    os.windows.open({ kind: "paint" });
    expect((await call("get_desktop_state")).sentence).toBe(
      "Open: untitled - Paint",
    );
    os.music.openAndPlay();
    os.windows.minimize("w1");
    os.windows.toggleMaximize("w2");
    os.startMenu.setOpen(true);
    os.display.setResolution("800x600");
    os.state.launchMode = "tab";
    expect(await call("get_desktop_state")).toEqual({
      ok: true,
      sentence: "Open: untitled - Paint, Winamp",
      observation:
        'Windows, back to front: w1 "untitled - Paint" (minimized); w2 "Winamp" (on top, maximized). Start menu open. Display: true-color, 800x600, scheme windows-standard, CRT off. Winamp playing "One" (3 tracks). Fuse games open in a browser tab.',
    });
    os.music.controls()?.pause();
    expect(desktopSummary(os)).toContain('Winamp not playing "One"');
  });
});

describe("the window tools", () => {
  function twoWindows() {
    const h = harness();
    h.os.windows.open({ kind: "paint" });
    h.os.games.launch("fuseball");
    h.os.log.length = 0;
    return h;
  }

  it("finds a window by id, title, kind or part of the title, the topmost first", () => {
    const { os } = twoWindows();
    os.windows.open({ kind: "paint" });
    const windows = os.windows.list();
    expect(findWindow("w2", windows)?.title).toBe("Fuseball");
    expect(findWindow("Fuseball", windows)?.id).toBe("w2");
    expect(findWindow("paint", windows)?.id).toBe("w3");
    expect(findWindow("untitled", windows)?.id).toBe("w3");
    expect(findWindow("the fuseball window", windows)?.id).toBe("w2");
    expect(findWindow("excel", windows)).toBeUndefined();
    expect(findWindow(" ", windows)).toBeUndefined();
    expect(describeWindow({ ...windows[0]!, focused: false })).toBe(
      'w1 "untitled - Paint"',
    );
  });

  it("focuses, minimizes, maximizes and closes the window named", async () => {
    const { os, call, doing } = twoWindows();
    expect(doing("focus_window", { window: "paint" })).toBe(
      "Bringing up untitled - Paint",
    );
    expect(doing("close_window", { window: "excel" })).toBe("Closing excel");
    expect(await call("focus_window", { window: "paint" })).toEqual({
      ok: true,
      sentence: "untitled - Paint is in front",
    });
    expect(await call("minimize_window", { window: "Fuseball" })).toEqual({
      ok: true,
      sentence: "Minimized Fuseball",
    });
    expect(await call("minimize_window", { window: "Fuseball" })).toEqual({
      ok: true,
      sentence: "Fuseball is already minimized",
    });
    // Maximizing a minimized window brings it back first.
    expect(await call("maximize_window", { window: "Fuseball" })).toEqual({
      ok: true,
      sentence: "Maximized Fuseball",
    });
    expect(await call("maximize_window", { window: "w2" })).toEqual({
      ok: true,
      sentence: "Fuseball is already maximized",
    });
    os.windows.minimize("w2");
    // Already maximized but minimized: only brought back.
    expect(await call("maximize_window", { window: "w2" })).toEqual({
      ok: true,
      sentence: "Maximized Fuseball",
    });
    expect(await call("close_window", { window: "Fuseball" })).toEqual({
      ok: true,
      sentence: "Closed Fuseball",
    });
    expect(os.log).toEqual([
      "focus w1",
      "minimize w2",
      "focus w2",
      "toggleMaximize w2",
      "minimize w2",
      "focus w2",
      "close w2",
    ]);
  });

  it("says which windows there are when none matches", async () => {
    const { call } = twoWindows();
    expect(await call("close_window", { window: "excel" })).toEqual({
      ok: false,
      sentence: 'There is no window called "excel"',
      observation:
        'No window matches "excel". Open windows: w1 "untitled - Paint"; w2 "Fuseball" (on top).',
    });
    expect(
      (await harness().call("focus_window", { window: "paint" })).observation,
    ).toBe('No window matches "paint". Open windows: none.');
  });

  it("opens and closes the Start menu, and shows a message box", async () => {
    const { os, call, doing } = harness();
    expect(doing("open_start_menu")).toBe("Opening the Start menu");
    expect(doing("open_start_menu", { open: false })).toBe(
      "Closing the Start menu",
    );
    expect(await call("open_start_menu")).toEqual({
      ok: true,
      sentence: "The Start menu is open",
    });
    expect(await call("open_start_menu", { open: "false" })).toEqual({
      ok: true,
      sentence: "The Start menu is closed",
    });
    expect(doing("show_message", { text: "hello" })).toBe("Showing a message");
    expect(await call("show_message", { text: "hello" })).toEqual({
      ok: true,
      sentence: 'Showed the message "Clippy"',
    });
    await call("show_message", { text: "Bye", title: "Notice" });
    expect(os.state.dialogs).toEqual([
      { title: "Clippy", message: "hello" },
      { title: "Notice", message: "Bye" },
    ]);
    expect(os.state.startMenuOpen).toBe(false);
  });
});

describe("the disk tools", () => {
  it("reads a path as the address bar would, and a bare path as one on C:", () => {
    expect(resolveLocation("C:\\docs\\")).toBe("C:/docs");
    expect(resolveLocation("a:")).toBe("A:");
    expect(resolveLocation("My Computer")).toBe("");
    expect(resolveLocation("docs/notes.txt")).toBe("C:/docs/notes.txt");
    expect(resolveLocation('"/README.md"')).toBe("C:/README.md");
    expect(resolveLocation("Z:/nope")).toBeUndefined();
    expect(resolveLocation("C:/../etc")).toBeUndefined();
  });

  it("lists a folder, My Computer and an empty drive, and refuses a file or a missing path", async () => {
    const { call, doing } = harness({
      binaries: { "C:/public/theme.mp3": 2048 },
    });
    expect(doing("list_dir", { path: "C:/docs" })).toBe("Looking in C:/docs");
    expect(await call("list_dir", { path: "C:/docs" })).toEqual({
      ok: true,
      sentence: "C:\\docs has 2 items",
      observation: "C:\\docs: guide/, notes.txt (1 KB).",
    });
    expect((await call("list_dir", { path: "My Computer" })).observation).toBe(
      "My Computer: A:/, C:/.",
    );
    expect((await call("list_dir", { path: "docs/guide" })).sentence).toBe(
      "C:\\docs\\guide has 1 item",
    );
    expect(await call("list_dir", { path: "README.md" })).toEqual({
      ok: false,
      sentence: "README.md is a file, not a folder",
      observation: "README.md is a file; use read_file to read it.",
    });
    expect(await call("list_dir", { path: "C:/nope" })).toEqual({
      ok: false,
      sentence: 'There is no "C:/nope" on this computer',
      observation:
        'Nothing is at "C:/nope". Use list_dir on its folder to see what exists.',
    });
    expect((await call("list_dir", { path: "Q:/x" })).ok).toBe(false);
    const empty = harness({ files: {} });
    expect(await empty.call("list_dir", { path: "C:" })).toEqual({
      ok: true,
      sentence: "C:\\ has 0 items",
      observation: "C:\\ is empty.",
    });
  });

  it("counts the entries it does not list", async () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_LISTED_ENTRIES + 3 }, (_unused, index) => [
        `many/file${String(index).padStart(2, "0")}.txt`,
        "x",
      ]),
    );
    const result = await harness({ files }).call("list_dir", { path: "many" });
    expect(result.observation).toMatch(/file39\.txt \(1 KB\), and 3 more\.$/);
  });

  it("opens a folder in Explorer and a text file in Notepad++", async () => {
    const { os, call, doing } = harness({
      binaries: { "C:/public/theme.mp3": 2048 },
    });
    expect(doing("explorer_open", { path: "C:/docs" })).toBe("Opening C:/docs");
    expect(await call("explorer_open", { path: "C:/docs" })).toEqual({
      ok: true,
      sentence: "Opened C:\\docs in Explorer",
    });
    expect(await call("explorer_open", { path: "readme.md" })).toEqual({
      ok: true,
      sentence: "Opened README.md in Notepad++",
    });
    expect(await call("explorer_open", { path: "public/theme.mp3" })).toEqual({
      ok: false,
      sentence: "theme.mp3 is not something Notepad++ can open",
    });
    expect((await call("explorer_open", { path: "nope" })).ok).toBe(false);
    expect(os.log).toEqual(["open Exploring - C:/docs", "edit-open README.md"]);
  });

  it("reads a text file, the saved copy first, truncated to what a small model can hold", async () => {
    const long = "x".repeat(MAX_READ_CHARS + 50);
    const { os, call, doing } = harness({
      files: { "README.md": "# Hello\n", "big.txt": long },
      binaries: {
        "C:/public/theme.mp3": 2048,
        "C:/huge.txt": 900 * 1024,
      },
    });
    expect(doing("read_file", { path: "README.md" })).toBe("Reading README.md");
    expect(await call("read_file", { path: "C:/README.md" })).toEqual({
      ok: true,
      sentence: "Read README.md (8 characters)",
      observation: "README.md reads:\n# Hello\n",
    });
    os.state.saved["README.md"] = "edited";
    expect((await call("read_file", { path: "README.md" })).observation).toBe(
      "README.md reads:\nedited",
    );
    expect((await call("read_file", { path: "big.txt" })).observation).toBe(
      `big.txt reads:\n${"x".repeat(MAX_READ_CHARS)}\n... (50 more characters not shown)`,
    );
    expect(await call("read_file", { path: "C:" })).toEqual({
      ok: false,
      sentence: "C: is a folder, not a file",
      observation: "C: is a folder; use list_dir to see inside.",
    });
    expect(await call("read_file", { path: "public/theme.mp3" })).toEqual({
      ok: false,
      sentence: "theme.mp3 is not a text file",
    });
    expect(await call("read_file", { path: "huge.txt" })).toEqual({
      ok: false,
      sentence: "huge.txt is too large to read (900 KB)",
    });
    expect((await call("read_file", { path: "nope.txt" })).ok).toBe(false);
  });

  it("replaces, appends to and prepends to a file, shows it in Notepad++ and undoes the last edit", async () => {
    const { os, undo, call, doing } = harness({
      files: { "notes.txt": "one", "empty.txt": "" },
    });
    expect(doing("edit_file", { path: "notes.txt", content: "x" })).toBe(
      "Editing notes.txt",
    );
    expect(
      await call("edit_file", {
        path: "notes.txt",
        content: "two",
        mode: "append",
      }),
    ).toEqual({
      ok: true,
      sentence: "Saved notes.txt to your C: drive (this browser only)",
      observation:
        "Saved notes.txt. It is open in Notepad++. undo_edit puts it back.",
    });
    expect(os.state.saved["notes.txt"]).toBe("one\ntwo");
    expect(os.state.opened).toEqual(["notes.txt"]);
    // There was no saved copy before: undo reverts to the committed text.
    expect(undo.current).toEqual({ path: "notes.txt", previous: undefined });
    await call("edit_file", {
      path: "notes.txt",
      content: "zero",
      mode: "prepend",
    });
    expect(os.state.saved["notes.txt"]).toBe("zero\none\ntwo");
    expect(undo.current).toEqual({ path: "notes.txt", previous: "one\ntwo" });
    expect(doing("undo_edit")).toBe("Undoing the last edit");
    expect(await call("undo_edit")).toEqual({
      ok: true,
      sentence: "Put notes.txt back the way it was",
    });
    expect(os.state.saved["notes.txt"]).toBe("one\ntwo");
    expect(await call("undo_edit")).toEqual({
      ok: false,
      sentence: "There is no edit to undo",
    });

    await call("edit_file", {
      path: "empty.txt",
      content: "first\n",
      mode: "append",
    });
    expect(os.state.saved["empty.txt"]).toBe("first\n");
    await call("edit_file", {
      path: "empty.txt",
      content: "top\n",
      mode: "prepend",
    });
    expect(os.state.saved["empty.txt"]).toBe("top\nfirst\n");
    await call("edit_file", { path: "empty.txt", content: "whole" });
    expect(os.state.saved["empty.txt"]).toBe("whole");
    await call("edit_file", {
      path: "empty.txt",
      content: "gone",
      mode: "replace",
    });
    await call("undo_edit");
    expect(os.state.saved["empty.txt"]).toBe("whole");
  });

  it("undoes the first edit of a file by reverting it, and refuses to edit what is not a text file", async () => {
    const { os, call } = harness({
      files: { "notes.txt": "one" },
      binaries: { "C:/public/theme.mp3": 2048 },
    });
    await call("edit_file", { path: "notes.txt", content: "two" });
    await call("undo_edit");
    expect(os.state.saved).toEqual({});
    expect(os.log).toEqual([
      "write notes.txt",
      "edit-open notes.txt",
      "revert notes.txt",
    ]);
    expect(
      await call("edit_file", { path: "public/theme.mp3", content: "x" }),
    ).toEqual({ ok: false, sentence: "theme.mp3 is not a text file" });
    expect(
      (await call("edit_file", { path: "nope.txt", content: "x" })).ok,
    ).toBe(false);
  });
});

describe("music", () => {
  it("starts Winamp on play when none is open and refuses the rest", async () => {
    const { os, call, doing } = harness();
    expect(doing("music", { action: "next" })).toBe(
      "Skipping to the next track",
    );
    expect(doing("music", { action: "volume", level: 30 })).toBe(
      "Setting the volume to 30",
    );
    expect(await call("music", { action: "pause" })).toEqual({
      ok: false,
      sentence: "Winamp is not open",
    });
    expect(await call("music", { action: "play" })).toEqual({
      ok: true,
      sentence: "Starting Winamp with the Fuse soundtrack",
    });
    expect(os.log).toEqual(["music openAndPlay"]);
  });

  it("presses the transport of the running Winamp and sets its volume", async () => {
    const { os, tools, call } = harness();
    os.music.openAndPlay();
    os.log.length = 0;
    expect(await call("music", { action: "next" })).toEqual({
      ok: true,
      sentence: "Skipping to the next track",
    });
    await call("music", { action: "prev" });
    await call("music", { action: "PAUSE" });
    await call("music", { action: "resume" });
    await call("music", { action: "stop" });
    expect(await call("music", { action: "volume", level: "130" })).toEqual({
      ok: true,
      sentence: "Volume set to 100",
    });
    expect(await call("music", { action: "volume" })).toEqual({
      ok: true,
      sentence: "Volume set to 50",
    });
    expect(os.log).toEqual([
      "music next",
      "music previous",
      "music pause",
      "music play",
      "music stop",
      "music volume 100",
      "music volume 50",
    ]);
    await expect(call("music", { action: "dance" })).rejects.toThrow(
      /music has no action "dance"/,
    );
    // An action that slipped past the check plays, the harmless reading.
    const music = tools.find((tool) => tool.name === "music");
    expect(await music?.run({})).toMatchObject({ ok: true });
  });

  it("says so when the player has no volume control", async () => {
    const { os, call } = harness({ noVolume: true });
    os.music.openAndPlay();
    expect(await call("music", { action: "volume", level: 10 })).toEqual({
      ok: false,
      sentence: "This Winamp has no volume control",
    });
  });
});

describe("set_display, set_wallpaper and screensaver_preview", () => {
  it("changes only the settings given", async () => {
    const { os, call, doing } = harness();
    expect(doing("set_display", { crt: "full" })).toBe("Changing the display");
    expect(
      await call("set_display", {
        color_mode: "256",
        resolution: "800x600",
        scheme: "hot-dog-stand",
        crt: "on",
        large_fonts: true,
      }),
    ).toEqual({
      ok: true,
      sentence:
        "Display set: colours 256-colors, resolution 800x600, scheme hot-dog-stand, CRT full, large fonts on",
    });
    expect(os.state.display).toEqual({
      colorMode: "256-colors",
      resolution: "800x600",
      crt: "full",
      curvature: false,
      scheme: "hot-dog-stand",
      largeFonts: true,
    });
    expect(
      await call("set_display", { resolution: "native", large_fonts: false }),
    ).toEqual({
      ok: true,
      sentence: "Display set: resolution native, large fonts off",
    });
    expect(await call("set_display")).toEqual({
      ok: false,
      sentence: "Nothing to change on the display",
      observation:
        "set_display needs at least one of color_mode, resolution, scheme, crt, curvature, large_fonts.",
    });
  });

  it("switches the whole CRT on for the curvature, which only bends with it", async () => {
    const { os, call } = harness();
    expect(await call("set_display", { curvature: true })).toEqual({
      ok: true,
      sentence: "Display set: CRT full, curvature on",
    });
    expect(await call("set_display", { curvature: true })).toEqual({
      ok: true,
      sentence: "Display set: curvature on",
    });
    expect(
      await call("set_display", { crt: "scanlines", curvature: false }),
    ).toEqual({
      ok: true,
      sentence: "Display set: CRT scanlines, curvature off",
    });
    expect(os.log).toEqual([
      "crt full",
      "curvature true",
      "curvature true",
      "crt scanlines",
      "curvature false",
    ]);
  });

  it("paints the desktop a palette colour by name", async () => {
    const { os, tools, call, doing } = harness();
    expect(doing("set_wallpaper", { color: "red" })).toBe(
      "Painting the desktop red",
    );
    expect(await call("set_wallpaper", { color: "Gray" })).toEqual({
      ok: true,
      sentence: "The desktop is grey now",
    });
    expect(os.state.backgroundColor).toBe("#808080");
    expect(os.wallpaper.get()).toEqual({ color: "#808080", hasPicture: false });
    const wallpaper = tools.find((tool) => tool.name === "set_wallpaper");
    expect(await wallpaper?.run({ color: "plaid" })).toEqual({
      ok: false,
      sentence: "plaid is not a desktop colour",
    });
    expect(wallpaper?.sentence({})).toBe("Painting the desktop teal");
    // The stored preference only keeps a colour of the Windows 98 palette.
    for (const hex of Object.values(BACKGROUND_COLORS))
      expect(WIN98_PALETTE).toContain(hex);
  });

  it("starts the screen saver, and says why when it cannot", async () => {
    const { os, call, doing } = harness();
    expect(doing("screensaver_preview")).toBe("Starting the screen saver");
    expect(await call("screensaver_preview")).toEqual({
      ok: true,
      sentence: "The screen saver is on",
    });
    expect(os.screenSaver.active()).toBe(true);
    os.screenSaver.preview = () => {
      throw new Error("The desktop is shut down");
    };
    expect(await call("screensaver_preview")).toEqual({
      ok: false,
      sentence: "The desktop is shut down",
    });
    os.screenSaver.preview = () => {
      throw "hidden";
    };
    expect(await call("screensaver_preview")).toEqual({
      ok: false,
      sentence: "The screen saver could not start",
    });
  });
});

describe("run", () => {
  it("types the command into Start, Run and reports what the dialog said", async () => {
    const { os, call, doing } = harness({ withRun: true });
    expect(doing("run", { command: "winamp" })).toBe("Running winamp");
    expect(await call("run", { command: "winamp" })).toEqual({
      ok: true,
      sentence: "Ran winamp",
    });
    expect(await call("run", { command: " " })).toEqual({
      ok: false,
      sentence: "Type the name of a program",
    });
    expect(os.log).toEqual(["run winamp", "run  "]);
  });
});
