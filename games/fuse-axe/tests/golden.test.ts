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
 */
const GOLDEN: { rules: string; steps: number; hashes: string[] } = {
  rules: "fuse-axe-11",
  steps: 5151,
  hashes: [
    ...["a9b4942b", "a4d2cf41", "85d8dcb5", "b635ac8b", "70f69837"],
    ...["9f2515f8", "e8ffeec5", "727fcdee", "e92ed0c8"],
  ],
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function record() {
  let world = createWorld({
    seed: 20261011,
    heroes: HERO_KINDS.map((kind, seat) => ({ seat, kind })),
  });
  const hashes: string[] = [];
  while (world.step < 12_000 && !stageCleared(world) && !defeated(world)) {
    const held: number[] = [];
    for (const hero of world.heroes) held[hero.seat] = botInput(world, hero.id);
    world = stepTick(world, held);
    if (world.step % 600 === 0)
      hashes.push(fnv(JSON.stringify(encodeWorld(world))));
  }
  hashes.push(fnv(JSON.stringify(encodeWorld(world))));
  return { world, steps: world.step, hashes };
}

test("three bots clear Stage 1 to the recorded hashes under the current rules", () => {
  const { world, steps, hashes } = record();
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, steps, hashes }));
  assert.ok(stageCleared(world), "the bots clear the stage");
  assert.ok(world.heroes.some((hero) => hero.casts > 0 && hero.throws > 0));
  assert.equal(
    RULES,
    GOLDEN.rules,
    "RULES changed: re-record the golden in the same commit",
  );
  assert.deepEqual(
    { steps, hashes },
    { steps: GOLDEN.steps, hashes: GOLDEN.hashes },
    "the engine's behaviour changed: bump RULES and re-record, or fix the regression",
  );
});
