import {
  MAPS,
  MAX_PLAYERS,
  QUEEN_EGGS,
  RULES,
  cloneRound,
  createRound,
  isQueenSlot,
  navEdgeCount,
  stepRound,
  teamOf,
  type BotGoal,
  type BotLevel,
  type LooseBerry,
  type MapDef,
  type MapId,
  type Round,
  type UnitKind,
  type VictoryKind,
} from "../engine/index.js";

/**
 * The round as a room checkpoint carries it, and the boundary that takes one back. The engine's state is plain data
 * with a fixed shape, so a fresh round of the same map is the template: a received round must have exactly its keys,
 * its array lengths and its value types, every number a safe integer, and every index and enum inside its range.
 * `events` (the last step's output, not state) are not sent.
 */
export const VICTORIES: readonly VictoryKind[] = [
  "military",
  "economy",
  "snail",
];
const KINDS: readonly UnitKind[] = ["worker", "warrior", "queen"];
const GOALS = [
  "idle",
  "gather",
  "bank",
  "gate",
  "ride",
  "stall",
  "flee",
  "hunt",
  "claim",
  "evade",
  "guard",
] as const satisfies readonly BotGoal[];
/** Fails to compile when the engine gains a goal this list does not know. */
const _everyGoal: Exclude<BotGoal, (typeof GOALS)[number]> extends never
  ? true
  : never = true;
void _everyGoal;
/** Far more loose berries than a map holds; a longer list is not a round. */
export const MAX_LOOSE = 256;
const LOOSE: LooseBerry = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  resting: false,
  wait: 0,
  by: 0,
};

