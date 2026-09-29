import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES,
  botInput,
  createWorld,
  encodeWorld,
  roundDone,
  stepWorld,
} from "../src/engine/index.js";

/**
 * The engine's safety net: five AI pilots fly a recorded round (shots, bumps, power-ups, drones, rocks, the crush
 * zone) and the world's hash is compared every ten seconds. A refactor must keep these; a change to the rules must
 * bump `RULES` in `src/engine/index.ts` and re-record them in the same commit (`GOLDEN_RECORD=1` prints the new ones).
 */
const GOLDEN: { rules: string; hashes: string[] } = {
  rules: "fuse-choppers-1",
  hashes: [
    "cf5d92d2",
    "eac86cbf",
    "a552a15f",
    "81b9758a",
    "dc4f581e",
    "19afe4c7",
    "24b9f77f",
    "a9af956d",
    "eab65bc5",
  ],
};

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function record(): string[] {
  const world = createWorld(
    20260929,
    [0, 1, 2, 3, 4].map((slot) => ({ id: `bot:${slot + 1}`, slot })),
    { lift: "classic", combat: "all", powerUps: true },
  );
  const hashes: string[] = [];
  let inputs = new Map<string, number>();
  for (let step = 0; step < 6000 && !roundDone(world); step++) {
    if (step % 3 === 0)
      inputs = new Map(world.choppers.map((c) => [c.id, botInput(world, c)]));
    stepWorld(world, inputs);
    if (world.step % 600 === 0)
      hashes.push(fnv(JSON.stringify(encodeWorld(world))));
  }
  hashes.push(fnv(JSON.stringify(encodeWorld(world))));
  return hashes;
}

test("a recorded round replays to its recorded hashes under the current rules", () => {
  const hashes = record();
  if (process.env.GOLDEN_RECORD)
    console.log(JSON.stringify({ rules: RULES, hashes }));
  assert.equal(
    RULES,
    GOLDEN.rules,
    "RULES changed: re-record the golden in the same commit",
  );
  assert.deepEqual(
    hashes,
    GOLDEN.hashes,
    "the engine's behaviour changed: bump RULES and re-record, or fix the regression",
  );
});
