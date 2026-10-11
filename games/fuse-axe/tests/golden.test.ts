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
 * pots, magic, throws, then the Ogre twins at the gate — and on through Wyrmbone Pass with the lives and pots they
 * carry (`carryOf`, as the room's stage flow does), and the world's hash is compared every ten seconds and at the end
 * of each stage. A refactor must keep these; a change to the rules (the bot's play included, as a bot seat folds
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
  rules: "fuse-axe-13",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5793, 6600],
      hashes: [
        ...["2a304630", "d2ab98ed", "2444873d", "0b598743", "2f567a66"],
        ...["739c9b2a", "b18a3d39", "ee18a4bf", "12796c9e", "74dd86c5"],
        ...["28ff2094", "cef042fb", "fb789895", "59fc3726", "9f505f25"],
        ...["8db9e385", "f0b146cd", "42393a48", "f827ebbf", "4aa1cd91"],
        ...["b7ac0756", "b7ac0756"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5883, 6621],
      hashes: [
        ...["5a914d3e", "3a6ca30f", "317fa788", "46f49710", "516a907f"],
        ...["c8dff408", "8206b333", "bb398a18", "f43ee13d", "b0d35db7"],
        ...["9f77031b", "50296f07", "205aec2b", "e0aeaafd", "225eb17c"],
        ...["012027be", "dda12abf", "52fabb7c", "3ba37e76", "6862ea37"],
        ...["21ab029d", "937f4eff"],
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
