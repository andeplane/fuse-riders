import {
  PALETTE_NAMES,
  WIN98_PALETTE,
  capitalizedColorName,
  colorName,
  parseHexColor,
  resolveColor,
  toHexColor,
} from "./palette";

describe("palette", () => {
  it("names every one of the 28 palette colours exactly once", () => {
    expect(PALETTE_NAMES.map((entry) => entry.hex)).toEqual([...WIN98_PALETTE]);
    expect(new Set(PALETTE_NAMES.map((entry) => entry.name)).size).toBe(
      WIN98_PALETTE.length,
    );
  });

  it("resolves names, aliases and hex forms to a lowercase #rrggbb", () => {
    expect(resolveColor("red")).toBe("#ff0000");
    expect(resolveColor(" Light  Blue ")).toBe("#8080ff");
    expect(resolveColor("light-grey")).toBe("#c0c0c0");
    expect(resolveColor("#FF8040")).toBe("#ff8040");
    expect(resolveColor("#abc")).toBe("#aabbcc");
    expect(resolveColor("tartan")).toBeUndefined();
    expect(resolveColor("#12345")).toBeUndefined();
  });

  it("names a colour back, falling back to the hex outside the palette", () => {
    expect(colorName("#ff0000")).toBe("red");
    expect(colorName("#FF0000")).toBe("red");
    expect(colorName("#123456")).toBe("#123456");
  });

  it("capitalizes the colour name for a button label, but not a hex fallback", () => {
    expect(capitalizedColorName("#008080")).toBe("Teal");
    expect(capitalizedColorName("#123456")).toBe("#123456");
  });

  it("parses and formats hex colours", () => {
    expect(parseHexColor("#ff8040")).toEqual([255, 128, 64, 255]);
    expect(parseHexColor("#abc")).toEqual([170, 187, 204, 255]);
    expect(parseHexColor("nope")).toEqual([0, 0, 0, 255]);
    expect(toHexColor(255, 128.4, 300)).toBe("#ff80ff");
  });
});
