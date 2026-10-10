// Average `step` cost over whole six-player rounds (seeds 1–4), with every gunship flying seeded random holds (a new
// direction every 20–80 ticks) and firing whenever loaded, against the same rounds with nobody steering. Each mode runs
// twice; the second pass is the warm one docs/engine.md quotes. From the repo root:
//   pnpm exec tsx games/fuse-bombers/preview/step-cost.ts
import { createRound, FIRE, isLoaded, step } from "../src/engine/index.js";

function play(seed: number, fly: boolean): { ms: number; steps: number } {
  const s = createRound({ seed, playerCount: 6 });
  let rng = seed;
  const random = (): number => {
    rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
    return rng / 2 ** 32;
  };
  const bits = s.castles.map(() => 0);
  const until = s.castles.map(() => 0);
  const held: number[] = [];
  let ms = 0;
  while (!s.result && s.tick < s.maxTicks) {
    for (const c of s.castles) {
      if (fly && s.tick >= (until[c.id] ?? 0)) {
        bits[c.id] = Math.floor(random() * 16);
        until[c.id] = s.tick + 20 + Math.floor(random() * 60);
      }
      held[c.id] = (bits[c.id] ?? 0) | (isLoaded(c) ? FIRE : 0);
    }
    const start = performance.now();
    step(s, held);
    ms += performance.now() - start;
  }
  return { ms, steps: s.tick };
}

for (const fly of [false, true, false, true]) {
  let [ms, steps] = [0, 0];
  for (let seed = 1; seed <= 4; seed++) {
    const r = play(seed, fly);
    ms += r.ms;
    steps += r.steps;
  }
  const mode = fly ? "flying " : "at rest";
  console.log(
    `${mode}: ${((ms / steps) * 1000).toFixed(1)} µs/step over ${steps} steps`,
  );
}
