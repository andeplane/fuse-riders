import test from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTIES,
  HERO_KINDS,
  NO_WINNER,
  STEPS_PER_TICK,
  STEPS_PER_SECOND,
  botCommands,
  createWorld,
  pickHeroes,
  stepTick,
  type Difficulty,
  type HeroKind,
} from "../src/engine/index.js";
import { dustBasin } from "./fixtures/maps.js";

/**
 * The bot league: every difficulty pairing plays to a result on Dust Basin, so evenly matched sides cannot stall at
 * the unit cap (the territory cap, the forts' guns and overtime break it). Bots read no RNG and the rules draw none,
 * so the seed changes nothing; what varies a match is where the sides start, so each 1v1 pairing plays from two
 * seat pairs, and 2v2 and 3v3 play each difficulty against itself, all as Brick; then each other hero plays Brick
 * from both sides, and mixed 2v2 and 3v3 teams play. Measured with every pairing from three starts (rules
 * fuse-front-7): the longest match ran 4.7 minutes, the median 2.6. The bound leaves headroom over that. About a
 * minute; the slowest file in the Fuse Front suite, sharded on its own by the test runner's timings.
 */
const LIMIT_MINUTES = 15;
const LIMIT_TICKS = (LIMIT_MINUTES * 60 * STEPS_PER_SECOND) / STEPS_PER_TICK;
const map = dustBasin();

/** The result after at most `LIMIT_TICKS`: the winning team, or `NO_WINNER` (or `DRAW`). */
function play(
  bots: ReadonlyMap<number, Difficulty>,
  kinds: Readonly<Record<number, HeroKind>> = {},
): number {
  let world = createWorld(map, [...bots.keys()], 1, kinds);
  for (let tick = 0; tick < LIMIT_TICKS && world.winner === NO_WINNER; tick++) {
    const commands = world.players.flatMap((player) =>
      botCommands(map, world, player.seat, bots.get(player.seat)!),
    );
    world = stepTick(map, world, commands);
  }
  return world.winner;
}

const matches: [string, Map<number, Difficulty>, Record<number, HeroKind>?][] =
  [];
for (const a of DIFFICULTIES)
  for (const b of DIFFICULTIES)
    for (const [x, y] of [
      [0, 1],
      [3, 2],
    ] as const)
      matches.push([
        `1v1 ${a}@${x} v ${b}@${y}`,
        new Map([
          [x, a],
          [y, b],
        ]),
      ]);
for (const d of DIFFICULTIES) {
  matches.push([`2v2 ${d}`, new Map([0, 1, 2, 3].map((s) => [s, d]))]);
  matches.push([`3v3 ${d}`, new Map([0, 1, 2, 3, 4, 5].map((s) => [s, d]))]);
}
// Mixed heroes: each other hero against Brick from both sides, and the 2v2 and 3v3 defaults (`pickHeroes`).
for (const kind of HERO_KINDS.slice(1))
  for (const [x, y] of [
    [0, 1],
    [1, 0],
  ] as const)
    matches.push([
      `1v1 ${kind}@${x} v brick`,
      new Map([
        [0, "normal"],
        [1, "normal"],
      ]),
      { [x]: kind, [y]: "brick" },
    ]);
for (const seats of [
  [0, 1, 2, 3],
  [0, 1, 2, 3, 4, 5],
]) {
  const picks = { 0: "vix" } as const;
  for (const d of ["normal", "hard"] as const)
    matches.push([
      `${seats.length / 2}v${seats.length / 2} mixed ${d}`,
      new Map(seats.map((s) => [s, d])),
      pickHeroes(seats, picks),
    ]);
}

test(`every bot pairing on Dust Basin ends with a winner inside ${LIMIT_MINUTES} minutes`, () => {
  const unfinished = matches.flatMap(([label, bots, kinds]) => {
    const winner = play(bots, kinds);
    return winner === 0 || winner === 1 ? [] : [`${label}: ${winner}`];
  });
  assert.deepEqual(unfinished, []);
});
