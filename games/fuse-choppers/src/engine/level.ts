import { SUB, clamp, wave } from "./math.js";
import { hash, hashRange } from "./rng.js";
import { VIEW_W } from "./tuning.js";

/**
 * The procedural cave. Everything here is a pure function of the round's seed and a world position, in whole
 * pixels: the ceiling and floor are a height map sampled every `COL` pixels, and every `SEG` pixels a segment
 * places at most one floating platform, one saw blade and the spawns (drones and power-ups) that become world
 * state when the camera reaches them. Nothing here is stored in the world, so the level costs no rollback state.
 */
export const COL = 24;
export const SEG = 480;
/** The world x of the exit gate: a clean run takes about 80 seconds to scroll here. */
export const EXIT_X = 7920;
/** Where the camera stops, with the gate on screen. */
export const CAMERA_END = EXIT_X + 150 - VIEW_W;
export const CEILING_MIN = 64;
export const FLOOR_MAX = 526;
/** Open, even cave for the countdown and the first seconds of play. */
export const START_CLEAR = 1150;
/** Hazards stop this far before the gate, so the finale is a race rather than a lottery. */
export const FINALE_CLEAR = 560;
const MIN_GAP = 186;
/** The corridor a platform or saw always leaves open beside it. */
const CLEARANCE = 108;

export const PICKUP_KINDS = [
  "shield",
  "triple",
  "shock",
  "turbo",
  "scramble",
] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A saw blade: centre `(x, y)`, bobbing `amp` pixels up and down over `period` steps. */
export interface Saw {
  x: number;
  y: number;
  r: number;
  amp: number;
  period: number;
  phase: number;
}
export interface Spawn {
  kind: "drone" | PickupKind;
  x: number;
  y: number;
}
export interface Segment {
  platforms: Platform[];
  saws: Saw[];
  spawns: Spawn[];
}

/** How far through the level `x` is, 0–1000. */
export const progress = (x: number): number =>
  clamp(Math.trunc((x * 1000) / EXIT_X), 0, 1000);

function noise(seed: number, c: number, period: number, salt: number): number {
  const k = Math.floor(c / period),
    f = c - k * period;
  const a = hashRange(0, 2000, seed, salt, k) - 1000,
    b = hashRange(0, 2000, seed, salt, k + 1) - 1000;
  const t = Math.trunc((f * 1000) / period);
  const s = Math.trunc((t * t * (3000 - 2 * t)) / 1_000_000);
  return a + Math.trunc(((b - a) * s) / 1000);
}

/** How wild the cave is at `x`, 0–1000: calm at the start and before the gate. */
function wildness(x: number): number {
  const start = clamp(
      Math.trunc(((x - 620) * 1000) / (START_CLEAR - 620)),
      0,
      1000,
    ),
    end = clamp(Math.trunc(((EXIT_X - 300 - x) * 1000) / 640), 0, 1000);
  return Math.min(start, end);
}

function point(seed: number, c: number): [top: number, bottom: number] {
  const x = c * COL,
    pm = progress(x),
    wild = wildness(x);
  const calmCenter = 296,
    calmGap = x < EXIT_X / 2 ? 420 : 340;
  const center =
      296 +
      Math.trunc(
        (noise(seed, c, 14, 1) * 104 + noise(seed, c, 5, 2) * 30) / 1000,
      ),
    gap =
      396 -
      Math.trunc((pm * 150) / 1000) +
      Math.trunc((noise(seed, c, 9, 3) * 38) / 1000);
  const mix = (calm: number, value: number) =>
    calm + Math.trunc(((value - calm) * wild) / 1000);
  const middle = mix(calmCenter, center),
    size = mix(calmGap, gap);
  let top = middle - (size >> 1) + hashRange(0, 14, seed, 4, c) - 7,
    bottom = middle + (size >> 1) + hashRange(0, 14, seed, 5, c) - 7;
  if (
    wild === 1000 &&
    c % 2 === 0 &&
    hash(seed, 6, c) % 1000 < 55 + Math.trunc(pm / 9)
  ) {
    let length = hashRange(34, 86, seed, 7, c);
    length = Math.min(length, bottom - top - MIN_GAP - 6);
    if (length >= 24) {
      if (hash(seed, 8, c) % 2 === 0) top += length;
      else bottom -= length;
    }
  }
  top = Math.max(top, CEILING_MIN);
  bottom = Math.min(bottom, FLOOR_MAX);
  if (bottom - top < MIN_GAP) {
    const mid = (top + bottom) >> 1;
    top = Math.max(CEILING_MIN, mid - (MIN_GAP >> 1));
    bottom = top + MIN_GAP;
  }
  return [top, bottom];
}

