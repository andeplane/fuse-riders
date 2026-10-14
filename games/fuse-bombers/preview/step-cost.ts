// Average `step` cost over whole six-player rounds (seeds 1–4), with every gunship flying seeded random holds (a new
// direction every 20–80 ticks) and firing whenever loaded, against the same rounds with nobody steering, and with six
// bots of each difficulty flying and fighting (`RoundConfig.bots`). Each mode runs twice; the second pass is the warm
// one docs/engine.md quotes. `--rounds` instead plays bots-only rounds (20 seeds × 2–6 players × each difficulty) and
// prints the median length and the share over before the fuse. From the repo root:
//   pnpm exec tsx games/fuse-bombers/preview/step-cost.ts [--rounds]
import {
  BOT_DIFFICULTIES,
  createRound,
  FIRE,
  isLoaded,
  step,
  type BotDifficulty,
} from "../src/engine/index.js";

function play(seed: number, fly: boolean | BotDifficulty, players = 6) {
  const kind = typeof fly === "string" ? fly : undefined;
  const ids = kind ? [0, 1, 2, 3, 4, 5].slice(0, players) : [];
  const bots = ids.map((id) => ({ id, difficulty: kind ?? "easy" }));
  const s = createRound({ seed, playerCount: players, bots });
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
      if (fly === true && s.tick >= (until[c.id] ?? 0)) {
        bits[c.id] = Math.floor(random() * 16);
        until[c.id] = s.tick + 20 + Math.floor(random() * 60);
      }
      held[c.id] = (bits[c.id] ?? 0) | (isLoaded(c) ? FIRE : 0);
    }
    const start = performance.now();
    step(s, held);
    ms += performance.now() - start;
  }
  return { ms, steps: s.tick, s };
}

const rounds = process.argv.includes("--rounds");
const modes = [false, true, ...BOT_DIFFICULTIES];
for (const fly of rounds ? [] : [...modes, ...modes]) {
  let [ms, steps] = [0, 0];
  for (let seed = 1; seed <= 4; seed++) {
    const r = play(seed, fly);
    ms += r.ms;
    steps += r.steps;
  }
  const mode = fly === false ? "at rest" : fly === true ? "flying " : fly;
  console.log(
    `${mode}: ${((ms / steps) * 1000).toFixed(1)} µs/step over ${steps} steps`,
  );
}

for (const kind of rounds ? BOT_DIFFICULTIES : [])
  for (let players = 2; players <= 6; players++) {
    const seeds = Array.from({ length: 20 }, (_, i) => i * 7919 + 7919);
    const ends = seeds.map((seed) => play(seed + players, kind, players).s);
    const ticks = ends.map((s) => s.result?.tick ?? s.tick);
    const early = ends.filter((s, i) => ticks[i]! < s.fuseTicks).length;
    const stops = ends.filter((s) => s.result?.reason === "timeout");
    ticks.sort((a, b) => a - b);
    const median = Math.round((ticks[9]! + ticks[10]!) / 120);
    const line = `median ${median} s, ${early * 5}% early, ${stops.length} at the 180 s stop`;
    console.log(`${kind} ${players}p: ${line}`);
  }
