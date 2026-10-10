/**
 * Dev-only scene lab: `pnpm exec vite`, then open /games/fuse-axe/lab/scene.html?mute. It runs the engine on this page
 * (no room, no netcode) at 60 steps a second with the keyboard on P1, and draws every step with the game's real scene
 * at a whole-number scale: a quick local playtest of the art. Not in the build and not on the portal.
 *
 * `?heroes=brakka,gorm,rhea` seats a hero per name (P2 on stand still), `?seed=N` seeds the world, `?paint` bakes the
 * backdrop through the surfaces' paint instead of their `putPixels` fast path. R brings in three more ravagers, one
 * per tier. The corner shows the scene's draw time per frame.
 */
import { HeldControls } from "../src/app/controls.js";
import {
  createWorld,
  HERO_KINDS,
  spawnEnemy,
  step,
  toView,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { px, SUB } from "../src/engine/tuning.js";
import { VIEW_H, VIEW_W } from "../src/engine/view-kit.js";
import { createScene } from "../src/render/scene.js";
import type { MakeSurface } from "../src/render/surface.js";

const query = new URLSearchParams(location.search);
const kinds = (query.get("heroes") ?? "brakka,gorm")
  .split(",")
  .filter((name): name is HeroKind => HERO_KINDS.some((kind) => kind === name))
  .slice(0, 5);
const fast = !query.has("paint");

const canvasSurface: MakeSurface<HTMLCanvasElement> = (width, height) => {
  const image = document.createElement("canvas");
  [image.width, image.height] = [width, height];
  const paint = image.getContext("2d")!;
  paint.imageSmoothingEnabled = false;
  const putPixels = (rgba: Uint8ClampedArray<ArrayBuffer>) =>
    paint.putImageData(new ImageData(rgba, width, height), 0, 0);
  return { image, paint, ...(fast ? { putPixels } : {}) };
};

const made = performance.now();
const scene = createScene(canvasSurface);
const setup = performance.now() - made;

const screen = document.querySelector<HTMLCanvasElement>("#screen")!;
[screen.width, screen.height] = [VIEW_W, VIEW_H];
const pen = screen.getContext("2d")!;
pen.imageSmoothingEnabled = false;
const fit = () => {
  const room = Math.min(innerWidth / VIEW_W, (innerHeight - 40) / VIEW_H);
  const scale = Math.max(1, Math.floor(room));
  screen.style.width = `${VIEW_W * scale}px`;
  screen.style.height = `${VIEW_H * scale}px`;
};
addEventListener("resize", fit);
fit();

/** Three ravagers, one per tier, walking in from the right of the screen. */
const raid = (world: World) =>
  ([0, 1, 2] as const).reduce(
    (next, tier) =>
      spawnEnemy(
        next,
        "ravager",
        px(Math.floor(world.camX / SUB) + 220 + tier * 30),
        px(118 + tier * 20),
        tier,
      ),
    world,
  );
let world = raid(
  createWorld({
    seed: Number(query.get("seed") ?? 7),
    heroes: (kinds.length ? kinds : ["brakka" as const]).map((kind, seat) => ({
      seat,
      kind,
    })),
  }),
);
// A tap shorter than a step still presses: every bit held since the last step counts for the next one.
let [held, tapped] = [0, 0];
const controls = new HeldControls((bits) => {
  held = bits;
  tapped |= bits;
});
addEventListener("keydown", (event) => {
  if (event.code === "KeyR") world = raid(world);
  else if (controls.down(event, false)) event.preventDefault();
});
addEventListener("keyup", (event) => controls.up(event.code));
addEventListener("blur", () => controls.clear());

const stats = document.querySelector("#stats")!;
const times: number[] = [];
const start = performance.now();
const frame = (now: number) => {
  const due = Math.floor(((now - start) * 60) / 1000);
  for (let n = 0; world.step < due && n < 6; n++) {
    world = step(world, [held | tapped]);
    tapped = held;
  }
  const t = performance.now();
  scene.draw(pen, toView(world), due);
  times.push(performance.now() - t);
  if (times.length === 120) {
    const mean = times.reduce((a, b) => a + b) / times.length;
    stats.textContent =
      `draw ${mean.toFixed(2)} ms mean, ${Math.max(...times).toFixed(2)} max · ` +
      `setup ${setup.toFixed(0)} ms (${fast ? "putPixels" : "paint"}) · ` +
      `step ${world.step} · ${world.enemies.length} enemies`;
    times.length = 0;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
