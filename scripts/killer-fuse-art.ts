/**
 * Killer Fuse's art pipeline. Three steps, each a subcommand:
 *
 *   OPENAI_API_KEY=... pnpm exec tsx scripts/killer-fuse-art.ts generate [id...]   image model -> art/raw-full/ (untracked)
 *   pnpm exec tsx scripts/killer-fuse-art.ts cut [id...]                           raw-full -> art/raw/ (small, tracked)
 *   pnpm exec tsx scripts/killer-fuse-art.ts build                                 art/raw + procedural -> public/killer-fuse/art
 *
 * `generate` asks the image model for sprite sheets on a flat chroma key with the team colour painted green.
 * `cut` finds each drawing, measures the grid its soft "pixels" sit on and samples it into real pixels on the
 * shared palette (backgrounds and the cover are area-averaged to their final size instead). `build` reduces
 * those to the game's resolution, aligns the frames, recolours them per team, adds the hand-pixelled art and
 * writes the sheets, `manifest.json`, a contact sheet and a mock scene.
 * `games/killer-fuse/art/README.md` has the details.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  CREAM,
  CUTS,
  GATES,
  GENERATIONS,
  GOLD,
  ICE,
  INK,
  NAVY,
  SCENERY,
  SNAIL,
  TAN,
  TEAMS,
  UNIT_NEUTRALS,
  UNITS,
  VIOLET,
  WHITE,
  type Generation,
  type Ramp,
  type Team,
  type UnitSheet,
} from "../games/killer-fuse/art/assets.ts";
import {
  alpha,
  blit,
  bounds,
  boxDown,
  clear,
  crop,
  decodePng,
  despeckle,
  encodePng,
  fill,
  findGrid,
  findSprites,
  flipX,
  hex,
  img,
  isTeam,
  keyOut,
  luma,
  nearest,
  outline,
  put,
  recolour,
  rgbAt,
  scaleUp,
  snap,
  toHex,
  trim,
  type Img,
  type Rgb,
} from "../games/killer-fuse/art/pixel.ts";
import {
  banner,
  berry,
  berryCarried,
  berryLoose,
  berryPop,
  deathPuff,
  egg,
  flapPuff,
  gateSparkle,
  goalPost,
  hive,
  HIVE_HOLES,
  hiveHole,
  killBurst,
  PILE_SLOTS,
  pileBase,
  tile,
  TILES,
  type WinKind,
} from "../games/killer-fuse/art/procedural.ts";

const ART = fileURLToPath(
  new URL("../games/killer-fuse/art/", import.meta.url),
);
const OUT = fileURLToPath(
  new URL("../games/killer-fuse/public/killer-fuse/art/", import.meta.url),
);

const read = (path: string) => decodePng(readFileSync(path));
const write = (path: string, image: Img) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(image));
};

const PLAYING: readonly Team[] = ["cyan", "pink"];

// ---------------------------------------------------------------------------------------------------------------
// generate

const MODELS = ["gpt-image-2", "gpt-image-1.5"];

const generate = async (spec: Generation, key: string) => {
  for (const model of MODELS) {
    let response: Response;
    if (spec.editOf) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", spec.prompt);
      form.set("size", spec.size);
      form.set("quality", "high");
      form.set(
        "image",
        new Blob([readFileSync(`${ART}raw-full/${spec.editOf}.png`)], {
          type: "image/png",
        }),
        `${spec.editOf}.png`,
      );
      response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
    } else
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: spec.prompt,
          size: spec.size,
          quality: "high",
          output_format: "png",
        }),
      });
    const body = (await response.json()) as {
      data?: { b64_json?: string }[];
      error?: { message?: string };
    };
    const b64 = body.data?.[0]?.b64_json;
    if (b64) {
      mkdirSync(`${ART}raw-full`, { recursive: true });
      writeFileSync(
        `${ART}raw-full/${spec.id}.png`,
        Buffer.from(b64, "base64"),
      );
      console.log(`${spec.id}: generated with ${model}`);
      return;
    }
    console.error(
      `${spec.id}: ${model} failed: ${body.error?.message ?? response.status}`,
    );
  }
  throw new Error(`${spec.id}: no model produced an image`);
};

// ---------------------------------------------------------------------------------------------------------------
// cut: raw-full -> art/raw (real pixels, canonical colours)

/** The neutral team colour as it is stored in `art/raw`: four greens, darkest first. */
const GREEN: Ramp = [
  hex("#004d00"),
  hex("#009a00"),
  hex("#00ff00"),
  hex("#a0ffa0"),
];

const same = (a: Rgb, b: Rgb) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isGreen = (c: Rgb) => GREEN.some((g) => same(g, c));

const canonical =
  (neutrals: readonly Rgb[], team: boolean) =>
  (c: Rgb): Rgb => {
    if (!team || !isTeam(c)) return nearest(c, neutrals);
    const l = luma(c);
    return GREEN[l > 0.78 ? 3 : l > 0.47 ? 2 : l > 0.24 ? 1 : 0];
  };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Cuts a generated sheet into its drawings, each sampled on the sheet's art-pixel grid. */
