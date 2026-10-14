import { px } from "./math.js";
import { EXIT_X, PICKUP_KINDS } from "./level.js";
import { COMBAT_MODES, LIFT_MODES } from "./settings.js";
import * as T from "./tuning.js";
import { CAUSES, FX_KINDS, PHASES, type Chopper, type World } from "./world.js";

/**
 * The world as checkpoint fields: flat integer tuples MessagePack carries, and a decoder that checks every one
 * against the bounds the simulation keeps. `decodeWorld` returns a whole world or nothing.
 */
const UINT32 = 0xffff_ffff;
const X_MIN = -px(4000),
  X_MAX = px(EXIT_X + 4000),
  Y_MIN = -px(4000),
  Y_MAX = px(4000),
  V_MAX = px(80),
  TIMER = 100_000;

const int = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;
const flag = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const list = (value: unknown, max: number): value is unknown[][] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((item) => Array.isArray(item));
export const chopperId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

const encodeChopper = (c: Chopper): unknown[] => [
  c.id,
  c.slot,
  c.x,
  c.y,
  c.vx,
  c.vy,
  c.face,
  c.alive ? 1 : 0,
  c.exited ? 1 : 0,
  c.endedAt,
  c.cause,
  c.shield,
  c.grace,
  c.stun,
  c.cool,
  c.triple,
  c.turbo,
  c.scramble,
  c.landed ? 1 : 0,
  c.input,
  c.hits,
  c.downed,
  c.pickups,
  c.bumps,
  c.engaged ? 1 : 0,
];

export function encodeWorld(world: World): unknown[] {
  return [
    world.seed,
    world.lift,
    world.combat,
    world.powerUps,
    world.step,
    world.phase,
    world.phaseAt,
    world.camX,
    world.scroll,
    world.crushX,
    world.rng,
    world.nextId,
    world.segment,
    world.rockAt,
    world.choppers.map(encodeChopper),
    world.bullets.map((b) => [b.id, b.owner, b.x, b.y, b.vx, b.vy, b.life]),
    world.bolts.map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.life]),
    world.rocks.map((r) => [r.id, r.x, r.y, r.vx, r.vy, r.r, r.life]),
    world.warnings.map((w) => [w.id, w.y, w.at]),
    world.drones.map((d) => [
      d.id,
      d.x,
      d.y,
      d.baseY,
      d.hp,
      d.cool,
      d.charge,
      d.phase,
    ]),
    world.pickups.map((k) => [k.id, k.kind, k.x, k.y]),
    world.fx.map((f) => [f.id, f.at, f.kind, f.x, f.y, f.slot, f.data]),
    world.winner,
  ];
}

function decodeChopper(raw: unknown[]): Chopper | undefined {
  if (raw.length !== 25) return;
  const [id, slot, x, y, vx, vy, face, alive, exited, endedAt, cause] = raw;
  const timers = raw.slice(11, 18),
    [landed, input, hits, downed, pickups, bumps, engaged] = raw.slice(18);
  if (
    !chopperId(id) ||
    !int(slot, 0, T.CAPACITY - 1) ||
    !int(x, X_MIN, X_MAX) ||
    !int(y, Y_MIN, Y_MAX) ||
    !int(vx, -V_MAX, V_MAX) ||
    !int(vy, -V_MAX, V_MAX) ||
    (face !== 1 && face !== -1) ||
    !flag(alive) ||
    !flag(exited) ||
    !int(endedAt, -1, UINT32) ||
    !int(cause, -1, CAUSES.length - 1) ||
    !timers.every((timer) => int(timer, 0, TIMER)) ||
    !int(timers[0], 0, 1) ||
    !flag(landed) ||
    !flag(engaged) ||
    !int(input, 0, 31) ||
    ![hits, downed, pickups, bumps].every((count) => int(count, 0, UINT32))
  )
    return;
  // Crashed: a cause and a step. Escaped: a step and no cause. Flying: neither.
  if (
    (alive === 0) !== cause >= 0 ||
    (alive === 0 && exited === 1) ||
    (alive === 0 || exited === 1) !== endedAt >= 0
  )
    return;
  const [shield, grace, stun, cool, triple, turbo, scramble] =
    timers as number[];
  return {
    id,
    slot,
    x,
    y,
    vx,
    vy,
    face,
    alive: alive === 1,
    exited: exited === 1,
    endedAt,
    cause,
    shield: shield!,
    grace: grace!,
    stun: stun!,
    cool: cool!,
    triple: triple!,
    turbo: turbo!,
    scramble: scramble!,
    landed: landed === 1,
    engaged: engaged === 1,
    input: input as number,
    hits: hits as number,
    downed: downed as number,
    pickups: pickups as number,
    bumps: bumps as number,
  };
}

