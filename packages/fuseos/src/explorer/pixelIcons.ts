/**
 * Explorer's toolbar pictures as pixel data: one character per pixel, drawn for this desktop rather
 * than taken from a Windows bitmap. A toolbar button shows its picture in grey until the pointer is
 * over it (the Internet Explorer 4 "cool bar" look), and embossed when it is disabled.
 */

export const PIXEL_ICON_SIZE = 20;

/** One character of a grid names a colour; "." is transparent. */
export const PIXEL_PALETTE = {
  K: "#000000",
  g: "#808080",
  s: "#c0c0c0",
  W: "#ffffff",
  B: "#000080",
  b: "#0000ff",
  T: "#008080",
  c: "#00ffff",
  Y: "#ffff00",
  y: "#808000",
  R: "#ff0000",
} as const;

export type PixelColour = keyof typeof PIXEL_PALETTE;

/** The colours that read as ink; a disabled picture keeps only these, in grey with a white shadow. */
const INK: ReadonlySet<string> = new Set(["K", "g", "B", "b", "T", "R", "y"]);

export type PixelIconName =
  | "back"
  | "forward"
  | "up"
  | "cut"
  | "copy"
  | "paste"
  | "undo"
  | "delete"
  | "properties"
  | "views";

const BACK = [
  "....................",
  "....................",
  "....................",
  ".........K..........",
  "........KK..........",
  ".......KcK..........",
  "......KcTK..........",
  ".....KcTTKKKKKKKK...",
  "....KcTTTccccccTK...",
  "...KcTTTTTTTTTTTK...",
  "....KTTTTTTTTTTTK...",
  ".....KTTTKKKKKKKK...",
  "......KTTK..........",
  ".......KTK..........",
  "........KK..........",
  ".........K..........",
  "....................",
  "....................",
  "....................",
  "....................",
];

const UP = [
  "....................",
  "....................",
  "...KKKKK............",
  "..KYYYYYK...........",
  ".KYYYYYYYKKKKKKKKK..",
  ".KYWWWWWWWWWWWWWYK..",
  ".KYWYYYYYYYYYYYYYK..",
  ".KYWYYYYYKYYYYYYYK..",
  ".KYWYYYYKKKYYYYYYK..",
  ".KYWYYYKKKKKYYYYYK..",
  ".KYWYYYYYKYYYYYYYK..",
  ".KYWYYYYYKYYYYYYYK..",
  ".KYWYYYYYKKKKKYYYK..",
  ".KYWYYYYYYYYYYYYYK..",
  ".KYYYYYYYYYYYYYYyK..",
  ".KyyyyyyyyyyyyyyyK..",
  ".KKKKKKKKKKKKKKKKK..",
  "....................",
  "....................",
  "....................",
];

const CUT = [
  "....................",
  ".....K.......K......",
  ".....KK.....KK......",
  "......K.....K.......",
  "......KK...KK.......",
  ".......K...K........",
  ".......KK.KK........",
  "........K.K.........",
  "........KKK.........",
  ".........K..........",
  "........KKK.........",
  ".......KK.KK........",
  ".....BBK...KBB......",
  "....B..B...B..B.....",
  "....B..B...B..B.....",
  "....B..B...B..B.....",
  ".....BB.....BB......",
  "....................",
  "....................",
  "....................",
];

const COPY = [
  "....................",
  "..KKKKKKKK..........",
  "..KWWWWWWKK.........",
  "..KWWWWWWKWK........",
  "..KWBBBBWKKKK.......",
  "..KWWWWWKKKKKKKK....",
  "..KWBBBBKWWWWWWKK...",
  "..KWWWWWKWWWWWWKWK..",
  "..KWBBBBKWBBBBWKKKK.",
  "..KWWWWWKWWWWWWWWWK.",
  "..KWBBBBKWBBBBBBBWK.",
  "..KWWWWWKWWWWWWWWWK.",
  "..KKKKKKKWBBBBBBBWK.",
  "........KWWWWWWWWWK.",
  "........KWBBBBBBBWK.",
  "........KWWWWWWWWWK.",
  "........KKKKKKKKKKK.",
  "....................",
  "....................",
  "....................",
];

const PASTE = [
  "....................",
  ".......KKKK.........",
  "..KKKKKsWWsKKKKK....",
  "..KyyyKKKKKKyyyK....",
  "..KyyyyyyyyyyyyK....",
  "..KyyyyyyyyyyyyK....",
  "..KyyyyyyyyyyyyK....",
  "..KyyyyyKKKKKKKKK...",
  "..KyyyyyKWWWWWWKK...",
  "..KyyyyyKWWWWWWKWK..",
  "..KyyyyyKWBBBBWKKKK.",
  "..KyyyyyKWWWWWWWWWK.",
  "..KyyyyyKWBBBBBBBWK.",
  "..KKKKKKKWWWWWWWWWK.",
  "........KWBBBBBBBWK.",
  "........KWWWWWWWWWK.",
  "........KKKKKKKKKKK.",
  "....................",
  "....................",
  "....................",
];

