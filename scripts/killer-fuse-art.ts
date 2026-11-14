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
  FROST,
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
  crop,
  decodePng,
  despeckle,
  encodePng,
  fill,
  flipX,
  findGrid,
  findSprites,
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
  berryPop,
  deathPuff,
  flapPuff,
  gateSparkle,
  killBurst,
  queenDeath,
  respawn,
  snailMarker,
  snailStrip,
  STRIP_LANE,
  tile,
  TILES,
  type WinKind,
} from "../games/killer-fuse/art/procedural.ts";
import {
  berries,
  carrySpot,
  egg,
  emerge,
  EMERGE,
  gate,
  GATE,
  goalNet,
  hive,
  HIVE_HOLES,
  HIVE_SIZES,
  hiveHole,
  pile,
  PILE,
  UNIT_SPECS,
  unitFrame,
  unitLayout,
  type UnitSpec,
} from "../games/killer-fuse/art/arcade.ts";

/** How far along the snail's shell, from its back to its front, the rider sits. */
const SNAIL_SEAT = 0.62;
/** The first column of the snail's neck and head in its cell: everything from here on turns red when it eats. */
const SNAIL_HEAD = 26;
const SNAIL_RED: readonly [Rgb, Rgb, Rgb] = [
  hex("#8c1c2c"),
  hex("#e23b3b"),
  hex("#ff8a70"),
];

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
    withEye(
      smooth(
        despeckle(reduce(spec.grow ? scaleUp(s, spec.grow) : s, spec.reduce)),
      ),
    ),
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

/** A unit as a flat white shape with a pale rim: the flash frame of invulnerability and of a hit. */
const flash = (cell: Img): Img =>
  outlined(
    recolour(cell, () => WHITE),
    ICE,
  );

/** Writes one form of a unit for both teams, and its flash sheet. */
const emitUnit = (
  form: string,
  cells: Img[],
  names: readonly string[],
  animations: unknown,
  extra: Record<string, unknown> = {},
  /** Rows of the cell under the feet (room for a wing on its down-stroke). */
  below = 0,
  /** The speed forms' bodies, one per cell: the outline is gold around these and dark around everything else. */
  bodies?: Img[],
) => {
  const rimmed = (cell: Img, i: number): Img => {
    const out = outlined(cell);
    const body = bodies?.[i % bodies.length];
    if (!body) return out;
    for (let y = 0; y < cell.h; y++)
      for (let x = 0; x < cell.w; x++) {
        if (alpha(cell, x, y) || !alpha(out, x, y)) continue;
        const touches = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(
          ([nx, ny]) =>
            alpha(body, nx ?? -1, ny ?? -1) > 0 &&
            !GOLD.some((g) => same(g, rgbAt(body, nx ?? -1, ny ?? -1))),
        );
        if (touches) put(out, x, y, GOLD[2]);
      }
    return out;
  };
  const first = cells[0] ?? img(1, 1);
  const anchor: [number, number] = [
    Math.floor(first.w / 2),
    first.h - 1 - below,
  ];
  const columns = Math.min(names.length, extra.carry ? names.length / 2 : 10);
  for (const team of PLAYING)
    emit(
      `${form}-${team}`,
      `units/${form}-${team}.png`,
      cells.map((cell, i) => rimmed(toRamp(cell, TEAMS[team]), i)),
      names,
      anchor,
      { animations, flash: `${form}-flash`, ...extra },
      columns,
    );
  emit(
    `${form}-flash`,
    `units/${form}-flash.png`,
    cells.map(flash),
    names,
    anchor,
    {
      note: "The same frames as a flat white shape, for both teams: see `invulnerable` at the top of the manifest.",
    },
    columns,
  );
};

