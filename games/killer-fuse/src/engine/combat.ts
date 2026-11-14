/**
 * Sword combat, after Killer Queen Black. A Warrior's sword kills only in the lethal window of its attack, a Queen
 * only while she dashes or dives, and a Worker never. For each pair of enemies, in this order:
 *
 * - two lethal weapons that touch, their owners facing each other, glance: nobody dies, both are stunned and thrown
 *   apart and both attacks end;
 * - a lethal weapon that touches an enemy's hit box kills, when the enemy is in front of the attacker (a dive kills
 *   whatever its blade touches) and no platform is between them;
 * - bodies that touch bounce: a unit landing on another's head springs off it, anything else is a bump that stuns
 *   both and throws them apart sideways.
 *
 * Invulnerable units, Workers locked in a gate or a hive hole and a Worker in the snail's mouth take no part.
 */
import { arenaOf, wrapDelta, wrapX, type Arena } from "./maps.js";
import { endDash, fold, sheathe } from "./motion.js";
import {
  colliderOf,
  hitBoxesOf,
  lethal,
  weaponOf,
  type Box,
} from "./shapes.js";
import {
  HEAD_OVERLAP,
  HEAD_RESTITUTION,
  KNOCK_SPEED,
  STUN_SPEED,
  S,
  STUN_STEPS,
} from "./tuning.js";
import type { Round, Unit } from "./types.js";
import { centreY, held, killUnit } from "./units.js";

/** Whether a unit takes part in combat at all: it can be hit, bumped and, when armed, hit others. */
export const exposed = (unit: Unit): boolean =>
  !unit.dead && !unit.eaten && unit.invuln === 0 && !held(unit);

/** Whether any box of `a` overlaps any box of `b`; boxes are mirrored with their unit's facing. */
function touch(
  a: Unit,
  boxesA: readonly Box[],
  b: Unit,
  boxesB: readonly Box[],
): boolean {
  for (const p of boxesA)
    for (const q of boxesB) {
      const dx = wrapDelta(b.x + b.facing * q.x, a.x + a.facing * p.x);
      const dy = b.y + q.y - (a.y + p.y);
      if (Math.abs(dx) < p.hw + q.hw && Math.abs(dy) < p.hh + q.hh) return true;
    }
  return false;
}

/** How many points of the line between two units are tested for a platform. */
const SIGHT_SAMPLES = 12;

/** Whether a platform lies on the line between the middles of two units. */
export function walled(arena: Arena, a: Unit, b: Unit): boolean {
  const dx = wrapDelta(b.x, a.x),
    ay = centreY(a),
    dy = centreY(b) - ay;
  for (let k = 1; k < SIGHT_SAMPLES; k += 1) {
    const x = wrapX(a.x + Math.trunc((dx * k) / SIGHT_SAMPLES)),
      y = ay + Math.trunc((dy * k) / SIGHT_SAMPLES);
    for (const solid of arena.solids)
      if (
        x > solid.x &&
        x < solid.x + solid.w &&
        y > solid.y &&
        y < solid.y + solid.h
      )
        return true;
  }
  return false;
}

/** Whether `b` is in front of `a`. A dive strikes all round. */
const fronts = (a: Unit, b: Unit): boolean =>
  a.diving || wrapDelta(b.x, a.x) * a.facing > 0;

/** 1 when `b` is to the right of `a`; ties go by slot so two stacked units still part. */
function side(a: Unit, b: Unit): -1 | 1 {
  const d = wrapDelta(b.x, a.x);
  return d > 0 || (d === 0 && a.slot < b.slot) ? 1 : -1;
}

const capped = (value: number): number =>
  Math.max(-STUN_SPEED, Math.min(STUN_SPEED, value));

function stun(unit: Unit, regular: boolean): void {
  if (unit.stun === 0 || regular) unit.regular = regular;
  unit.stun = STUN_STEPS;
  unit.jumping = false;
  unit.jumpStep = 0;
  fold(unit);
}

/** Sword on sword: both attacks end, and both are thrown apart along the line between them. */
function glance(state: Round, arena: Arena, a: Unit, b: Unit): void {
  const dx = wrapDelta(b.x, a.x) || side(a, b),
    dy = centreY(b) - centreY(a);
  const reach = Math.max(Math.abs(dx), Math.abs(dy));
  const kx = capped(Math.trunc((KNOCK_SPEED * dx) / reach)),
    ky = capped(Math.trunc((KNOCK_SPEED * dy) / reach));
  for (const [unit, sign] of [
    [a, -1],
    [b, 1],
  ] as const) {
    sheathe(unit, arena);
    stun(unit, true);
    unit.vx = sign * kx;
    unit.vy = sign * ky;
  }
  state.events.push({ type: "glance", a: a.slot, b: b.slot, ...between(a, b) });
}