const UNDO = [
  "....................",
  "....................",
  "....................",
  "...........BBBBB....",
  ".........BBbbbbbB...",
  "..B.....BbbBBBBbbB..",
  "..BB...BbbB....BbB..",
  "..BbB.BbbB.....BbB..",
  "..BbbBbbB......BbB..",
  "..BbbbbB.......BbB..",
  "..BbbbB........BbB..",
  "..BbbbbbB......BbB..",
  "..BBBBBBBB....BbB...",
  "..............BbB...",
  ".............BbB....",
  ".............BBB....",
  "....................",
  "....................",
  "....................",
  "....................",
];

const DELETE = [
  "....................",
  "....................",
  "...RR..........R....",
  "...RRR........RR....",
  "....RRR......RR.....",
  ".....RRR....RR......",
  "......RRR..RR.......",
  ".......RRRRR........",
  "........RRR.........",
  ".......RRRRR........",
  "......RRR..RR.......",
  ".....RRR....RR......",
  "....RRR......RR.....",
  "...RRR........RR....",
  "...RR..........R....",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
];

const PROPERTIES = [
  "....................",
  "..............R.....",
  ".............RR.....",
  "....KKKKKKKKRR......",
  "....KWWWWWWRRKK.....",
  "....KWWRWWRRWKWK....",
  "....KWWRRRRWWKKKK...",
  "....KWWWRRWWWWWWK...",
  "....KWWWWWWWWWWWK...",
  "....KWBBBBBBBBBWK...",
  "....KWWWWWWWWWWWK...",
  "....KWBBBBBBBBBWK...",
  "....KWWWWWWWWWWWK...",
  "....KWBBBBBBBBBWK...",
  "....KWWWWWWWWWWWK...",
  "....KWBBBBBBBBBWK...",
  "....KWWWWWWWWWWWK...",
  "....KKKKKKKKKKKKK...",
  "....................",
  "....................",
];

const VIEWS = [
  "....................",
  "....................",
  "...KKKKKKKKKKKKKK...",
  "...KBBBBBBBBBBBBK...",
  "...KKKKKKKKKKKKKK...",
  "...KWWWWWWWWWWWWK...",
  "...KWYYWKKKKKKKWK...",
  "...KWYYWWWWWWWWWK...",
  "...KWWWWWWWWWWWWK...",
  "...KWYYWKKKKKKKWK...",
  "...KWYYWWWWWWWWWK...",
  "...KWWWWWWWWWWWWK...",
  "...KWYYWKKKKKKKWK...",
  "...KWYYWWWWWWWWWK...",
  "...KWWWWWWWWWWWWK...",
  "...KKKKKKKKKKKKKK...",
  "....................",
  "....................",
  "....................",
  "....................",
];

/** The same picture facing the other way: Forward is Back mirrored. */
function mirrored(grid: readonly string[]): string[] {
  return grid.map((row) => [...row].reverse().join(""));
}

export const PIXEL_ICONS: Readonly<Record<PixelIconName, readonly string[]>> = {
  back: BACK,
  forward: mirrored(BACK),
  up: UP,
  cut: CUT,
  copy: COPY,
  paste: PASTE,
  undo: UNDO,
  delete: DELETE,
  properties: PROPERTIES,
  views: VIEWS,
};

export type PixelLayer = { colour: string; path: string };

function isPixelColour(value: string): value is PixelColour {
  return value in PIXEL_PALETTE;
}

/** One SVG path over the runs of pixels that pass `keep`, as 1x1 squares joined along each row. */
function runsPath(
  grid: readonly string[],
  keep: (pixel: string) => boolean,
): string {
  const parts: string[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!keep(row.charAt(x))) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && keep(row.charAt(x))) x += 1;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join("");
}

/** The picture in colour: one path per palette colour it uses. */
export function colourLayers(grid: readonly string[]): PixelLayer[] {
  const used = new Set(grid.join("").split("").filter(isPixelColour));
  return [...used].map((colour) => ({
    colour: PIXEL_PALETTE[colour],
    path: runsPath(grid, (pixel) => pixel === colour),
  }));
}

/** The picture's ink alone, for the embossed look of a disabled button. */
export function inkPath(grid: readonly string[]): string {
  return runsPath(grid, (pixel) => INK.has(pixel));
}
