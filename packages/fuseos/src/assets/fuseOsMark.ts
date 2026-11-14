/**
 * The FuseOS mark and wordmark as pixel data, so the boot splash, the favicon and the About
 * sheet draw the same picture without a font or a bitmap: everything is `<rect>`s.
 *
 * Colours are the Fuse games' own portal accents (games/<id>/portal.json), so the splash feels
 * like the desktop it boots into rather than a logo picked from somewhere else.
 */

/** Four panes, like a flag of coloured squares, in game accents: Riders cyan, Hook Havok pink, Fuseball yellow, Fusetown green. */
export const MARK_COLOURS = {
  cyan: "#16e7ff",
  pink: "#ff2e9d",
  yellow: "#ffe46b",
  green: "#3ddc84",
} as const;

export type MarkColour = keyof typeof MARK_COLOURS;

/** One 5x7 glyph: seven rows, `#` is a lit pixel. */
export type Glyph = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** Just the six letters of the name; the word is spelled from these, not from a font. */
export const GLYPHS: Readonly<
  Record<"F" | "u" | "s" | "e" | "O" | "S", Glyph>
> = {
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".####"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

export type Pixel = { x: number; y: number };

/** The lit pixels of a word, in glyph units, each letter `GLYPH_WIDTH + gap` further right. */
export function wordPixels(
  word: readonly (keyof typeof GLYPHS)[],
  gap = 1,
): Pixel[] {
  const pixels: Pixel[] = [];
  word.forEach((letter, index) => {
    const left = index * (GLYPH_WIDTH + gap);
    GLYPHS[letter].forEach((row, y) => {
      for (let x = 0; x < row.length; x++)
        if (row[x] === "#") pixels.push({ x: left + x, y });
    });
  });
  return pixels;
}

/** Width of a word in glyph units. */
export function wordWidth(letterCount: number, gap = 1): number {
  return letterCount * GLYPH_WIDTH + (letterCount - 1) * gap;
}

/** The four-pane mark: each pane a 3x3 block of pixels, waving one row down per column like a flag. */
export const MARK_PANES: readonly {
  colour: MarkColour;
  x: number;
  y: number;
}[] = [
  { colour: "cyan", x: 0, y: 0 },
  { colour: "pink", x: 4, y: 0 },
  { colour: "yellow", x: 0, y: 4 },
  { colour: "green", x: 4, y: 4 },
];

export const MARK_PANE_SIZE = 3;

/** Pixel offsets of one waving pane: the columns step down then up, a flag in a pixel breeze. */
export const MARK_WAVE: readonly number[] = [0, 1, 0];

/** The lit pixels of the mark, 7 units wide and 8 tall. */
export function markPixels(): (Pixel & { colour: MarkColour })[] {
  const pixels: (Pixel & { colour: MarkColour })[] = [];
  for (const pane of MARK_PANES)
    for (let column = 0; column < MARK_PANE_SIZE; column++) {
      const lift = MARK_WAVE[column] ?? 0;
      for (let row = 0; row < MARK_PANE_SIZE; row++)
        pixels.push({
          colour: pane.colour,
          x: pane.x + column,
          y: pane.y + row + lift,
        });
    }
  return pixels;
}
