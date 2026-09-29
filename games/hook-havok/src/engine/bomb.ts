import type { Arena, Keeper } from "./arena.js";
import { sweep } from "./collision.js";
import { splitBall } from "./combat.js";
import { MAPS, type MapId, type Platform } from "./maps.js";
import {
  BALL_RADII,
  BODY,
  HALF,
  HEIGHT,
  S,
  WIDTH,
  cancel,
  readyHook,
  type World,
} from "./world.js";
import {
  BLAST_RADIUS,
  BOMB_CEILING,
  BOMB_FLOOR,
  BOMB_RADIUS,
  BOUNCE_FRICTION,
  CARRY,
  CHAIN_TICKS,
  CHARGE_TICKS,
  COOLDOWN_TICKS,
  EVENT_TICKS,
  FULL_SPEED,
  FUSE_TICKS,
  KO_RESPAWN,
  MAX_BOMBS,
  MAX_BOMB_SPEED,
  MAX_EVENTS,
  REST_SPEED,
  RESTITUTION,
  ROLL_FRICTION,
  STILL_SPEED,
  TAP_SPEED,
} from "./bomb-rules.js";

/** A live bomb. Position is its centre; velocity is subunits per tick. */
export interface Bomb {
  /** Throw tick × 8 + thrower slot: unique and ascending in throw order. */
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks left; a blast nearby shortens it to CHAIN_TICKS. */
  fuse: number;
}
export interface Blast {
  tick: number;
  id: number;
  owner: string;
  x: number;
  y: number;
}
export interface Knockout {
  tick: number;
  by: string;
  target: string;
  /** The victim's chest where the blast caught them. */
  x: number;
  y: number;
}
/** Per keeper supply and round tally; `fate` is how they last went down. */
export interface BombKit {
  cooldown: number;
  thrown: number;
  knockouts: number;
  selfKnockouts: number;
  bombed: number;
  fate: "" | "fall" | "bomb" | "self";
  /** The rival whose bomb it was when fate is "bomb", otherwise "". */
  by: string;
}
export function freshKit(): BombKit {
  return {
    cooldown: 0,
    thrown: 0,
    knockouts: 0,
    selfKnockouts: 0,
    bombed: 0,
    fate: "",
    by: "",
  };
}
const saturate = (n: number) => Math.min(0xffffffff, n + 1);
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
/**
 * Launch velocity toward an absolute aim point, before any clamping by
 * flight. A tap throws at TAP_SPEED, a full charge at FULL_SPEED, plus CARRY
 * of the keeper's velocity. Aim on the chest lobs forward at 45°. Subunits;
 * only +, −, ×, ÷ and sqrt, so every peer rounds identically.
 */
