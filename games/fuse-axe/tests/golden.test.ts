import test from "node:test";
import assert from "node:assert/strict";
import {
  HERO_KINDS,
  RULES,
  STAGES,
  botInput,
  carryOf,
  createWorld,
  defeated,
  encodeWorld,
  seedOf,
  stageCleared,
  stepTick,
  type World,
} from "../src/engine/index.js";

/**
 * The engine's safety net: three bots (Brakka, Rhea and Gorm) fight through Stage 1 — every wave, the sack imps,
 * pots, magic, throws, then the Ogre twins at the gate — and on through Wyrmbone Pass and its riders on clawbeaks
 * with the lives and pots they carry (`carryOf`, as the room's stage flow does), and the world's hash is compared
 * every ten seconds and at the end of each stage. A refactor must keep these; a change to the rules (the bot's play included, as a bot seat folds
 * `botInput`) must bump `RULES` in `src/engine/index.ts` and re-record them in the same commit: `GOLDEN_RECORD=1`
 * prints the new ones.
 *
 * It runs twice. Once with every hero a bot with no player to follow, so they lead the camera on; once with Brakka
 * standing in for a player (played by `botInput` as well, and named in `humans`), so Rhea and Gorm follow it between
 * fights, the way a room's bots follow the players present.
 */
interface Run {
  seed: number;
  /** The heroes (ids) a player steers, whom the bots follow; they are played by `botInput` here all the same. */
  humans: number[];
  /** Each stage's steps. */
  steps: number[];
  hashes: string[];
}
const GOLDEN: { rules: string; runs: Run[] } = {
  rules: "fuse-axe-15",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5523, 6558],
      hashes: [
        ...["818a2506", "bd766865", "18295155", "360b2b0e", "539e770d"],
        ...["d5e799bc", "8c54e920", "e0d51b9f", "defe8331", "0d1eb456"],
        ...["2b379d35", "a824ab8e", "9b4f2c0b", "93f2af38", "15e53f46"],
        ...["452c4061", "50eb40e2", "069d3a79", "7599b62b", "68cd6e74"],
        ...["285fef52"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5937, 7017],
      hashes: [
        ...["56af9b1c", "2cb37a5f", "3322693e", "a11b6c2d", "0e903ab1"],
        ...["efc1aeed", "dc57fe7b", "11bf9259", "4d3af564", "033c8893"],
        ...["7d7e3d2d", "4f50f9ef", "42c6be1f", "1f5c2597", "efe668de"],
        ...["6ea9897e", "0c015b39", "e186e3c1", "7568c776", "485a8911"],
        ...["c9d8d892", "482c7e6a"],
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

/** One stage played to its end (or a bound), pushing a hash every ten seconds and at the end. */
function play(world: World, humans: number[], hashes: string[]): World {
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
  return world;
}

/** Every stage in turn, each won one's heroes carrying on into the next, seeded as a room seeds it. */
function record({ seed, humans }: Pick<Run, "seed" | "humans">) {
  const hashes: string[] = [],
    worlds: World[] = [];
  let world = createWorld({
    seed,
    heroes: HERO_KINDS.map((kind, seat) => ({ seat, kind })),
  });
  for (let stage = 1; stage <= STAGES.length; stage++) {
    if (stage > 1)
      world = createWorld({
        seed: seedOf(`${seed}:${stage}`),
        stage,
        heroes: world.heroes.map((hero) => ({
          seat: hero.seat,
          kind: hero.kind,
          carry: carryOf(hero),
        })),
      });
    world = play(world, humans, hashes);
    worlds.push(world);
    if (!stageCleared(world)) break;
  }
  return { worlds, steps: worlds.map((each) => each.step), hashes };
}

test("the bots clear every stage to the recorded hashes under the current rules", () => {
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
  for (const { worlds } of recorded) {
    assert.equal(worlds.length, STAGES.length, "the bots reach every stage");
    assert.ok(worlds.every(stageCleared), "and clear it");
    assert.ok(
      worlds[0]!.heroes.some((hero) => hero.casts > 0 && hero.throws > 0),
    );
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
