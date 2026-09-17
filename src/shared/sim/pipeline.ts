/**
 * The tick, as an ordered list. This file is the one statement of what happens in which order; `step` only walks it.
 * The order is part of the rules: moving a phase changes outcomes, so it needs a `RULES` bump like any other change.
 */
import type { TickContext } from "./context.js";
import { advanceClock } from "./phases/advance-clock.js";
import { expire } from "./phases/expire.js";
import { startPlay } from "./phases/start-play.js";
import { ageTrails } from "./phases/age-trails.js";
import { fitField } from "./phases/fit-field.js";
import { spawnPickups } from "./phases/spawn-pickups.js";
import { moveRiders } from "./phases/move-riders.js";
import { collectPickups } from "./phases/collect-pickups.js";
import { bounceImmuneRiders } from "./phases/bounce-immune-riders.js";
import { moveShells } from "./phases/move-shells.js";

export interface Phase {
  readonly name: string;
  /** `always` phases run whatever the game phase; the tick ends at the first `playing` phase when no round is in play. */
  readonly when: "always" | "playing";
  readonly run: (ctx: TickContext) => void;
}

export const PHASES: readonly Phase[] = [
  { name: "advanceClock", when: "always", run: advanceClock },
  { name: "expire", when: "always", run: expire },
  { name: "startPlay", when: "always", run: startPlay },
  { name: "ageTrails", when: "playing", run: ageTrails },
  { name: "fitField", when: "playing", run: fitField },
  { name: "spawnPickups", when: "playing", run: spawnPickups },
  { name: "moveRiders", when: "playing", run: moveRiders },
  { name: "collectPickups", when: "playing", run: collectPickups },
  { name: "bounceImmuneRiders", when: "playing", run: bounceImmuneRiders },
  { name: "moveShells", when: "playing", run: moveShells },
];

/** Walks the phases in order. False when the tick ended early because no round is in play. */
export function runPhases(ctx: TickContext, phases: readonly Phase[]): boolean {
  for (const phase of phases) {
    if (phase.when === "playing" && ctx.state.phase !== "playing") return false;
    phase.run(ctx);
  }
  return true;
}
