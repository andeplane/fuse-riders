import {
  colourLayers,
  inkPath,
  PIXEL_ICON_SIZE,
  PIXEL_ICONS,
  PIXEL_PALETTE,
} from "./pixelIcons";

describe("Explorer's toolbar pictures", () => {
  it("are all 20 by 20, drawn only from the palette", () => {
    const allowed = new Set([".", ...Object.keys(PIXEL_PALETTE)]);
    for (const [name, grid] of Object.entries(PIXEL_ICONS)) {
      expect(grid, name).toHaveLength(PIXEL_ICON_SIZE);
      for (const row of grid) {
        expect(row, name).toHaveLength(PIXEL_ICON_SIZE);
        expect(
          [...row].filter((pixel) => !allowed.has(pixel)),
          name,
        ).toEqual([]);
      }
    }
  });

  it("draws Forward as Back facing the other way", () => {
    expect(PIXEL_ICONS.forward).toEqual(
      PIXEL_ICONS.back.map((row) => [...row].reverse().join("")),
    );
    expect(PIXEL_ICONS.forward).not.toEqual(PIXEL_ICONS.back);
  });

  it("turns a grid into one path per colour, joining pixels along a row", () => {
    const grid = ["KK.W", ".K..", "...."];
    expect(colourLayers(grid)).toEqual([
      { colour: "#000000", path: "M0 0h2v1h-2zM1 1h1v1h-1z" },
      { colour: "#ffffff", path: "M3 0h1v1h-1z" },
    ]);
    expect(colourLayers(["....", "...."])).toEqual([]);
  });

  it("keeps only the ink for the embossed look of a disabled button", () => {
    // White, silver and the yellows are fills, not ink.
    expect(inkPath(["KWsY", "gBcR"])).toBe(
      "M0 0h1v1h-1zM0 1h2v1h-2zM3 1h1v1h-1z",
    );
    for (const grid of Object.values(PIXEL_ICONS))
      expect(inkPath(grid)).not.toBe("");
  });
});
