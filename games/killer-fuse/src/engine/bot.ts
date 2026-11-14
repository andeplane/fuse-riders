/**
 * Bots. A bot is a pure function of (round state, slot): it reads what a player could see, keeps its memory in the
 * state (`BotMind`), and returns the same `Input` a person's controller would. It gets no privileged physics. The
 * levels differ in reaction delay (how often a bot re-decides and re-reads its target's position), aim error, flap
 * precision, blunders and decision quality, never in what the rules let them do.
 */
import { gateOpenTo } from "./gates.js";
import { arenaOf, wrapDelta, wrapX, type Arena } from "./maps.js";
import { NEUTRAL, heightOf } from "./motion.js";
import {
  JUMP_NONE,
  LAUNCH_SLACK,
  UNREACHABLE,
  edgeInput,
  flyToward,
  nextEdge,
  platformAt,
  platformBelow,
  standable,
  workerNav,
  type Spot,
  type WorkerNav,
} from "./nav.js";
import { chance, randInt, randSpread } from "./rng.js";
import { goalDir } from "./snail.js";
import {
  FLAP_THRUST,
  FLY_GRAVITY,
  FLY_GRAVITY_LIGHT,
  FLY_MAX_RISE,
  MOUTH_REACH,
  QUEEN_EGGS,
  RUN_SPEED,
  S,
  SNAIL_HALF,
} from "./tuning.js";
import type { BotLevel, BotMind, Input, Round, Unit } from "./types.js";
import { centreY, duelY, isMilitary, isQueenSlot } from "./units.js";

export interface LevelRules {
  /** Steps between decisions: the reaction delay. A bot steers at where its target was when it last looked. */
  think: number;
  /** Largest error, in pixels, on the point a bot aims for. */
  aimError: number;
  /**
   * Fewest steps between two flaps, and the random extra on top: flap precision. No level presses faster than a
   * person comfortably can: 6 a second on hard, 5 on medium, 4 on easy.
   */
  flapMin: number;
  flapJitter: number;
  /** Chance, in percent per decision, of freezing for `idleSteps`. */
  blunder: number;
  idleSteps: number;
  /** How far, in pixels, a bot notices a threat. */
  awareness: number;
  /** Chance, in percent, that a decision is the considered one rather than "charge the nearest enemy". */
  smart: number;
  /** Steps of the target's motion a hunter leads by. */
  lead: number;
  /** How far, in pixels, a Worker starts running from a military unit; 0 never runs. */
  flee: number;
  /** Chance, in percent, that a team's first Worker plans to become a Warrior, and its second to ride the snail. */
  soldier: number;
  rider: number;
}

export const BOT_LEVEL_ORDER: readonly BotLevel[] = ["easy", "medium", "hard"];
export const BOT_LEVELS: Readonly<Record<BotLevel, LevelRules>> = {
  easy: {
    think: 38,
    aimError: 14,
    flapMin: 15,
    flapJitter: 5,
    blunder: 14,
    idleSteps: 45,
    awareness: 20,
    smart: 65,
    lead: 0,
    flee: 0,
    soldier: 50,
    rider: 40,
  },
  medium: {
    think: 16,
    aimError: 6,
    flapMin: 12,
    flapJitter: 3,
    blunder: 3,
    idleSteps: 24,
    awareness: 36,
    smart: 75,
    lead: 4,
    flee: 70,
    soldier: 70,
    rider: 40,
  },
  hard: {
    think: 6,
    aimError: 2,
    flapMin: 10,
    flapJitter: 0,
    blunder: 0,
    idleSteps: 0,
    awareness: 50,
    smart: 96,
    lead: 8,
    flee: 70,
    soldier: 80,
    rider: 40,
  },
};

const FLYER_GOALS: readonly BotMind["goal"][] = [
  "hunt",
  "claim",
  "evade",
  "guard",
];

const levelOf = (state: Round, unit: Unit): LevelRules =>
  BOT_LEVELS[state.teamLevels[unit.team] ?? state.botLevel];

