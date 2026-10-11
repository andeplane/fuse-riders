import test from "node:test";
import assert from "node:assert/strict";
import {
  HERO_KINDS,
  RULES,
  botInput,
  createWorld,
  defeated,
  encodeWorld,
  stageCleared,
  stepTick,
} from "../src/engine/index.js";

/**
 * The engine's safety net: three bots (Brakka, Rhea and Gorm) fight through Stage 1 — every wave, the sack imps,
 * pots, magic, throws, then the Ogre twins at the gate — and the world's hash is compared every ten seconds and at the
 * end. A refactor must keep these; a change to the rules (the bot's play included, as a bot seat folds `botInput`)
 * must bump `RULES` in `src/engine/index.ts` and re-record them in the same commit: `GOLDEN_RECORD=1` prints the new
 * ones.
 *
 * It runs twice. Once with every hero a bot with no player to follow, so they lead the camera on; once with Brakka
 * standing in for a player (played by `botInput` as well, and named in `humans`), so Rhea and Gorm follow it between
 * fights, the way a room's bots follow the players present.
 */
interface Run {
  seed: number;
  /** The heroes (ids) a player steers, whom the bots follow; they are played by `botInput` here all the same. */
  humans: number[];
  steps: number;
  hashes: string[];
}
const GOLDEN: { rules: string; runs: Run[] } = {
  rules: "fuse-axe-12",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: 5793,
      hashes: [
        ...["35a77db1", "8951c204", "9b1b19b4", "85e85312", "70f69837"],
        ...["0b93ba13", "807e11b8", "523f3916", "3f6520bf", "988af2ec"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: 5883,
      hashes: [
        ...["0bb3435f", "e7d73086", "bb4e06f9", "65fed011", "05bbb7d6"],
        ...["bf055f79", "378954e2", "d6592c69", "ebf363b4", "ef16f65e"],
      ],
    },
  ],
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function record({ seed, humans }: Pick<Run, "seed" | "humans">) {
  let world = createWorld({
    seed,
    heroes: HERO_KINDS.map((kind, seat) => ({ seat, kind })),
  });
  const hashes: string[] = [];
  while (world.step < 12_000 && !stageCleared(world) && !defeated(world)) {
    const held: number[] = [];
    for (const hero of world.heroes)
      held[hero.seat] = botInput(
        world,
        hero.id,
        humans.includes(hero.id) ? [] : humans,
      );
    world = stepTick(world, held);
    if (world.step % 600 === 0)
      hashes.push(fnv(JSON.stringify(encodeWorld(world))));
  }
  hashes.push(fnv(JSON.stringify(encodeWorld(world))));
  return { world, steps: world.step, hashes };
}

test("the bots clear Stage 1 to the recorded hashes under the current rules", () => {
  const recorded = GOLDEN.runs.map((run) => ({ run, ...record(run) }));
  if (process.env.GOLDEN_RECORD)
    console.log(
      JSON.stringify({
        rules: RULES,
        runs: recorded.map(({ run, steps, hashes }) => ({
          ...run,
          steps,
          hashes,
        })),
      }),
    );
  for (const { world } of recorded) {
    assert.ok(stageCleared(world), "the bots clear the stage");
    assert.ok(world.heroes.some((hero) => hero.casts > 0 && hero.throws > 0));
  }
  assert.equal(
    RULES,
    GOLDEN.rules,
    "RULES changed: re-record the golden in the same commit",
  );
  assert.deepEqual(
    recorded.map(({ steps, hashes }) => ({ steps, hashes })),
    GOLDEN.runs.map(({ steps, hashes }) => ({ steps, hashes })),
    "the engine's behaviour changed: bump RULES and re-record, or fix the regression",
  );
});
