/**
 * Adds a head to `public/avatars/neon-heads.png` without redrawing the ten that are already in it.
 *
 * The original sheet was image-generated (see `public/avatars/PROVENANCE.md`) as five columns by two rows. The eleventh
 * head — the mushroom, the one a human wears in the slot the robot used to fill — is drawn here instead, as a 32×32
 * pixel grid built from geometry, because that is what the style already is: chunky pixels, one navy outline, a lighter
 * top-left and a darker lower edge. Keeping it as code rather than as another opaque PNG means the cell can be nudged
 * and rebuilt, and that a reviewer can read what it is.
 *
 * The existing image is copied in one piece rather than cell by cell, so none of the ten is resampled by more than the
 * 0.13% vertical stretch that makes the sheet an exact three rows (793 → 794 = 2 × 397).
 *
 *   npx tsx scripts/build-avatar-atlas.ts          # rewrites public/avatars/neon-heads.png
 *   npx tsx scripts/build-avatar-atlas.ts --check  # fails if the file on disk is not what this script draws
 */
import { readFile, writeFile } from "node:fs/promises";
import { launchSelected } from "./lib/browser.js";

/** One cell, and the grid the sheet becomes: eleven heads in five columns, so the third row has four spares. */
const CELL = 397,
  COLUMNS = 5,
  ROWS = 3;
/** The pixel grid each drawn head is built on, and how many device pixels one of its pixels takes. */
const GRID = 32,
  SCALE = 9;
const ATLAS = "public/avatars/neon-heads.png";

/**
 * The mushroom, as the flat data the page turns into pixels. Every shape is snapped to the 32×32 grid there; the
 * outline is computed from the silhouette, so it stays one pixel wide wherever the shape goes.
 */
const MUSHROOM = {
  outline: "#221a3c",
  /** The cap is a dome: an ellipse cut off flat where the body starts, so it reads as a hat rather than a ball. */
  cap: { cx: 16, cy: 14.5, rx: 15, ry: 12, base: "#e8433f", bottom: 15 },
  capLight: "#ff8874",
  capShade: "#ab2740",
  /** Cream spots, in grid units: centre and radius. */
  spots: [
    { cx: 8, cy: 10, r: 3 },
    { cx: 19.5, cy: 7.5, r: 2.5 },
    { cx: 24.5, cy: 12.5, r: 2.2 },
    { cx: 13.5, cy: 13, r: 1.9 },
  ],
  spot: "#fff2d8",
  /** The body under it, wide enough to carry a face the size the rest of the sheet uses. */
  stem: { x0: 7.5, x1: 24.5, y0: 15, y1: 30, base: "#f7e6c8" },
  stemShade: "#d8bd97",
  eye: { dark: "#221a3c", light: "#ffffff" },
  mouth: "#e0607a",
};

