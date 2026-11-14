/**
 * Generates Fuse Volley's art (game id `fuse-volley`) with the OpenAI image API and fits each image to the size the
 * renderer expects, writing `public/games/fuse-volley/art/v1/` and its `manifest.json`.
 *
 *   OPENAI_API_KEY=… pnpm exec tsx scripts/fuse-volley-art.ts                 # every asset, one candidate each
 *   pnpm exec tsx scripts/fuse-volley-art.ts --only blob-cyan,ball --n 3      # three candidates of two assets
 *   pnpm exec tsx scripts/fuse-volley-art.ts --reprocess                      # refit the cached raw images, no API calls
 *   pnpm exec tsx scripts/fuse-volley-art.ts --manifest                       # rewrite manifest.json only
 *
 * Raw API images are cached in `--raw` (default `node_modules/.cache/fuse-volley-art/`, git-ignored), named
 * `<source>-<n>.png`. With `--n` above 1 each fitted candidate is written next to its raw image as `<file>-<n>.png`
 * for review, and candidate 0 goes to the public folder; `--pick <source>=<n>` refits a chosen candidate into place.
 * The key is read from the environment and never printed. Prompts live here and in docs/design/fuse-volley-art.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { format, resolveConfig } from "prettier";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, "public/games/fuse-volley/art/v1");

const STYLE =
  "Modern neon arcade style matching the Fuse Riders game family: clean vector-like shapes, smooth gradients, glossy highlights, high contrast, deep navy and indigo night palette lit by cyan (#16e7ff), hot pink (#ff2e9d) and warm gold (#ffe46b) neon. No text, no letters, no numbers, no logos, no watermark, no UI.";

type Background = "opaque" | "transparent";
/** One image requested from the API. */
interface Source {
  id: string;
  model: string;
  size: string;
  background: Background;
  prompt: string;
  /** Fitted asset files (from the output folder) sent as reference images; the request then goes to the edits endpoint. */
  refs?: string[];
}

const blob = (colour: string, name: string, hue: string): string =>
  `A single glossy translucent jelly blob character for a 2D side-on beach volleyball game, seen straight from the front. ` +
  `Shape: a tall soft pear, clearly taller than wide (about 1.3 times as tall as wide), a smaller rounded head bulge on top of a wider, heavier rounded body, like a drop of gelatin standing on the ground, with a flat bottom where it rests. ` +
  `Colour: vivid ${name} ${colour} (${hue}), translucent candy jelly with a darker saturated core, a bright rim light, a large soft white specular highlight on the upper left and a small sharp glint, a faint inner neon glow. ` +
  `Absolutely no face: no eyes, no mouth, no limbs, no accessories, nothing on the body. Centred, the whole blob in frame with generous margin, isolated on a fully transparent background, no shadow, no floor. ${STYLE}`;

const SOURCES: Source[] = [
  {
    id: "court-sky",
    model: "gpt-image-2",
    size: "1536x1024",
    background: "opaque",
    prompt:
      `Side-view 2D game background of a tropical beach at neon dusk, wide shot, used behind a beach volleyball court. ` +
      `A large setting sun with soft horizontal neon stripes sits low on the horizon slightly left of centre, a calm sea with long glowing reflections fills the lower third, a deep indigo-to-magenta gradient sky with a few faint stars and thin soft clouds. ` +
      `Dark palm tree silhouettes with faint cyan rim light only at the far left and far right edges, leaning outward; the middle of the image is open sky and sea with nothing standing in it. ` +
      `The bottom tenth of the image is the calm shoreline where wet sand meets the sea, flat and horizontal. No net, no poles, no posts, no people, no characters, no ball. ` +
      `Low contrast and slightly muted so game sprites read clearly on top of it. ${STYLE}`,
  },
  {
    id: "court-sand",
    model: "gpt-image-2",
    size: "1536x1024",
    background: "opaque",
    prompt:
      `Seamless side-view 2D game ground texture: smooth beach sand at night lit by neon dusk light, seen from the side as a flat band filling the whole frame. ` +
      `Fine soft sand grain, gentle subtle ripples, warm muted peach and lilac tones fading darker toward the bottom, a faint cyan and pink glow catching the top of the sand. ` +
      `Uniform and even across the full width, no horizon, no sky, no objects, no footprints, no shells, no lines. Low contrast. ${STYLE}`,
  },
  {
    id: "blob-cyan",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt: blob(
      "#16e7ff",
      "electric cyan",
      "a bright aqua cyan, greener than sky blue, never deep blue",
    ),
  },
  {
    id: "blob-pink",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt: blob("#ff2e9d", "hot pink", "a hot magenta pink"),
  },
  {
    id: "ball",
    model: "gpt-image-1.5",
    size: "1024x1024",
    background: "transparent",
    prompt:
      `A single classic volleyball seen straight on, a perfect sphere, with the familiar curved three-way panel pattern: alternating white and warm gold (#ffe46b) panels separated by thin dark seams. ` +
      `Glossy modern finish, soft shading toward the lower right, a crisp white specular highlight on the upper left, a faint warm neon rim glow. ` +
      `Isolated on a fully transparent background, no shadow, no motion lines, centred. ${STYLE}`,
  },
  {
    id: "hero",
    model: "gpt-image-2",
    size: "1536x864",
    background: "opaque",
    refs: ["blob-cyan.png", "blob-pink.png", "ball.png", "court.webp"],
    prompt:
      `Landing-page key art for a two-player neon beach volleyball game, using the reference images: the first is the cyan player blob, the second the pink player blob, the third the volleyball and the fourth the beach court backdrop. ` +
      `Side view of that beach at neon dusk with a glowing cyan net on two slim posts in the centre of the court. ` +
      `On the left, the cyan blob from the first image, exactly its armless pear shape and glossy jelly look, leaping up toward the net, squashed and stretched slightly by the jump; on the right the pink blob from the second image sitting on the sand, ready. ` +
      `Each blob gets only two simple big white oval eyes with black pupils looking at the ball, placed on the head bulge; no arms, no hands, no flippers, no legs, no mouth. ` +
      `The volleyball from the third image high above the net with a short warm neon trail. Dynamic, joyful, polished, cinematic glow. ${STYLE}`,
  },
];

