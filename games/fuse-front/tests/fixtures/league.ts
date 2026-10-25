import {
  NO_WINNER,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  botCommands,
  createWorld,
  stepTick,
  type Difficulty,
  type HeroKind,
} from "../../src/engine/index.js";
import { mapById } from "../../src/online/maps.js";

/** The bound every league match must finish inside; v3 M7 tunes matches to 15–20 minutes. */
export const LIMIT_MINUTES = 45;
const LIMIT_TICKS = (LIMIT_MINUTES * 60 * STEPS_PER_SECOND) / STEPS_PER_TICK;

/** A bot match on map `id`, a seat per difficulty: the winning team (or `NO_WINNER`, `DRAW`) and its minutes. */
export function play(
  id: string,
  bots: readonly Difficulty[],
  kinds: Readonly<Record<number, HeroKind>> = {},
): [number, number] {
  const map = mapById(id);
  let world = createWorld(map, [...bots.keys()], 1, kinds);
  for (let tick = 0; tick < LIMIT_TICKS && world.winner === NO_WINNER; tick++)
    world = stepTick(
      map,
      world,
      world.players.flatMap((p) =>
        botCommands(map, world, p.seat, bots[p.seat]!),
      ),
    );
  return [world.winner, world.step / STEPS_PER_SECOND / 60];
}
