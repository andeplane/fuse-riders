/**
 * Contact combat. There is no attack button: touching decides. A military unit (Warrior or Queen) kills an enemy
 * Worker it touches, a diving Queen included: she kills every Worker on her way down. Between two military units the
 * one clearly higher kills, a diving Queen kills what she lands on, and (unverified, behind the `BACKSTAB` flag) a hit
 * from behind kills; otherwise both bounce apart and cannot flap for a moment. A Worker never kills, but an
 * invulnerable one shoves the military unit it touches.
 */
import { wrapDelta } from "./maps.js";
import {
  BACKSTAB,
  BOUNCE_HOP,
  BOUNCE_SPEED,
  BUMP_HOP,
  BUMP_SPEED,
  HEIGHT_ADVANTAGE,
  STUN_STEPS,
} from "./tuning.js";
import type { Round, Unit } from "./types.js";
import { duelY, isMilitary, killUnit, unitsTouch } from "./units.js";

/** Which of two touching military units wins the contact, or null for a bounce. */
export function duelWinner(a: Unit, b: Unit): Unit | null {
  const rise = duelY(b) - duelY(a);
  if (a.diving && rise > 0) return a;
  if (b.diving && rise < 0) return b;
  if (rise >= HEIGHT_ADVANTAGE) return a;
  if (-rise >= HEIGHT_ADVANTAGE) return b;
  if (!BACKSTAB) return null;
  const toB = Math.sign(wrapDelta(b.x, a.x));
  const aFacesB = toB !== 0 && a.facing === toB,
    bFacesA = toB !== 0 && b.facing === -toB;
  if (aFacesB && !bFacesA) return a;
  if (bFacesA && !aFacesB) return b;
  return null;
}

/** 1 when `b` is to the right of `a`; ties go by slot so two stacked units still part. */
function side(a: Unit, b: Unit): -1 | 1 {
  const d = wrapDelta(b.x, a.x);
  return d > 0 || (d === 0 && a.slot < b.slot) ? 1 : -1;
}

export function resolveCombat(state: Round): void {
  const kills: [victim: Unit, killer: Unit][] = [];
  const units = state.units;
  for (let i = 0; i < units.length; i += 1)
    for (let j = i + 1; j < units.length; j += 1) {
      const a = units[i]!,
        b = units[j]!;
      if (a.dead || b.dead || a.team === b.team) continue;
      if (!isMilitary(a) && !isMilitary(b)) continue;
      if (!unitsTouch(a, b)) continue;
      const away = side(a, b);
      // Units already parting are left alone, so one contact is one bounce.
      const closing = (b.vx - a.vx) * away <= 0;
      if (isMilitary(a) && isMilitary(b)) {
        const winner = duelWinner(a, b);
        const loser = winner === a ? b : a;
        if (winner && loser.invuln === 0) kills.push([loser, winner]);
        else if (closing) {
          a.vx = -away * BOUNCE_SPEED;
          b.vx = away * BOUNCE_SPEED;
          a.vy = Math.min(a.vy, -BOUNCE_HOP);
          b.vy = Math.min(b.vy, -BOUNCE_HOP);
          a.stun = STUN_STEPS;
          b.stun = STUN_STEPS;
          state.events.push({ type: "bounce", a: a.slot, b: b.slot });
        }
        continue;
      }
      const soldier = isMilitary(a) ? a : b,
        worker = isMilitary(a) ? b : a;
      if (worker.invuln === 0) kills.push([worker, soldier]);
      else if (closing) {
        soldier.vx = (soldier === a ? -away : away) * BUMP_SPEED;
        soldier.vy = Math.min(soldier.vy, -BUMP_HOP);
        soldier.stun = STUN_STEPS;
        state.events.push({
          type: "bump",
          worker: worker.slot,
          target: soldier.slot,
        });
      }
    }
  for (const [victim, killer] of kills) killUnit(state, victim, killer.slot);
}
