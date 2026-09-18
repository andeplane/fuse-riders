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
 * How many times one shared tick steps the simulation. One today, and `RULES` would have to change with it.
 *
 * This is where issue #258's N2 (game speed as N steps per tick instead of a faster shared clock) belongs, but it is
 * not only this number: `applyTick` reads the log's tick off `game.tick + 1`, and a press, release or cancel in
 * `inputs` must reach the first step alone. See `docs/design/engine-tick-driver.md`.
 */
export const STEPS_PER_TICK = 1;

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
 * 1. `step`, `STEPS_PER_TICK` times, over the same inputs.
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
): DrivenTick {
  const events: GameEvent[] = [],
    removed: PlayerId[] = [];
  let roundStarted = false;
  for (let count = 0; count < STEPS_PER_TICK; count += 1)
    events.push(...step(game, inputs, phases).events);
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