const cutSheet = ({ id, count, key, units }: (typeof CUTS)[number]) => {
  const keyed = keyOut(
    read(`${ART}raw-full/${id}.png`),
    key === "green" ? isTeam : undefined,
  );
  // A logo is one drawing however far apart its letters are.
  const boxes =
    count === 1
      ? [bounds(keyed) ?? { x: 0, y: 0, w: keyed.w, h: keyed.h }]
      : findSprites(keyed, 12, 1200);
  if (boxes.length !== count)
    throw new Error(
      `${id}: expected ${count} drawings, found ${boxes.length}: ${JSON.stringify(boxes)}`,
    );
  const pitch = median(boxes.map((box) => findGrid(keyed, box, 4, 40).pitch));
  const sprites = boxes.map((box) => {
    const grid = findGrid(keyed, box, pitch * 0.985, pitch * 1.015);
    return recolour(
      trim(despeckle(snap(keyed, box, grid))),
      canonical(units ? UNIT_NEUTRALS : SCENERY, key !== "green"),
    );
  });
  const cw = Math.max(...sprites.map((s) => s.w)) + 2;
  const ch = Math.max(...sprites.map((s) => s.h)) + 2;
  const strip = img(cw * sprites.length, ch);
  sprites.forEach((sprite, i) => blit(strip, sprite, i * cw + 1, 1));
  write(`${ART}raw/${id}.png`, strip);
  console.log(
    `${id}: ${sprites.length} drawings, pitch ${pitch.toFixed(2)}, cells ${cw}x${ch}`,
  );
};

/** Dark, low-contrast palettes for the three background layers, far to near. */
const BACKDROPS: Record<string, { palette: readonly Rgb[]; keyed: boolean }> = {
  "bg-far": {
    palette: [
      NAVY.void,
      hex("#030a1c"),
      NAVY.deep,
      hex("#081029"),
      VIOLET[0],
    ].map((c, i) => (i === 4 ? hex("#130f33") : c)),
    keyed: false,
  },
  "bg-mid": {
    palette: [
      NAVY.deep,
      hex("#081029"),
      NAVY.night,
      hex("#0e1a40"),
      hex("#1a1446"),
      hex("#0a2c4a"),
      hex("#3a0f38"),
    ],
    keyed: true,
  },
  "bg-near": {
    palette: [
      NAVY.night,
      hex("#0e1a40"),
      NAVY.dusk,
      hex("#17275a"),
      VIOLET[0],
      GOLD[0],
    ],
    keyed: true,
  },
};

/** Crops a 3:2 generation to 16:9 and averages it down to the game's 480 by 270, onto a layer's palette. */
const cutBackdrop = (id: string) => {
  const spec = BACKDROPS[id];
  if (!spec) throw new Error(`no backdrop ${id}`);
  const full = read(`${ART}raw-full/${id}.png`);
  const h = Math.round((full.w * 9) / 16);
  // The skyline and the frame are anchored to the bottom edge; the far sky is centred.
  const top = id === "bg-far" ? Math.floor((full.h - h) / 2) : full.h - h;
  const source = crop(spec.keyed ? keyOut(full) : full, 0, top, full.w, h);
  const small = recolour(boxDown(source, 480, 270), (c) =>
    nearest(c, spec.palette),
  );
  write(`${ART}raw/${id}.png`, small);
  console.log(`${id}: 480x270, ${spec.palette.length} colours`);
};

/** Reduces `m` to at most `count` colours by median cut; used only for the cover, which has its own palette. */
const medianCut = (m: Img, count: number): Img => {
  const pixels: Rgb[] = [];
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) pixels.push(rgbAt(m, x, y));
  let boxes: Rgb[][] = [pixels];
  while (boxes.length < count) {
    let widest = 0;
    let channel = 0;
    let range = -1;
    boxes.forEach((box, i) => {
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of box) {
          lo = Math.min(lo, p[c] ?? 0);
          hi = Math.max(hi, p[c] ?? 0);
        }
        // Weight by population so big flat areas do not hoard entries, small bright ones still get some.
        const score = (hi - lo) * Math.sqrt(box.length);
        if (box.length > 1 && score > range) {
          range = score;
          widest = i;
          channel = c;
        }
      }
    });
    if (range <= 0) break;
    const box = [...(boxes[widest] ?? [])].sort(
      (a, b) => (a[channel] ?? 0) - (b[channel] ?? 0),
    );
    const mid = Math.floor(box.length / 2);
    boxes = [
      ...boxes.slice(0, widest),
      box.slice(0, mid),
      box.slice(mid),
      ...boxes.slice(widest + 1),
    ];
  }
  const palette = boxes.map((box): Rgb => {
    const sum = [0, 0, 0];
    for (const p of box)
      for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (p[c] ?? 0);
    return [
      Math.round((sum[0] ?? 0) / box.length),
      Math.round((sum[1] ?? 0) / box.length),
      Math.round((sum[2] ?? 0) / box.length),
    ];
  });
  return recolour(m, (c) => nearest(c, palette));
};

const cutCover = () => {
  const small = medianCut(
    boxDown(read(`${ART}raw-full/cover.png`), 256, 256),
    40,
  );
  write(`${ART}raw/cover.png`, small);
  console.log("cover: 256x256, 40 colours");
};

/** The drawings of an `art/raw` strip. */
const readStrip = (id: string, count: number): Img[] => {
  const strip = read(`${ART}raw/${id}.png`);
  const cw = strip.w / count;
  return Array.from({ length: count }, (_, i) =>
    trim(crop(strip, i * cw, 0, cw, strip.h)),
  );
};

// ---------------------------------------------------------------------------------------------------------------
// build helpers

