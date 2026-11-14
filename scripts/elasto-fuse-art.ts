/**
 * Generates Elasto Fuse's art (game id `elasto-fuse`) with the OpenAI image API and fits each image to the size and
 * pivots the renderer expects, writing `public/games/elasto-fuse/art/v1/` and its `manifest.json`.
 *
 *   OPENAI_API_KEY=… pnpm exec tsx scripts/elasto-fuse-art.ts                 # every asset, one candidate each
 *   pnpm exec tsx scripts/elasto-fuse-art.ts --only frame,wheel --n 3         # three candidates of two assets
 *   pnpm exec tsx scripts/elasto-fuse-art.ts --only frame --pick frame=2      # fit a chosen candidate into place
 *   pnpm exec tsx scripts/elasto-fuse-art.ts --reprocess                      # refit the cached raw images, no API calls
 *   pnpm exec tsx scripts/elasto-fuse-art.ts --sheet                          # contact sheet of the fitted files only
 *   pnpm exec tsx scripts/elasto-fuse-art.ts --manifest                       # rewrite manifest.json and the doc only
 *
 * Raw API images are cached in `--raw` (default `node_modules/.cache/elasto-fuse-art/`, git-ignored), named
 * `<source>-<n>.png`. With `--n` above 1 each fitted candidate is written next to its raw image as
 * `<file>-fit-<n>.<ext>` for review, and candidate 0 goes to the public folder; `--pick <source>=<n>` refits a chosen
 * candidate into place (only the picked sources are refitted). A plain `--reprocess` refits candidate 0 of everything,
 * so repeat the picks after it. Every run that fits anything also writes `contact-sheet.png` (every file, plus the parts
 * assembled into a bike at the rest layout) and `assembled.png` (the hero's reference image) to the cache.
 * The key is read from the environment and never printed. Prompts live here and in docs/design/elasto-fuse-art.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { format, resolveConfig } from "prettier";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, "public/games/elasto-fuse/art/v1");
const CACHE_REF = "cache:";

const STYLE =
  "Modern neon arcade style matching the Fuse Riders game family: clean vector-like shapes, smooth gradients, glossy highlights, high contrast, deep navy and indigo night palette lit by cyan (#16e7ff), hot pink (#ff2e9d) and warm gold (#ffe46b) neon. No text, no letters, no numbers, no logos, no watermark, no UI.";

/** The rest layout the renderer assumes, in world units (x right, y up, origin at the bike frame's centre). */
const LAYOUT = {
  pxPerUnit: 240,
  rearHub: [-0.85, -0.6],
  frontHub: [0.85, -0.6],
  wheelRadius: 0.4,
  head: [0, 0.44],
  headRadius: 0.24,
  /** The frame's body must stay inside this box (x0, y0, x1, y1). */
  frameBody: [-0.75, -0.45, 0.75, 0.35],
} as const;

/** The player colour is a hue shift of the cyan accent at load, so bike and rider sprites carry no other accent. */
const CYAN_ONLY =
  "Colours for this sprite: dark graphite and charcoal, white and neutral grey, with electric cyan (#16e7ff) as the one and only accent colour. No pink, no magenta, no gold, no yellow, no orange, no red anywhere.";
const SPRITE =
  "Flat orthographic 2D side view with no perspective and no foreshortening. Isolated on a fully transparent background, no ground, no floor, no shadow, no glow halo around it, no motion lines, the whole object in frame with generous margin.";
const SUIT =
  "a motocross racing suit of matte dark graphite armour panels with thin glowing cyan (#16e7ff) piping along the seams and a soft grey highlight along the top edge";
const PART =
  "One separate cut-out piece of a 2D paper-doll (skeletal animation) character rig for a side-view motorbike game: only this one piece, nothing attached to it, no other body part in the image.";

type Background = "opaque" | "transparent";
/** One image requested from the API. */
interface Source {
  id: string;
  model: string;
  size: string;
  background: Background;
  prompt: string;
  /**
   * Reference images; the request then goes to the edits endpoint. A plain name is a fitted file in the output
   * folder, `cache:<name>` a file the script wrote to the raw cache (the assembled bike).
   */
  refs?: string[];
}

const limb = (shape: string): string =>
  `${PART} ${shape} ` +
  `It is drawn lying exactly horizontally, as a straight elongated capsule about three times as long as it is thick, with fully rounded ends, in the same suit, colours and line weight as the torso piece in the reference image: ${SUIT}. ` +
  `${SPRITE} ${CYAN_ONLY} ${STYLE}`;