/** Where two units met, in whole art pixels: halfway between their middles. */
function between(a: Unit, b: Unit): { x: number; y: number } {
  return {
    x: Math.trunc(wrapX(a.x + Math.trunc(wrapDelta(b.x, a.x) / 2)) / S),
    y: Math.trunc((centreY(a) + centreY(b)) / (2 * S)),
  };
}

/** Body on body, side by side: both are stunned and thrown apart sideways. A dash ends; a dive goes on. */
function bump(state: Round, arena: Arena, a: Unit, b: Unit): void {
  const away = side(a, b);
  for (const [unit, sign] of [
    [a, -away],
    [b, away],
  ] as const) {
    endDash(unit, arena);
    stun(unit, false);
    unit.vx = sign * STUN_SPEED;
  }
  state.events.push({ type: "bounce", a: a.slot, b: b.slot, ...between(a, b) });
}

/**
 * What two touching bodies do: 1 for a bump, 2 when `a` lands on `b`'s head, 3 for the reverse, 0 for nothing (apart,
 * or already parting).
 */
function contact(a: Unit, b: Unit): 0 | 1 | 2 | 3 {
  const ca = colliderOf(a),
    cb = colliderOf(b);
  const dx = wrapDelta(b.x + cb.shift * b.facing, a.x + ca.shift * a.facing);
  if (Math.abs(dx) >= ca.half + cb.half) return 0;
  const aBottom = a.y - ca.lift,
    bBottom = b.y - cb.lift;
  const depth =
    Math.min(aBottom, bBottom) -
    Math.max(aBottom - ca.height, bBottom - cb.height);
  if (depth <= 0) return 0;
  if (depth < HEAD_OVERLAP) {
    if (aBottom < bBottom) return a.vy > b.vy ? 2 : 0;
    return b.vy > a.vy ? 3 : 0;
  }
  return (b.vx - a.vx) * side(a, b) < 0 ? 1 : 0;
}

/** `upper` lands on `lower`'s head and springs off: the closing speed is turned round fourfold, shared equally. */
function stomp(state: Round, upper: Unit, lower: Unit): void {
  const push = Math.trunc(((upper.vy - lower.vy) * (1 + HEAD_RESTITUTION)) / 2);
  upper.vy -= push;
  lower.vy += push;
  upper.jumping = false;
  upper.jumpStep = 0;
  state.events.push({
    type: "stomped",
    slot: lower.slot,
    by: upper.slot,
    x: Math.trunc(
      wrapX(lower.x + Math.trunc(wrapDelta(upper.x, lower.x) / 2)) / S,
    ),
    y: Math.trunc(upper.y / S),
  });
}

export function resolveCombat(state: Round): void {
  const arena = arenaOf(state.mapId);
  const units = state.units;
  const glances: [Unit, Unit][] = [],
    kills: [victim: Unit, killer: Unit][] = [],
    bodies: [Unit, Unit, 1 | 2 | 3][] = [];
  for (let i = 0; i < units.length; i += 1)
    for (let j = i + 1; j < units.length; j += 1) {
      const a = units[i]!,
        b = units[j]!;
      if (a.team === b.team || !exposed(a) || !exposed(b)) continue;
      const aArmed = lethal(a),
        bArmed = lethal(b);
      if (aArmed || bArmed) {
        const clear = !walled(arena, a, b);
        if (
          clear &&
          aArmed &&
          bArmed &&
          fronts(a, b) &&
          fronts(b, a) &&
          touch(a, weaponOf(a), b, weaponOf(b))
        ) {
          glances.push([a, b]);
          continue;
        }
        const aHits =
          clear &&
          aArmed &&
          fronts(a, b) &&
          touch(a, weaponOf(a), b, hitBoxesOf(b));
        const bHits =
          clear &&
          bArmed &&
          fronts(b, a) &&
          touch(b, weaponOf(b), a, hitBoxesOf(a));
        if (aHits) kills.push([b, a]);
        if (bHits) kills.push([a, b]);
        if (aHits || bHits) continue;
      }
      // A snail rider is carried: it neither bumps nor is bumped.
      if (a.riding || b.riding) continue;
      const kind = contact(a, b);
      if (kind !== 0) bodies.push([a, b, kind]);
    }
  for (const [a, b] of glances) glance(state, arena, a, b);
  for (const [victim, killer] of kills) killUnit(state, victim, killer.slot);
  for (const [a, b, kind] of bodies) {
    if (a.dead || b.dead) continue;
    if (kind === 1) bump(state, arena, a, b);
    else if (kind === 2) stomp(state, a, b);
    else stomp(state, b, a);
  }
}
