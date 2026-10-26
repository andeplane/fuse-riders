import {
  NO_WINNER,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  botCommands,
  createWorld,
  stepTick,
  type Difficulty,
  type HeroKind,
  type World,
} from "../../src/engine/index.js";
import { mapById } from "../../src/online/maps.js";

/**
 * v3 M7's pace (rules fuse-front-21): every league match ends within `SHORTEST`–`LONGEST` minutes, and each map's
 * median lies within `MEDIAN`. A match is played out to `LIMIT_MINUTES` at most, so one past the bound still reports
 * its length.
 */
export const SHORTEST = 10;
export const LONGEST = 28;
export const MEDIAN = [14, 21] as const;
export const LIMIT_MINUTES = 45;
const LIMIT_TICKS = (LIMIT_MINUTES * 60 * STEPS_PER_SECOND) / STEPS_PER_TICK;
const MINUTE_15 = 15 * 60 * STEPS_PER_SECOND;

const held = (world: World) =>
  world.heroes.map((hero) => hero.items.filter((id) => id >= 0).length);

/**
 * A bot match on map `id`, a seat per difficulty: the winning team (or `NO_WINNER`, `DRAW`), its minutes, and the
 * items each hero holds at minute 15 (v3 M3's shop), or at the end of a match over sooner, by seat.
 */
export function play(
  id: string,
  bots: readonly Difficulty[],
  kinds: Readonly<Record<number, HeroKind>> = {},
): [number, number, number[]] {
  const map = mapById(id);
  let world = createWorld(map, [...bots.keys()], 1, kinds);
  let items: number[] | undefined;
  for (let tick = 0; tick < LIMIT_TICKS && world.winner === NO_WINNER; tick++) {
    world = stepTick(
      map,
      world,
      world.players.flatMap((p) =>
        botCommands(map, world, p.seat, bots[p.seat]!),
      ),
    );
    if (items === undefined && world.step >= MINUTE_15) items = held(world);
  }
  return [
    world.winner,
    world.step / STEPS_PER_SECOND / 60,
    items ?? held(world),
  ];
}

/** The median of `values`. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Whether a match of `minutes` ends inside the pace bound. A mismatch of difficulties (`even` false) may end as soon
 * as it likes: a stomp is a healthy result, so it only has to end by `LONGEST`.
 */
export const paced = (minutes: number, even = true): boolean =>
  (!even || minutes >= SHORTEST) && minutes <= LONGEST;

/** Each team at one difficulty, by seat parity, on a map of `size` seats a team. */
export const sides = (size: number, a: Difficulty, b: Difficulty) =>
  Array.from({ length: 2 * size }, (_, seat) => (seat % 2 === 0 ? a : b));

/**
 * Plays every pairing in `pairs` from both sides on map `id` (`size` seats a team) and returns, per pairing, how many
 * of its two matches the first difficulty won, with a line per match for the report, the matches that had no winner
 * or ended past `LONGEST` (or, at one difficulty, before `SHORTEST`), and every match's minutes.
 */
export function both(
  id: string,
  size: number,
  pairs: readonly (readonly [Difficulty, Difficulty])[],
): { won: number[]; lines: string[]; unfinished: string[]; minutes: number[] } {
  const won: number[] = [];
  const lines: string[] = [];
  const unfinished: string[] = [];
  const lengths: number[] = [];
  for (const [a, b] of pairs) {
    let count = 0;
    for (const flip of [false, true]) {
      const [winner, minutes] = play(
        id,
        flip ? sides(size, b, a) : sides(size, a, b),
      );
      lengths.push(minutes);
      const line = `${id} ${flip ? `${b} v ${a}` : `${a} v ${b}`}: team ${winner} in ${minutes.toFixed(1)} min`;
      if ((winner !== 0 && winner !== 1) || !paced(minutes, a === b))
        unfinished.push(line);
      const stronger = flip ? 1 : 0;
      if (winner === stronger) count++;
      lines.push(line);
    }
    won.push(count);
  }
  return { won, lines, unfinished, minutes: lengths };
}
