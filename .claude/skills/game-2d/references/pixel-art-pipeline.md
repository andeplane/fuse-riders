# Pixel-art pipeline: source → snap → palette → sheet → engine

## 0. Lock the style contract (write it to `art/STYLE.md`)
- Internal resolution: 320×180 (scales ×6 to 1080p) or 480×270 (×4).
- Tile size: 16 px (or 8/32). Character height in tiles: e.g. 2 (32 px).
- Palette: one Lospec palette, 16-32 colours, saved as `art/palette.hex` (one `rrggbb` per line).
- Outline rule (1 px dark outline or none), light direction (top-left), and max frames per anim (idle 4, run 6-8, attack 4-6).

Every generation prompt and every review checks against this file.

## 1. AI sources

### PixelLab (MCP, best for 4/8-direction characters + Wang tilesets)
```bash
claude mcp add --transport http pixellab https://api.pixellab.ai/mcp \
  --header "Authorization: Bearer $PIXELLAB_TOKEN"
```
Tools: `create_character` (4 or 8 directional views), `animate_character` (walk/run/idle…), `create_tileset` (Wang tiles blending two terrains), `create_isometric_tile`. Generate the base character once and animate from it, so the proportions stay consistent. Check your plan's commercial-use terms.

### Retro Diffusion (REST + hosted MCP, best palette control)
- MCP: `https://mcp.retrodiffusion.ai/mcp`, header `Authorization: Bearer rdpk-...` (33 tools, including free cost estimates).
- REST v2 (Node 18+, no deps):
```js
// rd-gen.mjs (Node 20+)
import fs from "node:fs";
const H = { "X-RD-Token": process.env.RD_API_KEY, "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID() };
const res = await fetch("https://api.retrodiffusion.ai/v2/inferences", { method: "POST", headers: H,
  body: JSON.stringify({ prompt: "knight with blue cape, side view", prompt_style: "rd_plus__default",
    width: 64, height: 64, num_images: 1, seed: 42, remove_bg: true,
    input_palette: fs.readFileSync("art/palette.png").toString("base64") }) });
const { task_id } = await res.json();
let task; do { await new Promise(r => setTimeout(r, 2000));
  task = await (await fetch(`https://api.retrodiffusion.ai/v2/inferences/tasks/${task_id}`, { headers: H })).json();
} while (task.status === "pending" || task.status === "running");
if (task.status === "failed") throw new Error(task.error);
task.result.base64_images.forEach((b, i) => fs.writeFileSync(`out_${i}.png`, Buffer.from(b, "base64")));
```
Field names (`prompt_style`, `input_palette`, `remove_bg`, `tile_x`, `tile_y`) are from the Retro-Diffusion/api-examples README. List styles with `GET /v2/styles/selector`. It also has a low-poly 3D endpoint (`/v2/lowpoly`) for pixel-textured GLBs.

### Generic image models
Prompt for "pixel art, N×N grid, flat colours, no anti-aliasing, transparent background", then **always** run steps 2-3. The output is usually 1024 px with fake "pixels" that are 15.7 px wide and slightly blurred.

## 2. Grid snap (downsample AI output to true pixels)
```js
// scripts/grid-snap.mjs  — node grid-snap.mjs in.png out.png 64   (target width in px)
import fs from "node:fs"; import { PNG } from "pngjs";
const [, , inp, out, tw] = process.argv;
const src = PNG.sync.read(fs.readFileSync(inp));
const W = +tw, cell = src.width / W, H = Math.round(src.height / cell);
const dst = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * cell));   // sample cell centre
  const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * cell));
  const si = (sy * src.width + sx) * 4, di = (y * W + x) * 4;
  for (let c = 0; c < 4; c++) dst.data[di + c] = src.data[si + c];
}
fs.writeFileSync(out, PNG.sync.write(dst));
```

## 3. Palette quantize + check (CI gate)
```js
// scripts/check-palette.mjs — node check-palette.mjs art/palette.hex sprites/*.png [--fix]
import fs from "node:fs"; import { PNG } from "pngjs";
const [, , palFile, ...rest] = process.argv;
const fix = rest.includes("--fix"); const files = rest.filter((f) => f !== "--fix");
const pal = fs.readFileSync(palFile, "utf8").split(/\s+/).filter(Boolean)
  .map((h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16)));
