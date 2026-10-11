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
 * camp; the pass ends with its boss, the lancer captain on his ember drake, whom both runs beat to clear it. A
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
  rules: "fuse-axe-18",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5523, 702, 6807],
      hashes: [
        ...["cf0dfbbd", "58693af7", "369f17d3", "e58d782f", "3adf2404"],
        ...["2441d1d7", "12379f8c", "4b0e53eb", "c21b6b87", "f6f59f33"],
        ...["27e6f3db", "fe3be356", "083e12df", "851d1029", "6014107b"],
        ...["dfca48ad", "768a1a81", "1a0cb639", "ed96f319", "99d622d9"],
        ...["a01f6e48", "f73cab5b", "cd880756", "7ab3182e"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5937, 717, 6777],
      hashes: [
        ...["457efc89", "0bf29f37", "3b7048fe", "a202d543", "ac3a28e7"],
        ...["47070339", "58168026", "734a9004", "f2b53b0b", "6f013c9a"],
        ...["201e53e3", "3a1c3fe3", "25bc1ea3", "a899dc0c", "da515bab"],
        ...["6159903c", "958481d2", "a6ee36e2", "6fd89b16", "506a30bb"],
        ...["9e5dc84b", "97454ac9", "d4d31dd7", "5886fa5e"],
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