/**
 * Reduces pixel art by a whole factor `k`: each k-by-k block becomes one pixel of the block's most common colour,
 * and is kept when at least half of it is drawn, so thin limbs thicken rather than vanish. The block alignment
 * that leaves the blocks most uniform is used, which is the one that matches the drawing's own thick features.
 */
const reduce = (m: Img, k: number): Img => {
  if (k === 1) return m;
  let best: Img | undefined;
  let bestScore = -Infinity;
  for (let oy = 0; oy < k; oy++)
    for (let ox = 0; ox < k; ox++) {
      const w = Math.ceil((m.w + ox) / k);
      const h = Math.ceil((m.h + oy) / k);
      const out = img(w, h);
      let score = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const votes = new Map<number, { n: number; c: Rgb }>();
          let drawn = 0;
          for (let j = 0; j < k; j++)
            for (let i = 0; i < k; i++) {
              const sx = x * k + i - ox;
              const sy = y * k + j - oy;
              if (!alpha(m, sx, sy)) continue;
              drawn++;
              const c = rgbAt(m, sx, sy);
              const key = (c[0] << 16) | (c[1] << 8) | c[2];
              const vote = votes.get(key) ?? { n: 0, c };
              // Ink (pupils, stripes) is the detail that reads at this size; let it win ties.
              vote.n += same(c, INK) ? 1.01 : 1;
              votes.set(key, vote);
            }
          let top: { n: number; c: Rgb } | undefined;
          for (const vote of votes.values())
            if (!top || vote.n > top.n) top = vote;
          // A pupil smaller than a block would vanish into the face around it; a face without an eye is not a
          // character, so any ink inside a block that is otherwise face wins it.
          const ink = [...votes.values()].find((vote) => same(vote.c, INK));
          const face = [...votes.values()].every(
            (vote) =>
              same(vote.c, INK) || same(vote.c, WHITE) || same(vote.c, CREAM),
          );
          if (ink && face && votes.size > 1 && drawn === k * k) top = ink;
          const empty = k * k - drawn;
          score += Math.max(top?.n ?? 0, empty) / (k * k);
          if (top && drawn * 2 >= k * k) put(out, x, y, top.c);
        }
      // Normalise by area: the alignments differ by up to one row and column of blocks.
      const norm = score / (w * h);
      if (norm > bestScore) {
        bestScore = norm;
        best = out;
      }
    }
  return trim(best ?? m);
};

/**
 * Removes single-pixel shading noise from the team colour: a team pixel none of whose four neighbours shares its
 * shade takes the shade most of them have. Halving a shaded drawing leaves such specks; flat areas read better.
 */
const smooth = (m: Img): Img => {
  const out = img(m.w, m.h);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!alpha(m, x, y)) continue;
      const c = rgbAt(m, x, y);
      put(out, x, y, c);
      if (!isGreen(c)) continue;
      const around = (
        [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as const
      )
        .filter(([nx, ny]) => alpha(m, nx, ny))
        .map(([nx, ny]) => rgbAt(m, nx, ny))
        .filter(isGreen);
      if (around.some((n) => same(n, c))) continue;
      const counts = GREEN.map((g) => around.filter((n) => same(n, g)).length);
      const most = Math.max(...counts);
      if (most >= 2) put(out, x, y, GREEN[counts.indexOf(most)] ?? c);
    }
  return out;
};

const toRamp = (m: Img, ramp: Ramp): Img =>
  recolour(m, (c) => {
    const i = GREEN.findIndex((g) => same(g, c));
    return i < 0 ? c : (ramp[i] ?? c);
  });

/** Centre of the pixels `core` accepts: a unit's body (ignoring wings and weapons), the snail's shell. */
const centreOf = (m: Img, core: (c: Rgb) => boolean) => {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!alpha(m, x, y) || !core(rgbAt(m, x, y))) continue;
      sx += x;
      sy += y;
      n++;
    }
  return n ? { x: sx / n, y: sy / n } : { x: m.w / 2, y: m.h / 2 };
};

const isBody = (c: Rgb) => isGreen(c) || same(c, CREAM) || same(c, TAN);
const isShell = (c: Rgb) => VIOLET.some((v) => same(v, c));

/** Outlines a cell in place (the outline lands on the cell's own empty border pixels). */
const outlined = (cell: Img, colour: Rgb = NAVY.void): Img =>
  crop(outline(cell, colour), 1, 1, cell.w, cell.h);

const sheetOf = (cells: Img[], columns: number): Img => {
  const first = cells[0] ?? img(1, 1);
  const sheet = img(
    first.w * columns,
    first.h * Math.ceil(cells.length / columns),
  );
  cells.forEach((cell, i) =>
    blit(
      sheet,
      cell,
      (i % columns) * first.w,
      Math.floor(i / columns) * first.h,
    ),
  );
  return sheet;
};

const centred = (m: Img, w: number, h: number): Img => {
  const cell = img(w, h);
  blit(cell, m, Math.floor((w - m.w) / 2), Math.floor((h - m.h) / 2));
  return cell;
};

// ---------------------------------------------------------------------------------------------------------------
// manifest

interface Entry {
  file: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Frame index by name; frames run left to right, then top to bottom. */
  frames: Record<string, number>;
  /** The pixel of a frame the game places at the thing's position. */
  anchor: [number, number];
  [extra: string]: unknown;
}

const assets: Record<string, Entry> = {};
/** The cells of every sheet written, for the previews. */
const built: Record<string, Img[]> = {};

