import { freshBarriers, type BarrierState } from "./gadgets.js";
import { BTN, isInput } from "./input.js";
import { MAP_IDS, mapOf, type MapDef } from "./maps.js";
import * as T from "./tuning.js";
import {
  PHASES,
  type Ball,
  type Bubble,
  type Rider,
  type Slot,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: flat tuples of integers (and the two rider ids) that MessagePack carries, and a
 * decoder that checks every one against the bounds and the consistency the simulation keeps. `decodeWorld` returns
 * a whole new world or nothing; it never changes what it was given and never returns a half-checked one.
 */
const VERSION = 2;
const RIDER_FIELDS = 14,
  BUBBLE_FIELDS = 5,
  BALL_FIELDS = 7,
  WORLD_FIELDS = 16,
  PACE_FIELDS = 4;

const int = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  !Object.is(value, -0) &&
  value >= low &&
  value <= high;
const side = (value: unknown): value is -1 | Slot =>
  value === -1 || value === 0 || value === 1;
const flag = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const tuple = (value: unknown, length: number): value is unknown[] =>
  Array.isArray(value) && value.length === length;
const counter = (value: unknown): value is number =>
  int(value, 0, T.COUNTER - 1);
/** A rider's id: the member or bot id the room seats, as an opaque short string. */
export const riderId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

/** Where a body of `radius` may be: anywhere on an axis that wraps, clear of the edge on one that does not. */
const inField = (x: number, y: number, radius: number, map: MapDef): boolean =>
  (map.wrapX ? int(x, 0, T.WORLD_W - 1) : int(x, radius, T.WORLD_W - radius)) &&
  (map.wrapY ? int(y, 0, T.WORLD_H - 1) : int(y, radius, T.WORLD_H - radius));

const encodeRider = (r: Rider): unknown[] => [
  r.id,
  r.x,
  r.y,
  r.vx,
  r.vy,
  r.facing,
  r.grounded ? 1 : 0,
  r.prev,
  r.slide,
  r.zapped ? 1 : 0,
  r.jumps,
  r.pops,
  r.goals,
  r.ownGoals,
];
const encodeBubble = (b: Bubble): unknown[] => [
  b.active ? 1 : 0,
  b.x,
  b.y,
  b.hard ? 1 : 0,
  b.seq,
];

export function encodeWorld(world: World): unknown[] {
  const { ball } = world;
  return [
    VERSION,
    MAP_IDS.indexOf(world.mapId),
    world.step,
    PHASES.indexOf(world.phase),
    world.phaseSteps,
    world.score[0],
    world.score[1],
    world.lastScorer,
    world.suddenDeath ? 1 : 0,
    encodeRider(world.riders[0]),
    encodeRider(world.riders[1]),
    encodeBubble(world.bubbles[0]),
    encodeBubble(world.bubbles[1]),
    [
      ball.x,
      ball.y,
      ball.vx,
      ball.vy,
      ball.live ? 1 : 0,
      ball.bounces,
      ball.touch,
    ],
    [world.speed, world.budget, world.linger, world.freeze],
    world.barriers.map((barrier) => [barrier.left, barrier.timer]),
  ];
}

function decodeRider(raw: unknown, slot: Slot, map: MapDef): Rider | undefined {
  if (!tuple(raw, RIDER_FIELDS)) return;
  const [
    id,
    x,
    y,
    vx,
    vy,
    facing,
    grounded,
    prev,
    slide,
    zapped,
    jumps,
    pops,
    goals,
    ownGoals,
  ] = raw;
  if (
    !riderId(id) ||
    !int(x, 0, T.WORLD_W - 1) ||
    !int(y, 0, T.WORLD_H - 1) ||
    !inField(x, y, T.RIDER_R, map) ||
    !int(vx, -T.MAX_VX, T.MAX_VX) ||
    !int(vy, -T.MAX_RISE, T.MAX_FALL) ||
    (facing !== 1 && facing !== -1) ||
    !flag(grounded) ||
    !isInput(prev) ||
    !int(slide, 0, T.SLIDE_STEPS) ||
    !flag(zapped) ||
    !counter(jumps) ||
    !counter(pops) ||
    !int(goals, 0, T.TARGET) ||
    !int(ownGoals, 0, T.TARGET)
  )
    return;
  return {
    id,
    slot,
    x,
    y,
    vx,
    vy,
    facing,
    grounded: grounded === 1,
    prev,
    slide,
    zapped: zapped === 1,
    jumps,
    pops,
    goals,
    ownGoals,
  };
}

function decodeBubble(raw: unknown): Bubble | undefined {
  if (!tuple(raw, BUBBLE_FIELDS)) return;
  const [active, x, y, hard, seq] = raw;
  if (
    !flag(active) ||
    !int(x, 0, T.WORLD_W - 1) ||
    !int(y, 0, T.WORLD_H - 1) ||
    !flag(hard) ||
    !counter(seq) ||
    (hard === 1 && active === 0)
  )
    return;
  return { active: active === 1, x, y, hard: hard === 1, seq };
}

function decodeBall(raw: unknown, map: MapDef): Ball | undefined {
  if (!tuple(raw, BALL_FIELDS)) return;
  const [x, y, vx, vy, live, bounces, touch] = raw;
  if (
    !int(x, 0, T.WORLD_W - 1) ||
    !int(y, 0, T.WORLD_H - 1) ||
    !inField(x, y, T.BALL_R, map) ||
    !int(vx, -T.BALL_MAX, T.BALL_MAX) ||
    !int(vy, -T.BALL_MAX, T.BALL_MAX) ||
    !flag(live) ||
    !counter(bounces) ||
    !side(touch)
  )
    return;
  return {
    x,
    y,
    vx,
    vy,
    live: live === 1,
    bounces,
    touch,
  };
}

/** One state per barrier of the map, in the map's order, each inside what its kind allows. */
function decodeBarriers(raw: unknown, map: MapDef): BarrierState[] | undefined {
  if (!tuple(raw, map.barriers.length)) return;
  const states: BarrierState[] = [];
  for (let i = 0; i < map.barriers.length; i++) {
    const barrier = map.barriers[i]!,
      each = raw[i];
    if (!tuple(each, 2)) return;
    const [left, timer] = each;
    if (
      !int(left, 0, barrier.kind === "field" ? barrier.hits : 0) ||
      !int(
        timer,
        0,
        barrier.kind === "field" ? T.FIELD_COOL_STEPS : T.GATE_OPEN_STEPS,
      )
    )
      return;
    // A field that has never been struck is not cooling off.
    if (barrier.kind === "field" && left === barrier.hits && timer !== 0)
      return;
    states.push({ left, timer });
  }
  return states;
}

/** The checks that tie fields together: a world no sequence of steps could reach is refused. */
function consistent(world: World): boolean {
  const { phase, phaseSteps, score, lastScorer, riders, bubbles, ball } = world,
    [a, b] = riders,
    total = score[0] + score[1],
    won = score[0] === T.TARGET || score[1] === T.TARGET,
    scored = phase === "zap" || phase === "over";
  if (a.id === b.id) return false;
  // The pace: stopped exactly while a goal's freeze lasts, a quarter speed for the rest of the zap, slowed only in
  // play, and never so slow that a log tick would run no step.
  const { speed, budget, linger, freeze } = world;
  if (freeze > 0 ? phase !== "zap" || speed !== 0 : speed < T.MIN_SPEED)
    return false;
  if (phase === "zap" && freeze === 0 && speed !== T.ZAP_SPEED) return false;
  if (phase === "zap" && freeze > 0 && phaseSteps !== T.ZAP_STEPS) return false;
  if (phase !== "play" && (linger !== 0 || (phase !== "zap" && budget !== 0)))
    return false;
  if ((phase === "countdown" || phase === "over") && speed !== T.SPEED_FULL)
    return false;
  if (phase === "play" && speed < T.CLOUD_SPEED_CORE) return false;
  if (freeze > 0 && budget !== 0) return false;
  // Every point starts its barriers afresh: in a countdown no field is worn and no gate is open.
  if (phase === "countdown") {
    const fresh = freshBarriers(mapOf(world.mapId));
    if (
      world.barriers.some(
        (barrier, i) => barrier.timer !== 0 || barrier.left !== fresh[i]?.left,
      )
    )
      return false;
  }
  // Timers: a countdown or a zap is always running down, and nothing else has one.
  if (phase === "countdown" && !int(phaseSteps, 1, T.COUNTDOWN_STEPS))
    return false;
  if (phase === "zap" && !int(phaseSteps, 1, T.ZAP_STEPS)) return false;
  if ((phase === "play" || phase === "over") && phaseSteps !== 0) return false;
  // The score: one winner at most, the match over exactly when a zap has run out on a winning point.
  if (score[0] === T.TARGET && score[1] === T.TARGET) return false;
  if (phase === "over" ? !won : won && phase !== "zap") return false;
  if (lastScorer === -1 ? total !== 0 : score[lastScorer] === 0) return false;
  if (scored && lastScorer === -1) return false;
  if (
    world.suddenDeath !== (score[0] >= T.TARGET - 1 && score[1] >= T.TARGET - 1)
  )
    return false;
  // Every point is somebody's goal or the other rider's own goal.
  if (a.goals + b.ownGoals !== score[0] || b.goals + a.ownGoals !== score[1])
    return false;
  // Only the rider the last point went against is zapped, from the goal until the next point.
  for (const rider of riders) {
    const struck = scored && rider.slot !== lastScorer;
    if (rider.zapped !== struck) return false;
    if (rider.zapped && (rider.vx !== 0 || rider.vy !== 0 || rider.slide !== 0))
      return false;
  }
  if (ball.live === scored) return false;
  if (!ball.live && (ball.vx !== 0 || ball.vy !== 0)) return false;
  // A bubble is hard only while its owner holds the button; there are none during a countdown.
  for (const slot of [0, 1] as const) {
    const bubble = bubbles[slot];
    if (bubble.hard && !(riders[slot].prev & BTN)) return false;
    if (bubble.active && phase === "countdown") return false;
  }
  return true;
}

export function decodeWorld(raw: unknown): World | undefined {
  if (!tuple(raw, WORLD_FIELDS)) return;
  const [
    version,
    mapIndex,
    step,
    phaseIndex,
    phaseSteps,
    score0,
    score1,
    lastScorer,
    suddenDeath,
    riderA,
    riderB,
    bubbleA,
    bubbleB,
    rawBall,
    rawPace,
    rawBarriers,
  ] = raw;
  if (
    version !== VERSION ||
    !int(mapIndex, 0, MAP_IDS.length - 1) ||
    !int(step, 0, T.MAX_STEP) ||
    !int(phaseIndex, 0, PHASES.length - 1) ||
    !int(phaseSteps, 0, T.MAX_STEP) ||
    !int(score0, 0, T.TARGET) ||
    !int(score1, 0, T.TARGET) ||
    !side(lastScorer) ||
    !flag(suddenDeath) ||
    !tuple(rawPace, PACE_FIELDS)
  )
    return;
  const [speed, budget, linger, freeze] = rawPace;
  if (
    !int(speed, 0, T.SPEED_FULL) ||
    !int(budget, 0, T.SPEED_FULL - 1) ||
    !int(linger, 0, T.SLOW_HOLD_TICKS) ||
    !int(freeze, 0, T.GOAL_FREEZE_STEPS)
  )
    return;
  const mapId = MAP_IDS[mapIndex],
    phase = PHASES[phaseIndex];
  if (!mapId || !phase) return;
  const map = mapOf(mapId),
    a = decodeRider(riderA, 0, map),
    b = decodeRider(riderB, 1, map),
    bubble0 = decodeBubble(bubbleA),
    bubble1 = decodeBubble(bubbleB),
    ball = decodeBall(rawBall, map),
    barriers = decodeBarriers(rawBarriers, map);
  if (!a || !b || !bubble0 || !bubble1 || !ball || !barriers) return;
  const world: World = {
    mapId,
    step,
    phase,
    phaseSteps,
    score: [score0, score1],
    lastScorer,
    suddenDeath: suddenDeath === 1,
    speed,
    budget,
    linger,
    freeze,
    riders: [a, b],
    bubbles: [bubble0, bubble1],
    ball,
    barriers,
  };
  return consistent(world) ? world : undefined;
}
