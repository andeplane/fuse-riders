import {
  colorize,
  formattingKey,
  MIRC_PALETTE,
  parseFormatting,
  stripFormatting,
} from "./format";

describe("parseFormatting", () => {
  it("returns one plain run for plain text and nothing for empty text", () => {
    expect(parseFormatting("hello")).toEqual([
      {
        text: "hello",
        bold: false,
        italic: false,
        underline: false,
        reverse: false,
      },
    ]);
    expect(parseFormatting("")).toEqual([]);
  });

  it("toggles bold, italic, underline and reverse, and resets with ^O", () => {
    const runs = parseFormatting("a\x02b\x1dc\x1fd\x16e\x0ff");
    expect(runs.map((run) => run.text)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(runs[4]).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      reverse: true,
    });
    expect(runs[5]).toMatchObject({
      bold: false,
      italic: false,
      underline: false,
      reverse: false,
    });
  });

  it("reads one- and two-digit colours with an optional background", () => {
    const runs = parseFormatting("\x034red\x0312,8blue on yellow\x03plain");
    expect(runs[0]).toMatchObject({ text: "red", fg: 4 });
    expect(runs[0]?.bg).toBeUndefined();
    expect(runs[1]).toMatchObject({ text: "blue on yellow", fg: 12, bg: 8 });
    expect(runs[2]?.fg).toBeUndefined();
    expect(runs[2]?.bg).toBeUndefined();
  });

  it("keeps a padded colour from swallowing a following digit", () => {
    expect(parseFormatting("\x03041st")[0]).toMatchObject({
      text: "1st",
      fg: 4,
    });
  });

  it("keeps the background when only the foreground changes, and leaves a bare comma as text", () => {
    const runs = parseFormatting("\x031,15x\x034y\x035,z");
    expect(runs[1]).toMatchObject({ text: "y", fg: 4, bg: 15 });
    expect(runs[2]).toMatchObject({ text: ",z", fg: 5 });
  });

  it("drops colours outside the 16-colour palette and other control characters", () => {
    const runs = parseFormatting("\x0399,88x\x11y\x1e");
    expect(runs.map((run) => run.text).join("")).toBe("xy");
    expect(runs[0]?.fg).toBeUndefined();
    expect(runs[0]?.bg).toBeUndefined();
  });
});

describe("helpers", () => {
  it("strips formatting", () => {
    expect(stripFormatting("\x02\x0304hi\x03\x0f there")).toBe("hi there");
  });

  it("colorizes with padded codes", () => {
    expect(colorize("x", 4)).toBe("\x0304x\x03");
    expect(colorize("x", 0, 1)).toBe("\x0300,01x\x03");
    expect(parseFormatting(colorize("9 lives", 3))[0]).toMatchObject({
      text: "9 lives",
      fg: 3,
    });
  });

  it("maps the editbox shortcuts to control characters", () => {
    expect(["b", "K", "u", "r", "i", "o", "x"].map(formattingKey)).toEqual([
      "\x02",
      "\x03",
      "\x1f",
      "\x16",
      "\x1d",
      "\x0f",
      undefined,
    ]);
  });

  it("has the sixteen classic colours", () => {
    expect(MIRC_PALETTE).toHaveLength(16);
    expect(MIRC_PALETTE[3]).toBe("#009300");
  });
});