export function bombLaunch(
  charge: number,
  sx: number,
  sy: number,
  vx: number,
  vy: number,
  aimX: number,
  aimY: number,
  facing: -1 | 1,
): { vx: number; vy: number } {
  const t = clamp((charge - 1) / (CHARGE_TICKS - 1), 0, 1);
  const speed = ((TAP_SPEED + (FULL_SPEED - TAP_SPEED) * t) * S) / 60;
  let dx = aimX * S - sx,
    dy = aimY * S - sy,
    d = Math.sqrt(dx * dx + dy * dy);
  if (d < S) {
    dx = facing;
    dy = -1;
    d = Math.SQRT2;
  }
  const cap = MAX_BOMB_SPEED * S;
  return {
    vx: clamp(Math.round((dx / d) * speed + vx * CARRY), -cap, cap),
    vy: clamp(Math.round((dy / d) * speed + vy * CARRY), -cap, cap),
  };
}
const solidCache = new Map<MapId, Platform[]>();
/** Ledges are solid to bombs from every side, like orbs; walls and a far ceiling bound them. */
function solids(map: MapId): Platform[] {
  let list = solidCache.get(map);
  if (!list) {
    const r = BOMB_RADIUS;
    list = [
      ...MAPS[map].platforms,
      [-100, BOMB_CEILING - 100, 100, 5000],
      [WIDTH, BOMB_CEILING - 100, 100, 5000],
      [-100, BOMB_CEILING - 100, WIDTH + 200, 100],
    ].map(
      ([x, y, w, h]) => [x! - r, y! - r, w! + 2 * r, h! + 2 * r] as Platform,
    );
    solidCache.set(map, list);
  }
  return list;
}
/** Gravity, then up to four contacts: bounce, friction, roll and rest. */
function fly(bomb: Bomb, gravity: number, map: MapId): void {
  const cap = MAX_BOMB_SPEED * S;
  bomb.vy = Math.min(cap, bomb.vy + gravity);
  let remaining = 1;
  for (let i = 0; i < 4 && remaining > 0; i++) {
    const dx = Math.round(bomb.vx * remaining),
      dy = Math.round(bomb.vy * remaining);
    if (!dx && !dy) break;
    const hit = sweep(bomb.x, bomb.y, dx, dy, false, solids(map));
    if (!hit) {
      bomb.x += dx;
      bomb.y += dy;
      break;
    }
    bomb.x += Math.round(dx * hit.time) + hit.nx;
    bomb.y += Math.round(dy * hit.time) + hit.ny;
    if (hit.nx) bomb.vx = -Math.round(bomb.vx * RESTITUTION);
    else if (hit.ny < 0) {
      const up = Math.round(bomb.vy * RESTITUTION),
        bouncing = up > REST_SPEED * S;
      bomb.vy = bouncing ? -up : 0;
      bomb.vx = Math.round(
        bomb.vx * (bouncing ? BOUNCE_FRICTION : ROLL_FRICTION),
      );
      if (Math.abs(bomb.vx) < STILL_SPEED * S) bomb.vx = 0;
    } else bomb.vy = -Math.round(bomb.vy * RESTITUTION);
    remaining *= 1 - hit.time;
  }
}
/** Circle against a keeper's body box. */
function touches(w: World, x: number, y: number, r: number): boolean {
  const dx = x - clamp(x, w.x - HALF, w.x + HALF),
    dy = y - clamp(y, w.feet - BODY, w.feet);
  return dx * dx + dy * dy <= r * r;
}
function knockout(arena: Arena, victim: Keeper, by: string): void {
  const w = victim.world,
    self = victim.id === by;
  arena.knockouts.push({
    tick: arena.tick,
    by,
    target: victim.id,
    x: w.x,
    y: w.feet - BODY / 2,
  });
  // Like a fall the body leaves below the arena, so every respawn invariant holds.
  Object.assign(w, {
    respawn: KO_RESPAWN,
    deaths: saturate(w.deaths),
    feet: HEIGHT * S + BODY + S,
    vx: 0,
    vy: 0,
    buffer: 0,
    coyote: 0,
    grounded: false,
    airJump: false,
    charge: 0,
    hook: readyHook(),
  });
  victim.ward = 0;
  const kit = victim.bomb,
    thrower = arena.keepers.find((k) => k.id === by);
  if (self) kit.selfKnockouts = saturate(kit.selfKnockouts);
  else {
    kit.bombed = saturate(kit.bombed);
    if (thrower) thrower.bomb.knockouts = saturate(thrower.bomb.knockouts);
  }
  kit.fate = self ? "self" : "bomb";
  kit.by = self ? "" : by;
  const c = arena.contest;
  if (arena.tuning.rules === "free" || c.phase !== "active") return;
  const entry = c.entries.find((e) => e.id === victim.id);
  if (!entry) return;
  if (arena.tuning.rules === "elimination") {
    entry.out = true;
    cancel(w);
    return;
  }
  // The victim's usual death penalty; the thrower +1, or −1 for their own bomb.
  entry.score -= 2;
  const scorer = c.entries.find((e) => e.id === by);
  if (scorer) scorer.score += self ? -1 : 1;
}
function detonate(
  arena: Arena,
  bomb: Bomb,
  canPlay: (k: Keeper) => boolean,
  fresh: Set<number>,
): void {
  arena.blasts.push({
    tick: arena.tick,
    id: bomb.id,
    owner: bomb.owner,
    x: bomb.x,
    y: bomb.y,
  });
  const r = BLAST_RADIUS * S;
  // Stable slot order; a keeper already down this tick is not knocked out twice.
  for (const k of arena.keepers)
    if (
      canPlay(k) &&
      !k.world.respawn &&
      !k.shield &&
      touches(k.world, bomb.x, bomb.y, r)
    )
      knockout(arena, k, bomb.owner);
  const holder = arena.keepers[0]?.world,
    c = arena.combat;
  if (holder)
    for (const ball of [...c.balls]) {
      // Children from an earlier blast this tick wait for the next one.
      if (fresh.has(ball.id)) continue;
      const reach = r + BALL_RADII[ball.tier]! * S,
        dx = ball.x - bomb.x,
        dy = ball.y - bomb.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      c.hits = saturate(c.hits);
      c.impact = { tick: arena.tick, x: ball.x, y: ball.y };
      holder.combat = c;
      splitBall(holder, ball);
      for (const child of c.balls)
        if (child.id >> 1 === ball.id) fresh.add(child.id);
    }
  const chain = r + BOMB_RADIUS * S;
  for (const other of arena.bombs) {
    const dx = other.x - bomb.x,
      dy = other.y - bomb.y;
    if (other.fuse > 0 && dx * dx + dy * dy <= chain * chain)
      other.fuse = Math.min(other.fuse, CHAIN_TICKS);
  }
}
/**
 * Runs after keepers move, hooks hit and orbs step. Live bombs fly and burn
 * first, blasts resolve in bomb id order, then keepers in slot order charge
 * and throw, so a keeper knocked out this tick throws nothing and a new bomb
 * first moves next tick.
 */