/** Terrain points from x = 0 to past the camera's last position. */
export const COLUMNS = Math.ceil((EXIT_X + VIEW_W * 2) / COL) + 2;

export interface Terrain {
  top: Int16Array;
  bottom: Int16Array;
}
const terrains = new Map<number, Terrain>();
const segments = new Map<number, Segment[]>();
function remember<T>(cache: Map<number, T>, seed: number, make: () => T): T {
  const known = cache.get(seed);
  if (known) return known;
  if (cache.size >= 6) cache.delete(cache.keys().next().value!);
  const made = make();
  cache.set(seed, made);
  return made;
}

/** The cave's height map for `seed`, one point every `COL` pixels. Derived data, computed once per seed. */
export function terrain(seed: number): Terrain {
  return remember(terrains, seed, () => {
    const top = new Int16Array(COLUMNS),
      bottom = new Int16Array(COLUMNS);
    for (let c = 0; c < COLUMNS; c++) [top[c], bottom[c]] = point(seed, c);
    return { top, bottom };
  });
}

const column = (x: number) => clamp(Math.floor(x / COL), 0, COLUMNS - 2);

/** The ceiling at world x (sub-units in, sub-units out), linear between points. */
export function ceilingAt(seed: number, x: number): number {
  return edgeAt(terrain(seed).top, x);
}
export function floorAt(seed: number, x: number): number {
  return edgeAt(terrain(seed).bottom, x);
}
function edgeAt(edge: Int16Array, x: number): number {
  const scaled = COL * SUB,
    c = clamp(Math.floor(x / scaled), 0, COLUMNS - 2),
    f = clamp(x - c * scaled, 0, scaled);
  return edge[c]! * SUB + Math.trunc(((edge[c + 1]! - edge[c]!) * f) / COL);
}

/** The lowest ceiling and the highest floor over `[x0, x1]` (sub-units): exact for the piecewise-linear cave. */
export function span(
  seed: number,
  x0: number,
  x1: number,
): { ceiling: number; floor: number } {
  const { top, bottom } = terrain(seed);
  let ceiling = Math.max(edgeAt(top, x0), edgeAt(top, x1)),
    floor = Math.min(edgeAt(bottom, x0), edgeAt(bottom, x1));
  const scaled = COL * SUB;
  const first = Math.max(0, Math.floor(x0 / scaled) + 1),
    last = Math.min(COLUMNS - 1, Math.floor(x1 / scaled));
  for (let c = first; c <= last; c++) {
    ceiling = Math.max(ceiling, top[c]! * SUB);
    floor = Math.min(floor, bottom[c]! * SUB);
  }
  return { ceiling, floor };
}

/** `span` in whole pixels, for the generator. */
function openAt(seed: number, x0: number, x1: number) {
  const { ceiling, floor } = span(seed, x0 * SUB, x1 * SUB);
  return { ceiling: Math.ceil(ceiling / SUB), floor: Math.floor(floor / SUB) };
}