/** One file the renderer loads, fitted from one source image. */
interface Asset {
  file: string;
  role: string;
  width: number;
  height: number;
  transparent: boolean;
  pivot: [number, number];
  sources: string[];
  fit: "court" | "sprite" | "ball" | "cover";
  note: string;
}

const COURT_SAND_Y = 1000;
const ASSETS: Asset[] = [
  {
    file: "court.webp",
    role: "opaque court backdrop",
    width: 1600,
    height: 1200,
    transparent: false,
    pivot: [0, 0],
    sources: ["court-sky", "court-sand"],
    fit: "court",
    note: `Sand's top edge is the flat line y=${COURT_SAND_Y}; x=760..840 holds no net or post (the code draws the net at x=800).`,
  },
  {
    file: "blob-cyan.png",
    role: "player blob, cyan side",
    width: 384,
    height: 448,
    transparent: true,
    pivot: [0.5, 1],
    sources: ["blob-cyan"],
    fit: "sprite",
    note: "Faceless (code draws the eyes); about 85% of the width, flat bottom on the bottom edge, centred.",
  },
  {
    file: "blob-pink.png",
    role: "player blob, pink side",
    width: 384,
    height: 448,
    transparent: true,
    pivot: [0.5, 1],
    sources: ["blob-pink"],
    fit: "sprite",
    note: "Faceless (code draws the eyes); about 85% of the width, flat bottom on the bottom edge, centred.",
  },
  {
    file: "ball.png",
    role: "volleyball",
    width: 256,
    height: 256,
    transparent: true,
    pivot: [0.5, 0.5],
    sources: ["ball"],
    fit: "ball",
    note: "The ball fills the circle inscribed in the square.",
  },
  {
    file: "hero.webp",
    role: "landing art",
    width: 1536,
    height: 864,
    transparent: false,
    pivot: [0.5, 0.5],
    sources: ["hero"],
    fit: "cover",
    note: "Cyan blob left, pink right, net and ball; no text.",
  },
];

interface Options {
  only: Set<string> | null;
  n: number;
  raw: string;
  quality: string;
  reprocess: boolean;
  manifestOnly: boolean;
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
      if (id && n) picks.set(id, Number(n));
    }
  }
  return {
    only: only ? new Set(only.split(",")) : null,
    n: Number(value("--n") ?? 1),
    raw: value("--raw") ?? join(ROOT, "node_modules/.cache/fuse-volley-art"),
    quality: value("--quality") ?? "high",
    reprocess: argv.includes("--reprocess") || picks.size > 0,
    manifestOnly: argv.includes("--manifest"),
    picks,
  };
}

