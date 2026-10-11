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
 * pots, magic, throws, then the Ogre twins at the gate — make camp, kicking its imps for meat and pots, and go
 * on through Wyrmbone Pass and its riders on clawbeaks with the lives, pots and health they carry (`carryOf`, as
 * the room's stage flow does), and the world's hash is compared every ten seconds and at the end of each stage and
 * camp; the pass ends with its boss, the lancer captain on his ember drake, whom both runs beat to clear it. After a
 * second camp they go down the Drowned Crypt, its bonewalkers clawing up out of the graves and pulling themselves
 * together from their bones unless shattered, to the pair of bone knights at the cathedral's doors. A
 * refactor must keep these; a change to the rules (the bot's play included, as a bot seat folds
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
  rules: "fuse-axe-19",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5523, 702, 6807, 666, 6954],
      hashes: [
        ...["e035e59b", "0f3922e0", "c551dcb8", "7dfc6b6b", "3adf2404"],
        ...["358fc7c9", "1cb7cc51", "a92dcb72", "9579aaac", "f6f59f33"],
        ...["678f1b5c", "fe3be356", "311461a6", "c5643bdd", "f3912af8"],
        ...["d0bff503", "a194abbd", "00c89a46", "159aea9b", "76c92ab7"],
        ...["5cdbcb06", "8f72d04e", "6fdd756f", "7ab3182e", "2040a2fa"],
        ...["295b044f", "e45dc47b", "1a74be2e", "0b91b0fc", "68874d71"],
        ...["9a588416", "0de6aebd", "52331eb5", "3b086215", "3102e49f"],
        ...["6594a11a", "48737817", "1766e981"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5937, 717, 6777, 720, 7245],
      hashes: [
        ...["38b40aa1", "56fc6f32", "8d347cdf", "5b4bd330", "cad1bb0c"],
        ...["138755b0", "6200b592", "812d3748", "2527c8b9", "6f013c9a"],
        ...["f0191564", "3a1c3fe3", "ac6ea22e", "bef77d5b", "abdc2d21"],
        ...["8deed309", "0748a7a6", "5a00ad1b", "f0549557", "4a5b9bbd"],
        ...["1def3427", "96088938", "2ef220c3", "5886fa5e", "bf7a1d10"],
        ...["67506e1a", "1f586126", "35ef4377", "bad99d15", "3ce4d7e4"],
        ...["aa393d9a", "657b386e", "469b19f0", "68eac9e0", "42087a4b"],
        ...["e082897a", "19fcab3b", "b971537a", "5212d960"],
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