const SOURCES: Source[] = [
  {
    id: "wheel",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt:
      `A single motocross dirt-bike wheel seen exactly side-on, a perfect circle. ` +
      `A chunky knobbly dark graphite off-road tyre with evenly spaced square tread blocks all the way around its outer edge, a glowing cyan (#16e7ff) neon rim just inside the tyre, ` +
      `about ten thin bright silver spokes radiating from a small round metal hub that sits exactly in the centre, and a small cyan brake disc around the hub. The spokes and hub are clearly visible so that the wheel's rotation reads; the gaps between the spokes are empty and transparent. ` +
      `Only the wheel: no bike, no fork, no axle bolt sticking out, no mudguard. ${SPRITE} ${CYAN_ONLY} ${STYLE}`,
  },
  {
    id: "frame",
    model: "gpt-image-1.5",
    size: "1536x1024",
    background: "transparent",
    prompt:
      `The body of a compact trials dirt bike seen exactly side-on, facing right, as a game sprite with its wheels and suspension removed: ` +
      `there are NO wheels, NO tyres, NO front fork, NO rear swingarm, NO chain and NO rear shock, because the game draws those itself. ` +
      `What remains is one connected chunk: a dark graphite engine block low in the middle with a short exhaust pipe sweeping back under the seat, a small sculpted fuel tank on top toward the front, a flat slim seat behind the tank running back to a short raised tail fender at the rear, ` +
      `a steering head at the front top with a straight handlebar and one grip, a short front number-plate shroud, and a single small footpeg sticking out at the bottom centre below the engine. ` +
      `The silhouette is long and low, roughly twice as wide as it is tall, with the handlebar grip as the highest point at the front right and the seat lower at the rear left. ` +
      `Dark graphite and charcoal bodywork with white panel accents and glowing cyan (#16e7ff) neon edge lines. No rider. ${SPRITE} ${CYAN_ONLY} ${STYLE}`,
  },
  {
    id: "torso",
    model: "gpt-image-1.5",
    size: "1536x1024",
    background: "transparent",
    prompt:
      `${PART} This piece is the rider's torso and hips in one: the chest, back and pelvis of a motocross rider, with no head, no neck, no arms, no hands and no legs. ` +
      `It is drawn lying exactly horizontally as one smooth elongated rounded shape about twice as long as it is thick: the rounded hip end is at the left, the slightly broader rounded shoulder end is at the right, and both ends are smooth and closed like a capsule (no holes, no stumps, no sockets). ` +
      `It wears ${SUIT}, with a small chest protector plate and a waist belt line. ` +
      `${SPRITE} ${CYAN_ONLY} ${STYLE}`,
  },
  {
    id: "head",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt:
      `A single full-face motocross helmet seen exactly side-on, facing right, as a game sprite: a round, almost spherical helmet shell in glossy dark graphite with white panel accents and thin cyan (#16e7ff) neon stripes, ` +
      `a wide visor on the right side glowing bright cyan, a short chin guard, and a very short peak that stays within the round silhouette. The overall silhouette is close to a circle. ` +
      `Only the helmet: no neck, no shoulders, no body, no face visible behind the visor. ${SPRITE} ${CYAN_ONLY} ${STYLE}`,
  },
  {
    id: "thigh",
    model: "gpt-image-1.5",
    size: "1536x1024",
    background: "transparent",
    refs: ["torso.png"],
    prompt: limb(
      "This piece is the rider's thigh (upper leg): the hip end is at the left and the knee end, with a small rounded knee guard, is at the right. No shin, no foot.",
    ),
  },
  {
    id: "shin",
    model: "gpt-image-1.5",
    size: "1536x1024",
    background: "transparent",
    refs: ["torso.png"],
    prompt: limb(
      "This piece is the rider's lower leg: the knee end is at the left, and the right end finishes in a chunky motocross boot whose sole is at the far right and whose toe points down and to the right. No thigh.",
    ),
  },
  {
    id: "upper-arm",
    model: "gpt-image-1.5",
    size: "1536x1024",
    background: "transparent",
    refs: ["torso.png"],
    prompt: limb(
      "This piece is the rider's upper arm: the shoulder end, with a small rounded shoulder pad, is at the left and the elbow end is at the right. No forearm, no hand.",
    ),
  },
  {
    id: "forearm",
    model: "gpt-image-1.5",
    size: "1536x1024",
    background: "transparent",
    refs: ["torso.png"],
    prompt: limb(
      "This piece is the rider's forearm: the elbow end is at the left, and the right end finishes in a closed gloved fist (a dark glove with a cyan knuckle guard). No upper arm.",
    ),
  },
  {
    id: "apple",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt:
      `A single collectible apple for a neon arcade game, seen straight on: a plump glossy apple with a warm gold (#ffe46b) body shading to hot pink (#ff2e9d) on one side, a short dark stem and one small leaf, ` +
      `a crisp white specular highlight on the upper left and a thin bright neon rim light around its edge. Friendly and instantly readable at small size. ` +
      `${SPRITE} ${STYLE}`,
  },
  {
    id: "flower",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt:
      `A single glowing neon flower head seen exactly from the front, for a neon arcade game: eight rounded hot pink (#ff2e9d) petals arranged evenly around a round warm gold (#ffe46b) centre, each petal with a lighter glossy highlight and a thin bright rim light. ` +
      `Radially symmetric and round overall. Only the flower head: no stem, no leaves, no pot. ` +
      `${SPRITE} ${STYLE}`,
  },
  {
    id: "killer",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt:
      `A single deadly hazard for a neon arcade game, seen exactly from the front: a spiky mine crossed with a circular sawblade. A round dark graphite core with a glowing hot pink (#ff2e9d) ring and a small white-hot centre, surrounded by twelve identical sharp white-tipped metal spikes pointing straight outward, evenly spaced all the way around. ` +
      `Perfectly radially symmetric so that it can spin, round overall, clearly dangerous. Hot pink and white with dark graphite; no cyan, no gold. No face, no eyes. ` +
      `${SPRITE} ${STYLE}`,
  },
  {
    id: "ground",
    model: "gpt-image-2",
    size: "1024x1024",
    background: "opaque",
    prompt:
      `Seamless tileable 2D game texture that fills the whole square edge to edge, used as the fill of solid terrain in a side-view game: dark rock and packed earth crossed by a faint circuit-board pattern. ` +
      `Deep navy and indigo, with small irregular stone facets and thin, dim cyan (#16e7ff) circuit traces and a few tiny dim nodes spread evenly over the whole image. ` +
      `Uniform density and brightness everywhere, with no focal point, no large shapes, no border, no vignette, no horizon, no lighting gradient. Very low contrast and dark, so sprites read clearly on top of it. No pink, no gold. ${STYLE}`,
  },
  {
    id: "sky",
    model: "gpt-image-2",
    size: "2048x1024",
    background: "opaque",
    prompt:
      `Wide side-view 2D game backdrop drawn behind the terrain of a motorbike trials game, scrolled with slow parallax: a neon night at dusk. ` +
      `A deep navy-to-indigo gradient sky with a soft magenta band low on the horizon and a few faint stars, layered silhouettes of distant mountains across the lower half, and a far-off city skyline with tiny dim cyan and pink lights sitting between the mountain layers. ` +
      `The composition is an even horizontal band with the same kind of detail at the left and right edges, so that it can repeat sideways; no sun, no moon, no large single landmark. ` +
      `Muted, hazy and low contrast so that the bike and rider read clearly on top of it. No foreground, no ground, no road, no vehicles, no characters. ${STYLE}`,
  },
  {
    id: "hero",
    model: "gpt-image-2",
    size: "1536x864",
    background: "opaque",
    refs: [`${CACHE_REF}assembled.png`, "apple.png", "flower.png", "sky.webp"],
    prompt:
      `Landing-page key art for a neon side-view motorbike trials game, using the reference images: the first shows the game's rider on the trials dirt bike, the second the collectible apple, the third the exit flower and the fourth the night backdrop. ` +
      `Side view. The rider and bike from the first image, kept exactly in that design (dark graphite bike with cyan neon edge lines and cyan-rimmed knobbly wheels, rider in a dark suit with cyan piping and a round helmet with a glowing cyan visor), facing right, in mid-air in the middle of a big jump, the bike tilted nose-up, the suspension stretched, a short cyan light trail behind the rear wheel. ` +
      `Below them, dark angular polygon terrain with a glowing cyan edge line: a steep ramp at the left that the bike has just left, a gap, and a landing slope at the right. ` +
      `Three of the gold and pink apples from the second image float along the arc of the jump ahead of the bike, and the pink flower from the third image stands glowing on the far right landing. The backdrop from the fourth image fills the sky. ` +
      `Dynamic, joyful, polished, cinematic glow. ${STYLE}`,
  },
];