export function stepBombs(arena: Arena, canPlay: (k: Keeper) => boolean): void {
  const tuning = arena.tuning;
  if (tuning.bomb === "off") return;
  const gravity = Math.round((tuning.gravity * S) / 3600);
  for (const bomb of arena.bombs) {
    fly(bomb, gravity, tuning.map);
    bomb.fuse--;
  }
  // Out of the bottom of the arena: it fizzles.
  arena.bombs = arena.bombs.filter((b) => b.y <= BOMB_FLOOR * S);
  if (tuning.bomb === "impact")
    for (const bomb of arena.bombs)
      if (
        arena.keepers.some(
          (k) =>
            k.id !== bomb.owner &&
            canPlay(k) &&
            !k.world.respawn &&
            touches(k.world, bomb.x, bomb.y, BOMB_RADIUS * S),
        )
      )
        bomb.fuse = 0;
  const fresh = new Set<number>();
  for (const bomb of arena.bombs.filter((b) => b.fuse <= 0))
    detonate(arena, bomb, canPlay, fresh);
  arena.bombs = arena.bombs.filter((b) => b.fuse > 0);
  for (const keeper of arena.keepers) {
    if (!canPlay(keeper)) continue;
    const kit = keeper.bomb,
      w = keeper.world;
    kit.cooldown = Math.max(0, kit.cooldown - 1);
    if (w.respawn) {
      w.charge = 0;
      continue;
    }
    if (w.input.bomb) {
      // Holding through the end of a cooldown starts the charge then.
      if (!kit.cooldown) w.charge = Math.min(CHARGE_TICKS, w.charge + 1);
      continue;
    }
    if (!w.charge) continue;
    const charge = w.charge;
    w.charge = 0;
    if (
      arena.bombs.length >= MAX_BOMBS ||
      arena.bombs.some((b) => b.owner === keeper.id)
    )
      continue;
    const sx = w.x,
      sy = w.feet - Math.round(BODY * 0.6),
      v = bombLaunch(
        charge,
        sx,
        sy,
        w.vx,
        w.vy,
        w.input.aimX,
        w.input.aimY,
        w.facing,
      );
    arena.bombs.push({
      id: arena.tick * 8 + keeper.slot,
      owner: keeper.id,
      x: sx,
      y: sy,
      vx: v.vx,
      vy: v.vy,
      fuse: FUSE_TICKS,
    });
    kit.cooldown = COOLDOWN_TICKS;
    kit.thrown = saturate(kit.thrown);
  }
  arena.blasts = arena.blasts.slice(-MAX_EVENTS);
  arena.knockouts = arena.knockouts.slice(-MAX_EVENTS);
}
/** Drop presentation events once they are EVENT_TICKS old. */
export function pruneBombEvents(arena: Arena): void {
  const fresh = (e: { tick: number }) => arena.tick - e.tick < EVENT_TICKS;
  if (!arena.blasts.every(fresh)) arena.blasts = arena.blasts.filter(fresh);
  if (!arena.knockouts.every(fresh))
    arena.knockouts = arena.knockouts.filter(fresh);
}
/**
 * Presentation preview of the throw a release would make now: the same launch
 * and gravity, sampled every other tick until it meets stone, leaves the arena
 * or the fuse would end. Bounces are not predicted. World units.
 */
export function bombArc(
  charge: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  aimX: number,
  aimY: number,
  facing: -1 | 1,
  gravity: number,
  map: MapId,
): { x: number; y: number }[] {
  const v = bombLaunch(
    charge,
    Math.round(x * S),
    Math.round(y * S),
    Math.round((vx * S) / 60),
    Math.round((vy * S) / 60),
    aimX,
    aimY,
    facing,
  );
  let px = x * S,
    py = y * S,
    dx = v.vx,
    dy = v.vy;
  const g = Math.round((gravity * S) / 3600),
    cap = MAX_BOMB_SPEED * S,
    points: { x: number; y: number }[] = [];
  for (let t = 0; t < FUSE_TICKS && py <= BOMB_FLOOR * S; t++) {
    dy = Math.min(cap, dy + g);
    const hit = sweep(px, py, dx, dy, false, solids(map));
    if (hit) {
      points.push({ x: (px + dx * hit.time) / S, y: (py + dy * hit.time) / S });
      break;
    }
    px += dx;
    py += dy;
    if (t % 2) points.push({ x: px / S, y: py / S });
  }
  return points;
}
