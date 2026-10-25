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

/**
 * The bound every league match must finish inside. M5's bots defend their towers, so a 1v1 mirror runs up to about
 * 38 minutes (`league.test.ts`); v3 M7 tunes matches to 15–20 minutes.
 */
export const LIMIT_MINUTES = 45;
const LIMIT_TICKS = (LIMIT_MINUTES * 60 * STEPS_PER_SECOND) / STEPS_PER_TICK;

/**
 * A bot match on map `id`, a seat per difficulty: the winning team (or `NO_WINNER`, `DRAW`), its minutes, and the
 * items each hero holds at the end (v3 M3's shop), by seat.
 */
export function play(
  id: string,
  bots: readonly Difficulty[],
  kinds: Readonly<Record<number, HeroKind>> = {},
): [number, number, number[]] {
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
  return [
    world.winner,
    world.step / STEPS_PER_SECOND / 60,
    world.heroes.map((hero) => hero.items.filter((id) => id >= 0).length),
  ];
}

/** Each team at one difficulty, by seat parity, on a map of `size` seats a team. */
export const sides = (size: number, a: Difficulty, b: Difficulty) =>
  Array.from({ length: 2 * size }, (_, seat) => (seat % 2 === 0 ? a : b));

/**
 * Plays every pairing in `pairs` from both sides on map `id` (`size` seats a team) and returns, per pairing, how many
 * of its two matches the first difficulty won, with a line per match for the report.
 */
export function both(
  id: string,
  size: number,
  pairs: readonly (readonly [Difficulty, Difficulty])[],
): { won: number[]; lines: string[]; unfinished: string[] } {
  const won: number[] = [];
  const lines: string[] = [];
  const unfinished: string[] = [];
  for (const [a, b] of pairs) {
    let count = 0;
    for (const flip of [false, true]) {
      const [winner, minutes] = play(
        id,
        flip ? sides(size, b, a) : sides(size, a, b),
      );
      if (winner !== 0 && winner !== 1) unfinished.push(`${id} ${a} v ${b}`);
      const stronger = flip ? 1 : 0;
      if (winner === stronger) count++;
      lines.push(
        `${id} ${flip ? `${b} v ${a}` : `${a} v ${b}`}: team ${winner} in ${minutes.toFixed(1)} min`,
      );
    }
    won.push(count);
  }
  return { won, lines, unfinished };
}