type Fit =
  /** Trims the transparent margin and scales the rest to fit inside the box (x0, y0, x1, y1), centred in it. */
  | { kind: "box"; box: [number, number, number, number] }
  /** Scaled to cover the whole image. */
  | { kind: "cover" }
  /** Scaled to cover, then cross-faded with a half-size shifted copy of itself so that it tiles along these axes. */
  | { kind: "tile"; axes: "x" | "xy" };

/** One file the renderer loads, fitted from one source image. */
interface Asset {
  file: string;
  role: string;
  width: number;
  height: number;
  transparent: boolean;
  pivot: [number, number];
  /** Joint centres in pixels, for the pieces the renderer hangs between two joints. */
  joints?: Record<string, [number, number]>;
  source: string;
  fit: Fit;
  note: string;
}

const px = LAYOUT.pxPerUnit;
const FRAME = { width: 512, height: 320 };
/** World units to frame.png pixels (the frame's centre is the image centre, y up). */
const framePx = (x: number, y: number): [number, number] => [
  FRAME.width / 2 + x * px,
  FRAME.height / 2 - y * px,
];
const [frameX0, frameY1] = framePx(LAYOUT.frameBody[0], LAYOUT.frameBody[1]);
const [frameX1, frameY0] = framePx(LAYOUT.frameBody[2], LAYOUT.frameBody[3]);

/** A square sprite whose art fills `fill` of the square, centred. */
const centred = (size: number, fill: number): Fit => ({
  kind: "box",
  box: [
    (size * (1 - fill)) / 2,
    (size * (1 - fill)) / 2,
    (size * (1 + fill)) / 2,
    (size * (1 + fill)) / 2,
  ],
});
const LIMB = { width: 160, height: 64 };
const limbAsset = (
  id: string,
  role: string,
  from: string,
  to: string,
  note: string,
): Asset => ({
  file: `${id}.png`,
  role,
  width: LIMB.width,
  height: LIMB.height,
  transparent: true,
  pivot: [24 / LIMB.width, 0.5],
  joints: { [from]: [24, 32], [to]: [136, 32] },
  source: id,
  fit: { kind: "box", box: [0, 0, LIMB.width, LIMB.height] },
  note,
});

