import { render } from "@testing-library/react";

import { displayColorFilter } from "../../desktop/displayModes";

import {
  EFFECT_PALETTE_MODES,
  greyLevelsTable,
  isEffectPaletteMode,
  MONOCHROME_LEVELS,
  PaletteFilterDefs,
  paletteFilterId,
  thresholdTable,
  VGA_BASE_THRESHOLD,
  VGA_BASE_WEIGHT,
  VGA_INTENSITY_THRESHOLD,
  VGA_INTENSITY_WEIGHT,
} from "./paletteFilters";

describe("palette filters", () => {
  it("builds discrete tables that switch at the threshold", () => {
    expect(thresholdTable(5, 0.4)).toBe("0 0 1 1 1");
    expect(thresholdTable(10, 0.8)).toBe("0 0 0 0 0 0 0 0 1 1");
    expect(thresholdTable(2, 0.5)).toBe("0 1");
    expect(greyLevelsTable(4)).toBe("0 0.3333 0.6667 1");
    expect(greyLevelsTable(2)).toBe("0 1");
  });

  it("sums base and intensity to VGA's 0, 1/3, 2/3 and 1 levels", () => {
    expect(VGA_BASE_WEIGHT + VGA_INTENSITY_WEIGHT).toBeCloseTo(1);
    expect(VGA_BASE_WEIGHT).toBeCloseTo(2 / 3);
    // Silver (0.75) must land on light grey, not white: on in every channel, below the intensity cut.
    expect(0.75).toBeGreaterThanOrEqual(VGA_BASE_THRESHOLD);
    expect(0.75).toBeLessThan(VGA_INTENSITY_THRESHOLD);
  });

  it("names its modes the way displayColorFilter refers to them", () => {
    expect(EFFECT_PALETTE_MODES).toEqual(["16-colors", "monochrome"]);
    expect(isEffectPaletteMode("16-colors")).toBe(true);
    expect(isEffectPaletteMode("256-colors")).toBe(false);
    for (const mode of EFFECT_PALETTE_MODES)
      expect(displayColorFilter(mode)).toBe(`url(#${paletteFilterId(mode)})`);
  });

  it("renders a 16-colour filter with base, intensity and their arithmetic sum", () => {
    const { container } = render(
      <svg>
        <defs>
          <PaletteFilterDefs />
        </defs>
      </svg>,
    );
    const vga = container.querySelector("filter#display-16-colors");
    expect(vga).not.toBeNull();
    expect(vga?.getAttribute("color-interpolation-filters")).toBe("sRGB");
    const transfers = vga?.querySelectorAll("feComponentTransfer") ?? [];
    expect(transfers).toHaveLength(2);
    expect(transfers[0]?.getAttribute("result")).toBe("base");
    expect(
      transfers[0]?.querySelector("feFuncR")?.getAttribute("tableValues"),
    ).toBe(thresholdTable(5, VGA_BASE_THRESHOLD));
    expect(transfers[1]?.getAttribute("in")).toBe("luminance");
    expect(
      transfers[1]?.querySelector("feFuncB")?.getAttribute("tableValues"),
    ).toBe(thresholdTable(10, VGA_INTENSITY_THRESHOLD));
    const composite = vga?.querySelector("feComposite");
    expect(composite?.getAttribute("operator")).toBe("arithmetic");
    expect(composite?.getAttribute("in")).toBe("base");
    expect(composite?.getAttribute("in2")).toBe("intensity");
    expect(Number(composite?.getAttribute("k2"))).toBeCloseTo(VGA_BASE_WEIGHT);
    expect(Number(composite?.getAttribute("k3"))).toBeCloseTo(
      VGA_INTENSITY_WEIGHT,
    );
  });

  it("renders a monochrome filter: luminance, then four grey levels", () => {
    const { container } = render(
      <svg>
        <defs>
          <PaletteFilterDefs />
        </defs>
      </svg>,
    );
    const mono = container.querySelector("filter#display-monochrome");
    expect(mono?.querySelector("feColorMatrix")?.getAttribute("type")).toBe(
      "matrix",
    );
    for (const channel of ["feFuncR", "feFuncG", "feFuncB"])
      expect(
        mono?.querySelector(channel)?.getAttribute("tableValues")?.split(" "),
      ).toHaveLength(MONOCHROME_LEVELS);
  });
});
