import {
  removePlayer,
  sortedPlayers,
  startNextRound,
  step,
  type GameState,
  type InputIntent,
  type Phase,
} from "./game.js";
import type { PlayerId } from "./primitives.js";
import type { RoomSettings } from "./room-settings.js";
import type { GameEvent } from "./state.js";

/**
 * The most steps one log tick runs. `applyTick` chooses the count for each tick from the state before it; the
 * snapshot guard (`stepsCover`) bounds a game clock by it. See `docs/design/fixed-clock-game-speed.md`.
 */
export const MAX_STEPS_PER_TICK = 1;

/**
 * Whether a game clock can belong to a room at `logTick`: every log tick steps the game at least once and at most
 * `MAX_STEPS_PER_TICK` times, and nothing else moves the game's clock. The snapshot guard refuses any other pair.
 */
export function stepsCover(logTick: number, gameTick: number): boolean {
  return gameTick >= logTick && gameTick <= logTick * MAX_STEPS_PER_TICK;
}

/** How one log tick steps the game when it steps more than once. */
export interface TickSteps {
  /** Steps to run, at least one. Steps after the first run only while the round is still playing. */
  count: number;
  /**
   * The inputs of each step after the first, from the game as the previous step left it: held controls without the
   * tick's bomb commands, which belong to the first step alone, and bots asked again.
   */
  later: (game: Readonly<GameState>) => ReadonlyMap<PlayerId, InputIntent>;
}

/** What one driven tick did to the game that the room around it has to follow. */
export interface DrivenTick {
  events: GameEvent[];
  /** Riders the round boundary dropped because they were absent. The room forgets their held controls and bot seats. */
  removed: PlayerId[];
  /** The next round began on this tick: a gesture held across the boundary is no longer held. */
  roundStarted: boolean;
}

/**
 * One tick of a game, whoever runs it: the simulation, then what follows from it without anyone asking.
 *
 * 1. `step` with `inputs`, then, if `steps` asks for more, further steps with `steps.later` for as long as the round
 *    is playing: a round that ends on an early step is not stepped on into its pause.
 * 2. Round progression. When the round-over pause has run out, riders who are absent lose their seat; if two or more
 *    remain, the next round starts. With fewer the game waits in `roundOver` for the room to act.
 * 3. Settings at the round boundary. The next round plays under the room's current settings, except the match format
 *    (`match`, `length`), which is fixed when the match starts.
 * 4. Outside play nobody holds a charge or a target.
 *
 * The driver knows the game and nothing about the room's log, streams or bots; `applyTick` folds those into `inputs`
 * and applies `removed` and `roundStarted` to its own records. `roomSettings` is what the room has chosen now, which
 * can be newer than `game.settings`, what the game is playing under.
 *
 * Not transactional: a throw in `step` (a `TickFault`) leaves `game` part-way through the tick. `phases` is the
 * fault-injection seam of `step`.
 */
export function driveGameTick(
  game: GameState,
  inputs: ReadonlyMap<PlayerId, InputIntent>,
  roomSettings: RoomSettings,
  phases?: readonly Phase[],
  steps?: TickSteps,
): DrivenTick {
  const events: GameEvent[] = [],
    removed: PlayerId[] = [];
  let roundStarted = false;
  events.push(...step(game, inputs, phases).events);
  const count = Math.floor(steps?.count ?? 1);
  for (let index = 1; index < count && game.phase === "playing"; index += 1)
    events.push(...step(game, steps!.later(game), phases).events);
  if (
    game.phase === "roundOver" &&
    game.phaseEndsAtTick !== undefined &&
    game.tick >= game.phaseEndsAtTick
  ) {
    for (const player of sortedPlayers(game))
      if (!player.connected) {
        removePlayer(game, player.id);
        removed.push(player.id);
      }
    if (sortedPlayers(game).filter((player) => player.connected).length >= 2) {
      // Format stays fixed for a match; powerup changes apply at round boundaries.
      game.settings = {
        ...roomSettings,
        match: game.settings.match,
        length: game.settings.length,
      };
      startNextRound(game);
      roundStarted = true;
    }
  }
  if (game.phase !== "playing")
    for (const player of sortedPlayers(game)) {
      player.bombChargeStartedTick = undefined;
      player.bombTarget = undefined;
    }
  return { events, removed, roundStarted };
}