/** A fresh mind for `slot`, with this round's plan drawn from the round's own random stream. */
export function newMind(state: Round, slot: number): BotMind {
  const level = BOT_LEVELS[state.teamLevels[slot % 2] ?? state.botLevel];
  const first = slot === 2 || slot === 3;
  return {
    think: 1 + randInt(state, 8),
    goal: "idle",
    target: -1,
    tx: 0,
    ty: 0,
    node: -1,
    edge: -1,
    edgeStep: 0,
    flapWait: 0,
    idle: 0,
    dive: false,
    soldier: !isQueenSlot(slot) && first && chance(state, level.soldier),
    rider: !isQueenSlot(slot) && !first && chance(state, level.rider),
  };
}

const sign = (value: number): -1 | 0 | 1 =>
  value > 0 ? 1 : value < 0 ? -1 : 0;
const go = (dir: number, pressed = false, held = pressed): Input => ({
  left: dir < 0,
  right: dir > 0,
  down: false,
  held,
  pressed,
});

/** Straight-line distance stand-in that needs no square root: the longer side plus half the shorter. */
function reach(dx: number, dy: number): number {
  const ax = Math.abs(dx),
    ay = Math.abs(dy);
  return ax > ay ? ax + Math.trunc(ay / 2) : ay + Math.trunc(ax / 2);
}
const distance = (a: Unit, b: Unit): number =>
  reach(wrapDelta(b.x, a.x), centreY(b) - centreY(a));

const enemiesOf = (state: Round, unit: Unit): Unit[] =>
  state.units.filter((other) => !other.dead && other.team !== unit.team);

function nearest(
  from: Unit,
  units: readonly Unit[],
  cost: (unit: Unit) => number = () => 0,
): Unit | undefined {
  let best: Unit | undefined,
    bestCost = UNREACHABLE * S;
  for (const unit of units) {
    const total = distance(from, unit) + cost(unit);
    if (total < bestCost) {
      best = unit;
      bestCost = total;
    }
  }
  return best;
}

// --- Workers --------------------------------------------------------------------------------------------------------

/** Steps a Worker needs from where it is to a point on platform `node`, by the nav graph. */
function travel(state: Round, unit: Unit, node: number, x: number): number {
  const arena = arenaOf(state.mapId);
  const from =
    unit.ground >= 0 ? unit.ground : platformBelow(arena, unit.x, unit.y);
  if (from < 0 || node < 0) return UNREACHABLE;
  return (
    workerNav(state.mapId, unit.speed).dist[from]![node]! +
    Math.trunc(Math.abs(wrapDelta(x, unit.x)) / RUN_SPEED)
  );
}

function aimWorker(
  mind: BotMind,
  goal: BotMind["goal"],
  target: number,
  node: number,
  x: number,
): void {
  mind.goal = goal;
  mind.target = target;
  mind.node = node;
  mind.tx = wrapX(x);
}

/** The usable gate of `kind` that is quickest to reach, or -1. */
function bestGate(state: Round, unit: Unit, kind: "warrior" | "speed"): number {
  const arena = arenaOf(state.mapId);
  let best = -1,
    bestCost = UNREACHABLE;
  arena.gates.forEach((gate, index) => {
    if (gate.kind !== kind || !gateOpenTo(state, index, unit)) return;
    const cost = travel(state, unit, platformAt(arena, gate.x, gate.y), gate.x);
    if (cost < bestCost) {
      best = index;
      bestCost = cost;
    }
  });
  return best;
}

function mouthX(state: Round, team: number): number {
  return (
    state.snail.x + goalDir(team) * (SNAIL_HALF + Math.trunc(MOUTH_REACH / 2))
  );
}

/** The place among `spots` this Worker reaches soonest, with the steps it takes; undefined when there is none. */
function quickest(
  state: Round,
  unit: Unit,
  spots: readonly Spot[],
): [Spot | undefined, number] {
  let best: Spot | undefined,
    bestCost = 2 * UNREACHABLE;
  for (const spot of spots) {
    const cost = travel(state, unit, spot.node, spot.x) + spot.cost;
    if (cost < bestCost) {
      best = spot;
      bestCost = cost;
    }
  }
  return [best, bestCost];
}

/** Nothing to do: wait at the spawn point. */
function goHome(arena: Arena, unit: Unit, mind: BotMind): void {
  const spawn = arena.spawns[unit.slot]!;
  aimWorker(mind, "idle", -1, platformAt(arena, spawn.x, spawn.y), spawn.x);
}