const ASSETS: Asset[] = [
  {
    file: "wheel.png",
    role: "bike wheel (both wheels; the code spins it)",
    width: 256,
    height: 256,
    transparent: true,
    pivot: [0.5, 0.5],
    source: "wheel",
    fit: centred(256, 1),
    note: "The tyre's outer edge fills the circle inscribed in the square; hub at the centre (128, 128).",
  },
  {
    file: "frame.png",
    role: "bike body without wheels, fork or swingarm",
    width: FRAME.width,
    height: FRAME.height,
    transparent: true,
    pivot: [0.5, 0.5],
    source: "frame",
    fit: { kind: "box", box: [frameX0, frameY0, frameX1, frameY1] },
    note: `Faces right. The image centre is the frame's centre (world origin) at ${px} px per unit; the body stays within x ${frameX0}..${frameX1} and y ${frameY0}..${frameY1} px. The code draws the fork and swingarm as lines to the wheels.`,
  },
  {
    file: "torso.png",
    role: "rider torso and hips",
    width: 192,
    height: 96,
    transparent: true,
    pivot: [24 / 192, 0.5],
    joints: { hip: [24, 48], shoulder: [168, 48] },
    source: "torso",
    fit: { kind: "box", box: [0, 0, 192, 96] },
    note: "Laid horizontally: hip joint at the left end, neck/shoulder at the right end.",
  },
  {
    file: "head.png",
    role: "rider helmet",
    width: 160,
    height: 160,
    transparent: true,
    pivot: [0.5, 0.5],
    source: "head",
    fit: centred(160, 1),
    note: "Faces right; the helmet fills the inscribed circle and the image centre is the head centre.",
  },
  limbAsset(
    "thigh",
    "rider thigh",
    "hip",
    "knee",
    "Laid horizontally, hip at the left.",
  ),
  limbAsset(
    "shin",
    "rider shin and boot",
    "knee",
    "ankle",
    "Laid horizontally, knee at the left; ends in a boot at the right.",
  ),
  limbAsset(
    "upper-arm",
    "rider upper arm",
    "shoulder",
    "elbow",
    "Laid horizontally, shoulder at the left.",
  ),
  limbAsset(
    "forearm",
    "rider forearm and glove",
    "elbow",
    "hand",
    "Laid horizontally, elbow at the left; ends in a glove at the right.",
  ),
  {
    file: "apple.png",
    role: "pick-up",
    width: 192,
    height: 192,
    transparent: true,
    pivot: [0.5, 0.5],
    source: "apple",
    fit: centred(192, 0.85),
    note: "Fills about 85% of the square, centred.",
  },
  {
    file: "flower.png",
    role: "exit",
    width: 256,
    height: 256,
    transparent: true,
    pivot: [0.5, 0.5],
    source: "flower",
    fit: centred(256, 0.85),
    note: "Flower head seen front-on, no stem; fills about 85% of the square, centred.",
  },
  {
    file: "killer.png",
    role: "hazard (the code spins it)",
    width: 256,
    height: 256,
    transparent: true,
    pivot: [0.5, 0.5],
    source: "killer",
    fit: centred(256, 0.9),
    note: "Radially symmetric; fills about 90% of the square, centred.",
  },
  {
    file: "ground.webp",
    role: "terrain fill, tiled",
    width: 1024,
    height: 1024,
    transparent: false,
    pivot: [0, 0],
    source: "ground",
    fit: { kind: "tile", axes: "xy" },
    note: "Tiles in both directions (the script cross-fades the edges).",
  },
  {
    file: "sky.webp",
    role: "parallax backdrop",
    width: 2048,
    height: 1024,
    transparent: false,
    pivot: [0, 0],
    source: "sky",
    fit: { kind: "tile", axes: "x" },
    note: "Tiles horizontally (the script cross-fades the left and right edges).",
  },
  {
    file: "hero.webp",
    role: "landing art",
    width: 1536,
    height: 864,
    transparent: false,
    pivot: [0.5, 0.5],
    source: "hero",
    fit: { kind: "cover" },
    note: "Rider on the bike mid-jump over neon terrain with apples and the flower; no text.",
  },
];

const stem = (file: string): string => file.replace(/\.\w+$/, "");
const mime = (file: string): string =>
  file.endsWith(".webp") ? "image/webp" : "image/png";
/** Sources run in stages, so that a reference image exists before the source that uses it. */
const stageOf = (source: Source): number =>
  !source.refs
    ? 0
    : source.refs.some((ref) => ref.startsWith(CACHE_REF))
      ? 2
      : 1;

interface Options {
  only: Set<string> | null;
  n: number;
  raw: string;
  quality: string;
  reprocess: boolean;
  manifestOnly: boolean;
  sheetOnly: boolean;
  picks: Map<string, number>;
}

function parse(argv: string[]): Options {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = value("--only");
  const picks = new Map<string, number>();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--pick") {
      const [id, n] = (argv[i + 1] ?? "").split("=");
      if (
        !id ||
        !SOURCES.some((source) => source.id === id) ||
        !/^\d+$/.test(n ?? "")
      )
        throw new Error("--pick takes <source>=<candidate number>");
      picks.set(id, Number(n));
    }
  }
  const n = Number(value("--n") ?? 1);
  if (!Number.isInteger(n) || n < 1)
    throw new Error("--n takes a whole number of candidates, 1 or more");
  if (only?.startsWith("--")) throw new Error("--only takes a list of assets");
  return {
    only: only ? new Set(only.split(",")) : null,
    n,
    raw: value("--raw") ?? join(ROOT, "node_modules/.cache/elasto-fuse-art"),
    quality: value("--quality") ?? "high",
    reprocess: argv.includes("--reprocess") || picks.size > 0,
    manifestOnly: argv.includes("--manifest"),
    sheetOnly: argv.includes("--sheet"),
    picks,
  };
}

