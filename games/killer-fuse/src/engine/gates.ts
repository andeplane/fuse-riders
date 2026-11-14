/**
 * Gates. A Worker holding a berry that stands still in a gate offers the berry for GATE_OFFER steps; moving, leaving
 * the ground or the gate turning to the enemy cancels the offer. Then the gate locks the Worker in for GATE_LOCK
 * steps: the berry is spent, nothing touches the Worker, and it comes out upgraded and briefly invulnerable. A
 * warrior gate makes a Warrior, a speed gate a speed Worker, and a speed Worker in a warrior gate a speed Warrior.
 * A gate is neutral until a Queen touches it; then only her team may use it until the other Queen touches it. A
 * gate is never used up.
 */
import { arenaOf, standingOn } from "./maps.js";
import {
  GATE_HALF,
  GATE_HEIGHT,
  GATE_INVULN,
  GATE_OFFER,
  S,
  GATE_STEPS,
} from "./tuning.js";
import type { Round, Unit } from "./types.js";
import {
  freeWorker,
  release,
  settle,
  turnOrder,
  unitTouches,
  within,
} from "./units.js";

/** Whether `unit` could start using gate `index` right now, were it standing in it. */
export function gateOpenTo(state: Round, index: number, unit: Unit): boolean {
  const gate = state.gates[index]!;
  const kind = arenaOf(state.mapId).gates[index]!.kind;
  return (
    (gate.owner < 0 || gate.owner === unit.team) &&
    (gate.user < 0 || gate.user === unit.slot) &&
    unit.kind === "worker" &&
    (kind === "warrior" || !unit.speed)
  );
}

export function stepGates(state: Round): void {
  const arena = arenaOf(state.mapId);
  const order = turnOrder(state);
  for (let i = 0; i < arena.gates.length; i += 1) {
    const def = arena.gates[i]!,
      gate = state.gates[i]!;
    /** Standing still on the gate's floor, wholly between its sides. */
    const offering = (unit: Unit): boolean =>
      unit.carrying &&
      unit.ground >= 0 &&
      unit.vx === 0 &&
      within(unit, def.x, def.y, GATE_HALF, GATE_HEIGHT);
    for (const slot of order.slice(0, 2)) {
      const queen = state.units[slot]!;
      if (
        queen.dead ||
        gate.owner === queen.team ||
        !unitTouches(queen, def.x, def.y, GATE_HALF, GATE_HEIGHT)
      )
        continue;
      gate.owner = queen.team;
      // Tagging a gate ends the invulnerability she hatched with.
      queen.invuln = 0;
      state.events.push({
        type: "gateClaim",
        slot,
        gate: i,
        team: queen.team,
      });
    }
    const user = state.units[gate.user];
    if (user) {
      if (user.gateProgress >= GATE_OFFER) {
        // Locked in: nothing cancels it now, not even the gate changing hands.
        user.gateProgress += 1;
        if (user.gateProgress >= GATE_STEPS) {
          release(state, user);
          settle(user);
          if (def.kind === "warrior") user.kind = "warrior";
          else user.speed = true;
          user.x = def.x;
          user.y = def.y;
          user.ground = standingOn(arena, def.x, def.y);
          user.invuln = GATE_INVULN;
          state.events.push({
            type: "gateUse",
            slot: user.slot,
            gate: i,
            kind: def.kind,
            x: Math.trunc(user.x / S),
            y: Math.trunc(user.y / S),
          });
        }
      } else if (gate.owner === 1 - user.team || !offering(user))
        release(state, user);
      else {
        user.gateProgress += 1;
        if (user.gateProgress >= GATE_OFFER) {
          user.carrying = false;
          settle(user);
          state.events.push({ type: "gateLock", slot: user.slot, gate: i });
        }
      }
      continue;
    }
    for (const slot of order) {
      const unit = state.units[slot]!;
      if (
        freeWorker(unit) &&
        unit.gate < 0 &&
        gateOpenTo(state, i, unit) &&
        offering(unit)
      ) {
        unit.gate = i;
        unit.gateProgress = 0;
        gate.user = slot;
        state.events.push({ type: "gateOffer", slot, gate: i });
        break;
      }
    }
  }
}
