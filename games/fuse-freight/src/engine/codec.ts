import { BOUNDS, FLOOR } from "./arena.js";
import { DIRS } from "./math.js";
import { INPUT_MASK } from "./input.js";
import { ROUND_SECONDS } from "./settings.js";
import * as T from "./tuning.js";
import {
  FX_KINDS,
  PHASES,
  type Cart,
  type Fx,
  type Train,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: flat integer tuples MessagePack carries, and a decoder that checks every one
 * against the bounds the simulation keeps. `decodeWorld` returns a whole world or nothing.
 */
const UINT32 = 0xffff_ffff;
const LENGTHS = ROUND_SECONDS.map((seconds) => seconds * T.STEPS_PER_SECOND);

const int = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;
const list = (value: unknown, max: number): value is unknown[][] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((item) => Array.isArray(item));
export const trainId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

const onFloor = (x: unknown, y: unknown, inset: number) =>
  int(x, FLOOR.left + inset, FLOOR.right - inset) &&
  int(y, FLOOR.top + inset, FLOOR.bottom - inset);
const inBounds = (x: unknown, y: unknown) =>
  int(x, BOUNDS.left, BOUNDS.right) && int(y, BOUNDS.top, BOUNDS.bottom);

const encodeTrain = (t: Train): unknown[] => [
  t.id,
  t.slot,
  t.x,
  t.y,
  t.dir,
  [...t.cargo],
  [...t.trail],
  t.odo,
  t.input,
  t.guard,
  t.bump,
  t.score,
  t.collected,
  t.deliveries,
  t.stolen,
  t.lost,
];

export function encodeWorld(world: World): unknown[] {
  return [
    world.seed,
    world.length,
    world.step,
    world.phase,
    world.phaseAt,
    world.rng,
    world.nextId,
    world.spawnAt,
    world.trains.map(encodeTrain),
    world.carts.map((c) => [c.id, c.kind, c.x, c.y, c.vx, c.vy, c.cool]),
    world.fx.map((f) => [
      f.id,
      f.at,
      f.kind,
      f.x,
      f.y,
      f.slot,
      f.data,
      f.other,
    ]),
  ];
}

function decodeTrain(raw: unknown[]): Train | undefined {
  if (raw.length !== 16) return;
  const [id, slot, x, y, dir, cargo, trail, odo, input, guard, bump, score] =
    raw;
  const stats = raw.slice(12);
  if (
    !trainId(id) ||
    !int(slot, 0, T.CAPACITY - 1) ||
    !inBounds(x, y) ||
    !int(dir, 0, DIRS - 1) ||
    !Array.isArray(cargo) ||
    cargo.length > T.MAX_WAGONS ||
    !cargo.every((kind) => int(kind, 0, T.CARGO_KINDS - 1)) ||
    !Array.isArray(trail) ||
    trail.length !== T.TRAIL * 2 ||
    !trail.every((value, index) =>
      index % 2 === 0
        ? int(value, BOUNDS.left, BOUNDS.right)
        : int(value, BOUNDS.top, BOUNDS.bottom),
    ) ||
    !int(odo, 0, T.CRUMB - 1) ||
    !int(input, 0, INPUT_MASK) ||
    !int(guard, 0, T.CUT_GUARD) ||
    !int(bump, 0, T.BUMP_COOL) ||
    !int(score, 0, T.MAX_SCORE) ||
    !stats.every((count) => int(count, 0, UINT32))
  )
    return;
  const [collected, deliveries, stolen, lost] = stats as number[];
  return {
    id,
    slot,
    x: x as number,
    y: y as number,
    dir,
    cargo: [...(cargo as number[])],
    trail: [...(trail as number[])],
    odo,
    input,
    guard,
    bump,
    score,
    collected: collected!,
    deliveries: deliveries!,
    stolen: stolen!,
    lost: lost!,
  };
}

/** Decodes and validates a world, or returns undefined without touching anything. */
export function decodeWorld(raw: unknown): World | undefined {
  if (!Array.isArray(raw) || raw.length !== 11) return;
  const [
    seed,
    length,
    step,
    phase,
    phaseAt,
    rng,
    nextId,
    spawnAt,
    trains,
    carts,
    fx,
  ] = raw;
  if (
    !int(seed, 0, UINT32) ||
    !LENGTHS.includes(length as number) ||
    !int(step, 0, UINT32) ||
    !(PHASES as readonly unknown[]).includes(phase) ||
    !int(rng, 0, UINT32) ||
    !int(nextId, 1, UINT32) ||
    !int(spawnAt, 0, UINT32) ||
    !list(trains, T.CAPACITY) ||
    !list(carts, T.MAX_LOOSE) ||
    !list(fx, T.MAX_FX)
  )
    return;
  // The clock and the phase agree: a countdown, then `length` steps of play, then the whistle.
  const play = T.COUNTDOWN_STEPS,
    whistle = T.COUNTDOWN_STEPS + (length as number);
  if (
    phase === "countdown"
      ? !(step < play && phaseAt === 0)
      : phase === "play"
        ? !(step >= play && step < whistle && phaseAt === play)
        : !(step >= whistle && phaseAt === whistle)
  )
    return;
  const decoded = trains.map(decodeTrain);
  if (decoded.some((t) => !t)) return;
  const fleet = decoded as Train[];
  if (
    fleet.some((t, i) => i > 0 && t.slot <= fleet[i - 1]!.slot) ||
    new Set(fleet.map((t) => t.id)).size !== fleet.length
  )
    return;
  const ids = new Set<number>();
  const id = (value: unknown) => {
    if (!int(value, 1, (nextId as number) - 1) || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  const speed = T.SCATTER * 2;
  const ok =
    carts.every(
      (c) =>
        c.length === 7 &&
        id(c[0]) &&
        int(c[1], 0, T.CARGO_KINDS - 1) &&
        onFloor(c[2], c[3], T.CART_R) &&
        int(c[4], -speed, speed) &&
        int(c[5], -speed, speed) &&
        int(c[6], 0, T.CUT_COOL),
    ) &&
    fx.every(
      (f) =>
        f.length === 8 &&
        id(f[0]) &&
        int(f[1], 0, step as number) &&
        int(f[2], 0, FX_KINDS - 1) &&
        onFloor(f[3], f[4], 0) &&
        int(f[5], -1, T.CAPACITY - 1) &&
        int(f[6], 0, T.MAX_WAGONS) &&
        int(f[7], -1, T.CAPACITY - 1),
    );
  if (!ok) return;
  const n = (value: unknown) => value as number;
  return {
    seed,
    length: length as number,
    step,
    phase: phase as World["phase"],
    phaseAt: phaseAt as number,
    rng,
    nextId,
    spawnAt,
    trains: fleet,
    carts: carts.map((c): Cart => ({
      id: n(c[0]),
      kind: n(c[1]),
      x: n(c[2]),
      y: n(c[3]),
      vx: n(c[4]),
      vy: n(c[5]),
      cool: n(c[6]),
    })),
    fx: fx.map((f): Fx => ({
      id: n(f[0]),
      at: n(f[1]),
      kind: n(f[2]),
      x: n(f[3]),
      y: n(f[4]),
      slot: n(f[5]),
      data: n(f[6]),
      other: n(f[7]),
    })),
  };
}