/** The hop that touches what a Worker standing on its goal platform came for, or -1 when walking there is enough. */
function spotMove(
  state: Round,
  nav: WorkerNav,
  unit: Unit,
  mind: BotMind,
): number {
  const spots =
    mind.goal === "bank" && unit.carrying
      ? nav.holes[unit.team === 0 ? 0 : 1][mind.target]
      : mind.goal === "gather" && !unit.carrying
        ? nav.piles[mind.target]
        : undefined;
  if (mind.goal === "gather" && (state.piles[mind.target] ?? 0) <= 0) return -1;
  return (
    spots?.find((spot) => spot.node === mind.node && spot.x === mind.tx)
      ?.edge ?? -1
  );
}

function decideWorker(
  state: Round,
  unit: Unit,
  mind: BotMind,
  level: LevelRules,
): void {
  const arena = arenaOf(state.mapId);
  const nav = workerNav(state.mapId, unit.speed);
  if (unit.riding || unit.eaten || unit.gate >= 0) return;
  const smart = chance(state, level.smart);
  const threat = nearest(
    unit,
    enemiesOf(state, unit).filter(
      (enemy) =>
        isMilitary(enemy) &&
        Math.abs(wrapDelta(enemy.x, unit.x)) < level.flee * S &&
        Math.abs(enemy.y - unit.y) < level.flee * S,
    ),
  );
  if (threat && smart && unit.invuln === 0) {
    const away = wrapDelta(unit.x, threat.x) >= 0 ? 1 : -1;
    aimWorker(mind, "flee", threat.slot, -1, unit.x + away * 40 * S);
    return;
  }
  const floor = platformAt(arena, state.snail.x, arena.snail.y);
  if (unit.carrying) {
    const warriorGate =
      mind.soldier && smart ? bestGate(state, unit, "warrior") : -1;
    const speedGate =
      mind.rider && smart && !unit.speed ? bestGate(state, unit, "speed") : -1;
    const gate = warriorGate >= 0 ? warriorGate : speedGate;
    if (gate >= 0) {
      const at = arena.gates[gate]!;
      aimWorker(mind, "gate", gate, platformAt(arena, at.x, at.y), at.x);
      return;
    }
    // The empty hole that is quickest to touch, from wherever it can be touched.
    let hole = -1,
      from: Spot | undefined,
      holeCost = 2 * UNREACHABLE;
    nav.holes[unit.team === 0 ? 0 : 1].forEach((spots, index) => {
      if (state.holes[unit.team]![index]) return;
      const [spot, cost] = quickest(state, unit, spots);
      if (spot && cost < holeCost) {
        hole = index;
        from = spot;
        holeCost = cost;
      }
    });
    if (from) aimWorker(mind, "bank", hole, from.node, from.x);
    else goHome(arena, unit, mind);
    return;
  }
  const rider = state.units[state.snail.rider];
  if (rider && rider.team !== unit.team && smart) {
    // The free Worker nearest the snail's mouth walks into it to stall the ride.
    const mouth = mouthX(state, rider.team);
    const mates = state.units.filter(
      (mate) =>
        !mate.dead &&
        mate.team === unit.team &&
        mate.kind === "worker" &&
        !mate.carrying,
    );
    let closest = unit,
      closestCost = travel(state, unit, floor, mouth);
    for (const mate of mates) {
      const cost = travel(state, mate, floor, mouth);
      if (cost < closestCost) {
        closest = mate;
        closestCost = cost;
      }
    }
    if (closest === unit) {
      aimWorker(mind, "stall", rider.slot, floor, mouth);
      return;
    }
  }
  const snailFree = !rider || rider === unit;
  if (mind.rider && snailFree && unit.mountWait === 0) {
    aimWorker(mind, "ride", -1, floor, state.snail.x);
    return;
  }
  let best = -1,
    bestCost = UNREACHABLE,
    bestNode = -1,
    bestX = 0;
  nav.piles.forEach((spots, index) => {
    if (state.piles[index]! <= 0) return;
    const [spot, cost] = quickest(state, unit, spots);
    if (spot && cost < bestCost) {
      best = index;
      bestCost = cost;
      bestNode = spot.node;
      bestX = spot.x;
    }
  });
  for (const berry of state.loose) {
    // One that came to rest where no Worker fits (under a low block) is left alone.
    if (!berry.resting || !standable(arena, berry.x, berry.y)) continue;
    const node = platformAt(arena, berry.x, berry.y);
    const cost = travel(state, unit, node, berry.x);
    if (cost < bestCost) {
      best = arena.piles.length;
      bestCost = cost;
      bestNode = node;
      bestX = berry.x;
    }
  }
  if (best >= 0) aimWorker(mind, "gather", best, bestNode, bestX);
  else if (snailFree) aimWorker(mind, "ride", -1, floor, state.snail.x);
  else goHome(arena, unit, mind);
}

