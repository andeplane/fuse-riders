/**
 * Dev-only sprite sheet: `pnpm exec vite`, then open /games/fuse-axe/lab/sprites.html. It is not in the build and not
 * on the portal. Each figure in `FIGURES` is drawn through the production baker with a canvas surface; each hero in
 * `HEROES` also gets its palettes, portraits and a reel per anim, timed by `heroFrame` at the game's 60 steps a second.
 * `?step=N` freezes the reels at step N.
 */
import { HERO_KINDS, STEPS_PER_SECOND } from "../src/engine/view-kit.js";
import {
  HERO_ANIMS,
  HERO_TIMING,
  heroFrame,
  type HeroTiming,
} from "../src/render/art/animate.js";
import { FIGURES, HEROES } from "../src/render/art/index.js";
import type { Sprite } from "../src/render/pixel/sprite.js";
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
const PAD = 3;
const main = document.querySelector("main")!;
const add = (parent: Element, tag: string, text = "", className = "") =>
  parent.appendChild(
    Object.assign(document.createElement(tag), {
      textContent: text,
      className,
    }),
  );

/** A cell for a set of sprites, wide enough either side of the anchor for each flipped or not, `wide` and `high` more. */
function cellFor(
  sprites: readonly Sprite[],
  scale: number,
  wide = 0,
  high = 0,
) {
  const side = Math.max(...sprites.map((s) => Math.max(s.ax, s.w - 1 - s.ax)));
  const up = Math.max(...sprites.map((s) => s.ay)) + high;
  const down = Math.max(...sprites.map((s) => s.h - 1 - s.ay));
  const [w, h] = [side * 2 + 1 + PAD * 2 + wide, up + down + 1 + PAD * 2];
  /**
   * Draws a sprite with its anchor on the cyan floor line, `dx` along it from the left and `lift` above it, on a new
   * canvas or over `onto`.
   */
  return (
    sprite: Sprite,
    options: BakeOptions = {},
    [dx, lift] = [0, 0],
    onto = canvas(w * scale, h * scale),
  ) => {
    const { image, paint } = onto;
    paint.clearRect(0, 0, image.width, image.height);
    const baked = baker.bake(sprite, options);
    const [x, floor] = [PAD + side + dx, PAD + up + 1];
    paint.fillStyle = "#16e7ff55";
    paint.fillRect(0, floor * scale, w * scale, 1);
    paint.fillRect(x * scale, floor * scale, scale, 3);
    const [left, top] = [x - baked.ax, floor - 1 - lift - baked.ay];
    paint.drawImage(
      baked.image,
      left * scale,
      top * scale,
      baked.w * scale,
      baked.h * scale,
    );
    return onto;
  };
}

for (const [name, figure] of Object.entries(FIGURES)) {
  const section = add(main, "section");
  add(section, "h2", `${name} · ${figure.frames.length} frames at 3× and 1×`);
  const row = add(section, "div", "", "row");
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  const [big, small] = [cellFor(sprites, 3), cellFor(sprites, 1)];
  sprites.forEach((sprite, i) => {
    const cell = add(row, "figure");
    add(cell, "figcaption", `${figure.frames[i]} — ${sprite.w}×${sprite.h}`);
    cell.append(big(sprite).image, small(sprite).image);
  });
}

/** Each reel plays anims in turn for so many steps, `anim:steps`; the combo chains each swing as its blade ends. */
function reels({ swings }: HeroTiming): Record<string, string> {
  const [a1, a2, a3] = swings.map((s) => s.startup + s.active + s.recovery);
  const [c1, c2] = swings.map((s) => s.startup + s.active);
  return {
    idle: "idle:160",
    walk: "walk:90",
    "jump, land": "jump:40 land:8 idle:30",
    attack1: `attack1:${a1} idle:24`,
    attack2: `attack2:${a2} idle:24`,
    attack3: `attack3:${a3} idle:24`,
    combo: `attack1:${c1} attack2:${c2} attack3:${a3} idle:30`,
    hurt: "hurt:20 idle:30",
    "knockdown, down, getup": "knockdown:26 down:45 getup:20 idle:20",
  };
}
/** Every step of a reel, a hero moved as the engine moves Brakka: walking 1 px a step, his jump's arc, flung back. */
function playOut(spec: string) {
  const arc = (t: number, vz: number) =>
    Math.max(0, Math.floor((t + 1) * vz - 0.095 * t * (t + 1)));
  let x = 0;
  return spec.split(" ").flatMap((part) => {
    const [anim = "", steps] = part.split(":");
    const figureAnim = HERO_ANIMS.find((known) => known === anim);
    if (!figureAnim) throw new Error(`The reel has no anim "${anim}"`);
    return Array.from({ length: Number(steps) }, (_, step) => {
      x += anim === "walk" ? 1 : anim === "knockdown" ? -1.25 : 0;
      const z =
        anim === "jump"
          ? arc(step, 3.7)
          : anim === "knockdown"
            ? arc(step, 2.5)
            : 0;
      return { anim: figureAnim, step, x: Math.round(x), z };
    });
  });
}

const players: ((step: number) => void)[] = [];
for (const kind of HERO_KINDS) {
  const art = HEROES[kind];
  if (!art) continue;
  const { figure, portrait } = art;
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  const section = add(main, "section");
  add(section, "h2", `${kind} · palettes, damage flash, flip and portrait`);
  const palettes = add(section, "div", "", "row");
  const idle = cellFor([figure.sprite("idle0")], 3);
  const face = cellFor([portrait], 3);
  const variants: [string, BakeOptions][] = [
    ["first", {}],
    ...Object.entries(figure.swaps).map(
      ([swap, palette]): [string, BakeOptions] => [swap, { swap: palette }],
    ),
    ["flash", { flash: true }],
    ["flip", { flip: true }],
  ];
  for (const [label, options] of variants) {
    const cell = add(palettes, "figure");
    add(cell, "figcaption", label);
    cell.append(
      idle(figure.sprite("idle0"), options).image,
      face(portrait, options).image,
    );
  }
  add(section, "h2", `${kind} · a reel per anim at game speed`);
  const motion = add(section, "div", "", "row");
  for (const [label, spec] of Object.entries(reels(HERO_TIMING[kind]))) {
    const steps = playOut(spec);
    const xs = steps.map((s) => s.x);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const high = Math.max(...steps.map((s) => s.z));
    const draw = cellFor(sprites, 2, right - left, high);
    const cell = add(motion, "figure");
    add(cell, "figcaption", label);
    const caption = add(cell, "figcaption");
    const view = draw(figure.sprite("idle0"));
    cell.append(view.image);
    players.push((step) => {
      const { anim, step: local, x, z } = steps[step % steps.length]!;
      const frame = heroFrame(kind, anim, local);
      caption.textContent = `${anim} ${local} → ${frame}`;
      draw(figure.sprite(frame), {}, [x - left, z], view);
    });
  }
}

// `?step=N` freezes the reels at a whole step; anything else plays them.
const asked = new URLSearchParams(location.search).get("step");
const frozen = asked !== null && /^\d+$/.test(asked) ? Number(asked) : null;
const start = performance.now();
const tick = (now: number) => {
  // The first frame's time can precede `start`, so the step is held at 0 rather than going negative.
  const elapsed = Math.max(0, now - start);
  const step = frozen ?? Math.floor((elapsed * STEPS_PER_SECOND) / 1000);
  for (const player of players) player(step);
  if (frozen === null) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
