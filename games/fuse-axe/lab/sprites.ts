/**
 * Dev-only sprite sheet: `pnpm exec vite`, then open /games/fuse-axe/lab/sprites.html. It is not in the build and not
 * on the portal. Each figure in `FIGURES` is drawn through the production baker with a canvas surface.
 */
import { FIGURES } from "../src/render/art/index.js";
import {
  createSpriteBaker,
  type BakeOptions,
  type MakeSurface,
} from "../src/render/pixel/surface.js";

const canvas = (width: number, height: number) => {
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  const paint = image.getContext("2d");
  if (!paint) throw new Error("This browser has no 2D canvas");
  paint.imageSmoothingEnabled = false;
  return { image, paint };
};
const makeSurface: MakeSurface<HTMLCanvasElement> = canvas;
const baker = createSpriteBaker(makeSurface);
const SCALE = 4;
const PAD = 3;
const main = document.querySelector("main")!;

for (const [name, figure] of Object.entries(FIGURES)) {
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  // One cell size per figure, wide enough either side of the anchor for every frame flipped or not.
  const side = Math.max(...sprites.map((s) => Math.max(s.ax, s.w - 1 - s.ax)));
  const up = Math.max(...sprites.map((s) => s.ay));
  const down = Math.max(...sprites.map((s) => s.h - 1 - s.ay));
  const [cw, ch] = [side * 2 + 1 + PAD * 2, up + down + 1 + PAD * 2];
  const variants: [string, BakeOptions][] = [
    ["", {}],
    ...Object.entries(figure.swaps).map(
      ([swap, palette]): [string, BakeOptions] => [swap, { swap: palette }],
    ),
    ["flash", { flash: true }],
    ["flip", { flip: true }],
  ];
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent = name;
  for (const [label, options] of variants) {
    const row = document.createElement("div");
    row.className = "row";
    figure.frames.forEach((frame, i) => {
      const baked = baker.bake(sprites[i]!, options);
      const [x, y] = [PAD + side - baked.ax, PAD + up - baked.ay];
      const big = canvas(cw * SCALE, ch * SCALE);
      big.paint.fillStyle = "#16e7ff55";
      big.paint.fillRect(0, (PAD + up + 1) * SCALE, cw * SCALE, 1);
      big.paint.fillRect(
        (PAD + side) * SCALE,
        (PAD + up + 1) * SCALE,
        SCALE,
        3,
      );
      big.paint.drawImage(
        baked.image,
        x * SCALE,
        y * SCALE,
        baked.w * SCALE,
        baked.h * SCALE,
      );
      const small = canvas(cw, ch);
      small.paint.drawImage(baked.image, x, y);
      const cell = document.createElement("figure");
      const caption = document.createElement("figcaption");
      caption.textContent = `${frame}${label && ` · ${label}`} — ${baked.w}×${baked.h}`;
      cell.append(caption, big.image, small.image);
      row.append(cell);
    });
    section.append(row);
  }
  main.append(section);
}