const buildUnits = () => {
  // Drawn in the stand-in green and recoloured per team, like the generated art.
  const cellsOf = (spec: UnitSpec, speed: boolean, bare = false) =>
    spec.frames.map((pose) => unitFrame(spec, pose, GREEN, speed, bare));
  const namesOf = (spec: UnitSpec) => spec.frames.map((pose) => pose.name);
  for (const speed of [false, true]) {
    const worker = UNIT_SPECS.worker;
    emitUnit(
      speed ? "speed-worker" : "worker",
      cellsOf(worker, speed),
      namesOf(worker),
      worker.animations,
      {
        // Top-left corner of the 5 by 5 carried berry in each frame, for drawing it separately.
        carry: worker.frames
          .slice(0, worker.frames.length / 2)
          .map(() => carrySpot()),
        note: "Frames named <frame>Carry are the same poses with a berry on the back; the sprite is no taller for it.",
      },
      0,
      speed ? cellsOf(worker, speed, true) : undefined,
    );
    const warrior = UNIT_SPECS.warrior;
    emitUnit(
      speed ? "speed-warrior" : "warrior",
      cellsOf(warrior, speed),
      namesOf(warrior),
      warrior.animations,
      {
        note: "Feet on the anchor. Warriors do not dive: there is no `dive` frame. Standing and walking, the sword points diagonally up and forward; flying, straight forward.",
      },
      0,
      speed ? cellsOf(warrior, speed, true) : undefined,
    );
  }
  const queen = UNIT_SPECS.queen;
  emitUnit(
    "queen",
    cellsOf(queen, false),
    namesOf(queen),
    queen.animations,
    {
      note: "Feet on the anchor. The rows under it are only used by `dive`: a column 7 wide, wings folded up the back, the sword straight down with its tip 4 pixels under the feet.",
    },
    queen.below,
  );
  // A worker inside a gate: its shape turning to light and swelling, drawn in the gate's lit alcove.
  const spec = UNIT_SPECS.worker;
  const idle = cellsOf(spec, false)[0] ?? img(1, 1);
  const at = unitLayout(spec);
  const grown = outline(idle, WHITE);
  for (const team of PLAYING) {
    const ramp = TEAMS[team];
    const shape = (m: Img, fill: Rgb, rim: Rgb) =>
      outlined(
        recolour(m, () => fill),
        rim,
      );
    const big = img(idle.w, idle.h);
    blit(big, crop(grown, 1, 1, idle.w, idle.h), 0, 0);
    // Wing buds on the last frame: the warrior it is about to be.
    const budded = img(idle.w, idle.h);
    blit(budded, big, 0, 0);
    for (const [dx, dy] of [
      [-2, 0],
      [-3, -1],
      [-3, 1],
    ] as const)
      put(budded, at.x + dx, at.torso + 1 + dy, WHITE);
    emit(
      `transform-${team}`,
      `effects/transform-${team}.png`,
      [
        shape(idle, ramp[3], ramp[2]),
        shape(idle, WHITE, ramp[3]),
        shape(big, WHITE, ramp[3]),
        shape(budded, WHITE, ramp[3]),
      ],
      ["0", "1", "2", "3"],
      [Math.floor(idle.w / 2), idle.h - 1],
      {
        fps: 8,
        note: "A worker transforming inside a gate: draw instead of the worker, anchored like it, over the gate's <owner>Active frame; loop 1-3 while it waits, then swap to the new unit.",
      },
    );
  }
};

// ---------------------------------------------------------------------------------------------------------------
// snail, gates