async function generate(
  source: Source,
  n: number,
  quality: string,
): Promise<Buffer[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = source.refs
    ? await edit(source, n, quality, key)
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
): Promise<Response> {
  const form = new FormData();
  form.set("model", source.model);
  form.set("prompt", source.prompt);
  form.set("size", source.size);
  form.set("quality", quality);
  form.set("n", String(n));
  for (const file of source.refs ?? []) {
    form.append(
      "image[]",
      new Blob([readFileSync(join(OUT, file))], {
        type: file.endsWith(".webp") ? "image/webp" : "image/png",
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

/** Fits images in a headless page's canvas: crops, trims transparent margins and scales to the asset's exact size. */
async function fit(
  page: Page,
  asset: Asset,
  images: Buffer[],
): Promise<Buffer> {
  const urls = images.map(
    (image) => `data:image/png;base64,${image.toString("base64")}`,
  );
  const out = await page.evaluate(
    async ({ urls, width, height, mode, sandY, opaque }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const imgs = await Promise.all(urls.map(load));
      const at = (i: number): HTMLImageElement => {
        const img = imgs[i];
        if (!img) throw new Error(`missing source image ${i}`);
        return img;
      };
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      /** Draws `img` scaled to cover the box, anchored by `ay` (0 = keep top, 1 = keep bottom). */
      const cover = (
        img: HTMLImageElement,
        x: number,
        y: number,
        w: number,
        h: number,
        ay: number,
      ) => {
        const s = Math.max(w / img.width, h / img.height);
        const sw = w / s;
        const sh = h / s;
        ctx.drawImage(
          img,
          (img.width - sw) / 2,
          (img.height - sh) * ay,
          sw,
          sh,
          x,
          y,
          w,
          h,
        );
      };
      const bbox = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const cx = c.getContext("2d")!;
        cx.drawImage(img, 0, 0);
        const { data } = cx.getImageData(0, 0, img.width, img.height);
        let x0 = img.width;
        let y0 = img.height;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < img.height; y += 1)
          for (let x = 0; x < img.width; x += 1)
            if ((data[(y * img.width + x) * 4 + 3] ?? 0) > 24) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
        return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      };
      if (mode === "court") {
        const sky = at(0);
        const sand = at(1);
        // Muted so the blobs, ball and net read clearly against it.
        ctx.filter = "saturate(0.8) brightness(0.78)";
        cover(sky, 0, 0, width, sandY, 1);
        ctx.filter = "saturate(0.8) brightness(0.72)";
        cover(sand, 0, sandY, width, height - sandY, 0);
        ctx.filter = "none";
        // A soft shade under the edge and a thin neon lip keep the flat sand line crisp at game scale.
        const shade = ctx.createLinearGradient(0, sandY, 0, sandY + 60);
        shade.addColorStop(0, "rgba(255,255,255,0.10)");
        shade.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shade;
        ctx.fillRect(0, sandY, width, 60);
        const lip = ctx.createLinearGradient(0, 0, width, 0);
        lip.addColorStop(0, "rgba(22,231,255,0.55)");
        lip.addColorStop(0.5, "rgba(255,228,107,0.45)");
        lip.addColorStop(1, "rgba(255,46,157,0.55)");
        ctx.fillStyle = lip;
        ctx.fillRect(0, sandY, width, 3);
      } else if (mode === "cover") {
        cover(at(0), 0, 0, width, height, 0.5);
      } else {
        const img = at(0);
        const b = bbox(img);
        if (mode === "sprite") {
          const s = Math.min((width * 0.85) / b.w, height / b.h);
          const w = b.w * s;
          const h = b.h * s;
          ctx.drawImage(
            img,
            b.x,
            b.y,
            b.w,
            b.h,
            (width - w) / 2,
            height - h,
            w,
            h,
          );
        } else {
          const s = Math.min(width / b.w, height / b.h);
          const w = b.w * s;
          const h = b.h * s;
          ctx.drawImage(
            img,
            b.x,
            b.y,
            b.w,
            b.h,
            (width - w) / 2,
            (height - h) / 2,
            w,
            h,
          );
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
      urls,
      width: asset.width,
      height: asset.height,
      mode: asset.fit,
      sandY: COURT_SAND_Y,
      opaque: !asset.transparent,
    },
  );
  return Buffer.from(out, "base64");
}

/** Writes a text file formatted the way the repository's Prettier check expects. */
async function writeFormatted(path: string, text: string): Promise<void> {
  const config = await resolveConfig(path);
  writeFileSync(path, await format(text, { ...config, filepath: path }));
}

function writeManifest(): Promise<void> {
  const manifest = {
    version: 1,
    theme: "neon-dusk-beach",
    provenance:
      "Original assets generated for this project with OpenAI image generation by scripts/fuse-volley-art.ts. Prompts are retained there and in docs/design/fuse-volley-art.md. No Blobby Volley art is used.",
    assets: ASSETS.map(
      ({ file, role, width, height, transparent, pivot, note }) => ({
        file,
        role,
        width,
        height,
        transparent,
        sampling: "linear",
        pivot,
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
  const lines = [
    "# Fuse Volley art",
    "",
    "Generated by `scripts/fuse-volley-art.ts` (edit the tables there, then rerun it; this file is rewritten on every run). " +
      "The script calls the OpenAI image API with `OPENAI_API_KEY` from the environment, caches the raw images in `node_modules/.cache/fuse-volley-art/`, " +
      "and fits them in a headless Chromium canvas to the exact sizes below in `public/games/fuse-volley/art/v1/`, with `manifest.json` beside them. " +
      "The renderer draws a procedural fallback for any file that is missing.",
    "",
    "Look: recognisably Blobby Volley (faceless jelly blobs, a beach court with a net, a volleyball, the sun and sky) in the Fuse neon style. " +
      "The art is original; no Blobby Volley art is used. The code draws the blobs' eyes and the net, so neither is in the sprites or the court.",
    "",
    "## Files",
    "",
    "| File | Size | Alpha | Pivot | Built from | Notes |",
    "| --- | --- | --- | --- | --- | --- |",
    ...ASSETS.map(
      (a) =>
        `| \`${a.file}\` | ${a.width}×${a.height} | ${a.transparent ? "yes" : "no"} | ${a.pivot.join(", ")} | ${a.sources.map((id) => `\`${id}\``).join(" + ")} | ${a.note} |`,
    ),
    "",
    "Opaque art is WebP (quality 0.9, about a tenth of the PNG's size); sprites are PNG. " +
      "The court is composed from two images: the sky is cropped into rows 0–999 and the sand into rows 1000–1199, both muted, with a thin neon lip on the flat sand line at y=1000.",
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
      `\`${source.model}\`, ${source.size}, ${source.background} background${source.refs ? `, reference images ${source.refs.map((f) => `\`${f}\``).join(", ")} (edits endpoint)` : ""}.`,
      "",
      `> ${source.prompt}`,
      "",
    ]),
    "## Rerunning",
    "",
    "```sh",
    "pnpm exec tsx scripts/fuse-volley-art.ts                                  # every asset",
    "pnpm exec tsx scripts/fuse-volley-art.ts --only blob-cyan --n 3            # three candidates, written to the cache for review",
    "pnpm exec tsx scripts/fuse-volley-art.ts --only blob-cyan --pick blob-cyan=2  # fit the chosen candidate into place",
    "pnpm exec tsx scripts/fuse-volley-art.ts --manifest                        # manifest and this file only",
    "```",
    "",
    "Regenerate the hero after the blobs, ball or court change: it uses them as reference images.",
    "",
  ];
  return writeFormatted(
    join(ROOT, "docs/design/fuse-volley-art.md"),
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

  const wanted = ASSETS.filter(
    (asset) =>
      !options.only ||
      options.only.has(asset.file.replace(/\.\w+$/, "")) ||
      asset.sources.some((id) => options.only!.has(id)),
  );
  const sourceIds = new Set(wanted.flatMap((asset) => asset.sources));
  if (!options.reprocess) {
    await Promise.all(
      SOURCES.filter(
        (source) =>
          sourceIds.has(source.id) &&
          (!options.only ||
            options.only.has(source.id) ||
            wanted.some(
              (a) =>
                a.sources.includes(source.id) &&
                options.only!.has(a.file.replace(/\.\w+$/, "")),
            )),
      ).map(async (source) => {
        const images = await generate(source, options.n, options.quality);
        images.forEach((image, i) =>
          writeFileSync(join(options.raw, `${source.id}-${i}.png`), image),
        );
        console.log(`generated ${source.id} ×${images.length}`);
      }),
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // tsx keeps function names with an `__name` helper that the page does not have.
    await page.evaluate("window.__name = (f) => f");
    for (const asset of wanted) {
      const rawOf = (id: string, i: number) =>
        join(options.raw, `${id}-${i}.png`);
      const count = options.picks.size > 0 ? 1 : options.n;
      for (let i = 0; i < count; i += 1) {
        const paths = asset.sources.map((id) =>
          rawOf(id, options.picks.get(id) ?? i),
        );
        if (!paths.every((path) => existsSync(path))) continue;
        const fitted = await fit(
          page,
          asset,
          paths.map((path) => readFileSync(path)),
        );
        if (count > 1)
          writeFileSync(
            join(
              options.raw,
              `${asset.file.replace(/\.\w+$/, "")}-fit-${i}${asset.file.slice(asset.file.lastIndexOf("."))}`,
            ),
            fitted,
          );
        if (i === 0) writeFileSync(join(OUT, asset.file), fitted);
      }
      console.log(`fitted ${asset.file}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
