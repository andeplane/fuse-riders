/**
 * Dev-only spell lab: `pnpm exec vite`, then open /games/fuse-axe/lab/spells.html?mute. It is not in the build and not
 * on the portal. Each spell plays in the production scene from a real engine world: one hero holding the level's
 * pots, five ravagers about it, Magic tapped so the cast spends them all. `?level=N` picks the level (each spell's top
 * one by default; held to the levels it has), `?age=N` freezes every spell at that step of its life and `?age=hit` at
 * its blow. `?sheet` draws the docs' contact sheet instead: each spell gathering and at its blow at the top level, and
 * at its blow at level 1. The page reports the scene's draw time over every frame of each spell, painted already.
 */
import {
  createWorld,
  MAGIC,
  spawnEnemy,
  step,
  toView,
  type HeroKind,
  type WorldView,
} from "../src/engine/index.js";
import { px } from "../src/engine/tuning.js";
import { SPELL_STEPS, VIEW_H, VIEW_W } from "../src/engine/view-kit.js";
import type { SpellKind } from "../src/engine/view.js";
import { createScene } from "../src/render/scene.js";
import type { MakeSurface } from "../src/render/surface.js";

const canvas = (width: number, height: number) => {
  const image = document.createElement("canvas");
  [image.width, image.height] = [width, height];
  const paint = image.getContext("2d")!;
  paint.imageSmoothingEnabled = false;
  return { image, paint };
};
const surface: MakeSurface<HTMLCanvasElement> = (width, height) => {
  const { image, paint } = canvas(width, height);
  const putPixels = (rgba: Uint8ClampedArray<ArrayBuffer>) =>
    paint.putImageData(new ImageData(rgba, width, height), 0, 0);
  return { image, paint, putPixels };
};
const CASTERS: readonly (readonly [HeroKind, SpellKind])[] = [
  ["brakka", "storm"],
  ["rhea", "fire"],
  ["gorm", "earth"],
];
const RAVAGERS = [[200, 120, 0], [250, 150, 1], [170, 162, 2], [290, 132, 0], [60, 126, 1]] as const; // prettier-ignore

/** Every view of a spell of `level` from its cast until it is gone, by age. */
function cast(kind: HeroKind, level: number): WorldView[] {
  const fresh = createWorld({ seed: 7, heroes: [{ seat: 0, kind }] });
  const hero = { ...fresh.heroes[0]!, pots: level, x: px(110), y: px(140) };
  let world = { ...fresh, heroes: [hero] };
  for (const [x, y, tier] of RAVAGERS)
    world = spawnEnemy(world, "ravager", px(x), px(y), tier);
  // A tap: Magic down for a step, then let go, casts every pot held.
  world = step(step(world, [MAGIC]), []);
  const views: WorldView[] = [];
  for (let view = toView(world); view.spells.length; view = toView(world)) {
    views[view.spells[0]!.age] = view;
    world = step(world, []);
  }
  return views;
}

const params = new URLSearchParams(location.search);
const scene = createScene(surface);
const native = canvas(VIEW_W, VIEW_H);
const main = document.querySelector("main")!;
const levelOf = (spell: SpellKind, asked: number) =>
  Math.min(SPELL_STEPS[spell].length, Math.max(1, asked));
const top = (spell: SpellKind) => SPELL_STEPS[spell].length;
const hitOf = (spell: SpellKind, level: number) =>
  SPELL_STEPS[spell][level - 1]!.hit;
const at = (views: WorldView[], age: number) =>
  views[Math.min(views.length - 1, Math.max(0, age))]!;

/**
 * The scene's draw time for each frame of a whole spell, averaged over `REPEATS` draws once every picture is painted
 * (a single draw is below the clock's resolution), in ms: the median frame and the slowest, then the same frames'
 * with the spell taken out.
 */
const REPEATS = 20;
function cost(views: WorldView[]): readonly number[] {
  const time = (list: WorldView[]) => {
    list.forEach((view, age) => scene.draw(native.paint, view, age));
    const frames = list
      .map((view, age) => {
        const start = performance.now();
        for (let r = 0; r < REPEATS; r++) scene.draw(native.paint, view, age);
        return (performance.now() - start) / REPEATS;
      })
      .sort((a, b) => a - b);
    return [frames[frames.length >> 1]!, frames.at(-1)!];
  };
  return [...time(views), ...time(views.map((view) => ({ ...view, spells: [] })))]; // prettier-ignore
}
const costs: Record<string, string> = {};

if (params.has("sheet")) {
  const gap = 3;
  const sheet = canvas(3 * VIEW_W + 2 * gap, 3 * VIEW_H + 2 * gap);
  sheet.paint.fillStyle = "#150c1f";
  sheet.paint.fillRect(0, 0, sheet.image.width, sheet.image.height);
  CASTERS.forEach(([kind, spell], column) => {
    const [high, low] = [cast(kind, top(spell)), cast(kind, 1)];
    const hit = hitOf(spell, top(spell));
    const cells = [at(high, hit - 14), at(high, hit), at(low, hitOf(spell, 1))];
    cells.forEach((view, row) => {
      scene.draw(native.paint, view, view.spells[0]!.age);
      sheet.paint.drawImage(native.image, column * (VIEW_W + gap), row * (VIEW_H + gap)); // prettier-ignore
    });
  });
  main.append(sheet.image);
} else
  for (const [kind, spell] of CASTERS) {
    const level = levelOf(spell, Number(params.get("level") ?? top(spell)));
    const views = cast(kind, level);
    const shown = canvas(VIEW_W * 2, VIEW_H * 2);
    const [median, slowest, base, baseSlowest] = cost(views).map((ms) => ms.toFixed(2)); // prettier-ignore
    costs[spell] = `${median} ${slowest} ${base} ${baseSlowest}`;
    const caption = `${spell} level ${level}: a frame of the scene draws in ${median} ms, ${slowest} at the slowest; ${base} and ${baseSlowest} without the spell`; // prettier-ignore
    const figure = document.createElement("figure");
    figure.append(shown.image, Object.assign(document.createElement("figcaption"), { textContent: caption })); // prettier-ignore
    main.append(figure);
    const asked = params.get("age");
    const frozen = asked === "hit" ? hitOf(spell, level) : asked === null ? null : Number(asked); // prettier-ignore
    const paint = (frame: number) => {
      // Playing, each spell loops with half a second of the field at rest between casts.
      const age = frozen ?? frame % (views.length + 30);
      const view = at(views, age >= views.length ? 0 : age);
      scene.draw(native.paint, age >= views.length ? { ...view, spells: [] } : view, frame); // prettier-ignore
      shown.paint.drawImage(native.image, 0, 0, shown.image.width, shown.image.height); // prettier-ignore
      if (frozen === null) requestAnimationFrame((now) => paint(Math.floor((now * 60) / 1000))); // prettier-ignore
    };
    paint(frozen ?? 0);
  }
document.body.dataset.cost = JSON.stringify(costs);