const buildSnail = () => {
  // The generated saddle is gold, which now means speed: it becomes part of the shell.
  const plain = alignedFrames(SNAIL, isShell).map((cell) =>
    recolour(cell, (c) => (GOLD.some((g) => same(g, c)) ? VIOLET[2] : c)),
  );
  // Eating, the snail's head and neck flush red and two claws close over its mouth.
  const eating = SNAIL.frames.indexOf("eat");
  const mouth = centreOf(
    crop(
      plain[eating] ?? img(1, 1),
      SNAIL_HEAD,
      0,
      SNAIL.cell[0],
      SNAIL.cell[1],
    ),
    (c) => same(c, INK),
  );
  const jaw: [number, number] = [
    SNAIL_HEAD + Math.round(mouth.x),
    Math.round(mouth.y),
  ];
  const cells = plain.map((cell, i) => {
    if (i !== eating) return cell;
    const out = img(cell.w, cell.h);
    for (let y = 0; y < cell.h; y++)
      for (let x = 0; x < cell.w; x++) {
        if (!alpha(cell, x, y)) continue;
        const c = rgbAt(cell, x, y);
        const head = x >= SNAIL_HEAD;
        put(
          out,
          x,
          y,
          head && same(c, CREAM)
            ? SNAIL_RED[1]
            : head && same(c, TAN)
              ? SNAIL_RED[0]
              : c,
        );
      }
    for (const [dx, dy] of [
      [3, -2],
      [4, -1],
      [3, 3],
      [4, 2],
    ] as const)
      put(out, Math.min(cell.w - 2, jaw[0] + dx), jaw[1] + dy, SNAIL_RED[2]);
    return out;
  });
  // The rider sits astride the front of the shell, drawn behind the snail so the shell hides its legs: the saddle
  // is where its soles go, six rows under the shell's top edge there.
  const saddles = cells.map((cell): [number, number] => {
    let left = cell.w;
    let right = 0;
    for (let y = 0; y < cell.h; y++)
      for (let x = 0; x < cell.w; x++)
        if (alpha(cell, x, y) && isShell(rgbAt(cell, x, y))) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
    const x = Math.round(left + (right - left) * SNAIL_SEAT);
    let top = 0;
    while (top < cell.h && !alpha(cell, x, top)) top++;
    return [x, top + 6];
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
      // Centre of the mouth in `eat`: put the worker being eaten there.
      mouth: jaw,
      note: "`eat` has a red head and claws: draw the victim at `mouth`, then the snail over it. Faces right; the anchor is under the shell, so the body stretches ahead of it. Draw the rider first with its anchor on `saddle`, then the snail over it: the rider sits astride, its legs hidden behind the shell.",
    },
  );
};

const buildGates = () => {
  for (const team of PLAYING)
    for (const speed of [false, true])
      emit(
        `gate-emerge-${speed ? "speed-" : ""}${team}`,
        `effects/gate-emerge-${speed ? "speed-" : ""}${team}.png`,
        emerge(TEAMS[team], speed).map((cell) => outlined(cell)),
        ["0", "1", "2", "3", "4", "5"],
        [Math.floor(EMERGE.cell[0] / 2), EMERGE.cell[1] - 1],
        {
          fps: 12,
          note: "A new warrior rising out of the top of a warrior gate, sword first, with chips of stone: draw over the gate, anchored like it, once (half a second), then put the warrior in flight with its feet 13 pixels above the gate's anchor. The worker is not drawn while it plays: it has gone into the dark doorway.",
        },
      );
  for (const kind of GATE.kinds) {
    const frames: Img[] = [];
    const names: string[] = [];
    for (const active of [false, true])
      for (const owner of ["neutral", ...PLAYING] as const) {
        frames.push(outlined(gate(kind, owner, active)));
        names.push(active ? `${owner}Active` : owner);
      }
    emit(
      `gate-${kind}`,
      `gates/${kind}.png`,
      frames,
      names,
      [Math.floor(GATE.cell[0] / 2), GATE.cell[1] - 1],
      {
        note: "Stands on the anchor: grey stone pillars with a white ornament (wings for the warrior gate, crossed blades for the speed gate) that takes the owner's colour. <owner>Active is the gate in use: draw the worker standing on the anchor between the pillars; its berry is already in the socket above.",
      },
    );
  }
};

// ---------------------------------------------------------------------------------------------------------------
// hand-pixelled sheets

