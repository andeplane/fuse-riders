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
 * pots, magic, throws — and the world's hash is compared every ten seconds and at the end. A refactor must keep
 * these; a change to the rules (the bot's play included, as a bot seat folds `botInput`) must bump `RULES` in
 * `src/engine/index.ts` and re-record them in the same commit: `GOLDEN_RECORD=1` prints the new ones.
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
  rules: "fuse-axe-11",
  runs: [
    {
      seed: 20261011,
      humans: [],
      steps: 5151,
      hashes: [
        ...["a9b4942b", "a4d2cf41", "85d8dcb5", "b635ac8b", "70f69837"],
        ...["9f2515f8", "e8ffeec5", "727fcdee", "e92ed0c8"],
      ],
    },
    {
      seed: 20261012,
      humans: [1],
      steps: 5133,
      hashes: [
        ...["1493d377", "ffd8c8a9", "d44bbc6a", "96eb9680", "2ee751b4"],
        ...["6c8b9fd0", "04a7e686", "944f2a6b", "98b80a1e"],
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
