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
import { TIME_LIMIT } from "./tuning.js";
import type { Input, Round, VictoryKind } from "./types.js";
import { firstTeam, held, respawnUnit } from "./units.js";

function win(state: Round, team: number, kind: VictoryKind): void {
  state.winner = { team, kind };
  state.events.push({ type: "victory", team, kind });
}

function checkVictory(state: Round, snailTeam: number): void {
  // Victories on the same step, of any kinds, go to the step's coin flip: the first team's are checked before any
  // of the other's. The snail counts only while its rider is still on it after combat: a rider killed on the step
  // of arrival did not bring it home.
  const first = firstTeam(state);
  const rode = state.snail.rider >= 0 ? snailTeam : -1;
  for (const team of [first, 1 - first]) {
    if (state.eggs[1 - team]! <= 0) return win(state, team, "military");
    if (state.holes[team]!.every((filled) => filled))
      return win(state, team, "economy");
    if (rode === team) return win(state, team, "snail");
  }
}

/**
 * Time is up: the team with more Queen eggs wins, then the one with more berries banked, then the one the snail is
 * closer to carrying home, and a dead heat goes to the step's coin flip. The victory's kind names what decided it
 * (a coin flip counts as "snail"), so the state keeps its shape; `timeUp` in the view tells it from a real victory.
 */
function decideByTime(state: Round): void {
  const [left, right] = arenaOf(state.mapId).snail.goals;
  const banked = state.holes.map((holes) => holes.filter(Boolean).length);
  const scores: [VictoryKind, number][] = [
    ["military", state.eggs[0]! - state.eggs[1]!],
    ["economy", banked[0]! - banked[1]!],
    ["snail", right - state.snail.x - (state.snail.x - left)],
  ];
  for (const [kind, lead] of scores)
    if (lead !== 0) return win(state, lead > 0 ? 0 : 1, kind);
  win(state, firstTeam(state), "snail");
}

/** True once the round was decided by the clock rather than by a victory. */
export const timedOut = (state: Round): boolean =>
  state.winner !== null && state.step > TIME_LIMIT;

/**
 * Advances `state` by one step in place and returns it. `inputs[slot]` is read for the slots people play; bots make
 * their own. A missing input is neutral. After a victory, or once TIME_LIMIT steps are played and the clock has
 * decided, the state no longer changes.
 */
export function stepRound(state: Round, inputs: readonly Input[]): Round {
  if (state.winner) {
    state.events = [];
    return state;
  }
  state.events = [];
  state.step += 1;
  // The step after the last one of play only decides: a victory on the last step itself still counts as one.
  if (state.step > TIME_LIMIT) {
    decideByTime(state);
    return state;
  }
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
    // Carried by the snail, in its mouth, locked in a gate or sitting in a hive hole: it does not move itself.
    if (unit.riding || unit.eaten || held(unit)) {
      unit.flapped = false;
      continue;
    }
    moveUnit(unit, applied[unit.slot]!, arena);
    if (unit.attack === 1)
      state.events.push({ type: "attack", slot: unit.slot });
  }
  const snailTeam = stepSnail(state, applied);
  resolveCombat(state);
  stepBerries(state);
  stepGates(state);
  checkVictory(state, snailTeam);
  return state;
}
