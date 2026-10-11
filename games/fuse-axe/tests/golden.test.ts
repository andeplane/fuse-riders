import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMP,
  HERO_KINDS,
  RULES,
  STAGES,
  botInput,
  campOver,
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
 * pots, magic, throws, then the Ogre twins at the gate — make camp, kicking its imps for meat and pots, and go on
 * through Wyrmbone Pass with the lives, pots and health they carry (`carryOf`, as the room's stage flow does), and the
 * world's hash is compared every ten seconds and at the end of each stage and camp. A refactor must keep these; a change to the rules (the bot's play included, as a bot seat folds
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
  /** Each stage's steps, and each camp's after the stage it follows. */
  steps: number[];
  hashes: string[];
}
const GOLDEN: { rules: string; runs: Run[] } = {
  rules: "fuse-axe-15",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5523, 702, 6360],
      hashes: [
        ...["9c5107cd", "9cf0ca64", "c13dbdd4", "0adad315", "f140b0ec"],
        ...["76a4a07b", "797c0c77", "61aee386", "4b101238", "5b20b31d"],
        ...["b64d6ee2", "9c0660a0", "f2902532", "6f1c8fb7", "a7c2dd93"],
        ...["aa96120e", "9270092f", "541295f3", "1127d3f8", "701e77db"],
        ...["8ea1a626", "81a4b75b", "a189a10e"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5937, 717, 6387],
      hashes: [
        ...["01c73ddb", "d6f13146", "b98b68c5", "f3e4e90c", "fb0f54b8"],
        ...["40b22ecc", "75480bda", "00e1c3e0", "86d66b23", "1851f452"],
        ...["c51bc10a", "404c4033", "ed34a98a", "0f52eff9", "fb1d2524"],
        ...["c3280a9a", "38fb9e1e", "4bda9259", "12cd5f8e", "8056ce4c"],
        ...["eb12767d", "53dc59c4", "11a1fb5d"],
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

/** One stage or camp played to its end (or a bound), pushing a hash every ten seconds and at the end. */
function play(world: World, humans: number[], hashes: string[]): World {
  while (
    world.step < 12_000 &&
    !stageCleared(world) &&
    !defeated(world) &&
    !campOver(world)
  ) {
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

/** The heroes of a world going on, with what they carry. */
const carried = (world: World) =>
  world.heroes.map((hero) => ({
    seat: hero.seat,
    kind: hero.kind,
    carry: carryOf(hero),
  }));

/**
 * Every stage in turn, each won one's heroes making camp and carrying on from it into the next, seeded as a room
 * seeds them.
 */
function record({ seed, humans }: Pick<Run, "seed" | "humans">) {
  const hashes: string[] = [],
    worlds: World[] = [],
    camps: World[] = [],
    steps: number[] = [];
  let world = createWorld({
    seed,
    heroes: HERO_KINDS.map((kind, seat) => ({ seat, kind })),
  });
  for (let stage = 1; stage <= STAGES.length; stage++) {
    if (stage > 1) {
      const camp = play(
        createWorld({
          seed: seedOf(`${seed}:${stage - 1}:camp`),
          stage: stage - 1,
          camp: true,
          heroes: carried(world),
        }),
        humans,
        hashes,
      );
      camps.push(camp);
      steps.push(camp.step);
      world = createWorld({
        seed: seedOf(`${seed}:${stage}`),
        stage,
        heroes: carried(camp),
      });
    }
    world = play(world, humans, hashes);
    worlds.push(world);
    steps.push(world.step);
    if (!stageCleared(world)) break;
  }
  return { worlds, camps, steps, hashes };
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
  for (const { worlds, camps } of recorded) {
    assert.equal(worlds.length, STAGES.length, "the bots reach every stage");
    assert.ok(worlds.every(stageCleared), "and clear it");
    assert.equal(camps.length, STAGES.length - 1, "making camp between them");
    assert.ok(
      camps.every(
        (camp) => campOver(camp) && camp.impsSent === CAMP.imps.length,
      ),
      "until it is over, every imp come",
    );
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
