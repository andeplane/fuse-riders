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
 * camp. A refactor must keep these; a change to the rules (the bot's play included, as a bot seat folds
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
  rules: "fuse-axe-17",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: [5523, 702, 6387],
      hashes: [
        ...["ce198dc3", "6ce8077c", "3770858c", "794f5b4b", "3adf2404"],
        ...["236062d9", "54038edd", "35924576", "1e7a67b8", "f6f59f33"],
        ...["a6591d38", "fe3be356", "59086cfa", "d209a19d", "6a706b44"],
        ...["2a156f7b", "9695cc85", "bfebbafa", "0a04ca7b", "3603623f"],
        ...["8730e576", "79ef133e", "c47e9c1d"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: [5937, 717, 6507],
      hashes: [
        ...["bc9499b9", "b59139b6", "f4ef79db", "278dcf24", "e8c26338"],
        ...["84a63064", "35c9c1e2", "c8885600", "3091a701", "6f013c9a"],
        ...["899f3800", "3a1c3fe3", "ec5499b2", "97516d97", "48d24699"],
        ...["b6c8734d", "494e7c3e", "d4bc8e3f", "8eb517e3", "3691169d"],
        ...["4e69a7bf", "c96fd13c", "82ca96c0"],
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