const SLOT = SEG / 3;
function buildSegment(seed: number, s: number): Segment {
  const out: Segment = { platforms: [], saws: [], spawns: [] };
  const x0 = s * SEG,
    pm = progress(x0);
  if (x0 < START_CLEAR || x0 + SEG > EXIT_X - FINALE_CLEAR) return out;
  const roll = (salt: number, low: number, high: number) =>
    hashRange(low, high, seed, 100 + salt, s);
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) {
    const j = hash(seed, 90, s, i) % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const slotX = (slot: number) => x0 + slot * SLOT;

  // A floating rock with a landing pad on top.
  if (roll(0, 0, 99) < 72) {
    const w = roll(1, 90, SLOT - 12),
      h = roll(2, 24, 34),
      x = slotX(order[0]!) + roll(3, 4, SLOT - w - 4);
    const open = openAt(seed, x, x + w),
      room = open.floor - open.ceiling - h - 2 * CLEARANCE;
    if (room >= 0)
      out.platforms.push({
        x,
        y: open.ceiling + CLEARANCE + roll(4, 0, room),
        w,
        h,
      });
  }
  // A saw blade, sweeping up and down later in the level.
  if (roll(5, 0, 999) < 250 + Math.trunc((pm * 450) / 1000)) {
    const r = roll(6, 22, 31),
      x = slotX(order[1]!) + (SLOT >> 1),
      open = openAt(seed, x - r, x + r);
    let amp = pm > 180 ? roll(7, 0, 72) : 0;
    const total = open.floor - open.ceiling;
    if (total - 2 * r - 2 * amp - CLEARANCE < 8) amp = 0;
    // The band the blade sweeps sits against the ceiling or the floor, leaving CLEARANCE open on the other side.
    const room = total - 2 * r - 2 * amp - CLEARANCE;
    if (room >= 8) {
      const offset = roll(8, 0, room),
        bandTop =
          roll(9, 0, 1) === 0
            ? open.ceiling + offset
            : open.ceiling + CLEARANCE + offset;
      out.saws.push({
        x,
        y: bandTop + r + amp,
        r,
        amp,
        period: 4 * roll(10, 40, 72),
        phase: roll(11, 0, 287),
      });
    }
  }
  // Power-ups and drones share the third slot.
  const spawnX = slotX(order[2]!);
  const middle = (x: number, spread: number, salt: number) => {
    const open = openAt(seed, x - 24, x + 24),
      mid = (open.ceiling + open.floor) >> 1,
      half = Math.max(
        0,
        Math.min(spread, ((open.floor - open.ceiling) >> 1) - 44),
      );
    return mid + roll(salt, 0, 2 * half) - half;
  };
  if (roll(12, 0, 99) < 70) {
    const x = spawnX + roll(13, 30, SLOT - 30);
    out.spawns.push({
      kind: PICKUP_KINDS[roll(14, 0, PICKUP_KINDS.length - 1)]!,
      x,
      y: middle(x, 60, 15),
    });
  }
  const drones =
    pm < 90
      ? 0
      : (roll(16, 0, 999) < 220 + Math.trunc((pm * 320) / 1000) ? 1 : 0) +
        (pm > 550 && roll(17, 0, 99) < 22 ? 1 : 0);
  for (let d = 0; d < drones; d++) {
    const x = spawnX + (SLOT >> 1) + d * 60;
    out.spawns.push({ kind: "drone", x, y: middle(x, 80, 18 + d) });
  }
  return out;
}

/** Segment `s` of the level for `seed`; empty before the start clearing and in the finale. */
export function segment(seed: number, s: number): Segment {
  const all = remember(segments, seed, () =>
    Array.from({ length: Math.ceil(EXIT_X / SEG) + 1 }, (_, index) =>
      buildSegment(seed, index),
    ),
  );
  return all[s] ?? { platforms: [], saws: [], spawns: [] };
}

/** The segments that can touch `[x0, x1]` (pixels). */
export function segmentsNear(seed: number, x0: number, x1: number): Segment[] {
  const out: Segment[] = [];
  for (
    let s = Math.max(0, Math.floor(x0 / SEG) - 1);
    s <= Math.floor(x1 / SEG);
    s++
  )
    out.push(segment(seed, s));
  return out;
}

/** A saw's centre y at `step` (pixels). */
export function sawY(saw: Saw, step: number): number {
  if (!saw.amp) return saw.y;
  return (
    saw.y + Math.trunc((wave(step + saw.phase, saw.period) * saw.amp) / 1000)
  );
}
