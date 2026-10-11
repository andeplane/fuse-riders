/**
 * Dev-only, below the sprite sheet: for each enemy, every frame packed on one floor in each palette swap, then its
 * anims playing at the simulation's 60 steps a second in the swap picked above them. A one-shot anim holds its last
 * frame for a moment, then plays again. Then the Ogre twins in the real scene, and last the floor items at 6×, 3×
 * and 1×.
 */
import type { EnemyAnim, EnemyView, WorldView } from "../src/engine/view.js";
import {
  ENEMY_KINDS,
  OGRE_STEPS,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";
import { ENEMY_ANIMS, type AnimStrip } from "../src/render/art/animate.js";
import { POT } from "../src/render/art/pot.js";
import type { Figure } from "../src/render/pixel/kit.js";
import type { Palette } from "../src/render/pixel/palette.js";
import {
  createSpriteBaker,
  type MakeSurface,
} from "../src/render/pixel/surface.js";
import { createScene, ENEMY_ART } from "../src/render/scene.js";

interface Animated {
  readonly name: string;
  readonly figure: Figure;
  readonly anims: Readonly<Record<string, AnimStrip<string>>>;
}
const ANIMATED: readonly Animated[] = ENEMY_KINDS.map((kind) => ({
  name: kind,
  figure: ENEMY_ART[kind].figure,
  anims: ENEMY_ANIMS[kind],
}));

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
const SCALE = 3;
const PAD = 3;
const STEP_MS = 1000 / 60;
/** Steps a one-shot anim rests on its last frame before it plays again. */
const REST = 30;

/** The frame an anim shows `step` steps in: a loop wraps, a one-shot holds its last frame, then starts over. */
function frameAt({ frames, loop }: AnimStrip<string>, step: number): string {
  const length = frames.reduce((sum, [, steps]) => sum + steps, 0);
  let t = step % (loop ? length : length + REST);
  for (const [frame, steps] of frames) {
    if (t < steps) return frame;
    t -= steps;
  }
  return frames.at(-1)![0];
}

const main = document.querySelector("main")!;
const players: (() => void)[] = [];
let start = 0;
let step = 0;

/** Every frame side by side on one floor, in each swap: a figure's whole set at a glance. */
function strips({ name, figure }: Animated, up: number, down: number) {
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  const width = sprites.reduce((sum, s) => sum + s.w + PAD * 2, 0);
  const height = up + down + 1 + PAD * 2;
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent = `${name} · every frame in every swap`;
  for (const swap of ["", ...Object.keys(figure.swaps)]) {
    const strip = canvas(width * 2, (height + 6) * 2);
    const { paint } = strip;
    paint.fillStyle = "#281e34";
    paint.fillRect(0, 0, width * 2, (height + 6) * 2);
    paint.fillStyle = "#16e7ff55";
    paint.fillRect(0, (PAD + up + 1) * 2, width * 2, 1);
    paint.font = "9px ui-monospace, monospace";
    let x = 0;
    figure.frames.forEach((frame, i) => {
      const palette = figure.swaps[swap];
      const baked = baker.bake(sprites[i]!, palette ? { swap: palette } : {});
      const left = (x + PAD) * 2;
      const top = (PAD + up - baked.ay) * 2;
      paint.drawImage(baked.image, left, top, baked.w * 2, baked.h * 2);
      paint.fillStyle = "#d8c8e8";
      paint.fillText(frame, left, (height + 5) * 2);
      x += baked.w + PAD * 2;
    });
    const cell = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = swap || "base";
    cell.append(caption, strip.image);
    section.append(cell);
  }
  main.append(section);
}

for (const animated of ANIMATED) {
  const { name, figure, anims } = animated;
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  const side = Math.max(...sprites.map((s) => Math.max(s.ax, s.w - 1 - s.ax)));
  const up = Math.max(...sprites.map((s) => s.ay));
  const down = Math.max(...sprites.map((s) => s.h - 1 - s.ay));
  const [cw, ch] = [side * 2 + 1 + PAD * 2, up + down + 1 + PAD * 2];
  strips(animated, up, down);
  const section = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = `${name} · anims `;
  const pick = document.createElement("select");
  for (const swap of ["", ...Object.keys(figure.swaps)])
    pick.append(new Option(swap || "base", swap));
  title.append(pick);
  const row = document.createElement("div");
  row.className = "row";
  section.append(title, row);
  for (const [anim, strip] of Object.entries(anims)) {
    const view = canvas(cw * SCALE, ch * SCALE);
    const caption = document.createElement("figcaption");
    const cell = document.createElement("figure");
    cell.append(caption, view.image);
    row.append(cell);
    let shown = "";
    let swap: Palette | undefined;
    players.push(() => {
      const frame = frameAt(strip, step);
      const picked = figure.swaps[pick.value];
      if (frame === shown && picked === swap) return;
      [shown, swap] = [frame, picked];
      caption.textContent = `${anim} — ${frame}`;
      const baked = baker.bake(figure.sprite(frame), swap ? { swap } : {});
      const { paint } = view;
      paint.clearRect(0, 0, cw * SCALE, ch * SCALE);
      paint.fillStyle = "#16e7ff55";
      paint.fillRect(0, (PAD + up + 1) * SCALE, cw * SCALE, 1);
      paint.drawImage(
        baked.image,
        (PAD + side - baked.ax) * SCALE,
        (PAD + up - baked.ay) * SCALE,
        baked.w * SCALE,
        baked.h * SCALE,
      );
    });
  }
  main.append(section);
}

// The Ogre twins in the real scene at 2×: the green one idles, winds up, slams and stands open on a loop, its
// shockwave cracking the floor; the red one is enraged, burning and steaming as it stands.
{
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent =
    "ogre twins · the scene's slam, shockwave and rage";
  const native = canvas(VIEW_W, VIEW_H);
  const shown = canvas(VIEW_W * 2, VIEW_H * 2);
  const scene = createScene<HTMLCanvasElement>((w, h) => {
    const surface = canvas(w, h);
    const putPixels = (rgba: Uint8ClampedArray<ArrayBuffer>) =>
      surface.paint.putImageData(new ImageData(rgba, w, h), 0, 0);
    return { ...surface, putPixels };
  });
  const loop: readonly (readonly [EnemyAnim, number])[] = [
    ["idle", 30],
    ["windup", OGRE_STEPS.windup],
    ["slam", OGRE_STEPS.slam],
    ["recover", OGRE_STEPS.recover],
  ];
  const total = loop.reduce((sum, [, steps]) => sum + steps, 0);
  const twin = (more: Partial<EnemyView>): EnemyView => ({
    ...{ id: 1, kind: "ogre", tier: 0, x: 70, y: 150, z: 0, facing: 1 },
    ...{ anim: "idle", animStep: 0, hp: 150, maxHp: 150, flash: false },
    ...{ boss: true, enraged: false, mounted: false },
    ...more,
  });
  players.push(() => {
    let [anim, animStep] = loop[0]!;
    let t = step % total;
    for (const [a, steps] of loop) {
      [anim, animStep] = [a, t];
      if (t < steps) break;
      t -= steps;
    }
    const view: WorldView = {
      ...{ step, stage: 1, camX: 0, heroes: [], fx: [], items: [], spells: [] },
      mounts: [],
      camp: false,
      enemies: [
        twin({ anim, animStep }),
        twin({ id: 2, tier: 1, x: 260, y: 128, facing: -1, enraged: true }),
      ],
      ...{ wave: 5, waves: 6, locked: true, go: false, cleared: false },
      ...{ defeated: false, boss: { kind: "ogre", hp: 150, maxHp: 300 } },
    };
    scene.draw(native.paint, view, step);
    shown.paint.drawImage(native.image, 0, 0, VIEW_W * 2, VIEW_H * 2);
  });
  section.append(shown.image);
  main.append(section);
}

{
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent = `pot · ${POT.w}×${POT.h} at 6×, 3× and 1×`;
  const baked = baker.bake(POT);
  const [w, h] = [baked.w * 10 + PAD * 8, baked.h * 6 + PAD * 2];
  const items = canvas(w, h);
  let x = PAD;
  for (const scale of [6, 3, 1]) {
    const [bw, bh] = [baked.w * scale, baked.h * scale];
    items.paint.drawImage(baked.image, x, h - PAD - bh, bw, bh);
    x += bw + PAD * 3;
  }
  section.append(items.image);
  main.append(section);
}

const tick = (now: number) => {
  start ||= now;
  step = Math.floor((now - start) / STEP_MS);
  for (const play of players) play();
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