function steerWorker(state: Round, unit: Unit, mind: BotMind): Input {
  if (unit.eaten) return NEUTRAL;
  // Mounted by accident on the way somewhere else: hop off.
  if (unit.riding) return go(0, mind.goal !== "ride");
  if (unit.gate >= 0 && mind.goal === "gate") return NEUTRAL;
  const nav = workerNav(state.mapId, unit.speed);
  const edge = nav.edges[mind.edge];
  if (edge) {
    const landed = unit.ground >= 0 && unit.ground !== edge.from;
    // Back on the launch ledge after the take-off (a walk-off needs a few steps to reach its end): the move failed.
    const failed =
      mind.edgeStep > (edge.jump === JUMP_NONE ? 40 : 3) &&
      unit.ground === edge.from;
    if (landed || failed || mind.edgeStep > 160) {
      mind.edge = -1;
      mind.edgeStep = 0;
    } else {
      mind.edgeStep += 1;
      return edgeInput(edge, unit, mind.edgeStep - 1);
    }
  }
  const toTarget = wrapDelta(mind.tx, unit.x);
  // In the air without a move to fly: drift toward the target, holding the button so a hop stays a full one.
  if (unit.ground < 0) return go(sign(toTarget), false, true);
  if (mind.goal === "flee") {
    const threat = state.units[mind.target]!;
    const close = Math.abs(wrapDelta(threat.x, unit.x)) < 18 * S;
    return go(sign(toTarget), close);
  }
  // On the way: the next hop toward the goal platform. There: the hop that touches the hole or pile, if it takes one.
  const hop =
    nav.edges[
      mind.node >= 0 && unit.ground !== mind.node
        ? nextEdge(nav, unit.ground, unit.x, mind.node, unit.speed)
        : spotMove(state, nav, unit, mind)
    ];
  if (hop) {
    const dx = wrapDelta(hop.x, unit.x);
    if (unit.vx === 0 && Math.abs(dx) <= LAUNCH_SLACK - 100) {
      mind.edge = nav.edges.indexOf(hop);
      mind.edgeStep = 1;
      return edgeInput(hop, unit, 0);
    }
    // A Worker stops dead when it lets go, so it walks until it is on the mark.
    return go(Math.abs(dx) > LAUNCH_SLACK - 100 ? sign(dx) : 0);
  }
  const dir = Math.abs(toTarget) > 2 * S ? sign(toTarget) : 0;
  // The snail mounts whoever touches it: hop over it unless riding is the plan.
  const arena = arenaOf(state.mapId);
  const ahead = wrapDelta(state.snail.x, unit.x) * dir;
  const over =
    dir !== 0 &&
    mind.goal !== "ride" &&
    !unit.carrying &&
    state.snail.rider < 0 &&
    unit.y === arena.snail.y &&
    ahead > 0 &&
    ahead < SNAIL_HALF + 12 * S;
  return go(dir, over);
}

// --- Flyers ---------------------------------------------------------------------------------------------------------

/** Steps a flyer looks ahead when deciding to flap. */
const FLAP_LOOK = 4;
/** The braking a flyer counts on when it falls toward a point: about what steady flapping gives, per step. */
const BRAKE = 120;

/**
 * Whether a flyer whose middle is at `y` should press now to get to height `to`. Below the point it wants to climb
 * in proportion to the distance. Above it, it lets itself fall as fast as it can still brake before the point.
 */
function wantsFlap(unit: Unit, y: number, to: number): boolean {
  let push = 0;
  for (const left of unit.flaps)
    push += Math.min(left, FLAP_LOOK) * FLAP_THRUST;
  const gravity = unit.light ? FLY_GRAVITY_LIGHT : FLY_GRAVITY;
  const soon = unit.vy + gravity * FLAP_LOOK - push;
  const drop = to - y;
  if (drop <= 0)
    return soon > Math.max(-FLY_MAX_RISE, Math.trunc(drop / FLAP_LOOK));
  return soon > 0 && soon * soon > 2 * BRAKE * drop;
}
/** Steps of its own horizontal speed a flyer allows for when steering: about half its glide. */
const GLIDE_LOOK = 12;