/** Writes a sheet of equal cells and records it. */
const emit = (
  id: string,
  file: string,
  cells: Img[],
  names: readonly string[],
  anchor: [number, number],
  extra: Record<string, unknown> = {},
  columns = cells.length,
) => {
  const sheet = sheetOf(cells, columns);
  const first = cells[0] ?? img(1, 1);
  write(`${OUT}${file}`, sheet);
  built[id] = cells;
  assets[id] = {
    file,
    width: sheet.w,
    height: sheet.h,
    frameWidth: first.w,
    frameHeight: first.h,
    frameCount: cells.length,
    frames: Object.fromEntries(names.map((name, i) => [name, i])),
    anchor,
    ...extra,
  };
  return sheet;
};

// ---------------------------------------------------------------------------------------------------------------
// units

/**
 * Gives a face its pupil back when the reduction lost it: every frame of a character must look at you the same
 * way, or the eye flickers as it animates. The pupil goes on the leading edge of the face, where the others are.
 */
const withEye = (m: Img): Img => {
  const isFace = (x: number, y: number) =>
    alpha(m, x, y) > 0 &&
    (same(rgbAt(m, x, y), CREAM) || same(rgbAt(m, x, y), WHITE));
  let left = m.w;
  let right = -1;
  let top = m.h;
  let bottom = -1;
  let eyes = 0;
  for (let y = 0; y < Math.ceil(m.h * 0.7); y++)
    for (let x = 0; x < m.w; x++) {
      // Wings and swords are white too; a face has cream in it.
      if (isFace(x, y) && same(rgbAt(m, x, y), CREAM)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < 0) return m;
  for (let y = top - 1; y <= bottom + 1; y++)
    for (let x = left - 1; x <= right + 2; x++)
      if (alpha(m, x, y) && same(rgbAt(m, x, y), INK)) eyes++;
  const out = img(m.w, m.h);
  blit(out, m, 0, 0);
  if (eyes > 0) {
    // A pupil on the very edge of the head disappears into the outline: pull it one pixel into the face.
    for (let y = top - 1; y <= bottom + 1; y++)
      for (let x = left; x <= right + 2; x++)
        if (
          alpha(m, x, y) &&
          same(rgbAt(m, x, y), INK) &&
          !alpha(m, x + 1, y) &&
          isFace(x - 1, y)
        ) {
          put(out, x, y, WHITE);
          put(out, x - 1, y, INK);
        }
    return out;
  }
  const x = isFace(right + 1, top + 1) ? right + 1 : right;
  const y = Math.min(bottom - 1, top + 1);
  put(out, x, y, INK);
  if (y + 1 < bottom) put(out, x, y + 1, INK);
  return out;
};

/** The frames of a generated character, reduced and aligned in their cells, still in the neutral green. */
const alignedFrames = (spec: UnitSheet, core: (c: Rgb) => boolean) => {
  const [cw, ch] = spec.cell;
  const sprites = readStrip(spec.from, spec.frames.length).map((s) =>
    withEye(smooth(despeckle(reduce(s, spec.reduce)))),
  );
  const names = spec.frames;
  const refIndex = Math.max(
    0,
    names.findIndex((name) => spec.grounded.includes(name)),
  );
  const ref = sprites[refIndex] ?? img(1, 1);
  // How far above the soles the body centre sits when standing.
  const rise = ref.h - 1 - centreOf(ref, core).y;
  const footX = Math.floor(cw / 2);
  const footY = ch - 2;
  return sprites.map((sprite, i) => {
    const centre = centreOf(sprite, core);
    const grounded = spec.grounded.includes(names[i] ?? "");
    if (sprite.w > cw - 2 || sprite.h > ch - 2)
      throw new Error(
        `${spec.from}/${names[i]}: ${sprite.w}x${sprite.h} does not fit a ${cw}x${ch} cell`,
      );
    // A pose that reaches past the cell (a dive, a thrust sword) is nudged back inside it.
    const clamp = (v: number, size: number, limit: number) =>
      Math.max(1, Math.min(limit - 1 - size, v));
    const x = clamp(Math.round(footX - centre.x), sprite.w, cw);
    const y = grounded
      ? footY - (sprite.h - 1)
      : clamp(Math.round(footY - rise - centre.y), sprite.h, ch);
    const cell = img(cw, ch);
    blit(cell, sprite, x, y);
    return cell;
  });
};

/**
 * The speed form of a unit, made from the same frames so the two are the same character: gold boots, gold antenna
 * or horn tips, and gold dashes streaming behind every frame that moves.
 */
const speedForm = (cell: Img, frame: string, index: number): Img => {
  const out = img(cell.w, cell.h);
  blit(out, cell, 0, 0);
  let top = cell.h;
  let bottom = -1;
  let left = cell.w;
  for (let y = 0; y < cell.h; y++)
    for (let x = 0; x < cell.w; x++)
      if (alpha(cell, x, y) && isGreen(rgbAt(cell, x, y))) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
      }
  for (let y = 0; y < cell.h; y++)
    for (let x = 0; x < cell.w; x++) {
      if (!alpha(cell, x, y)) continue;
      const shade = GREEN.findIndex((g) => same(g, rgbAt(cell, x, y)));
      if (shade < 0) continue;
      if (y >= bottom - 1 || y <= top + 1)
        put(out, x, y, GOLD[Math.max(1, shade)] ?? GOLD[2]);
    }
  if (frame === "idle" || frame === "blink") return out;
  const centre = centreOf(cell, isBody);
  const rows: [number, number, Rgb][] = [
    [-3, 3, GOLD[3]],
    [0, 4, GOLD[2]],
    [3, 2, GOLD[3]],
  ];
  for (const [dy, length, colour] of rows) {
    const y = Math.round(centre.y) + dy;
    // The dashes start clear of the body on this row and flicker by a pixel from frame to frame.
    let start = left;
    for (let x = 0; x < cell.w; x++)
      if (alpha(cell, x, y)) {
        start = x;
        break;
      }
    const from = Math.min(start, left + 3) - 2 - (index % 2);
    for (let i = 0; i < length; i++)
      if (from - i >= 1) put(out, from - i, y, colour);
  }
  return out;
};