const page = await (
  await launchSelected("chromium", { headless: true })
).newPage();
// tsx compiles named arrow functions with esbuild's keep-names helper, which does not exist inside the page: the
// body below is sent as source text, so it has to find one. Passed as a string, so nothing transforms this line.
await page.evaluate("globalThis.__name ??= (value) => value");
const source = `data:image/png;base64,${(await readFile(ATLAS)).toString("base64")}`;
const dataUrl = await page.evaluate(
  async ([src, cell, columns, rows, grid, scale, artJson]) => {
    const art = JSON.parse(artJson) as typeof MUSHROOM;
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = cell * columns;
    canvas.height = cell * rows;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    // The ten that are already there, in one piece. Only the first two rows' worth of the source is taken, so running
    // this on its own output rebuilds the same sheet instead of compositing over it: from the original 793-tall sheet
    // that is the whole image, stretched the 0.13% that makes two exact rows; from a sheet this script already wrote
    // it is the top 794 pixels, copied one to one. Idempotent either way, which is what makes `--check` mean anything.
    const band = Math.min(image.height, cell * 2);
    ctx.drawImage(
      image,
      0,
      0,
      image.width,
      band,
      0,
      0,
      cell * columns,
      cell * 2,
    );

    // The eleventh, drawn at 32×32 and blown up with smoothing off so its pixels stay square.
    const head = document.createElement("canvas");
    head.width = head.height = grid;
    const hx = head.getContext("2d")!;
    const px = (x: number, y: number, color: string) => {
      hx.fillStyle = color;
      hx.fillRect(x, y, 1, 1);
    };
    // The cap's underside curves down towards its edges instead of being cut off flat, so it overhangs the body the
    // way a cap does. A straight line there was the one shape on the sheet that looked drawn rather than grown.
    const capBottom = (x: number) =>
      art.cap.bottom + 2.6 * ((x + 0.5 - art.cap.cx) / art.cap.rx) ** 2;
    const inCap = (x: number, y: number) =>
      ((x + 0.5 - art.cap.cx) / art.cap.rx) ** 2 +
        ((y + 0.5 - art.cap.cy) / art.cap.ry) ** 2 <=
        1 && y + 0.5 <= capBottom(x);
    // A superellipse rather than a rectangle: every head on this sheet is round-shouldered, and a box would be the one
    // thing that gave the drawn cell away at a glance.
    const inStem = (x: number, y: number) => {
      const { x0, x1, y0, y1 } = art.stem;
      const cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2,
        rx = (x1 - x0) / 2,
        ry = (y1 - y0) / 2;
      return (
        Math.abs((x + 0.5 - cx) / rx) ** 3.2 +
          Math.abs((y + 0.5 - cy) / ry) ** 3.2 <=
        1
      );
    };
    const filled = (x: number, y: number) => inCap(x, y) || inStem(x, y);

    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        if (!filled(x, y)) continue;
        if (inCap(x, y)) {
          // Light from the upper left: a band of highlight, the base, then a darker rim along the cap's lower edge.
          const lift =
            (x + 0.5 - art.cap.cx) / art.cap.rx +
            (y + 0.5 - art.cap.cy) / art.cap.ry;
          px(x, y, lift < -0.6 ? art.capLight : art.cap.base);
          const depth =
            ((x + 0.5 - art.cap.cx) / art.cap.rx) ** 2 +
            ((y + 0.5 - art.cap.cy) / art.cap.ry) ** 2;
          if (depth > 0.7 && y + 0.5 > art.cap.cy - 2) px(x, y, art.capShade);
        } else {
          // The body, with the cap's shadow across its top and the light falling off towards its lower right.
          const underCap = y + 0.5 < art.cap.bottom + 2;
          const away = (x + 0.5 - 16) / 8.5 + (y + 0.5 - 22.5) / 7.5 > 0.95;
          px(x, y, underCap || away ? art.stemShade : art.stem.base);
        }
      }
    // The spots sit on the cap only, and never on its outline, so they read as marks rather than holes.
    for (const spot of art.spots)
      for (let y = 0; y < grid; y++)
        for (let x = 0; x < grid; x++)
          if (
            inCap(x, y) &&
            (x + 0.5 - spot.cx) ** 2 + (y + 0.5 - spot.cy) ** 2 <= spot.r ** 2
          ) {
            // Keep a pixel of cap between a spot and the silhouette's edge.
            const edge = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].some(([dx, dy]) => !inCap(x + dx!, y + dy!));
            if (!edge) px(x, y, art.spot);
          }

    // The face, on the stem: two round eyes with a highlight each, and a small smile between them. Drawn at the size
    // the other heads use — the eyes are what carries a 40-pixel-tall portrait, so they are deliberately large.
    for (const [ex, ey] of [
      [10, 19],
      [18, 19],
    ] as const) {
      for (let y = ey; y < ey + 5; y++)
        for (let x = ex; x < ex + 4; x++) {
          const corner =
            (x === ex || x === ex + 3) && (y === ey || y === ey + 4);
          if (!corner) px(x, y, art.eye.dark);
        }
      px(ex + 1, ey + 1, art.eye.light);
      px(ex + 2, ey + 1, art.eye.light);
      px(ex + 1, ey + 2, art.eye.light);
    }
    for (const [mx, my] of [
      [15, 26],
      [16, 26],
      [14, 25],
      [17, 25],
    ] as const)
      px(mx, my, art.mouth);

    // One navy pixel wherever the silhouette meets nothing: the outline every other head in this sheet wears.
    const edges: [number, number][] = [];
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        if (filled(x, y)) continue;
        const touches = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ].some(([dx, dy]) => filled(x + dx!, y + dy!));
        if (touches) edges.push([x, y]);
      }
    for (const [x, y] of edges) px(x, y, art.outline);

    // Centre the head in its cell, at about the 70% the others fill.
    const size = grid * scale,
      offset = Math.round((cell - size) / 2);
    ctx.drawImage(
      head,
      0,
      0,
      grid,
      grid,
      offset,
      cell * 2 + offset,
      size,
      size,
    );
    return canvas.toDataURL("image/png");
  },
  [source, CELL, COLUMNS, ROWS, GRID, SCALE, JSON.stringify(MUSHROOM)] as const,
);
await page.context().browser()!.close();

const bytes = Buffer.from(dataUrl.split(",")[1]!, "base64");
if (process.argv.includes("--check")) {
  const current = await readFile(ATLAS);
  if (!current.equals(bytes)) {
    console.error(
      `${ATLAS} is not what scripts/build-avatar-atlas.ts draws — re-run it without --check.`,
    );
    process.exit(1);
  }
  console.log(`${ATLAS} matches the script.`);
} else {
  await writeFile(ATLAS, bytes);
  console.log(
    `${ATLAS}: ${CELL * COLUMNS}×${CELL * ROWS}, ${COLUMNS}×${ROWS} cells, ${bytes.length} bytes`,
  );
}