export function encodeWorld(world: Round): Record<string, unknown> {
  const { events: _events, ...rest } = cloneRound(world);
  return rest;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;
/** An array without holes. */
const dense = (value: unknown): value is unknown[] =>
  Array.isArray(value) && Object.keys(value).length === value.length;

/** Whether `value` has the template's shape: its keys, lengths and types, with every number a safe integer. */
function conforms(template: unknown, value: unknown): boolean {
  if (typeof template === "number") return Number.isSafeInteger(value);
  if (typeof template !== "object" || template === null)
    return typeof value === typeof template;
  if (Array.isArray(template))
    return (
      dense(value) &&
      value.length === template.length &&
      template.every((item, index) => conforms(item, value[index]))
    );
  if (!plain(value)) return false;
  const shape = template as Record<string, unknown>,
    keys = Object.keys(shape);
  return (
    Object.keys(value).length === keys.length &&
    keys.every(
      (key) => Object.hasOwn(value, key) && conforms(shape[key], value[key]),
    )
  );
}

const within = (value: number, low: number, high: number): boolean =>
  value >= low && value <= high;

/**
 * How many values a bot's `target` can take, by goal: it is a slot for the goals about another unit, and otherwise
 * an index into the map's own lists. `idle` and `ride` are about nothing and hold -1 when they are chosen, but a
 * bot that dies keeps the target it had while its goal becomes `idle`, so those accept any of the lists. Without
 * the top, `state.units[mind.target]!` under `flee` is a throw inside a later fold, which a checkpoint from a peer
 * must never be able to cause; a target inside its list is one the engine's own lookups cope with.
 */
function targetBound(goal: BotGoal, map: MapDef, team: number): number {
  switch (goal) {
    case "gather":
      return map.piles.length;
    case "bank":
      return map.holes[team]!.length;
    case "gate":
    case "claim":
      return map.gates.length;
    // A slot: `flee`, `stall`, `hunt`, `evade` and `guard` are aimed at a unit, and take their target with the goal.
    case "flee":
    case "stall":
    case "hunt":
    case "evade":
    case "guard":
      return MAX_PLAYERS;
    default:
      return Math.max(
        MAX_PLAYERS,
        map.piles.length,
        map.gates.length,
        map.holes[team]!.length,
      );
  }
}

/**
 * The least a bot's `target` can be, by goal. `flee`, `stall`, `hunt` and `evade` always take the slot of the unit
 * they are about (`aimWorker` and `aimFlyer` are handed `threat.slot`, `rider.slot`, `target.slot`), and `flee`
 * reads `state.units[mind.target]!` on the next fold, so -1 there is a throw a checkpoint must not pass on. `guard`
 * is aimed at a place and holds -1 for nobody; the rest keep whatever list index, or -1, the goal left.
 */
function targetFloor(goal: BotGoal): number {
  switch (goal) {
    case "flee":
    case "stall":
    case "hunt":
    case "evade":
      return 0;
    default:
      return -1;
  }
}

/** The ranges the shape cannot say: indices into the map and the slots, enums, and counters that never go negative. */
function inRange(world: Round): boolean {
  const map = MAPS[world.mapId],
    slot = (value: number) => within(value, -1, MAX_PLAYERS - 1);
  // The bots' nav: `node` is a platform, as `unit.ground` is, and `edge` indexes the moves built for this map.
  const edges = world.bots.some((mind) => mind.edge >= 0)
    ? navEdgeCount(world.mapId)
    : 0;
  return (
    within(world.rng, 0, 0xffff_ffff) &&
    within(world.step, 0, 0xffff_ffff) &&
    world.units.every(
      (unit, index) =>
        unit.slot === index &&
        unit.team === teamOf(index) &&
        KINDS.includes(unit.kind) &&
        (unit.kind === "queen") === isQueenSlot(index) &&
        (unit.facing === 1 || unit.facing === -1) &&
        within(unit.ground, -1, map.platforms.length - 1) &&
        within(unit.gate, -1, map.gates.length - 1) &&
        within(unit.deposit, -1, map.holes[unit.team]!.length - 1) &&
        unit.coyote >= 0 &&
        unit.jumpStep >= -1 &&
        unit.stun >= 0 &&
        unit.attack >= 0 &&
        unit.attackBuffer >= 0 &&
        unit.buffer >= 0 &&
        unit.takeoff >= 0 &&
        unit.depositStep >= 0 &&
        unit.flaps.every((left) => left >= 0) &&
        unit.gateProgress >= 0 &&
        unit.invuln >= 0 &&
        unit.respawn >= 0 &&
        unit.mountWait >= 0,
    ) &&
    world.piles.every((count, index) =>
      within(count, 0, map.piles[index]!.count),
    ) &&
    world.loose.every(
      (berry) => berry.wait >= 0 && within(berry.by, 0, MAX_PLAYERS - 1),
    ) &&
    world.gates.every((gate) => within(gate.owner, -1, 1) && slot(gate.user)) &&
    slot(world.snail.rider) &&
    slot(world.snail.victim) &&
    world.snail.eat >= 0 &&
    (world.snail.facing === 1 || world.snail.facing === -1) &&
    world.eggs.every((eggs) => within(eggs, 0, QUEEN_EGGS)) &&
    world.bots.every(
      (mind, index) =>
        (GOALS as readonly string[]).includes(mind.goal) &&
        mind.think >= 0 &&
        mind.edgeStep >= 0 &&
        mind.flapWait >= 0 &&
        mind.idle >= 0 &&
        mind.strike >= 0 &&
        mind.plunge >= 0 &&
        mind.noise >= 0 &&
        within(
          mind.target,
          targetFloor(mind.goal),
          targetBound(mind.goal, map, teamOf(index)) - 1,
        ) &&
        within(mind.node, -1, map.platforms.length - 1) &&
        within(mind.edge, -1, edges - 1),
    )
  );
}

/**
 * The round `encodeWorld` wrote for the game seeded `seed` on `mapId` at `botLevel`, or undefined: never a partial
 * round and never a throw. The last check runs one step on a copy, so a round the engine cannot step is refused here
 * rather than in the fold.
 */
export function decodeWorld(
  raw: unknown,
  expected: {
    seed: number;
    mapId: MapId;
    botLevel: BotLevel;
    passive?: boolean;
  },
): Round | undefined {
  if (!plain(raw)) return;
  const { winner, loose, ...rest } = raw;
  const {
    winner: _winner,
    loose: _loose,
    events: _events,
    ...template
  } = createRound(expected);
  if (!conforms(template, rest)) return;
  if (!dense(loose) || loose.length > MAX_LOOSE) return;
  if (!loose.every((berry) => conforms(LOOSE, berry))) return;
  if (winner !== null) {
    if (!plain(winner) || Object.keys(winner).length !== 2) return;
    if (winner.team !== 0 && winner.team !== 1) return;
    if (!VICTORIES.some((kind) => kind === winner.kind)) return;
  }
  // The shape is the template's, so the value is a round: the casts below say what `conforms` checked.
  const world = structuredClone({
    ...rest,
    loose,
    winner,
    events: [],
  }) as unknown as Round;
  if (
    world.rules !== RULES ||
    world.seed !== template.seed ||
    world.mapId !== expected.mapId ||
    world.botLevel !== expected.botLevel ||
    world.passive !== (expected.passive === true) ||
    world.teamLevels.some((level) => level !== expected.botLevel) ||
    !inRange(world)
  )
    return;
  try {
    stepRound(cloneRound(world), []);
  } catch {
    return;
  }
  return world;
}