async function generate(
  source: Source,
  n: number,
  quality: string,
  raw: string,
): Promise<Buffer[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = source.refs
    ? await edit(source, n, quality, key, raw)
    : await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: source.model,
          prompt: source.prompt,
          size: source.size,
          quality,
          n,
          output_format: "png",
          ...(source.background === "transparent"
            ? { background: "transparent" }
            : {}),
        }),
      });
  const body = (await response.json()) as {
    data?: { b64_json: string }[];
    error?: { message: string };
  };
  if (!response.ok || !body.data)
    throw new Error(
      `${source.id}: ${response.status} ${body.error?.message ?? ""}`,
    );
  return body.data.map((item) => Buffer.from(item.b64_json, "base64"));
}

function edit(
  source: Source,
  n: number,
  quality: string,
  key: string,
  raw: string,
): Promise<Response> {
  const form = new FormData();
  form.set("model", source.model);
  form.set("prompt", source.prompt);
  form.set("size", source.size);
  form.set("quality", quality);
  form.set("n", String(n));
  if (source.background === "transparent") {
    form.set("background", "transparent");
    form.set("output_format", "png");
  }
  for (const ref of source.refs ?? []) {
    const cached = ref.startsWith(CACHE_REF);
    const file = cached ? ref.slice(CACHE_REF.length) : ref;
    form.append(
      "image[]",
      new Blob([readFileSync(join(cached ? raw : OUT, file))], {
        type: mime(file),
      }),
      file,
    );
  }
  return fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
}

/** Fits an image in a headless page's canvas: crops, trims transparent margins and scales to the asset's exact size. */
async function fit(page: Page, asset: Asset, image: Buffer): Promise<Buffer> {
  const out = await page.evaluate(
    async ({ url, width, height, fit, opaque }) => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      if (fit.kind === "box") {
        const source = document.createElement("canvas");
        source.width = img.width;
        source.height = img.height;
        const sx = source.getContext("2d")!;
        sx.drawImage(img, 0, 0);
        const pixels = sx.getImageData(0, 0, img.width, img.height);
        const { data } = pixels;
        // Faint stray pixels around the subject would widen the trim box and show as a halo in the game.
        let x0 = img.width;
        let y0 = img.height;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < img.height; y += 1)
          for (let x = 0; x < img.width; x += 1) {
            const i = (y * img.width + x) * 4 + 3;
            if ((data[i] ?? 0) <= 24) {
              data[i] = 0;
              continue;
            }
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        sx.putImageData(pixels, 0, 0);
        const bw = x1 - x0 + 1;
        const bh = y1 - y0 + 1;
        const [left, top, right, bottom] = fit.box;
        const s = Math.min((right - left) / bw, (bottom - top) / bh);
        const w = bw * s;
        const h = bh * s;
        ctx.drawImage(
          source,
          x0,
          y0,
          bw,
          bh,
          (left + right - w) / 2,
          (top + bottom - h) / 2,
          w,
          h,
        );
      } else {
        const s = Math.max(width / img.width, height / img.height);
        const sw = width / s;
        const sh = height / s;
        ctx.drawImage(
          img,
          (img.width - sw) / 2,
          (img.height - sh) / 2,
          sw,
          sh,
          0,
          0,
          width,
          height,
        );
        if (fit.kind === "tile") {
          // Along each axis, cross-fade the image with a copy of itself shifted by half its size. The copy's seam is
          // in the middle, where the original has full weight, and the original's seam is at the edge, where the copy
          // has; the result wraps without a seam. Doing x and then y keeps both.
          const blend = (horizontal: boolean) => {
            const pixels = ctx.getImageData(0, 0, width, height);
            const from = pixels.data.slice();
            const to = pixels.data;
            const size = horizontal ? width : height;
            const half = size / 2;
            for (let y = 0; y < height; y += 1)
              for (let x = 0; x < width; x += 1) {
                const p = horizontal ? x : y;
                const t = Math.min(
                  1,
                  Math.max(0, (1 - Math.abs(p - half) / half - 0.08) / 0.3),
                );
                const weight = t * t * (3 - 2 * t);
                const q = (p + half) % size;
                const i = (y * width + x) * 4;
                const j = (horizontal ? y * width + q : q * width + x) * 4;
                for (let c = 0; c < 3; c += 1)
                  to[i + c] =
                    (from[i + c] ?? 0) * weight +
                    (from[j + c] ?? 0) * (1 - weight);
              }
            ctx.putImageData(pixels, 0, 0);
          };
          blend(true);
          if (fit.axes === "xy") blend(false);
        }
      }
      // Opaque art ships as WebP (about a tenth of the PNG's size, which matters on phones); sprites keep PNG alpha.
      return (
        (opaque
          ? canvas.toDataURL("image/webp", 0.9)
          : canvas.toDataURL("image/png")
        ).split(",")[1] ?? ""
      );
    },
    {
      url: `data:image/png;base64,${image.toString("base64")}`,
      width: asset.width,
      height: asset.height,
      fit: asset.fit,
      opaque: !asset.transparent,
    },
  );
  return Buffer.from(out, "base64");
}