const buildProcedural = () => {
  emit(
    "berry",
    "berries/berry.png",
    berries(),
    ["pile", "carried", "loose1", "loose2"],
    [2, 2],
    {
      animations: {
        loose: { frames: ["loose1", "loose2"], fps: 8, loop: true },
      },
    },
  );
  const counts = [0, 1, 2, 3, 4, 5, 6];
  emit(
    "berry-pile",
    "berries/pile.png",
    counts.map((count) => outlined(pile(count))),
    counts.map(String),
    [Math.floor(PILE.cell[0] / 2), PILE.cell[1] - 1],
    {
      // Top-left corners of the 5 by 5 berry cells in the pile, relative to the frame's own top-left corner; the
      // first n are the ones in frame n.
      slots: PILE.slots,
      note: "Frame n is the pile with n berries left, stacked 3-2-1 on its leaf: nothing else needs drawing. The leaf stands on the anchor.",
    },
  );
  emit(
    "snail-strip",
    "hud/snail-strip.png",
    [snailStrip(TEAMS.cyan, TEAMS.pink)],
    ["strip"],
    [0, 0],
    {
      // The x of the marker's anchor at Cyan's goal and at Pink's goal.
      lane: STRIP_LANE,
      note: "Fixed size. Cyan's goal cap is on the left, Pink's on the right, the white tick is the middle of the track. Put `snail-marker` with its anchor on row 6, between lane[0] and lane[1].",
    },
  );
  emit(
    "snail-marker",
    "hud/snail-marker.png",
    [snailMarker()],
    ["marker"],
    [4, 6],
    { note: "Faces right; flip it when the snail heads left." },
  );
  for (const team of PLAYING) {
    const ramp = TEAMS[team];
    for (const [time, size] of Object.entries(HIVE_SIZES)) {
      emit(
        `hive-${time}-${team}`,
        `hives/hive-${time}-${team}.png`,
        [hive(ramp, size)],
        ["hive"],
        [Math.floor(size[0] / 2), size[1] - 1],
        {
          // The wall has no holes in it: the engine places them, per map.
          holes: [],
          hole: `hive-hole-${team}`,
          note: "A flat wall standing on the anchor (bottom centre, on the floor's top row), sized for the map of its name. Draw `hive-hole` `empty` or `filled` centred on each of the map's holes.",
        },
      );
    }
    emit(
      `hive-hole-${team}`,
      `hives/hole-${team}.png`,
      [hiveHole(false), hiveHole(true)],
      ["empty", "filled"],
      [2, 2],
      { note: "A 5 by 5 cell centred on a hole." },
    );
    emit(
      `egg-${team}`,
      `hives/egg-${team}.png`,
      [egg(ramp, "full"), egg(ramp, "broken"), egg(ramp, "cracked")].map((e) =>
        outlined(centred(e, 10, 16)),
      ),
      ["full", "broken", "cracked"],
      [5, 15],
      {
        note: "A Queen's spare life, standing on the hive floor on its anchor. Show `cracked` for a few frames when a life is lost, then `broken` (the empty shell).",
      },
    );
    const net = outlined(centred(goalNet(ramp), 29, 19));
    emit(
      `goal-${team}`,
      `tiles/goal-${team}.png`,
      [team === "cyan" ? net : flipX(net)],
      ["post"],
      [14, 18],
      {
        note: "A net cage standing on the ground on its anchor, its mouth towards the middle of the arena: Cyan's as drawn for a goal on the left, Pink's for one on the right.",
      },
    );
    emit(
      `kill-burst-${team}`,
      `effects/kill-burst-${team}.png`,
      killBurst(ramp),
      ["0", "1", "2", "3", "4", "5"],
      [42, 42],
      {
        fps: 20,
        note: "A scatter of 44 one- and two-pixel specks in the victim's colour, flung about 40 pixels; no flash. Centred on the victim's body, drawn once.",
      },
    );
    emit(
      `queen-death-${team}`,
      `effects/queen-death-${team}.png`,
      queenDeath(ramp),
      ["0", "1", "2", "3", "4", "5", "6", "7"],
      [50, 50],
      {
        fps: 16,
        note: "A Queen's death, centred on her body; pair it with her egg's `cracked` frame.",
      },
      4,
    );
    emit(
      `respawn-${team}`,
      `effects/respawn-${team}.png`,
      respawn(ramp),
      ["0", "1", "2", "3", "4", "5", "6"],
      [7, 23],
      {
        fps: 14,
        note: "Drawn over a unit as it respawns, anchored at its feet.",
      },
    );
    emit(
      `death-puff-${team}`,
      `effects/death-puff-${team}.png`,
      deathPuff(ramp),
      ["0", "1", "2", "3", "4"],
      [8, 8],
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
    [6, 0],
    {
      fps: 16,
    },
  );
  emit(
    "gate-sparkle",
    "effects/gate-sparkle.png",
    gateSparkle(),
    ["0", "1", "2", "3", "4", "5"],
    [17, 27],
    { fps: 12, note: "Drawn over a gate, anchored like it." },
  );
  emit(
    "berry-pop",
    "effects/berry-pop.png",
    berryPop(),
    ["0", "1", "2", "3", "4"],
    [5, 5],
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
      note: "8 by 8 cells. track* is the ground, 5 rows drawn; slab* is a floating platform, 7 rows drawn (6 solid and a fringe). Every end cap is opaque where it is drawn, so a platform of any length from 14 pixels is slabLeft at its left edge, slab repeated, and slabRight drawn last with its right edge on the platform's. ledge* is a thinner platform (5 rows); top*/middle*/bottom* build thick blocks. *Lamp tiles are variants to drop into long runs.",
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
  // The cut maps the logo onto the scenery palette, which has no team colours: its two drop shadows come out
  // frost and dark gold. Put them back as drawn, cyan under KILLER and pink under FUSE, and drop stray violet.
  const cutMark = trim(read(`${ART}raw/logo.png`));
  const mark = img(cutMark.w, cutMark.h);
  for (let y = 0; y < cutMark.h; y++)
    for (let x = 0; x < cutMark.w; x++) {
      if (!alpha(cutMark, x, y)) continue;
      const c = rgbAt(cutMark, x, y);
      const upper = y < cutMark.h / 2;
      put(
        mark,
        x,
        y,
        isShell(c)
          ? NAVY.night
          : upper && same(c, FROST)
            ? TEAMS.cyan[2]
            : !upper && same(c, GOLD[1]) && x < cutMark.w * 0.84
              ? TEAMS.pink[2]
              : c,
      );
    }
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
  const page = fill(img(width, 2400), NAVY.night);
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

/** A platform or a stretch of ground from x1 to x2 inclusive, its top row at y: caps at the ends, tiles between. */
const run = (
  scene: Img,
  x1: number,
  x2: number,
  y: number,
  kind: "slab" | "track",
) => {
  const last = x2 - 7;
  let i = 0;
  for (let x = x1 + 8; x < last; x += 8, i++)
    blit(
      scene,
      frame("tiles", i % 5 === 2 ? `${kind}Lamp` : kind),
      Math.min(x, last - 8),
      y,
    );
  blit(scene, frame("tiles", `${kind}Left`), x1, y);
  blit(scene, frame("tiles", `${kind}Right`), last, y);
};

/** The arcade's night map, measured from footage, as a list of platforms: x1, x2, y of the top row. */
const PLATFORMS: readonly (readonly [number, number, number])[] = [
  [175, 303, 55],
  [5, 30, 55],
  [85, 120, 55],
  [358, 393, 55],
  [448, 476, 55],
  [50, 65, 85],
  [140, 154, 31],
  [140, 154, 85],
  [325, 339, 31],
  [325, 339, 85],
  [414, 428, 85],
  [2, 30, 115],
  [85, 120, 115],
  [175, 204, 115],
  [275, 304, 115],
  [358, 393, 115],
  [448, 476, 115],
  [50, 154, 145],
  [225, 254, 145],
  [325, 428, 145],
  [2, 30, 175],
  [175, 204, 175],
  [275, 304, 175],
  [448, 476, 175],
  [50, 70, 205],
  [125, 154, 205],
  [225, 254, 205],
  [325, 354, 205],
  [408, 430, 205],
  [2, 30, 235],
  [90, 104, 235],
  [175, 304, 235],
  [375, 389, 235],
  [448, 476, 235],
];

/** A believable moment of a match laid out like the arcade's night map, at the game's resolution, shown at 4x. */
const mockScene = () => {
  const scene = img(480, 270);
  for (const id of ["bg-far", "bg-mid", "bg-near"])
    blit(scene, read(`${ART}raw/${id}.png`), 0, 0);
  const ground = 265;
  run(scene, 0, 479, ground, "track");
  for (const [x1, x2, y] of PLATFORMS) run(scene, x1, x2, y, "slab");
  // Hives side by side on the top ledge, partly filled, with the Queens' eggs standing in front of them.
  (
    [
      ["cyan", 208, 7, ["full", "broken"]],
      ["pink", 271, 3, ["cracked", "broken"]],
    ] as const
  ).forEach(([team, x, filled, eggs]) => {
    place(scene, `hive-day-${team}`, "hive", x, 55);
    HIVE_HOLES.forEach(([hx, hy], i) =>
      place(
        scene,
        `hive-hole-${team}`,
        i < filled ? "filled" : "empty",
        x + (team === "cyan" ? hx : -hx),
        55 + hy,
      ),
    );
    eggs.forEach((state, i) =>
      place(
        scene,
        `egg-${team}`,
        state,
        x + (team === "cyan" ? 1 : -1) * (i ? 8 : 19),
        55,
      ),
    );
  });
  // Gates: neutral, owned and in use.
  place(scene, "gate-speed", "neutral", 102, 55);
  place(scene, "gate-speed", "pink", 376, 55);
  place(scene, "gate-warrior", "neutral", 239, 145);
  place(scene, "gate-warrior", "cyan", 139, 205);
  place(scene, "gate-warrior", "pinkActive", 339, 205);
  place(scene, "gate-emerge-pink", "3", 339, 205);
  // Berry piles at different stages.
  for (const [x, y, count] of [
    [189, 175, 6],
    [289, 175, 4],
    [59, 205, 6],
    [418, 205, 5],
    [239, 205, 6],
    [239, 235, 2],
    [97, 265, 6],
    [381, 265, 0],
  ] as const)
    place(scene, "berry-pile", String(count), x, y);
  // Goals at the ends of the ground, and the snail with its rider behind the shell.
  place(scene, "goal-cyan", "post", 16, ground);
  place(scene, "goal-pink", "post", 463, ground);
  const [sx, sy] = (assets.snail?.saddle as [number, number][])[1] ?? [0, 0];
  place(
    scene,
    "worker-cyan",
    "idle",
    310 - Math.floor(SNAIL.cell[0] / 2) + sx,
    ground - (SNAIL.cell[1] - 1) + sy,
  );
  place(scene, "snail", "crawl1", 310, ground);
  // Units.
  place(scene, "worker-cyan", "run2", 70, 145);
  place(scene, "worker-cyan", "run1Carry", 110, 145);
  place(scene, "worker-cyan", "idleCarry", 196, 115);
  place(scene, "speed-worker-cyan", "run3", 150, ground);
  place(scene, "worker-pink", "run2Carry", 350, 145, true);
  place(scene, "worker-pink", "jump", 300, 222, true);
  place(scene, "speed-worker-pink", "run1", 420, ground, true);
  place(scene, "worker-pink", "idle", 290, 115, true);
  place(scene, "warrior-cyan", "flapUp", 200, 150);
  place(scene, "speed-warrior-cyan", "glide", 120, 100);
  place(scene, "warrior-pink", "flapDown", 320, 108, true);
  place(scene, "speed-warrior-pink", "walk1", 380, 115, true);
  place(scene, "warrior-pink", "idle", 250, 235, true);
  place(scene, "warrior-cyan", "walk2", 60, 205);
  place(scene, "queen-cyan", "flapMid", 215, 100);
  place(scene, "queen-pink", "dive", 262, 108, true);
  place(scene, "queen-pink", "idle", 440, 55, true);
  place(scene, "kill-burst-pink", "2", 300, 190);
  place(scene, "respawn-cyan", "2", 20, 235);
  place(scene, "flap-puff", "1", 200, 152);
  place(scene, "berry", "loose1", 268, 160);
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
      invulnerable:
        "Every unit sheet names a `flash` sheet: the same frames, same layout and anchor, as a flat white shape with a pale rim. While a unit is invulnerable (after respawning), draw the flash frame instead of the team frame on alternate 4-tick beats (about 8 flashes a second); draw it for 2 ticks when a unit is hit. For a steadier shield, draw the flash frame under the team frame at +-1 pixel offsets as a white outline.",
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

await main();
