import { TURN } from "../engine/index.js";
import { RECORDED } from "./rides-data.js";

export { RECORDED };

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
