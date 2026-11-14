/**
 * The silent gameplay demo behind the main menu and the lobby: six bots playing real Killer Fuse rounds through the
 * game's own engine. There is no room, transport, account, stored state or product metric here, and no privileged
 * physics: every unit is driven by the same `botInput` an empty seat gets in a match, because `humans` is all false.
 *
 * The demo is seeded and stepped by hand, so a test can replay it exactly; the shared attract lifecycle
 * (`mountAttract`) decides when `advance` and the drawing happen.
 */
import {
  MAX_PLAYERS,
  NEUTRAL,
  createRound,
  stepRound,
  viewOf,
  type BotLevel,
  type GameEvent,
  type Input,
  type MapId,
  type Round,
  type RoundView,
} from "../engine/index.js";

/** One demo tick folds the three 60 Hz engine steps a room's 20 Hz log tick folds. */
export const STEPS_PER_ADVANCE = 3;
/** A round is replaced after this many ticks even when nobody has won, so nothing grows without bound. */
export const LOOP_TICKS = 1200;
/** How long the winning moment stays on screen before the next round starts. */
export const LINGER_TICKS = 40;
/** The maps the demo cycles through, so a menu left open does not show the same arena forever. */
const MAP_ROTATION: readonly MapId[] = [1, 2, 3];
const RESTING: readonly Input[] = Array.from(
  { length: MAX_PLAYERS },
  () => NEUTRAL,
);
const NO_HUMANS: readonly boolean[] = Array.from(
  { length: MAX_PLAYERS },
  () => false,
);

export interface AttractMatchOptions {
  /** The first round's seed; each later round takes the next one, so the rotation is reproducible. */
  seed?: number;
  botLevel?: BotLevel;
  /** Ticks played before the first frame is shown, so the menu opens on a fight rather than on six spawns. */
  warmupTicks?: number;
}

export interface AttractMatch {
  /** Plays one demo tick, or starts a fresh round when the last one is finished or has run long enough. */
  advance(): void;
  /** Ticks played in the current round; it falls back to zero when a round is replaced. */
  tick(): number;
  /** The newest view, with the events of every step of the tick it folded. */
  view(): RoundView;
  /** The view before it, for the renderer's interpolation. */
  previous(): RoundView;
  /** How many rounds have been started, the first included. */
  rounds(): number;
}

export function createAttractMatch(
  options: AttractMatchOptions = {},
): AttractMatch {
  const seed = options.seed ?? 20261114;
  const botLevel: BotLevel = options.botLevel ?? "medium";
  let state: Round;
  let current: RoundView;
  let before: RoundView;
  let tick = 0;
  let rounds = 0;
  let settled = 0;
  const fresh = (): void => {
    rounds += 1;
    state = createRound({
      seed: seed + rounds,
      mapId: MAP_ROTATION[rounds % MAP_ROTATION.length]!,
      botLevel,
      humans: [...NO_HUMANS],
    });
    tick = 0;
    settled = 0;
    // Step zero tells the renderer a new round began, so nothing of the last one lingers.
    before = current = viewOf(state);
  };
  fresh();
  const advance = (): void => {
    if (tick >= LOOP_TICKS || settled >= LINGER_TICKS) {
      fresh();
      return;
    }
    const events: GameEvent[] = [];
    let stepped = current;
    for (let step = 0; step < STEPS_PER_ADVANCE; step += 1) {
      stepRound(state, RESTING);
      stepped = viewOf(state);
      events.push(...stepped.events);
    }
    tick += 1;
    before = current;
    current = { ...stepped, events };
    if (current.winner) settled += 1;
  };
  for (let warm = options.warmupTicks ?? 0; warm > 0; warm -= 1) advance();
  return {
    advance,
    tick: () => tick,
    view: () => current,
    previous: () => before,
    rounds: () => rounds,
  };
}
