/**
 * Gates. A Worker holding a berry stands in a gate for GATE_STEPS and comes out upgraded and briefly invulnerable:
 * a warrior gate makes a Warrior, a speed gate a speed Worker, and a speed Worker in a warrior gate a speed Warrior.
 * A gate is neutral until a Queen touches it; then only her team may use it until the other Queen touches it.
 */
import { arenaOf } from "./maps.js";
import { GATE_HALF, GATE_HEIGHT, GATE_INVULN, GATE_STEPS } from "./tuning.js";
import type { Round, Unit } from "./types.js";
import { freeWorker, release, turnOrder, unitTouches } from "./units.js";

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
    const inGate = (unit: Unit): boolean =>
      unitTouches(unit, def.x, def.y, GATE_HALF, GATE_HEIGHT);
    for (const slot of order.slice(0, 2)) {
      const queen = state.units[slot]!;
      if (queen.dead || gate.owner === queen.team || !inGate(queen)) continue;
      gate.owner = queen.team;
      state.events.push({
        type: "gateClaim",
        slot,
        gate: i,
        team: queen.team,
      });
      // The Worker standing in it is locked out with everyone else on its team.
      const user = state.units[gate.user];
      if (user && user.team !== queen.team) release(state, user);
    }
    const user = state.units[gate.user];
    if (user) {
      if (!user.carrying || !inGate(user)) release(state, user);
      else {
        user.gateProgress += 1;
        if (user.gateProgress >= GATE_STEPS) {
          release(state, user);
          user.carrying = false;
          if (def.kind === "warrior") user.kind = "warrior";
          else user.speed = true;
          user.invuln = GATE_INVULN;
          state.events.push({
            type: "gateUse",
            slot: user.slot,
            gate: i,
            kind: def.kind,
          });
        }
      }
      continue;
    }
    for (const slot of order) {
      const unit = state.units[slot]!;
      if (
        freeWorker(unit) &&
        unit.carrying &&
        unit.gate < 0 &&
        unit.ground >= 0 &&
        gateOpenTo(state, i, unit) &&
        inGate(unit)
      ) {
        unit.gate = i;
        unit.gateProgress = 0;
        gate.user = slot;
        break;
      }
    }
  }
}
