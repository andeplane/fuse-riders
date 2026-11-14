import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TURN } from "../../src/engine/index.js";

/**
 * The solver's finishing rides (`scripts/elasto-fuse-solve.ts`): for each level a list of held bits, one per
 * decision of `decision` steps, and the step the ride reaches the flower on.
 */
interface Recorded {
  rules: string;
  decision: number;
  rides: Record<string, { ride: string; steps: number }>;
}
export const RECORDED = JSON.parse(
  readFileSync(fileURLToPath(new URL("./rides.json", import.meta.url)), "utf8"),
) as Recorded;

/** The ride for `levelId` as the bits to hold on each step. A turn is a press: down on a decision's first step only. */
export function rideBits(levelId: string): number[] {
  const recorded = RECORDED.rides[levelId];
  if (!recorded) throw new Error(`no ride recorded for ${levelId}`);
  const bits: number[] = [];
  for (const run of recorded.ride.split(" ")) {
    const [action, count] = run.split("*").map(Number) as [number, number];
    for (let decision = 0; decision < count; decision++)
      for (let step = 0; step < RECORDED.decision; step++)
        bits.push(step === 0 ? action : action & ~TURN);
  }
  return bits;
}
