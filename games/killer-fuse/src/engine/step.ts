/**
 * One 60 Hz step of a round. The order is fixed: bots decide, timers run, every unit moves on its own, then the
 * snail, combat, berries and gates resolve the contacts, and last the three victories are checked. The network
 * calls this three times per 50 ms log tick; nothing here reads a clock or anything outside the state.
 */
import { stepBerries } from "./berries.js";
import { botInput } from "./bot.js";
import { resolveCombat } from "./combat.js";
import { stepGates } from "./gates.js";
import { arenaOf } from "./maps.js";
import { NEUTRAL, moveUnit } from "./motion.js";
import { stepSnail } from "./snail.js";
import type { Input, Round, VictoryKind } from "./types.js";
import { firstTeam, respawnUnit } from "./units.js";

function win(state: Round, team: number, kind: VictoryKind): void {
  state.winner = { team, kind };
  state.events.push({ type: "victory", team, kind });
}

function checkVictory(state: Round, snailTeam: number): void {
  // A tie on the same step (both Queens' last egg, both hives' last hole) goes to the step's coin flip.
  const first = firstTeam(state),
    second = 1 - first;
  for (const team of [first, second])
    if (state.eggs[1 - team]! <= 0) return win(state, team, "military");
  for (const team of [first, second])
    if (state.holes[team]!.every((filled) => filled))
      return win(state, team, "economy");
  if (snailTeam >= 0) win(state, snailTeam, "snail");
}

/**
 * Advances `state` by one step in place and returns it. `inputs[slot]` is read for the slots people play; bots make
 * their own. A missing input is neutral. After a victory the state no longer changes.
 */
export function stepRound(state: Round, inputs: readonly Input[]): Round {
  if (state.winner) {
    state.events = [];
    return state;
  }
  state.events = [];
  state.step += 1;
  const arena = arenaOf(state.mapId);
  const applied: Input[] = state.units.map((unit) =>
    state.humans[unit.slot]
      ? (inputs[unit.slot] ?? NEUTRAL)
      : botInput(state, unit.slot),
  );
  for (const unit of state.units) {
    if (unit.dead) {
      unit.respawn -= 1;
      if (unit.respawn <= 0) respawnUnit(state, unit);
      continue;
    }
    if (unit.invuln > 0) unit.invuln -= 1;
    if (unit.mountWait > 0) unit.mountWait -= 1;
    if (unit.riding || unit.eaten) {
      unit.flapped = false;
      continue;
    }
    moveUnit(unit, applied[unit.slot]!, arena);
  }
  const snailTeam = stepSnail(state, applied);
  resolveCombat(state);
  stepBerries(state);
  stepGates(state);
  checkVictory(state, snailTeam);
  return state;
}
