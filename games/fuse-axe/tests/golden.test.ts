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
 * together from their bones unless shattered, to the pair of bone knights at the cathedral's doors. After a third they
 * fight through Vorhal's Keep to the throne room and beat Vorhal: his greatsword, his fire spell's sigils, his summoned
 * bonewalkers, his leap and his roar at half his hit points. A
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
  rules: "fuse-axe-21",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5523, 702, 6807, 666, 6954, 702, 9516],
      hashes: [
        ...["9ef10783", "6b2fe356", "71dd514e", "3691b733", "679b6f22"],
        ...["9dda2a89", "f80eefd1", "0d61c578", "ecee146a", "319868db"],
        ...["47a9ff7a", "6630f634", "fd385924", "8951abf5", "17dcc10e"],
        ...["0213bd8b", "a32982d5", "65d31444", "64087e83", "ef324607"],
        ...["1f455f84", "54ca6d0c", "6126e93f", "fb11576c", "b5543840"],
        ...["96076a1f", "9bc29fe3", "53def96c", "68800a9a", "f35afb71"],
        ...["ef766d74", "694963d5", "ffc5c40d", "118cdced", "b4d298cf"],
        ...["5b6f0660", "1cbbbbe7", "3ddecaa1", "c0e9e65f", "08782746"],
        ...["c77aaae5", "ecc0feb0", "cfb50a5e", "03fc0938", "190fdc3f"],
        ...["8db0230d", "f546ba73", "caf0d4df", "9e69dda1", "ce91895f"],
        ...["47549efb", "345e31eb", "89c97f4d", "86913dbc", "51eb7d01"],
        ...["7184a977"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5937, 717, 6777, 720, 7245, 726, 8520],
      hashes: [
        ...["c28b37c1", "efe8b0b8", "b68a238f", "d6337406", "8c5f05ca"],
        ...["aae22f86", "17cb1598", "b102a77e", "61dec9d9", "c3fb14e0"],
        ...["cd70ed82", "d602f7eb", "aa80c56c", "1d7eecc3", "8e6cd341"],
        ...["6e0c5549", "2f7adb24", "53d7fa03", "9ea55ba7", "cf41d2d5"],
        ...["1ce45e57", "4cff5ace", "8894facb", "af4766bc", "2e421866"],
        ...["5bcb1560", "e3cab3a4", "59e0f247", "d21a25ed", "85226902"],
        ...["2c165fe0", "4fc1d82c", "3aafd546", "f400d056", "b2194b13"],
        ...["33ce3fc0", "612ac823", "35016dc0", "3293dad6", "6e9b3eac"],
        ...["50c56d55", "11e884fd", "9707cb8e", "28cd0e09", "77bb8ea5"],
        ...["105ee38d", "51d45cbf", "f5d3cf94", "077630e1", "ba46a0cc"],
        ...["c5c00f02", "2e31c573", "09f092de", "4a9442ba", "cf9624fc"],
        ...["71d69aa7"],
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
