import type { MakeSurface, PixelPaint } from "./surface.js";

/**
 * The HUD's lettering: a 3 × 5 pixel font of capitals, digits and a few marks, after the concept page's. Each glyph is
 * five rows of three pixels, one octal digit a row (4 the left pixel, 2 the middle, 1 the right), and a line of text
 * steps `ADVANCE` pixels a glyph. A label is painted once into a surface and reused, so a frame only blits it.
 */
export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = GLYPH_W + 1;

// prettier-ignore
const GLYPHS: Readonly<Record<string, string>> = {
  A: "25755", B: "65656", C: "34443", D: "65556", E: "74647", F: "74644",
  G: "34553", H: "55755", I: "72227", J: "11152", K: "55655", L: "44447",
  M: "57755", N: "65555", O: "25552", P: "65644", Q: "25563", R: "65655",
  S: "34216", T: "72222", U: "55557", V: "55552", W: "55775", X: "55255",
  Y: "55222", Z: "71247",
  0: "75557", 1: "26227", 2: "61247", 3: "61216", 4: "55711",
  5: "74616", 6: "34757", 7: "71222", 8: "75757", 9: "75716",
  " ": "00000", "-": "00700", ".": "00002", ",": "00024", "!": "22202",
  "?": "61202", "'": "22000", ":": "02020", "/": "11244", "+": "02720",
  "=": "07070", "_": "00007", "#": "57575", "(": "24442", ")": "21112",
  "×": "05250",
};

/** Each glyph's rows as bit masks, decoded once. */
const ROWS = new Map(
  Object.entries(GLYPHS).map(([char, rows]) => [
    char,
    [...rows].map((digit) => parseInt(digit, 8)),
  ]),
);

/** Letters the font lacks but can spell. */
const SPELLED: Readonly<Record<string, string>> = {
  Æ: "AE",
  Ø: "O",
  Œ: "OE",
  ẞ: "SS",
};

/** The pixels `text` spans: `ADVANCE` a glyph, less the gap after the last; 0 for no text. */
export const textWidth = (text: string): number =>
  Math.max(0, text.length * ADVANCE - 1);

/**
 * A player's name as the font can write it: in capitals, accents taken off (Å is A), a few letters spelled out (Ø is
 * O, Æ is AE), anything else the font lacks dropped, spaces closed up, and at most `max` glyphs.
 */
export function fontText(raw: string, max: number): string {
  const letters = [...raw.normalize("NFD").toUpperCase()]
    .map((char) => SPELLED[char] ?? char)
    .join("")
    .replace(/\p{M}/gu, "");
  const kept = [...letters]
    .map((char) => (ROWS.has(char) ? char : char.trim() ? "" : " "))
    .join("")
    .replace(/ +/g, " ")
    .trim();
  return kept.slice(0, Math.max(0, max)).trim();
}

/** Paints `text` with its top-left at (`x`, `y`) in `color`: a rectangle per run of lit pixels in a glyph's row. */
export function paintText(
  paint: PixelPaint,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  paint.fillStyle = color;
  [...text].forEach((char, i) => {
    const rows = ROWS.get(char);
    if (!rows) return;
    rows.forEach((bits, row) => {
      for (let col = 0; col < GLYPH_W;) {
        const lit = (bits >> (GLYPH_W - 1 - col)) & 1;
        let end = col + 1;
        while (end < GLYPH_W && ((bits >> (GLYPH_W - 1 - end)) & 1) === lit)
          end++;
        if (lit) paint.fillRect(x + i * ADVANCE + col, y + row, end - col, 1);
        col = end;
      }
    });
  });
}

/** A label painted into a surface, `w` × `GLYPH_H`. */
export interface Label<Image> {
  readonly image: Image;
  readonly w: number;
  readonly h: number;
}

/** At most this many labels are kept; past it the cache starts over (names come and go, but only a few at a time). */
export const MAX_LABELS = 96;

/** Paints each text in each colour once into a surface from `make` and hands back the same one after. */
export function createLettering<Image>(make: MakeSurface<Image>): {
  label(text: string, color: string): Label<Image>;
} {
  const byColor = new Map<string, Map<string, Label<Image>>>();
  let count = 0;
  return {
    label(text, color) {
      let labels = byColor.get(color);
      const known = labels?.get(text);
      if (known) return known;
      if (count >= MAX_LABELS) {
        byColor.clear();
        labels = undefined;
        count = 0;
      }
      if (!labels) byColor.set(color, (labels = new Map()));
      const [w, h] = [Math.max(1, textWidth(text)), GLYPH_H];
      const { image, paint } = make(w, h);
      paintText(paint, text, 0, 0, color);
      const made = { image, w, h };
      labels.set(text, made);
      count++;
      return made;
    },
  };
}