/** Decodes and validates a world, or returns undefined without touching anything. */
export function decodeWorld(raw: unknown): World | undefined {
  if (!Array.isArray(raw) || raw.length !== 23) return;
  const [
    seed,
    lift,
    combat,
    powerUps,
    step,
    phase,
    phaseAt,
    camX,
    scroll,
    crushX,
    rng,
    nextId,
    segment,
    rockAt,
    choppers,
    bullets,
    bolts,
    rocks,
    warnings,
    drones,
    pickups,
    fx,
    winner,
  ] = raw;
  if (
    !int(seed, 0, UINT32) ||
    !(LIFT_MODES as readonly unknown[]).includes(lift) ||
    !(COMBAT_MODES as readonly unknown[]).includes(combat) ||
    typeof powerUps !== "boolean" ||
    !int(step, 0, UINT32) ||
    !(PHASES as readonly unknown[]).includes(phase) ||
    !int(phaseAt, 0, step) ||
    !int(camX, 0, X_MAX) ||
    !int(scroll, 0, T.SCROLL_MAX) ||
    !int(crushX, 0, X_MAX) ||
    !int(rng, 0, UINT32) ||
    !int(nextId, 1, UINT32) ||
    !int(segment, 0, 1000) ||
    !int(rockAt, 0, UINT32) ||
    !list(choppers, T.CAPACITY) ||
    !list(bullets, T.MAX_BULLETS) ||
    !list(bolts, T.MAX_BOLTS) ||
    !list(rocks, T.MAX_ROCKS) ||
    !list(warnings, T.MAX_ROCKS) ||
    !list(drones, T.MAX_DRONES) ||
    !list(pickups, T.MAX_PICKUPS) ||
    !list(fx, T.MAX_FX) ||
    (winner !== null && typeof winner !== "string")
  )
    return;
  if ((phase === "countdown") !== step < T.COUNTDOWN_STEPS) return;
  const decoded = choppers.map(decodeChopper);
  if (decoded.some((c) => !c)) return;
  const fleet = decoded as Chopper[];
  if (
    fleet.some((c, i) => i > 0 && c.slot <= fleet[i - 1]!.slot) ||
    new Set(fleet.map((c) => c.id)).size !== fleet.length
  )
    return;
  if (
    (phase === "outro") !== (winner !== null) ||
    (winner && !fleet.some((c) => c.id === winner))
  )
    return;
  const ids = new Set<number>();
  const id = (value: unknown) => {
    if (!int(value, 1, nextId - 1) || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  const position = (x: unknown, y: unknown) =>
    int(x, X_MIN, X_MAX) && int(y, Y_MIN, Y_MAX);
  const velocity = (vx: unknown, vy: unknown) =>
    int(vx, -V_MAX, V_MAX) && int(vy, -V_MAX, V_MAX);
  const ok =
    bullets.every(
      ([i, owner, x, y, vx, vy, life]) =>
        id(i) &&
        int(owner, 0, T.CAPACITY - 1) &&
        position(x, y) &&
        velocity(vx, vy) &&
        int(life, 0, T.BULLET_LIFE),
    ) &&
    bolts.every(
      ([i, x, y, vx, vy, life]) =>
        id(i) &&
        position(x, y) &&
        velocity(vx, vy) &&
        int(life, 0, T.BOLT_LIFE),
    ) &&
    rocks.every(
      ([i, x, y, vx, vy, r, life]) =>
        id(i) &&
        position(x, y) &&
        velocity(vx, vy) &&
        int(r, px(4), px(40)) &&
        int(life, 0, T.ROCK_LIFE),
    ) &&
    warnings.every(
      ([i, y, at]) => id(i) && int(y, Y_MIN, Y_MAX) && int(at, 0, UINT32),
    ) &&
    drones.every(
      ([i, x, y, baseY, hp, cool, charge, dronePhase]) =>
        id(i) &&
        position(x, y) &&
        int(baseY, Y_MIN, Y_MAX) &&
        int(hp, 1, T.DRONE_HP) &&
        int(cool, -TIMER, TIMER) &&
        int(charge, 0, T.DRONE_CHARGE) &&
        int(dronePhase, 0, TIMER),
    ) &&
    pickups.every(
      ([i, kind, x, y]) =>
        id(i) && int(kind, 0, PICKUP_KINDS.length - 1) && position(x, y),
    ) &&
    fx.every(
      ([i, at, kind, x, y, slot, data]) =>
        id(i) &&
        int(at, 0, step) &&
        int(kind, 0, FX_KINDS - 1) &&
        position(x, y) &&
        int(slot, -1, T.CAPACITY - 1) &&
        int(data, 0, 255),
    ) &&
    [bullets, bolts, rocks, warnings, drones, pickups, fx].every((rows, k) =>
      rows.every((row) => row.length === [7, 6, 7, 3, 8, 4, 7][k]),
    );
  if (!ok) return;
  const n = (value: unknown) => value as number;
  return {
    seed,
    lift: lift as World["lift"],
    combat: combat as World["combat"],
    powerUps,
    step,
    phase: phase as World["phase"],
    phaseAt,
    camX,
    scroll,
    crushX,
    rng,
    nextId,
    segment,
    rockAt,
    choppers: fleet,
    bullets: bullets.map((b) => ({
      id: n(b[0]),
      owner: n(b[1]),
      x: n(b[2]),
      y: n(b[3]),
      vx: n(b[4]),
      vy: n(b[5]),
      life: n(b[6]),
    })),
    bolts: bolts.map((b) => ({
      id: n(b[0]),
      x: n(b[1]),
      y: n(b[2]),
      vx: n(b[3]),
      vy: n(b[4]),
      life: n(b[5]),
    })),
    rocks: rocks.map((r) => ({
      id: n(r[0]),
      x: n(r[1]),
      y: n(r[2]),
      vx: n(r[3]),
      vy: n(r[4]),
      r: n(r[5]),
      life: n(r[6]),
    })),
    warnings: warnings.map((w) => ({ id: n(w[0]), y: n(w[1]), at: n(w[2]) })),
    drones: drones.map((d) => ({
      id: n(d[0]),
      x: n(d[1]),
      y: n(d[2]),
      baseY: n(d[3]),
      hp: n(d[4]),
      cool: n(d[5]),
      charge: n(d[6]),
      phase: n(d[7]),
    })),
    pickups: pickups.map((k) => ({
      id: n(k[0]),
      kind: n(k[1]),
      x: n(k[2]),
      y: n(k[3]),
    })),
    fx: fx.map((f) => ({
      id: n(f[0]),
      at: n(f[1]),
      kind: n(f[2]),
      x: n(f[3]),
      y: n(f[4]),
      slot: n(f[5]),
      data: n(f[6]),
    })),
    winner: winner as string | null,
  };
}
