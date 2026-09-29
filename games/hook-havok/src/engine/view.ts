import {
  BALL_RADII,
  BODY,
  HALF,
  S,
  ballField,
  type Tuning,
  type World,
} from "./world.js";
import { MAPS, type MapId, type Platform } from "./maps.js";
import {
  bonusLive,
  floorTop,
  laserPhase,
  risen,
  type LaserPhase,
} from "./zones.js";
import {
  BONUS,
  LASER_LIVE,
  LASER_PERIOD,
  LASER_TELEGRAPH,
  RISE_TICKS,
  RISE_WARNING,
} from "./zone-rules.js";
import { activeWire } from "./wire-contact.js";
import { bombArc } from "./bomb.js";
import {
  BLAST_RADIUS,
  BOMB_RADIUS,
  CHARGE_TICKS,
  COOLDOWN_TICKS,
  FUSE_TICKS,
} from "./bomb-rules.js";
import {
  createContest,
  COUNTDOWN_TICKS,
  ROUND_TICKS,
  type Contest,
} from "./contest.js";
export interface BombView {
  id: number;
  owner: string;
  x: number;
  y: number;
  /** Units per second. */
  vx: number;
  vy: number;
  /** Ticks left on the fuse. */
  fuse: number;
}
export interface BlastView {
  tick: number;
  id: number;
  owner: string;
  x: number;
  y: number;
}
export interface KnockoutView {
  tick: number;
  /** The thrower or credited pusher; "" when a hazard credits nobody. */
  by: string;
  target: string;
  x: number;
  y: number;
  cause: "bomb" | "hazard";
}
/** Bomb rule values presentation draws, in world units and ticks. */
export const BOMB_VIEW = {
  radius: BOMB_RADIUS,
  blast: BLAST_RADIUS,
  fuse: FUSE_TICKS,
  cooldown: COOLDOWN_TICKS,
} as const;
/** A laser gate as drawn: its start and end lines, phase and progress 0–1. */
export interface LaserView {
  axis: "h" | "v";
  from: readonly [number, number, number, number];
  to: readonly [number, number, number, number];
  phase: LaserPhase;
  progress: number;
}
/** The zones in force (12B), in world units; a switched-off zone is absent. */
export interface ZonesView {
  /** Pad tops: x, y, width. */
  pads: readonly (readonly [number, number, number])[];
  lifts: readonly Platform[];
  lowGravity: readonly Platform[];
  floor: {
    y: number;
    base: number;
    cap: number;
    rising: boolean;
    /** Whole seconds until the floor starts rising, while warning; else 0. */
    warning: number;
  } | null;
  lasers: LaserView[];
  bonus: Platform | null;
  /** What a gain inside the bonus counts for in these rules. */
  multiplier: number;
}
export function zoneView(
  t: Tuning,
  tick: number,
  contest: Pick<Contest, "phase" | "elapsed">,
): ZonesView {
  const z = MAPS[t.map].zones,
    top = floorTop(t, contest),
    rise = risen(t, contest),
    ahead = ROUND_TICKS - RISE_TICKS - contest.elapsed;
  return {
    pads: t.jumpPads === "on" ? z.pads : [],
    lifts: t.lifts === "on" ? z.lifts : [],
    lowGravity: t.lowGravity === "on" ? z.lowGravity : [],
    floor:
      z.floor && top !== undefined
        ? {
            y: top / S,
            ...z.floor,
            rising: rise > 0 && rise < RISE_TICKS,
            warning:
              t.rules !== "free" &&
              contest.phase === "active" &&
              ahead > 0 &&
              ahead <= RISE_WARNING
                ? Math.ceil(ahead / 60)
                : 0,
          }
        : null,
    lasers:
      t.lasers === "on"
        ? z.lasers.map((l) => {
            const { phase, at } = laserPhase(l, tick),
              h = l.axis === "h";
            const line = (d: number) =>
              (h
                ? [l.x, l.y + d, l.x + l.length, l.y + d]
                : [l.x + d, l.y, l.x + d, l.y + l.length]) as [
                number,
                number,
                number,
                number,
              ];
            return {
              axis: l.axis,
              from: line(0),
              to: line(l.travel),
              phase,
              progress:
                phase === "telegraph"
                  ? at / LASER_TELEGRAPH
                  : phase === "live"
                    ? (at + 1) / LASER_LIVE
                    : at / (LASER_PERIOD - LASER_TELEGRAPH - LASER_LIVE),
            };
          })
        : [],
    bonus: t.bonusZone === "on" ? z.bonus : null,
    multiplier: bonusLive(t) ? BONUS : 1,
  };
}
export interface WorldView {
  /** World size in units (12A). */
  size: { width: number; height: number };
  /** Indices into `platforms` that are solid to keepers from every side. */
  solid: readonly number[];
  zones: ZonesView;
  bombMode: World["tuning"]["bomb"];
  /** Charge held by this keeper, 0–1 (full at 0.6 s). */
  charge: number;
  gravity: number;
  bombs: BombView[];
  blasts: BlastView[];
  knockouts: KnockoutView[];
  pickups: { kind: "lift" | "ward"; x: number; y: number; cooldown: number }[];
  pickupEvents: {
    tick: number;
    by: string;
    kind: "lift" | "ward";
    x: number;
    y: number;
  }[];
  airJump: boolean;
  doubleJump: boolean;
  spikedWire: boolean;
  wire: { x: number; y: number; endX: number; endY: number } | null;
  map: MapId;
  contest: Contest & { rules: World["tuning"]["rules"]; seconds: number };
  keepers: KeeperView[];
  hit: {
    tick: number;
    by: string;
    target: string;
    x: number;
    y: number;
  } | null;
  localId?: string;
  experiment: World["tuning"]["experiment"];
  combat: {
    target: { x: number; feet: number; respawn: number } | null;
    balls: {
      id: number;
      x: number;
      y: number;
      radius: number;
      vx: number;
      vy: number;
    }[];
    field: readonly [number, number, number, number];
    hits: number;
    falls: number;
    impact: { tick: number; x: number; y: number };
  };
  tick: number;
  x: number;
  feet: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: -1 | 1;
  respawn: number;
  deaths: number;
  /** rope: attached rope length in world units, 0 otherwise. */
  hook: {
    phase: World["hook"]["phase"];
    x: number;
    y: number;
    rope: number;
  };
  /** Hook range in world units. */
  range: number;
  platforms: readonly (readonly [number, number, number, number])[];
  body: { half: number; height: number };
  aim: { x: number; y: number };
}
export interface KeeperView {
  /** Bomb cooldown remaining, 0–1. */
  cooldown: number;
  tally: {
    thrown: number;
    knockouts: number;
    selfKnockouts: number;
    bombed: number;
    /** Times knocked out by a hazard. */
    zapped: number;
    falls: number;
    fate: "" | "fall" | "bomb" | "self" | "hazard";
    by: string;
  };
  ward: number;
  playing: boolean;
  id: string;
  slot: number;
  name: string;
  connected: boolean;
  shield: number;
  hits: number;
  body: WorldView;
}
export function toView(world: World): WorldView {
  const wire = activeWire(world),
    map = MAPS[world.tuning.map];
  return {
    size: { width: map.width, height: map.height },
    solid: map.solid,
    zones: zoneView(
      world.tuning,
      world.tick,
      createContest(world.tuning.rules),
    ),
    bombMode: world.tuning.bomb,
    charge: world.charge / CHARGE_TICKS,
    gravity: world.tuning.gravity,
    bombs: [],
    blasts: [],
    knockouts: [],
    pickups: [],
    pickupEvents: [],
    wire: wire
      ? {
          x: wire.x / S,
          y: wire.y / S,
          endX: wire.endX / S,
          endY: wire.endY / S,
        }
      : null,
    airJump: world.airJump,
    doubleJump: world.tuning.jumpMode === "double",
    spikedWire: world.tuning.wire === "spiked",
    map: world.tuning.map,
    contest: {
      ...createContest(world.tuning.rules),
      rules: world.tuning.rules,
      seconds: 0,
    },
    keepers: [],
    hit: null,
    experiment: world.tuning.experiment,
    combat: {
      target: world.combat.target
        ? {
            x: world.combat.target.x / S,
            feet: world.combat.target.feet / S,
            respawn: world.combat.target.respawn,
          }
        : null,
      balls: world.combat.balls.map((b) => ({
        id: b.id,
        x: b.x / S,
        y: b.y / S,
        radius: BALL_RADII[b.tier]!,
        vx: b.vx / S,
        vy: b.vy / S,
      })),
      field: ballField(world.tuning.experiment, world.tuning.map),
      hits: world.combat.hits,
      falls: world.combat.falls,
      impact: {
        tick: world.combat.impact.tick,
        x: world.combat.impact.x / S,
        y: world.combat.impact.y / S,
      },
    },
    tick: world.tick,
    x: world.x / S,
    feet: world.feet / S,
    vx: (world.vx * 60) / S,
    vy: (world.vy * 60) / S,
    grounded: world.grounded,
    facing: world.facing,
    respawn: world.respawn,
    deaths: world.deaths,
    hook: {
      phase: world.hook.phase,
      x: world.hook.x / S,
      y: world.hook.y / S,
      rope: world.hook.phase === "attached" ? world.hook.distance / S : 0,
    },
    range: world.tuning.range,
    platforms: MAPS[world.tuning.map].platforms,
    body: { half: HALF / S, height: BODY / S },
    aim: { x: world.input.aimX, y: world.input.aimY },
  };
}
export function contestView(
  contest: Contest,
  rules: World["tuning"]["rules"],
): WorldView["contest"] {
  return {
    ...structuredClone(contest),
    rules,
    seconds: Math.ceil(
      Math.max(
        0,
        (contest.phase === "countdown" ? COUNTDOWN_TICKS : ROUND_TICKS) -
          contest.elapsed,
      ) / 60,
    ),
  };
}
/** Local presentation: where releasing now would send this keeper's bomb. */
export function throwPreview(
  view: WorldView,
  aim: { x: number; y: number },
): { x: number; y: number }[] {
  if (!view.charge || view.respawn || view.bombMode === "off") return [];
  return bombArc(
    Math.round(view.charge * CHARGE_TICKS),
    view.x,
    view.feet - view.body.height * 0.6,
    view.vx,
    view.vy,
    Math.round(aim.x),
    Math.round(aim.y),
    view.facing,
    view.gravity,
    {
      map: view.map,
      lifts: view.zones.lifts.length ? "on" : "off",
      lowGravity: view.zones.lowGravity.length ? "on" : "off",
    },
  );
}