/** Where a carried berry's top-left corner goes: centred over the head, overlapping the antennae. */
const carrySpot = (cell: Img): [number, number] => {
  const b = bounds(cell) ?? { x: 0, y: 0, w: cell.w, h: cell.h };
  let sx = 0;
  let n = 0;
  for (let y = b.y; y < b.y + 6; y++)
    for (let x = 0; x < cell.w; x++)
      if (alpha(cell, x, y)) {
        sx += x;
        n++;
      }
  return [Math.round(sx / Math.max(1, n)) - 2, Math.max(1, b.y - 2)];
};

const buildUnits = () => {
  for (const [id, spec] of Object.entries(UNITS)) {
    const base = alignedFrames(spec, isBody);
    const forms: [string, Img[]][] = [[id, base]];
    if (id !== "queen")
      forms.push([
        `speed-${id}`,
        base.map((cell, i) => speedForm(cell, spec.frames[i] ?? "", i)),
      ]);
    for (const [form, cells] of forms) {
      const spots = cells.map(carrySpot);
      const carrying =
        id === "worker"
          ? cells.map((cell, i) => {
              const out = img(cell.w, cell.h);
              blit(out, cell, 0, 0);
              const [x, y] = spots[i] ?? [0, 0];
              blit(out, berryCarried(), x, y);
              return out;
            })
          : [];
      for (const team of PLAYING) {
        const finish = (cell: Img) => outlined(toRamp(cell, TEAMS[team]));
        emit(
          `${form}-${team}`,
          `units/${form}-${team}.png`,
          [...cells, ...carrying].map(finish),
          [
            ...spec.frames,
            ...(carrying.length ? spec.frames.map((n) => `${n}Carry`) : []),
          ],
          [Math.floor(spec.cell[0] / 2), spec.cell[1] - 1],
          {
            animations: spec.animations,
            ...(carrying.length
              ? {
                  // Top-left corner of the 5 by 5 carried berry in each frame, for drawing it separately.
                  carry: spots,
                  note: "Frames named <frame>Carry are the same poses holding a berry.",
                }
              : {}),
          },
          spec.frames.length,
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------
// snail, gates

const buildSnail = () => {
  const cells = alignedFrames(SNAIL, isShell);
  // The saddle is the gold on top of the shell; the rider's soles go on its top row.
  const saddles = cells.map((cell): [number, number] => {
    let sx = 0;
    let n = 0;
    let top = cell.h;
    for (let y = 0; y < cell.h; y++)
      for (let x = 0; x < cell.w; x++)
        if (alpha(cell, x, y) && GOLD.some((g) => same(g, rgbAt(cell, x, y)))) {
          sx += x;
          n++;
          top = Math.min(top, y);
        }
    return [Math.round(sx / Math.max(1, n)), top];
  });
  emit(
    "snail",
    "snail.png",
    cells.map((cell) => outlined(cell)),
    SNAIL.frames,
    [Math.floor(SNAIL.cell[0] / 2), SNAIL.cell[1] - 1],
    {
      animations: SNAIL.animations,
      // Where the rider's soles go in each frame.
      saddle: saddles,
      note: "Faces right; the anchor is under the shell, so the body stretches ahead of it.",
    },
  );
};

/** The doorway of a gate: the dark opening, found by flooding from its middle. */
const doorway = (gate: Img): boolean[] => {
  const inside = new Array<boolean>(gate.w * gate.h).fill(false);
  const dark = (x: number, y: number) => {
    if (!alpha(gate, x, y)) return false;
    return luma(rgbAt(gate, x, y)) < 0.13;
  };
  const stack: [number, number][] = [
    [Math.floor(gate.w / 2), Math.floor(gate.h * 0.6)],
  ];
  while (stack.length) {
    const [x, y] = stack.pop() ?? [0, 0];
    if (x < 0 || y < 0 || x >= gate.w || y >= gate.h) continue;
    if (inside[y * gate.w + x] || !dark(x, y)) continue;
    inside[y * gate.w + x] = true;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return inside;
};

const buildGates = () => {
  const raw = readStrip(GATES.from, GATES.kinds.length).map((s) =>
    smooth(reduce(s, GATES.reduce)),
  );
  const w = Math.max(...raw.map((s) => s.w)) + 2;
  const h = Math.max(...raw.map((s) => s.h)) + 2;
  GATES.kinds.forEach((kind, i) => {
    const gate = raw[i] ?? img(1, 1);
    const cell = img(w, h);
    blit(cell, gate, Math.floor((w - gate.w) / 2), h - 1 - gate.h);
    // The generated lamps and pillars are not quite symmetric; below the emblem a gate is its left half mirrored.
    const box = bounds(cell) ?? { x: 0, y: 0, w, h };
    for (let y = box.y + Math.floor(box.h * 0.42); y < h; y++)
      for (let i = 0; i < Math.floor(box.w / 2); i++) {
        const from = box.x + i;
        const to = box.x + box.w - 1 - i;
        if (alpha(cell, from, y)) put(cell, to, y, rgbAt(cell, from, y));
        else clear(cell, to, y);
      }
    const door = doorway(cell);
    const frames: Img[] = [];
    const names: string[] = [];
    for (const active of [false, true])
      for (const owner of ["neutral", ...PLAYING] as const) {
        const ramp = TEAMS[owner];
        const frame = toRamp(cell, ramp);
        if (active) {
          // In use: the doorway fills with the owner's light, brightest up the middle.
          let lo = w;
          let hi = 0;
          door.forEach((inside, p) => {
            if (!inside) return;
            lo = Math.min(lo, p % w);
            hi = Math.max(hi, p % w);
          });
          door.forEach((inside, p) => {
            if (!inside) return;
            const x = p % w;
            const y = Math.floor(p / w);
            const edge = Math.min(x - lo, hi - x);
            put(
              frame,
              x,
              y,
              edge === 0
                ? ramp[1]
                : edge === 1
                  ? ramp[2]
                  : edge === 2
                    ? ramp[3]
                    : WHITE,
            );
          });
        }
        frames.push(outlined(frame));
        names.push(active ? `${owner}Active` : owner);
      }
    emit(
      `gate-${kind}`,
      `gates/${kind}.png`,
      frames,
      names,
      [Math.floor(w / 2), h - 1],
      {
        note: "Stands on the anchor. <owner>Active is the gate while a worker is transforming inside it.",
      },
    );
  });
};

// ---------------------------------------------------------------------------------------------------------------
// hand-pixelled sheets

const buildProcedural = () => {
  emit(
    "berry",
    "berries/berry.png",
    [berry(), berryCarried(), ...berryLoose()].map((b) =>
      centred(outlined(centred(b, 8, 8)), 8, 8),
    ),
    ["pile", "carried", "loose1", "loose2"],
    [4, 4],
    {
      animations: {
        loose: { frames: ["loose1", "loose2"], fps: 8, loop: true },
      },
    },
  );
  const base = pileBase();
  emit(
    "berry-pile",
    "berries/pile.png",
    [base],
    ["base"],
    [Math.floor(base.w / 2), base.h - 1],
    {
      // Top-left corners of the 6 by 6 berries stacked on the base, bottom row first, relative to the base's own
      // top-left corner.
      slots: PILE_SLOTS,
    },
  );
  for (const team of PLAYING) {
    const ramp = TEAMS[team];
    emit(
      `hive-${team}`,
      `hives/hive-${team}.png`,
      [hive(ramp)],
      ["hive"],
      [32, 47],
      {
        // Top-left corners of the six 16 by 18 holes, in fill order.
        holes: HIVE_HOLES,
      },
    );
    emit(
      `hive-hole-${team}`,
      `hives/hole-${team}.png`,
      [hiveHole(ramp, false), hiveHole(ramp, true)],
      ["empty", "filled"],
      [0, 0],
    );
    emit(
      `egg-${team}`,
      `hud/egg-${team}.png`,
      [egg(ramp, false), egg(ramp, true)].map((e) =>
        outlined(centred(e, 12, 14)),
      ),
      ["full", "broken"],
      [6, 7],
    );
    emit(
      `goal-${team}`,
      `tiles/goal-${team}.png`,
      [outlined(centred(goalPost(ramp), 18, 42))],
      ["post"],
      [9, 40],
    );
    emit(
      `kill-burst-${team}`,
      `effects/kill-burst-${team}.png`,
      killBurst(ramp),
      ["0", "1", "2", "3", "4", "5"],
      [16, 16],
      { fps: 20 },
    );
    emit(
      `death-puff-${team}`,
      `effects/death-puff-${team}.png`,
      deathPuff(ramp),
      ["0", "1", "2", "3", "4"],
      [12, 12],
      { fps: 14 },
    );
    const name = team.toUpperCase();
    for (const kind of ["military", "economy", "snail"] as WinKind[])
      emit(
        `banner-${kind}-${team}`,
        `banners/${kind}-${team}.png`,
        [banner(ramp, name, kind)],
        ["banner"],
        [116, 22],
      );
  }
  emit(
    "flap-puff",
    "effects/flap-puff.png",
    flapPuff(),
    ["0", "1", "2", "3"],
    [8, 0],
    {
      fps: 16,
    },
  );
  emit(
    "gate-sparkle",
    "effects/gate-sparkle.png",
    gateSparkle(),
    ["0", "1", "2", "3", "4", "5"],
    [12, 31],
    { fps: 12, note: "Drawn over a gate, anchored like it." },
  );
  emit(
    "berry-pop",
    "effects/berry-pop.png",
    berryPop(),
    ["0", "1", "2", "3", "4"],
    [8, 8],
    {
      fps: 16,
    },
  );
  const names = Object.keys(TILES);
  emit(
    "tiles",
    "tiles/platform.png",
    names.map(tile),
    names,
    [0, 0],
    {
      note: "8 by 8 tiles. The ledge tiles are the thin one-way platform: only their top 4 rows are drawn.",
    },
    6,
  );
};

// ---------------------------------------------------------------------------------------------------------------
// backgrounds, logo, cover

const buildScenes = () => {
  (["bg-far", "bg-mid", "bg-near"] as const).forEach((id, layer) => {
    const image = read(`${ART}raw/${id}.png`);
    write(`${OUT}backgrounds/${id.slice(3)}.png`, image);
    assets[id] = {
      file: `backgrounds/${id.slice(3)}.png`,
      width: image.w,
      height: image.h,
      frameWidth: image.w,
      frameHeight: image.h,
      frameCount: 1,
      frames: { layer: 0 },
      anchor: [0, 0],
      // Suggested horizontal drift relative to the camera or to time; the far layer is opaque.
      parallax: [0, 0.3, 0.6][layer],
    };
  });
  const mark = trim(read(`${ART}raw/logo.png`));
  emit(
    "logo",
    "logo.png",
    [outlined(centred(mark, mark.w + 2, mark.h + 2))],
    ["logo"],
    [Math.floor(mark.w / 2) + 1, Math.floor(mark.h / 2) + 1],
    { note: "The title; draw it at 2x on the title screen." },
  );
  const cover = scaleUp(read(`${ART}raw/cover.png`), 2);
  write(`${OUT}cover.png`, cover);
  assets.cover = {
    file: "cover.png",
    width: cover.w,
    height: cover.h,
    frameWidth: cover.w,
    frameHeight: cover.h,
    frameCount: 1,
    frames: { cover: 0 },
    anchor: [0, 0],
    note: "Portal cover, 256 by 256 art pixels shown at 2x.",
  };
};

// ---------------------------------------------------------------------------------------------------------------
// previews

/** A frame of a built sheet. */
const frame = (id: string, name: string): Img => {
  const cell = built[id]?.[assets[id]?.frames[name] ?? -1];
  if (!cell) throw new Error(`no frame ${id}/${name}`);
  return cell;
};

/** Draws a frame with its anchor at (x, y), mirrored when `flip`. */
const place = (
  scene: Img,
  id: string,
  name: string,
  x: number,
  y: number,
  flip = false,
) => {
  const cell = frame(id, name);
  const [ax, ay] = assets[id]?.anchor ?? [0, 0];
  blit(scene, cell, x - (flip ? cell.w - 1 - ax : ax), y - ay, flip);
};

/** Every sheet on one page, packed in rows, at 3x. */
const contactSheet = () => {
  const width = 620;
  const page = fill(img(width, 1400), NAVY.night);
  let x = 4;
  let y = 4;
  let row = 0;
  for (const [id, entry] of Object.entries(assets)) {
    if (id.startsWith("bg-")) continue;
    const sheet = read(`${OUT}${entry.file}`);
    if (x + sheet.w + 4 > width) {
      x = 4;
      y += row + 6;
      row = 0;
    }
    blit(page, sheet, x, y);
    x += sheet.w + 8;
    row = Math.max(row, sheet.h);
  }
  const out = fill(img(width, y + row + 4), NAVY.night);
  blit(out, page, 0, 0);
  write(`${ART}preview/contact-sheet.png`, scaleUp(out, 3));
};

/** A run of tiles: `left`, then `middle` repeated, then `right`, with its top-left corner at (x, y). */
const run = (
  scene: Img,
  x: number,
  y: number,
  tiles: number,
  kind: "slab" | "ledge" | "track" | "top",
) => {
  for (let i = 0; i < tiles; i++) {
    const end = i === 0 ? "Left" : i === tiles - 1 ? "Right" : "";
    const name = end
      ? `${kind}${end}`
      : kind === "top" && i % 5 === 2
        ? "topLamp"
        : kind;
    blit(scene, frame("tiles", name), x + i * 8, y);
  }
};

/** A believable moment of a match on map 1 at the game's resolution, shown at 4x. */
const mockScene = () => {
  const scene = img(480, 270);
  for (const id of ["bg-far", "bg-mid", "bg-near"])
    blit(scene, read(`${ART}raw/${id}.png`), 0, 0);
  // The floor: the snail track with solid ground under it.
  run(scene, 0, 246, 60, "track");
  for (let j = 1; j < 3; j++)
    for (let i = 0; i < 60; i++)
      blit(
        scene,
        frame(
          "tiles",
          (i * 7 + j * 3) % 11 === 0
            ? "middleNode"
            : (i * 5 + j) % 9 === 0
              ? "middleCell"
              : "middle",
        ),
        i * 8,
        246 + j * 8,
      );
  // Platforms, mirrored left to right.
  const slabs: [number, number, number][] = [
    [56, 72, 12],
    [16, 128, 8],
    [104, 168, 10],
    [24, 208, 9],
    [200, 112, 10],
  ];
  for (const [x, y, n] of slabs) {
    run(scene, x, y, n, "slab");
    if (x + n * 8 <= 240) run(scene, 480 - x - n * 8, y, n, "slab");
  }
  const ledges: [number, number, number][] = [
    [176, 60, 6],
    [136, 208, 7],
    [208, 190, 8],
  ];
  for (const [x, y, n] of ledges) {
    run(scene, x, y, n, "ledge");
    if (x + n * 8 <= 240) run(scene, 480 - x - n * 8, y, n, "ledge");
  }
  // Hives on the top platforms, partly filled.
  (
    [
      ["cyan", 104, 4],
      ["pink", 376, 2],
    ] as const
  ).forEach(([team, x, filled]) => {
    place(scene, `hive-${team}`, "hive", x, 71);
    HIVE_HOLES.forEach(([hx, hy], i) => {
      if (i < filled)
        blit(
          scene,
          frame(`hive-hole-${team}`, "filled"),
          x - 32 + hx,
          71 - 47 + hy,
        );
    });
  });
  // Gates: one neutral, one owned, one in use, one owned by the other team.
  place(scene, "gate-warrior", "cyan", 48, 127);
  place(scene, "gate-speed", "neutral", 144, 167);
  place(scene, "gate-warrior", "pinkActive", 432, 127);
  place(scene, "gate-speed", "pink", 336, 167);
  place(scene, "gate-warrior", "neutral", 240, 111);
  place(scene, "gate-sparkle", "2", 432, 127);
  // Berry piles.
  for (const [x, y, count] of [
    [60, 207, 10],
    [420, 207, 6],
    [240, 189, 8],
  ] as const) {
    const base = frame("berry-pile", "base");
    blit(scene, base, x - Math.floor(base.w / 2), y - base.h + 1);
    PILE_SLOTS.slice(0, count).forEach(([sx, sy]) =>
      blit(
        scene,
        frame("berry", "pile"),
        x - Math.floor(base.w / 2) + sx - 1,
        y - base.h + 1 + sy - 1,
      ),
    );
  }
  // Snail and goals.
  place(scene, "goal-cyan", "post", 20, 245);
  place(scene, "goal-pink", "post", 460, 245, true);
  place(scene, "snail", "crawl1", 262, 245);
  const [sx, sy] = (assets.snail?.saddle as [number, number][])[1] ?? [0, 0];
  place(scene, "worker-cyan", "idle", 262 - 26 + sx, 245 - 25 + sy);
  // Units.
  place(scene, "worker-cyan", "run2", 120, 167);
  place(scene, "worker-cyan", "run1Carry", 84, 207);
  place(scene, "speed-worker-cyan", "run3", 190, 245);
  place(scene, "worker-pink", "run2Carry", 380, 167, true);
  place(scene, "worker-pink", "jump", 300, 226, true);
  place(scene, "speed-worker-pink", "run1", 400, 245, true);
  place(scene, "worker-pink", "idle", 356, 71, true);
  place(scene, "warrior-cyan", "flapUp", 170, 120);
  place(scene, "speed-warrior-cyan", "glide", 96, 108);
  place(scene, "warrior-pink", "flapDown", 310, 104, true);
  place(scene, "speed-warrior-pink", "walk1", 392, 127, true);
  place(scene, "queen-cyan", "flapDown", 212, 62);
  place(scene, "queen-pink", "dive", 280, 52, true);
  place(scene, "kill-burst-pink", "2", 316, 150);
  place(scene, "flap-puff", "1", 170, 122);
  place(scene, "berry", "loose1", 268, 140);
  // HUD: three eggs per team, one broken on each side.
  for (let i = 0; i < 3; i++) {
    place(scene, "egg-cyan", i < 2 ? "full" : "broken", 14 + i * 13, 12);
    place(scene, "egg-pink", i < 2 ? "full" : "broken", 466 - i * 13, 12);
  }
  write(`${ART}preview/mock-scene.png`, scaleUp(scene, 4));
  // The same moment with a victory banner and the title, to judge those against the scene.
  const win = img(480, 270);
  blit(win, scene, 0, 0);
  place(win, "banner-snail-cyan", "banner", 240, 150);
  place(win, "logo", "logo", 240, 60);
  write(`${ART}preview/mock-victory.png`, scaleUp(win, 4));
};

// ---------------------------------------------------------------------------------------------------------------

const main = async () => {
  const [command, ...ids] = process.argv.slice(2);
  const wanted = (id: string) => ids.length === 0 || ids.includes(id);
  if (command === "generate") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("set OPENAI_API_KEY");
    await Promise.all(
      GENERATIONS.filter(
        (spec) =>
          wanted(spec.id) &&
          (ids.length > 0 || !existsSync(`${ART}raw-full/${spec.id}.png`)),
      ).map((spec) => generate(spec, key)),
    );
  } else if (command === "cut") {
    for (const spec of CUTS) if (wanted(spec.id)) cutSheet(spec);
    for (const id of Object.keys(BACKDROPS)) if (wanted(id)) cutBackdrop(id);
    if (wanted("cover")) cutCover();
  } else if (command === "build") {
    buildUnits();
    buildSnail();
    buildGates();
    buildProcedural();
    buildScenes();
    // Written as Prettier would write it, so `pnpm format:check` passes on a fresh build.
    const manifest = JSON.stringify({
      note: "Written by scripts/killer-fuse-art.ts. Sizes are art pixels; draw at an integer scale with smoothing off. Units face right; mirror them to face left.",
      canvas: [480, 270],
      teams: Object.fromEntries(
        PLAYING.map((team) => [team, TEAMS[team].map(toHex)]),
      ),
      assets,
    });
    writeFileSync(
      `${OUT}manifest.json`,
      await format(manifest, {
        ...(await resolveConfig(`${OUT}manifest.json`)),
        parser: "json",
      }),
    );
    contactSheet();
    mockScene();
    console.log(`${Object.keys(assets).length} sheets`);
  } else {
    console.error("usage: killer-fuse-art.ts generate|cut|build [id...]");
    process.exit(1);
  }
};

void [clear, flipX, ICE];
await main();