/**
 * Draws the fitted files for review: the parts assembled into a bike at the rest layout, and every file on a
 * checkerboard with its joints marked. Returns the contact sheet and the plain assembled bike (the hero's reference).
 */
async function sheet(
  page: Page,
): Promise<{ contact: Buffer; assembled: Buffer }> {
  const urls: Record<string, string> = {};
  for (const asset of ASSETS) {
    const path = join(OUT, asset.file);
    if (existsSync(path))
      urls[asset.file] =
        `data:${mime(asset.file)};base64,${readFileSync(path).toString("base64")}`;
  }
  const out = await page.evaluate(
    async ({ urls, layout, assets }) => {
      const images: Record<string, HTMLImageElement> = {};
      await Promise.all(
        Object.entries(urls).map(
          ([file, src]) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              image.onload = () => {
                images[file] = image;
                resolve();
              };
              image.onerror = reject;
              image.src = src;
            }),
        ),
      );
      type Point = readonly [number, number];
      /** The bike and rider at rest, at `scale` pixels per world unit with the frame's centre at (ox, oy). */
      const bike = (
        ctx: CanvasRenderingContext2D,
        ox: number,
        oy: number,
        scale: number,
        guides: boolean,
      ) => {
        const k = scale / layout.pxPerUnit;
        const at = ([x, y]: Point): [number, number] => [
          ox + x * scale,
          oy - y * scale,
        ];
        const centredAt = (file: string, world: Point, size: number) => {
          const image = images[file];
          if (!image) return;
          const [x, y] = at(world);
          ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
        };
        /** Hangs a piece between two world points by its two joints, scaled evenly to span them. */
        const between = (file: string, a: Point, b: Point) => {
          const image = images[file];
          const joints = Object.values(
            assets.find((asset) => asset.file === file)?.joints ?? {},
          );
          const [ja, jb] = joints;
          if (!image || !ja || !jb) return;
          const [ax, ay] = at(a);
          const [bx, by] = at(b);
          const s = Math.hypot(bx - ax, by - ay) / (jb[0] - ja[0]);
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(Math.atan2(by - ay, bx - ax));
          ctx.scale(s, s);
          ctx.drawImage(image, -ja[0], -ja[1]);
          ctx.restore();
        };
        const line = (a: Point, b: Point) => {
          const [ax, ay] = at(a);
          const [bx, by] = at(b);
          ctx.strokeStyle = "#16e7ff";
          ctx.lineWidth = 10 * k;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        };
        // An illustrative riding pose; the game poses the rider itself.
        const hip: Point = [-0.36, 0.17];
        const shoulder: Point = [-0.1, 0.34];
        const knee: Point = [0.12, 0.04];
        const foot: Point = [0, -0.3];
        const elbow: Point = [0.2, 0.14];
        const hand: Point = [0.45, 0.28];
        const wheel = layout.wheelRadius * 2 * scale;
        line([-0.3, -0.3], layout.rearHub);
        line([0.55, 0.18], layout.frontHub);
        centredAt("wheel.png", layout.rearHub, wheel);
        centredAt("wheel.png", layout.frontHub, wheel);
        const frame = images["frame.png"];
        if (frame)
          ctx.drawImage(
            frame,
            ox - (frame.width * k) / 2,
            oy - (frame.height * k) / 2,
            frame.width * k,
            frame.height * k,
          );
        between("thigh.png", hip, knee);
        between("shin.png", knee, foot);
        between("torso.png", hip, shoulder);
        centredAt("head.png", layout.head, layout.headRadius * 2 * scale);
        between("upper-arm.png", shoulder, elbow);
        between("forearm.png", elbow, hand);
        if (!guides) return;
        ctx.strokeStyle = "rgba(255,228,107,0.9)";
        ctx.lineWidth = 1;
        const circle = (c: Point, r: number) => {
          const [x, y] = at(c);
          ctx.beginPath();
          ctx.arc(x, y, r * scale, 0, Math.PI * 2);
          ctx.stroke();
        };
        circle(layout.rearHub, layout.wheelRadius);
        circle(layout.frontHub, layout.wheelRadius);
        circle(layout.head, layout.headRadius);
        // Where the brief wants the seat top, handlebar grip and footpeg.
        for (const mark of [
          [-0.25, 0.12],
          [0.45, 0.28],
          [0, -0.3],
        ] as const)
          circle(mark, 0.025);
        const [bx0, by0, bx1, by1] = layout.frameBody;
        const [x0, y0] = at([bx0, by1]);
        const [x1, y1] = at([bx1, by0]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      };
      const navy = "#0b1030";
      const assembled = document.createElement("canvas");
      assembled.width = 768;
      assembled.height = 512;
      const actx = assembled.getContext("2d")!;
      actx.fillStyle = navy;
      actx.fillRect(0, 0, assembled.width, assembled.height);
      bike(actx, 384, 232, layout.pxPerUnit, false);

      const contact = document.createElement("canvas");
      contact.width = 2200;
      contact.height = 2300;
      const ctx = contact.getContext("2d")!;
      ctx.fillStyle = navy;
      ctx.fillRect(0, 0, contact.width, contact.height);
      bike(ctx, 550, 420, 400, true);
      bike(ctx, 1650, 420, 400, false);
      ctx.drawImage(assembled, 0, 0, 768, 512, 20, 860, 384, 256);
      // Every file at its own size on a checkerboard, joints marked.
      let x = 20;
      let y = 1140;
      let row = 0;
      for (const asset of assets) {
        const image = images[asset.file];
        if (!image) continue;
        const w = Math.min(asset.width, 512);
        const h = (asset.height * w) / asset.width;
        if (x + w > contact.width - 20) {
          x = 20;
          y += row + 20;
          row = 0;
        }
        for (let cy = 0; cy < h; cy += 16)
          for (let cx = 0; cx < w; cx += 16) {
            ctx.fillStyle = (cx + cy) % 32 === 0 ? "#5a5f78" : "#2a2e48";
            ctx.fillRect(
              x + cx,
              y + cy,
              Math.min(16, w - cx),
              Math.min(16, h - cy),
            );
          }
        ctx.drawImage(image, x, y, w, h);
        ctx.strokeStyle = "rgba(255,228,107,0.9)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
        for (const [jx, jy] of Object.values(asset.joints ?? {})) {
          ctx.beginPath();
          ctx.arc(
            x + (jx * w) / asset.width,
            y + (jy * w) / asset.width,
            4,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        x += w + 20;
        row = Math.max(row, h);
      }
      const png = (canvas: HTMLCanvasElement): string =>
        canvas.toDataURL("image/png").split(",")[1] ?? "";
      return { contact: png(contact), assembled: png(assembled) };
    },
    {
      urls,
      layout: LAYOUT,
      assets: ASSETS.map(({ file, width, height, joints }) => ({
        file,
        width,
        height,
        joints,
      })),
    },
  );
  return {
    contact: Buffer.from(out.contact, "base64"),
    assembled: Buffer.from(out.assembled, "base64"),
  };
}

/** Writes a text file formatted the way the repository's Prettier check expects. */
async function writeFormatted(path: string, text: string): Promise<void> {
  const config = await resolveConfig(path);
  writeFileSync(path, await format(text, { ...config, filepath: path }));
}

function writeManifest(): Promise<void> {
  const manifest = {
    version: 1,
    theme: "neon-night-trials",
    provenance:
      "Original assets generated for this project with OpenAI image generation by scripts/elasto-fuse-art.ts. Prompts are retained there and in docs/design/elasto-fuse-art.md. No Elasto Mania art is used.",
    layout: LAYOUT,
    assets: ASSETS.map(
      ({ file, role, width, height, transparent, pivot, joints, note }) => ({
        file,
        role,
        width,
        height,
        transparent,
        sampling: "linear",
        pivot,
        ...(joints ? { joints } : {}),
        trim: [0, 0, width, height],
        note,
      }),
    ),
  };
  return writeFormatted(
    join(OUT, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

/** Writes the prompt sheet from the tables above, so it never drifts from what the script sends. */
function writeDoc(): Promise<void> {
  const point = (p: readonly [number, number]): string => `(${p[0]}, ${p[1]})`;
  const lines = [
    "# Elasto Fuse art",
    "",
    "Generated by `scripts/elasto-fuse-art.ts` (edit the tables there, then rerun it; this file is rewritten on every run). " +
      "The script calls the OpenAI image API with `OPENAI_API_KEY` from the environment, caches the raw images in `node_modules/.cache/elasto-fuse-art/`, " +
      "and fits them in a headless Chromium canvas to the exact sizes below in `public/games/elasto-fuse/art/v1/`, with `manifest.json` beside them. " +
      "The renderer draws a procedural fallback for any file that is missing.",
    "",
    "Look: a side-view motorbike trials game in the Fuse neon style, mechanically modelled on Elasto Mania (a springy dirt bike on polygon terrain; collect every apple, then touch the flower). " +
      "The art is original; no Elasto Mania art, names or logos are used.",
    "",
    "## Geometry",
    "",
    `The frame is drawn at ${LAYOUT.pxPerUnit} px per world unit; the wheel and the head are scaled to their world radius and each limb to the distance between its two joints. The bike faces right in every sprite (the code mirrors it), in a flat side view with no perspective, ground or shadow. ` +
      "The code hue-shifts the cyan accent per player at load, so the bike and rider sprites use cyan (#16e7ff) as their only accent on dark graphite, white and neutral grey.",
    "",
    `Rest layout in world units, x right, y up, origin at the bike frame's centre: rear wheel hub ${point(LAYOUT.rearHub)}, front wheel hub ${point(LAYOUT.frontHub)}, wheel radius ${LAYOUT.wheelRadius}, ` +
      `rider head centre ${point(LAYOUT.head)} with radius ${LAYOUT.headRadius}. The frame's body stays within x ${LAYOUT.frameBody[0]} to ${LAYOUT.frameBody[2]} and y ${LAYOUT.frameBody[1]} to ${LAYOUT.frameBody[3]}; ` +
      "the code draws the front fork and the rear swingarm as lines from the frame to the moving wheels. " +
      "The torso and the four limb pieces lie horizontally and hang between two joints, listed in `manifest.json` as `joints`.",
    "",
    "## Files",
    "",
    "| File | Size | Alpha | Pivot | Joints (px) | Built from | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...ASSETS.map(
      (a) =>
        `| \`${a.file}\` | ${a.width}×${a.height} | ${a.transparent ? "yes" : "no"} | ${a.pivot.join(", ")} | ${
          a.joints
            ? Object.entries(a.joints)
                .map(([name, p]) => `${name} ${point(p)}`)
                .join(", ")
            : ""
        } | \`${a.source}\` | ${a.note} |`,
    ),
    "",
    "Opaque art is WebP (quality 0.9, about a tenth of the PNG's size); sprites are PNG with real transparency. " +
      "A sprite is trimmed of its transparent margin (pixels with alpha of 24 or less are cleared, which removes stray halos) and scaled evenly into its box, centred, so a round piece keeps its centre and a limb's joint line stays on the image's horizontal midline. " +
      "The ground and the sky are made to tile by cross-fading each with a copy of itself shifted by half its size, along both axes for the ground and along x for the sky.",
    "",
    "## Shared style",
    "",
    `> ${STYLE}`,
    "",
    "## Prompts",
    "",
    ...SOURCES.flatMap((source) => [
      `### \`${source.id}\``,
      "",
      `\`${source.model}\`, ${source.size}, ${source.background} background${source.refs ? `, reference images ${source.refs.map((f) => `\`${f.replace(CACHE_REF, "")}\``).join(", ")} (edits endpoint)` : ""}.`,
      "",
      `> ${source.prompt}`,
      "",
    ]),
    "## Rerunning",
    "",
    "```sh",
    "pnpm exec tsx scripts/elasto-fuse-art.ts                               # every asset",
    "pnpm exec tsx scripts/elasto-fuse-art.ts --only frame --n 3            # three candidates, written to the cache for review",
    "pnpm exec tsx scripts/elasto-fuse-art.ts --only frame --pick frame=2   # fit the chosen candidate into place",
    "pnpm exec tsx scripts/elasto-fuse-art.ts --sheet                       # contact sheet of the fitted files",
    "pnpm exec tsx scripts/elasto-fuse-art.ts --manifest                    # manifest and this file only",
    "```",
    "",
    "Sources run in three stages: first the pieces with no reference image, then the limbs (they take the fitted `torso.png` as a reference, so they share its suit), then the hero. " +
      "The hero's first reference is `assembled.png`, the fitted parts assembled into a bike at the rest layout, which the script writes to the cache with `contact-sheet.png` on every run. " +
      "Regenerate the limbs after the torso changes, and the hero after any bike or rider piece, the apple, the flower or the sky changes.",
    "",
  ];
  return writeFormatted(
    join(ROOT, "docs/design/elasto-fuse-art.md"),
    lines.join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  mkdirSync(OUT, { recursive: true });
  mkdirSync(options.raw, { recursive: true });
  await writeManifest();
  await writeDoc();
  if (options.manifestOnly) return;

  // A pick refits only the picked sources, so that it never puts candidate 0 back over an earlier pick.
  const wanted = options.sheetOnly
    ? []
    : ASSETS.filter((asset) =>
        options.picks.size > 0
          ? options.picks.has(asset.source)
          : !options.only ||
            options.only.has(stem(asset.file)) ||
            options.only.has(asset.source),
      );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // tsx keeps function names with an `__name` helper that the page does not have.
    await page.evaluate("window.__name = (f) => f");
    const writeSheet = async () => {
      const { contact, assembled } = await sheet(page);
      writeFileSync(join(options.raw, "contact-sheet.png"), contact);
      writeFileSync(join(options.raw, "assembled.png"), assembled);
    };
    for (const stage of [0, 1, 2]) {
      const sources = SOURCES.filter(
        (source) =>
          stageOf(source) === stage &&
          wanted.some((asset) => asset.source === source.id),
      );
      if (sources.length === 0) continue;
      if (stage === 2) {
        const missing = ASSETS.filter(
          (asset) => asset.transparent && !existsSync(join(OUT, asset.file)),
        ).map((asset) => asset.file);
        if (missing.length > 0 && !options.reprocess)
          throw new Error(
            `the hero's reference needs the fitted sprites first; missing ${missing.join(", ")}`,
          );
        await writeSheet();
      }
      if (!options.reprocess) {
        await Promise.all(
          sources.map(async (source) => {
            const images = await generate(
              source,
              options.n,
              options.quality,
              options.raw,
            );
            images.forEach((image, i) =>
              writeFileSync(join(options.raw, `${source.id}-${i}.png`), image),
            );
            console.log(`generated ${source.id} ×${images.length}`);
          }),
        );
      }
      for (const asset of wanted) {
        if (!sources.some((source) => source.id === asset.source)) continue;
        const count = options.picks.size > 0 ? 1 : options.n;
        let done = 0;
        for (let i = 0; i < count; i += 1) {
          const path = join(
            options.raw,
            `${asset.source}-${options.picks.get(asset.source) ?? i}.png`,
          );
          if (!existsSync(path)) continue;
          const fitted = await fit(page, asset, readFileSync(path));
          if (count > 1)
            writeFileSync(
              join(
                options.raw,
                `${stem(asset.file)}-fit-${i}${asset.file.slice(asset.file.lastIndexOf("."))}`,
              ),
              fitted,
            );
          if (i === 0) writeFileSync(join(OUT, asset.file), fitted);
          done += 1;
        }
        console.log(
          done > 0
            ? `fitted ${asset.file}`
            : `skipped ${asset.file}: no raw image in the cache`,
        );
      }
    }
    await writeSheet();
  } finally {
    await browser.close();
  }
}

await main();
