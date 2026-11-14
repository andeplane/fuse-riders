import { demoCanvas } from "fuse-ui";
import {
  LEVELS,
  STEPS_PER_TICK,
  createWorld,
  stepWorld,
  toView,
  type World,
  type WorldView,
} from "../engine/index.js";
import { createScene } from "../render/scene.js";
import { browserCanvas, browserImages, browserTint, loadArt } from "./art.js";
import { blendViews } from "./forward.js";
import { RECORDED, rideBits } from "./rides.js";

/** Steps the demo counts down before a ride, and rests on a finished one. */
const LEAD = 40,
  REST = 120;
/** One demo tick of the shared lifecycle, in milliseconds. */
const TICK_MS = 50;

/**
 * The menu's background: one silent bike riding the levels in turn on the recorded finishing rides, with the real
 * engine and the real renderer. Nothing here touches a room, an account, storage or the sounds.
 */
export function createAttract(host: HTMLElement) {
  const demoLevels = LEVELS.flatMap((level, index) =>
    RECORDED.rides[level.id] ? [index] : [],
  );
  const renderer = createScene(demoCanvas(host), {
    art: loadArt(import.meta.env.BASE_URL, browserImages, browserTint),
    createCanvas: browserCanvas,
  });
  let level = 0,
    ticks = 0,
    world: World,
    bits: number[],
    step = 0,
    rest = 0,
    before: WorldView,
    after: WorldView,
    at = 0;
  const begin = (index: number) => {
    level = index % demoLevels.length;
    const levelIndex = demoLevels[level]!;
    world = createWorld(["demo"], levelIndex, LEAD);
    bits = rideBits(LEVELS[levelIndex]!.id);
    step = 0;
    rest = 0;
    before = after = toView(world);
  };
  begin(0);
  return {
    advance() {
      ticks++;
      before = after;
      for (let i = 0; i < STEPS_PER_TICK; i++) {
        if (world.phase === "over") rest++;
        const racing = world.phase === "racing";
        stepWorld(world, [racing ? (bits[step] ?? 0) : 0], [true]);
        if (racing) step++;
      }
      if (rest >= REST) begin(level + 1);
      else after = toView(world);
      at = 0;
    },
    tick: () => ticks,
    render(now: number) {
      // Between two demo ticks the bike is drawn part of the way, so it moves on every frame.
      if (!at) at = now;
      const view = blendViews(before, after, (now - at) / TICK_MS);
      renderer.draw(view, now, { follow: [0], local: -1 });
    },
    dispose: () => renderer.destroy(),
  };
}
