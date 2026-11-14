import { BIKE_KEYS, validBike, type Bike } from "./bike.js";
import { isInput } from "./input.js";
import { compile } from "./level.js";
import { LEVELS } from "./levels.js";
import * as T from "./tuning.js";
import {
  DEAD,
  FINISHED,
  PHASES,
  RIDING,
  isLevel,
  type Rider,
  type Status,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: flat tuples of numbers (and the rider ids, plus a rider's apple set as a decimal
 * string so it stays exact past 32 bits) that MessagePack carries exactly, doubles included, and a decoder that
 * checks every one against the bounds and the consistency the simulation keeps. `decodeWorld` returns a whole new
 * world or nothing; it never changes what it was given.
 */
const VERSION = 3;
const HEAD_FIELDS = 6,
  RIDER_FIELDS = 10;

const int = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  !Object.is(value, -0) &&
  value >= low &&
  value <= high;
const MOST = 0xffff_ffff;
/** A rider's eaten apples as a canonical decimal string; 20 digits bounds the parse at 2^64. */
const decodeApples = (value: unknown): bigint | undefined => {
  if (
    typeof value !== "string" ||
    value.length > 20 ||
    !/^(?:0|[1-9][0-9]*)$/.test(value)
  )
    return;
  return BigInt(value);
};
/** A rider's id: the member or bot id the room seats, as an opaque short string. */
export const riderId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

const encodeRider = (rider: Rider): unknown[] => [
  rider.id,
  rider.status,
  rider.taken.toString(),
  rider.prev,
  rider.run,
  rider.wait,
  rider.deaths,
  rider.finish,
  rider.step,
  BIKE_KEYS.map((key) => rider.bike[key]),
];

export function encodeWorld(world: World): unknown[] {
  return [
    VERSION,
    world.level,
    PHASES.indexOf(world.phase),
    world.go,
    world.step,
    world.close,
    ...world.riders.map(encodeRider),
  ];
}

function decodeBike(raw: unknown): Bike | undefined {
  if (!Array.isArray(raw) || raw.length !== BIKE_KEYS.length) return;
  const bike = {} as Bike;
  for (const [index, key] of BIKE_KEYS.entries()) {
    const value: unknown = raw[index];
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    // The checkpoint's JSON hash cannot tell −0 from 0, so the state never holds one.
    bike[key] = value === 0 ? 0 : value;
  }
  return validBike(bike) ? bike : undefined;
}

function decodeRider(
  raw: unknown,
  worldStep: number,
  allApples: bigint,
): Rider | undefined {
  if (!Array.isArray(raw) || raw.length !== RIDER_FIELDS) return;
  const [id, status, taken, prev, run, wait, deaths, finish, own, rawBike] =
    raw as unknown[];
  const bike = decodeBike(rawBike);
  const apples = decodeApples(taken);
  if (
    !riderId(id) ||
    !int(status, RIDING, FINISHED) ||
    apples === undefined ||
    apples > allApples ||
    !isInput(prev) ||
    // A rider's own clock stays within reach of the race's.
    !int(own, 0, Math.min(T.RACE_LIMIT, worldStep + T.RIDER_AHEAD)) ||
    !int(run, 0, own) ||
    !int(wait, 0, T.RESPAWN) ||
    !int(deaths, 0, MOST) ||
    !int(finish, 0, own) ||
    !bike
  )
    return;
  if (
    (status === DEAD) !== wait > 0 ||
    (status === FINISHED) !== finish > 0 ||
    (status === FINISHED && apples !== allApples)
  )
    return;
  return {
    id,
    status: status as Status,
    bike,
    taken: apples,
    prev,
    run,
    wait,
    deaths,
    finish,
    step: own,
  };
}

export function decodeWorld(raw: unknown): World | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length < HEAD_FIELDS + 1 ||
    raw.length > HEAD_FIELDS + T.CAPACITY
  )
    return;
  const [version, level, phaseIndex, go, step, close] = raw as unknown[];
  if (
    version !== VERSION ||
    !isLevel(level) ||
    !int(phaseIndex, 0, PHASES.length - 1) ||
    !int(go, 0, T.COUNTDOWN) ||
    !int(step, 0, T.RACE_LIMIT + T.CLOSE_LAG) ||
    !int(close, 1, T.RACE_LIMIT)
  )
    return;
  const phase = PHASES[phaseIndex]!;
  if (
    (phase === "countdown") !== go > 0 ||
    (phase === "countdown" && step !== 0) ||
    (phase === "racing" && step >= close + T.CLOSE_LAG)
  )
    return;
  const allApples = (1n << BigInt(compile(LEVELS[level]!).apples.length)) - 1n;
  const riders: Rider[] = [];
  for (const item of raw.slice(HEAD_FIELDS)) {
    const rider = decodeRider(item, step, allApples);
    if (!rider || riders.some((other) => other.id === rider.id)) return;
    riders.push(rider);
  }
  return { level, phase, go, step, close, riders };
}