/** A flyer standing on a platform walks unless its next point is this far above its middle. */
const WALK_BAND = 5 * S;

function aimFlyer(
  state: Round,
  mind: BotMind,
  level: LevelRules,
  goal: BotMind["goal"],
  target: number,
  x: number,
  y: number,
  dive = false,
): void {
  mind.goal = goal;
  mind.target = target;
  mind.tx = wrapX(x + randSpread(state, level.aimError) * S);
  mind.ty = Math.max(9 * S, y + randSpread(state, level.aimError) * S);
  mind.dive = dive;
}

/** Aim at a target: its middle for a Worker, a point clearly above it for a military unit. */
function hunt(
  state: Round,
  unit: Unit,
  mind: BotMind,
  level: LevelRules,
  target: Unit,
  above: boolean,
): void {
  // A duel compares the duel lines, and a flyer steers by its middle: a Queen's middle rides above her line.
  const lift =
    above && isMilitary(target) ? 9 * S + duelY(unit) - centreY(unit) : 0;
  aimFlyer(
    state,
    mind,
    level,
    "hunt",
    target.slot,
    target.x + target.vx * level.lead,
    (lift ? duelY(target) : centreY(target)) - lift,
    unit.kind === "queen",
  );
}

function hiveCentre(arena: Arena, team: number): { x: number; y: number } {
  const holes = arena.holes[team === 0 ? 0 : 1];
  const mid = holes[Math.trunc(holes.length / 2)]!;
  return { x: mid.x, y: mid.y };
}

function decideFlyer(
  state: Round,
  unit: Unit,
  mind: BotMind,
  level: LevelRules,
): void {
  const arena = arenaOf(state.mapId);
  const enemies = enemiesOf(state, unit);
  const queen = unit.kind === "queen";
  const eggs = state.eggs[unit.team]!;
  // A Queen grows more careful with every egg she loses.
  const caution = queen ? QUEEN_EGGS - eggs : 0;
  const soldiers = enemies.filter(isMilitary);
  if (!chance(state, level.smart)) {
    // A lapse. A Warrior charges whoever is nearest; a Queen, who has a game to lose, drifts home instead.
    const anyone = queen ? undefined : nearest(unit, enemies);
    const rest = queen
      ? hiveCentre(arena, unit.team)
      : { x: unit.x, y: centreY(unit) };
    if (anyone) hunt(state, unit, mind, level, anyone, false);
    else aimFlyer(state, mind, level, "guard", -1, rest.x, rest.y);
    return;
  }
  const margin = (5 * caution - 2) * S;
  const radius = Math.trunc((level.awareness * S * (2 + caution)) / 2);
  const threat = nearest(
    unit,
    soldiers.filter(
      (enemy) =>
        distance(unit, enemy) < radius && duelY(enemy) < duelY(unit) + margin,
    ),
  );
  if (threat && unit.invuln === 0) {
    // Get out from under it: sideways and up past its height.
    const away = wrapDelta(unit.x, threat.x) >= 0 ? 1 : -1;
    aimFlyer(
      state,
      mind,
      level,
      "evade",
      threat.slot,
      unit.x + away * 44 * S,
      centreY(threat) - 22 * S,
    );
    return;
  }
  const rider = state.units[state.snail.rider];
  if (rider && rider.team !== unit.team) {
    hunt(state, unit, mind, level, rider, true);
    return;
  }
  const workers = enemies.filter(
    (enemy) => enemy.kind === "worker" && enemy.invuln === 0,
  );
  const prey = nearest(unit, workers, (enemy) =>
    enemy.gate >= 0 ? -70 * S : enemy.carrying ? -40 * S : 0,
  );
  if (queen) {
    let gate = -1,
      gateCost = UNREACHABLE * S;
    arena.gates.forEach((at, index) => {
      const held = state.gates[index]!;
      if (held.owner === unit.team) return;
      const guarded = soldiers.some(
        (enemy) =>
          reach(wrapDelta(enemy.x, at.x), centreY(enemy) - at.y) <
          (30 + 20 * caution) * S,
      );
      if (guarded) return;
      const cost =
        reach(wrapDelta(at.x, unit.x), at.y - centreY(unit)) +
        (at.kind === "speed" ? 80 * S : 0) -
        (held.user >= 0 ? 100 * S : 0);
      if (cost < gateCost) {
        gate = index;
        gateCost = cost;
      }
    });
    if (gate >= 0 && (!prey || gateCost < distance(unit, prey) + 40 * S)) {
      const at = arena.gates[gate]!;
      aimFlyer(state, mind, level, "claim", gate, at.x, at.y - 8 * S);
      return;
    }
  }
  // A military enemy that is already below is an opening; a careful Queen passes on a duel she could lose.
  const below = nearest(
    unit,
    soldiers.filter(
      (enemy) =>
        enemy.invuln === 0 &&
        duelY(enemy) > duelY(unit) + 4 * S &&
        distance(unit, enemy) < (queen ? 70 - 20 * caution : 110) * S,
    ),
  );
  if (below) {
    hunt(state, unit, mind, level, below, true);
    return;
  }
  if (prey) {
    hunt(state, unit, mind, level, prey, true);
    return;
  }
  const royal = soldiers.find((enemy) => enemy.kind === "queen");
  if (royal && !queen) {
    hunt(state, unit, mind, level, royal, true);
    return;
  }
  const home = hiveCentre(arena, unit.team);
  aimFlyer(state, mind, level, "guard", -1, home.x, home.y);
}

