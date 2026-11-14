import { render, screen } from "@testing-library/react";

import {
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  GLYPHS,
  MARK_COLOURS,
  markPixels,
  wordPixels,
  wordWidth,
} from "./fuseOsMark";
import { FuseOsSplash } from "./FuseOsSplash";

describe("fuseOsMark", () => {
  it("has a 5x7 glyph for each letter of the name", () => {
    for (const glyph of Object.values(GLYPHS)) {
      expect(glyph).toHaveLength(GLYPH_HEIGHT);
      for (const row of glyph) {
        expect(row).toHaveLength(GLYPH_WIDTH);
        expect(row).toMatch(/^[#.]+$/);
      }
    }
  });

  it("spells a word by placing each glyph one width and a gap further right", () => {
    const pixels = wordPixels(["F", "F"], 1);
    const single = wordPixels(["F"]);
    expect(pixels).toHaveLength(single.length * 2);
    expect(pixels.slice(single.length)).toEqual(
      single.map((pixel) => ({ ...pixel, x: pixel.x + GLYPH_WIDTH + 1 })),
    );
    expect(wordWidth(2, 1)).toBe(11);
    expect(wordWidth(1)).toBe(5);
    // The F's top bar is lit, its bottom row only in the stem.
    expect(single.filter((pixel) => pixel.y === 0)).toHaveLength(5);
    expect(single.filter((pixel) => pixel.y === 6)).toEqual([{ x: 0, y: 6 }]);
  });

  it("draws the four-pane mark in the four accents, waving the middle column down one row", () => {
    const pixels = markPixels();
    expect(pixels).toHaveLength(4 * 9);
    const colours = new Set(pixels.map((pixel) => pixel.colour));
    expect([...colours].sort()).toEqual(["cyan", "green", "pink", "yellow"]);
    const cyan = pixels.filter((pixel) => pixel.colour === "cyan");
    expect(Math.min(...cyan.map((pixel) => pixel.y))).toBe(0);
    expect(
      cyan.filter((pixel) => pixel.x === 1).map((pixel) => pixel.y),
    ).toEqual([1, 2, 3]);
    expect(MARK_COLOURS.cyan).toBe("#16e7ff");
  });
});

describe(FuseOsSplash.name, () => {
  it("is an SVG picture named FuseOS, with the mark and the wordmark as pixel rects", () => {
    const { container } = render(<FuseOsSplash width={320} height={180} />);
    const svg = screen.getByRole("img", { name: "FuseOS" });
    expect(svg).toHaveAttribute("viewBox", "0 0 640 360");
    expect(svg).toHaveAttribute("width", "320");
    expect(svg).toHaveAttribute("height", "180");
    const mark = container.querySelector('[data-part="mark"]');
    const wordmark = container.querySelector('[data-part="wordmark"]');
    expect(mark?.querySelectorAll("rect")).toHaveLength(markPixels().length);
    expect(wordmark?.querySelectorAll("rect")).toHaveLength(
      wordPixels(["F", "u", "s", "e"]).length + wordPixels(["O", "S"]).length,
    );
    // No text node: the name is drawn, not typeset, so it looks the same without any font.
    expect(svg.querySelector("text")).toBeNull();
  });

  it("fills its box by default", () => {
    render(<FuseOsSplash />);
    const svg = screen.getByRole("img", { name: "FuseOS" });
    expect(svg).toHaveAttribute("width", "100%");
    expect(svg).toHaveAttribute("height", "100%");
  });
});