const nearest = (r, g, b) => pal.reduce((best, p) => {
  const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
  return d < best.d ? { d, p } : best; }, { d: Infinity, p: pal[0] });
let bad = 0;
for (const f of files) {
  const png = PNG.sync.read(fs.readFileSync(f)); let off = 0, semi = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a > 0 && a < 255) { semi++; if (fix) png.data[i + 3] = a < 128 ? 0 : 255; }
    if (png.data[i + 3] === 0) continue;
    const n = nearest(png.data[i], png.data[i + 1], png.data[i + 2]);
    if (n.d > 0) { off++; if (fix) [png.data[i], png.data[i + 1], png.data[i + 2]] = n.p; }
  }
  if (off || semi) { bad++; console.log(`${f}: ${off} off-palette, ${semi} semi-transparent px`); }
  if (fix) fs.writeFileSync(f, PNG.sync.write(png));
}
process.exit(bad && !fix ? 1 : 0);
```
`npm i -D pngjs`. RGB-distance nearest colour is crude but good enough for 16-32 colour palettes. For dithering-aware quantization, do it in Aseprite (Sprite → Color Mode → Indexed) or with Retro Diffusion's `input_palette`.

## 4. Aseprite CLI export
```bash
# one sheet + JSON per character, tags become animations (Phaser createFromAseprite expects json-array + tags)
aseprite -b art/hero.aseprite --sheet public/sprites/hero.png --data public/sprites/hero.json \
  --format json-array --list-tags --sheet-type packed --ignore-layer "ref"

# PixiJS-friendly hash format
aseprite -b art/hero.aseprite --sheet hero.png --data hero.json --format json-hash --list-tags

# pack many sprites into one atlas
aseprite -b art/props/*.aseprite --sheet-pack --sheet public/atlas.png --data public/atlas.json --format json-hash

# tileset with extruded edges (prevents bleeding). Check `aseprite --help` for --extrude/--shape-padding in your version
aseprite -b art/tiles.aseprite --sheet public/tiles.png --sheet-type rows --extrude --shape-padding 2
```
Aseprite is EULA-licensed (buy it, or compile it for personal use). Agents on CI need a licensed install. Lua `--script` automates palette swaps and layer exports.

## 5. Engine import
- **Phaser 4:** `this.load.aseprite(key, png, json)` → `this.anims.createFromAseprite(key)` → `sprite.play("run")`. Tag names become animation keys, and tag direction (forward/ping-pong) is honoured.
- **PixiJS v8:** load the sheet with `Assets.load("hero.json")` → `Spritesheet`. Then:
```ts
const sheet = await Assets.load("sprites/hero.json");
const data = sheet.data as any; // Aseprite json-hash: meta.frameTags[{name,from,to}]
const names = Object.keys(data.frames);
const anims = Object.fromEntries(data.meta.frameTags.map((t: any) =>
  [t.name, names.slice(t.from, t.to + 1).map((n) => sheet.textures[n])]));
const run = new AnimatedSprite(anims.run); run.animationSpeed = 0.15; run.play();
```
(Per-frame `duration` in the JSON is ignored by `AnimatedSprite`. Use `AnimatedSprite` with `{ texture, time }[]` objects if timing matters.)
- **Godot 4:** Aseprite Wizard (viniciusgerevini/godot-aseprite-wizard, MIT) imports `.aseprite` → `SpriteFrames` / `AnimationPlayer` tracks.
- **three.js:** use the JSON frame rects as UV offsets on an instanced quad. Set `NearestFilter` and `generateMipmaps=false`.

## 6. Review checklist (send to the art critic, see `game-art-review`)
- Same pixel size everywhere (no mixed-scale sprites or rotated pixel art without `smoothPixelArt`).
- Palette check passes. No semi-transparent edge pixels (halo on dark backgrounds).
- Silhouette readable at 1× on the actual background. Animations loop without a pop.
- Tiles tile: render a 5×5 repeat of every tile and screenshot it.
