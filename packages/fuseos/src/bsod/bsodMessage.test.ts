import {
  bsodMessage,
  executableName,
  FALLBACK_CULPRIT,
  pickCulprit,
} from "./bsodMessage";

describe("executableName", () => {
  it("upper-cases a short id", () => {
    expect(executableName("fuseball")).toBe("FUSEBALL.EXE");
  });

  it("drops punctuation and squeezes a long id into 8.3", () => {
    expect(executableName("fuse-riders")).toBe("FUSERI~1.EXE");
    expect(executableName("fuse-birds")).toBe("FUSEBI~1.EXE");
  });

  it("keeps an id of exactly eight characters whole", () => {
    expect(executableName("abcd-1234")).toBe("ABCD1234.EXE");
  });

  it("falls back when nothing usable is left", () => {
    expect(executableName("---")).toBe(FALLBACK_CULPRIT);
  });
});

describe("pickCulprit", () => {
  const games = [{ id: "fuseball" }, { id: "dice" }, { id: "fuse-volley" }];

  it("maps the random number onto the list", () => {
    expect(pickCulprit(games, () => 0)).toBe("FUSEBALL.EXE");
    expect(pickCulprit(games, () => 0.5)).toBe("DICE.EXE");
    expect(pickCulprit(games, () => 0.99)).toBe("FUSEVO~1.EXE");
  });

  it("stays inside the list for a source that misbehaves", () => {
    expect(pickCulprit(games, () => 1)).toBe("FUSEVO~1.EXE");
    expect(pickCulprit(games, () => -3)).toBe("FUSEBALL.EXE");
    expect(pickCulprit(games, () => Number.NaN)).toBe(FALLBACK_CULPRIT);
  });

  it("blames Explorer when no game is installed", () => {
    expect(pickCulprit([], () => 0.4)).toBe(FALLBACK_CULPRIT);
  });
});

describe("bsodMessage", () => {
  it("is the Windows 95 fatal exception text, naming the VXD and the culprit", () => {
    const message = bsodMessage("FUSEBALL.EXE");
    expect(message.title).toBe("Windows");
    expect(message.summary).toBe(
      "A fatal exception 0E has occurred at 0028:C0011E36 in VXD FUSE(01) + 00010E36, called from FUSEBALL.EXE. The current application will be terminated.",
    );
    expect(message.instructions).toHaveLength(2);
    expect(message.instructions[1]).toContain("CTRL+ALT+DEL");
    expect(message.prompt).toBe("Press any key to continue");
  });
});
