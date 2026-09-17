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
import { explodeFuses, explodeInstant } from "./phases/explode.js";
import { hitProjectiles } from "./phases/hit-projectiles.js";
import { burnTrails } from "./phases/burn-trails.js";
import { detectHazards } from "./phases/detect-hazards.js";
import { detectRiderContacts } from "./phases/detect-rider-contacts.js";
import { settleSceneryContacts } from "./phases/settle-scenery-contacts.js";
import { resolveDefences } from "./phases/resolve-defences.js";
import { portalTransit } from "./phases/portal-transit.js";
import { stopAtContact } from "./phases/stop-at-contact.js";
import { commitMovement } from "./phases/commit-movement.js";
import { commitDeaths } from "./phases/commit-deaths.js";
import { launchWeapons } from "./phases/launch-weapons.js";
import { fireGuns } from "./phases/fire-guns.js";
import { resolveInstantHits } from "./phases/resolve-instant-hits.js";
import { observeDodges } from "./phases/observe-dodges.js";
import { recordFacts } from "./phases/record-facts.js";
import { resolveRound } from "./phases/resolve-round.js";

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
  { name: "explodeFuses", when: "playing", run: explodeFuses },
  { name: "hitProjectiles", when: "playing", run: hitProjectiles },
  { name: "burnTrails", when: "playing", run: burnTrails },
  { name: "detectHazards", when: "playing", run: detectHazards },
  { name: "detectRiderContacts", when: "playing", run: detectRiderContacts },
  {
    name: "settleSceneryContacts",
    when: "playing",
    run: settleSceneryContacts,
  },
  { name: "resolveDefences", when: "playing", run: resolveDefences },
  { name: "portalTransit", when: "playing", run: portalTransit },
  { name: "stopAtContact", when: "playing", run: stopAtContact },
  { name: "commitMovement", when: "playing", run: commitMovement },
  { name: "commitSweepDeaths", when: "playing", run: commitDeaths },
  { name: "launchWeapons", when: "playing", run: launchWeapons },
  { name: "fireGuns", when: "playing", run: fireGuns },
  { name: "explodeInstant", when: "playing", run: explodeInstant },
  { name: "resolveInstantHits", when: "playing", run: resolveInstantHits },
  { name: "commitInstantDeaths", when: "playing", run: commitDeaths },
  { name: "observeDodges", when: "playing", run: observeDodges },
  { name: "recordFacts", when: "playing", run: recordFacts },
  { name: "resolveRound", when: "playing", run: resolveRound },
];

/**
 * A phase threw. The state it was given is part-way through the tick — the clock has advanced, some phases have
 * written and the rest have not — and must not be simulated, hashed, served or shown again: the caller restores a
 * state from before the tick. `step` cannot do that itself without copying the state every tick, which costs most of
 * what a tick costs; the world that owns the state already keeps snapshots (docs/design/tick-fault-recovery.md).
 */
export class TickFault extends Error {
  constructor(
    /** The tick that was being simulated. */
    readonly tick: number,
    /** The name of the phase that threw, as listed in PHASES. */
    readonly phase: string,
    cause: unknown,
  ) {
    super(
      `tick ${tick} failed in phase ${phase}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "TickFault";
  }
}
