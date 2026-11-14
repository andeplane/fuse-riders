import {
  resolveRunCommand,
  RUN_ALIASES,
  runCommandId,
  runNotFoundMessage,
  runSuggestions,
} from "./runCommand";

const games = {
  has: (id: string) => id === "fuseball" || id === "fuse-riders",
};

describe(runCommandId.name, () => {
  it("lower-cases, trims, drops a program extension and follows the aliases", () => {
    expect(runCommandId("  DOOM.EXE ")).toBe("doom");
    expect(runCommandId("Notepad++")).toBe("notepad");
    expect(runCommandId("taskmgr.exe")).toBe("taskmanager");
    expect(runCommandId("Control Panel")).toBe("settings");
    expect(runCommandId("winamp.lnk")).toBe("winamp");
    expect(runCommandId("fuseball")).toBe("fuseball");
  });
});

describe(resolveRunCommand.name, () => {
  it("opens nothing for an empty line", () => {
    expect(resolveRunCommand("   ", games)).toEqual({ type: "empty" });
  });

  it("starts a Fuse game through the launcher and a retro game in its window", () => {
    expect(resolveRunCommand("Fuseball", games)).toEqual({
      type: "fusegame",
      gameId: "fuseball",
    });
    expect(resolveRunCommand("doom", games)).toEqual({
      type: "open",
      content: { kind: "retro", game: "doom" },
    });
    expect(resolveRunCommand("winmine.exe", games)).toEqual({
      type: "open",
      content: { kind: "retro", game: "minesweeper" },
    });
  });

  it("opens the programs by their names and their old names", () => {
    const opened = (text: string) => resolveRunCommand(text, games);
    expect(opened("winamp")).toEqual({
      type: "open",
      content: { kind: "winamp" },
    });
    expect(opened("notepad")).toEqual({
      type: "open",
      content: {
        kind: "notepadpp",
        paths: ["README.md"],
        activePath: "README.md",
      },
    });
    expect(opened("explorer")).toEqual({
      type: "open",
      content: { kind: "explorer", location: "" },
    });
    expect(opened("steam")).toEqual({
      type: "open",
      content: { kind: "launcher" },
    });
    expect(opened("dosgames")).toEqual({
      type: "open",
      content: { kind: "retroFolder" },
    });
    expect(opened("icq")).toEqual({
      type: "open",
      content: { kind: "friends" },
    });
    // Every alias leads somewhere.
    for (const alias of Object.keys(RUN_ALIASES))
      expect(opened(alias).type, alias).toBe("open");
  });

  it("raises the blue screen for bsod", () => {
    expect(resolveRunCommand("BSOD", games)).toEqual({ type: "bsod" });
    expect(resolveRunCommand("bsod.exe", games)).toEqual({ type: "bsod" });
  });

  it("opens a drive or a Windows folder by its address, in Explorer", () => {
    expect(resolveRunCommand("a:", games)).toEqual({
      type: "open",
      content: { kind: "explorer", location: "A:" },
    });
    expect(resolveRunCommand("C:\\", games)).toEqual({
      type: "open",
      content: { kind: "explorer", location: "C:" },
    });
    expect(resolveRunCommand("c:\\windows\\system32", games)).toEqual({
      type: "open",
      content: { kind: "explorer", location: "C:/WINDOWS/SYSTEM32" },
    });
    // A repository folder may or may not exist; Run does not guess.
    expect(resolveRunCommand("C:\\packages", games)).toEqual({
      type: "notFound",
      text: "C:\\packages",
    });
  });

  it("sends a web address to a browser tab", () => {
    expect(resolveRunCommand("https://fusegames.ai/", games)).toEqual({
      type: "url",
      url: "https://fusegames.ai/",
    });
    expect(resolveRunCommand("ftp://example.org", games).type).toBe(
      "notFound",
    );
  });

  it("says what it could not find, as typed", () => {
    expect(resolveRunCommand(" Format C: ", games)).toEqual({
      type: "notFound",
      text: "Format C:",
    });
    expect(runNotFoundMessage("quake")).toContain("Cannot find the file 'quake'");
    // Not an app just because Object.prototype has it.
    expect(resolveRunCommand("toString", games).type).toBe("notFound");
  });
});

describe(runSuggestions.name, () => {
  it("offers the installed games first, then names that run something", () => {
    const names = runSuggestions(["fuseball", "fuse-riders"]);
    expect(names.slice(0, 2)).toEqual(["fuseball", "fuse-riders"]);
    expect(names).toContain("doom");
    expect(names).toContain("bsod");
    for (const name of names)
      expect(resolveRunCommand(name, games).type, name).not.toBe("notFound");
  });
});
