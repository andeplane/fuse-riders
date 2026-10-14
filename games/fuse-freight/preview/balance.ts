/**
 * Balance report: whole bot rounds on the real rules, per seed and train count, for tuning speed, steering and cargo
 * density. For each train it prints the banked score (s), carts collected (c), deliveries (d), rival wagons stolen
 * (st), own wagons lost (lo) and wagons still pulled at the whistle, then the round's effect counts.
 *
 *   pnpm exec tsx games/fuse-freight/preview/balance.ts [seed …]
 */
import {
  FX,
  botInput,
  createWorld,
  encodeWorld,
  roundDone,
  stepWorld,
} from "../src/engine/index.js";

const seeds = process.argv.slice(2).map(Number);
const names = Object.keys(FX);
for (const seed of seeds.length ? seeds : [1, 2, 3, 4, 5])
  for (const count of [5, 3, 2]) {
    const world = createWorld(
      seed,
      Array.from({ length: count }, (_, slot) => ({
        id: `bot:${slot + 1}`,
        slot,
      })),
      { seconds: 75 },
    );
    let inputs = new Map<string, number>();
    const kinds = new Map<number, number>();
    const seen = new Set<number>();
    let maxCarts = 0,
      maxWagons = 0;
    while (!roundDone(world)) {
      if (world.step % 3 === 0)
        inputs = new Map(world.trains.map((t) => [t.id, botInput(world, t)]));
      stepWorld(world, inputs);
      for (const fx of world.fx)
        if (!seen.has(fx.id)) {
          seen.add(fx.id);
          kinds.set(fx.kind, (kinds.get(fx.kind) ?? 0) + 1);
        }
      maxCarts = Math.max(maxCarts, world.carts.length);
      maxWagons = Math.max(
        maxWagons,
        ...world.trains.map((t) => t.cargo.length),
      );
    }
    console.log(
      `seed ${seed} n=${count}`,
      world.trains
        .map(
          (t) =>
            `${t.slot}:s${t.score} c${t.collected} d${t.deliveries} st${t.stolen} lo${t.lost} carry${t.cargo.length}`,
        )
        .join(" | "),
      [...kinds].map(([k, v]) => `${names[k]}=${v}`).join(" "),
      `maxCarts=${maxCarts} maxWagons=${maxWagons} checkpointBytes=${JSON.stringify(encodeWorld(world)).length}`,
    );
  }