function steerFlyer(
  state: Round,
  unit: Unit,
  mind: BotMind,
  level: LevelRules,
): Input {
  const y = centreY(unit);
  const point = flyToward(state.mapId, unit.x, y, mind.tx, mind.ty);
  const direct = point.x === mind.tx && point.y === mind.ty;
  const dx = wrapDelta(point.x, unit.x);
  // A flyer glides on when it lets go, so it steers for where the glide would take it.
  const ahead = dx - unit.vx * GLIDE_LOOK;
  const dir = Math.abs(ahead) > 2 * S ? sign(ahead) : 0;
  const dive =
    mind.dive &&
    direct &&
    unit.ground < 0 &&
    Math.abs(dx) < 6 * S &&
    mind.ty > y + 12 * S;
  if (mind.flapWait > 0) mind.flapWait -= 1;
  // Flap when coasting would leave the unit below where it wants to be. On a platform with nothing to climb
  // for, it walks instead.
  const sinking = wantsFlap(unit, y, point.y);
  const walking = unit.ground >= 0 && point.y > y - WALK_BAND;
  const flap = !dive && sinking && !walking && mind.flapWait === 0;
  if (flap)
    mind.flapWait = level.flapMin + randInt(state, level.flapJitter + 1);
  return {
    left: dir < 0,
    right: dir > 0,
    down: dive,
    held: flap,
    pressed: flap,
  };
}

// --- Entry ----------------------------------------------------------------------------------------------------------

/** The controls bot `slot` holds this step. Advances its memory and the round's random stream. */
export function botInput(state: Round, slot: number): Input {
  const unit = state.units[slot]!,
    mind = state.bots[slot]!;
  if (unit.dead) {
    mind.edge = -1;
    mind.edgeStep = 0;
    mind.goal = "idle";
    mind.think = 1;
    return NEUTRAL;
  }
  const level = levelOf(state, unit);
  if (mind.idle > 0) {
    mind.idle -= 1;
    return NEUTRAL;
  }
  mind.think -= 1;
  if (mind.think <= 0) {
    mind.think = level.think + randInt(state, 3);
    if (chance(state, level.blunder)) {
      mind.idle = level.idleSteps;
      return NEUTRAL;
    }
    if (unit.kind === "worker") decideWorker(state, unit, mind, level);
    else decideFlyer(state, unit, mind, level);
  }
  if (unit.kind === "worker") return steerWorker(state, unit, mind);
  // A Worker that just left a gate still has a Worker's plan in mind until its next decision.
  if (!FLYER_GOALS.includes(mind.goal)) {
    mind.tx = unit.x;
    mind.ty = centreY(unit) - heightOf(unit.kind);
  }
  return steerFlyer(state, unit, mind, level);
}
