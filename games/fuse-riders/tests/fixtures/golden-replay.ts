import { PICKUP_TYPES } from "../../src/engine/game.js";
import { replayHashes, type Recording } from "./replay-log.js";
import {
  coverageObserver,
  emptyCoverage,
  isObstacleMap,
  REQUIREMENTS,
} from "./replay-coverage.js";

/** The seed and tick budget `scripts/update-golden-hashes.ts --record` plays the pinned workload with. */
export const GOLDEN_SEED = 20260918;
export const GOLDEN_TICK_BUDGET = 30_000;

/** One thing the pinned recording has to do, read back from its replay. `key` is a `REQUIREMENTS` key where it has one. */
export interface CoverageClaim {
  key: string;
  claim: string;
  ok: boolean;
  /** What the replay saw instead, for a claim that does not hold. */
  detail?: string;
}

/**
 * Replays a recording once, for its per-tick hashes and for everything the golden test claims the recording
 * exercises. The test asserts every claim and the updater refuses to pin a replay that fails one, from this one
 * list, so the updater cannot write a golden its own test rejects.
 *
 * `stride` is passed straight to `replayHashes`: it thins the hashes, never the fold, so the coverage claims
 * below are read from the whole recording whatever it is set to. The updater always records at stride 1.
 */
export function replayGolden(
  recording: Recording,
  stride = 1,
): {
  hashes: string[];
  claims: CoverageClaim[];
} {
  const coverage = emptyCoverage();
  const observeCoverage = coverageObserver(coverage);
  let fiveRiderTicks = 0,
    duelTicks = 0,
    tick = 0;
  /** The first few ticks the roster did not add up on; the rest would say the same. */
  const roster: string[] = [];
  const rosterFault = (fault: string) => {
    if (roster.length < 3) roster.push(`tick ${tick}: ${fault}`);
  };
  const hashes = replayHashes(
    recording,
    (state) => {
      tick++;
      if (state.game.phase === "playing") {
        if (state.bots.size + state.folds.size !== state.game.players.size)
          rosterFault(
            `${state.bots.size} bots and ${state.folds.size} human streams for ${state.game.players.size} riders`,
          );
        // The bots are sent home for the duels; with any of them seated the room is full.
        const seats = state.bots.size ? 5 : 2;
        if (state.game.players.size !== seats)
          rosterFault(
            `${state.game.players.size} riders seated with ${state.bots.size} bots, expected ${seats}`,
          );
        if (
          state.bots.size === 3 &&
          state.folds.size === 2 &&
          state.game.roundParticipants.size === 5
        )
          fiveRiderTicks++;
        if (state.game.roundParticipants.size === 2) duelTicks++;
      }
      return observeCoverage(state);
    },
    stride,
  );
  const missingPickups = PICKUP_TYPES.filter(
    (type) => !coverage.collected.includes(type),
  );
  const seen = JSON.stringify(coverage);
  const claim = (
    key: string,
    text: string,
    ok: boolean,
    detail?: string,
  ): CoverageClaim => ({
    key,
    claim: text,
    ok,
    ...(ok || detail === undefined ? {} : { detail }),
  });
  return {
    hashes,
    claims: [
      claim(
        "roster:seats",
        "every seated rider is a bot or a human stream, five riders with bots seated and two without",
        roster.length === 0,
        roster.join("; "),
      ),
      claim(
        "five-riders",
        "two humans and three bots ride together for at least 150 seconds of play",
        fiveRiderTicks >= 3000,
        `${fiveRiderTicks} ticks`,
      ),
      claim("two-riders", "the two humans also ride alone", duelTicks > 0),
      claim(
        "pickups",
        "every pickup must actually be collected",
        missingPickups.length === 0 &&
          coverage.collected.length === PICKUP_TYPES.length,
        `never collected: ${missingPickups.join(", ")}`,
      ),
      claim(
        "portal:transit",
        "a rider crosses a portal with exit grace",
        coverage.portalTransits > 0,
      ),
      claim(
        "shield:absorb",
        "a shield absorbs a hazard while its rider survives",
        coverage.shieldAbsorbs > 0,
      ),
      claim(
        "map:obstacles",
        "a round is played on an obstacle map",
        coverage.maps.some(isObstacleMap),
      ),
      ...[
        "desert",
        "forest",
        "city",
        "wrap",
        "classic",
        "cross",
        "drift",
        "trains",
      ].map((map) =>
        claim(
          `map:${map}:played`,
          `a round is played on ${map}`,
          (coverage.maps as string[]).includes(map),
          `maps played: ${coverage.maps.join(", ")}`,
        ),
      ),
      claim(
        "obstacles:blasted",
        "a blast clears an obstacle away on the tick it opens",
        coverage.obstaclesBlasted > 0,
      ),
      claim(
        "scenery:crash",
        "a rider crashes into scenery and dies against it",
        coverage.sceneryCrashes > 0,
      ),
      claim(
        "edge:crossing",
        "a living rider is carried through an open edge without a portal",
        coverage.edgeCrossings > 0,
      ),
      claim(
        "edge:blast",
        "a blast opens over an open edge and stands on both sides of it",
        coverage.edgeBlasts > 0,
      ),
      // What the recorder played for, read back from this replay: it stops only once every one of these holds, so a
      // fresh `--record` cannot write a fixture that fails here.
      ...REQUIREMENTS.map((entry) =>
        claim(entry.key, entry.claim, entry.met(coverage), seen),
      ),
    ],
  };
}
