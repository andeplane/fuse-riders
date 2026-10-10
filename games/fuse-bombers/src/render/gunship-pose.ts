// The gunship and ghost art's animation, as plain data: what the drawing in gunship-art.ts needs each frame (which
// way the hull faces, the cosmetic bob and bank, rotor spin and tilt, hit flashes, the damage stage, the wreck clock)
// and the small particles it trails (exhaust, smoke, sparks, wreck debris). Everything here is cosmetic and advances
// only by the frame time it is given: it never feeds back into the simulation, and the hit circle stays at the
// engine's (x, y) whatever the bob or bank. No Phaser, so tests run it under Node.

/** Hit circle radius (px) the gunship art is drawn for: the flight kernel's gunship radius (a test pins them equal). */
export const GUNSHIP_RADIUS = 30;
/** Hit circle radius (px) the ghost art is drawn for: the flight kernel's ghost radius. */
export const GHOST_RADIUS = 18;

/** Speed (px/s) a gunship must fly the other way before its hull turns round, so hovering never flickers. */
export const FACING_SPEED = 20;
/** Seconds the hull takes to turn round (its drawn width passes through zero). */
export const TURN_TIME = 0.28;
/** Bob amplitude (base units: 1/30 of a gunship's hit radius, 1/18 of a ghost's) and period (s). Cosmetic. */
export const BOB = { amplitude: 1.6, period: 2.6 } as const;
/** Largest cosmetic lean (radians) at full speed; the hull pitches bow-down into its motion. */
export const MAX_BANK = 0.14;
/** Speed (px/s) at which the lean is full. */
export const BANK_SPEED = 200;
/** Rotor spin (revolutions per second) when idle and at full thrust, and the most the rotors tilt into thrust. */
export const ROTOR = { idle: 2.2, full: 9, tilt: 0.5 } as const;
/** How long a hit flash and a shield flash last (s). */
export const FLASH_TIME = 0.16;
export const SHIELD_FLASH_TIME = 0.24;
/** How long the wreck animation runs after the gunship is destroyed (s); the art is hidden after it. */
export const WRECK_TIME = 1.6;
/** The last part of the wreck (s) in which the falling hull fades out. */
export const WRECK_FADE = 0.7;
/** How fast the falling hull tips over (radians per second of wreck), toward its bow. */
export const WRECK_SPIN = 1.7;
/** Longest frame the animation advances by in one go, so a backgrounded tab does not dump a burst of particles. */
export const MAX_DT = 0.1;
/** Most particles one gunship or ghost keeps; the oldest makes way. */
export const MAX_PARTICLES = 72;

/** What the art is told each frame, in the engine's terms. Angles are radians, 0 = right, π/2 = up, y grows down. */
export interface GunshipState {
  /** Centre of the hit circle (world px). */
  readonly x: number;
  readonly y: number;
  /** Launcher angle: any value, a full circle. */
  readonly angle: number;
  readonly hp: number;
  readonly maxHp: number;
  /** Shield strength, 0 (none) to 1 (full). */
  readonly shield: number;
  /** The launcher can fire now. */
  readonly loaded: boolean;
  /** Reload progress while not loaded, 0 to 1. */
  readonly reload: number;
  /** Velocity (px/s). */
  readonly vx: number;
  readonly vy: number;
  /** Held thrust direction, each -1 to 1 (y grows down): the engine's `thrustDirection` of the held bits. */
  readonly thrustX: number;
  readonly thrustY: number;
  readonly alive: boolean;
}

/** What the ghost art is told each frame. */
export interface GhostState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly thrustX: number;
  readonly thrustY: number;
  /** A bomb hangs under the ghost, ready to drop. */
  readonly loaded: boolean;
}

/** The input to `stepPose`: the part of a gunship's or ghost's state that drives animation. */
export interface PoseInput {
  readonly vx: number;
  readonly thrustX: number;
  readonly thrustY: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  readonly alive: boolean;
}

/** Hull health stage: 0 intact, 1 smoking (half HP or less), 2 burning and sparking (a quarter or less). */
export type DamageStage = 0 | 1 | 2;

export interface Pose {
  /** Seconds of animation so far. */
  readonly time: number;
  /** The way the hull points: 1 right, -1 left. */
  readonly facing: 1 | -1;
  /** The hull's drawn x scale, easing from -1 to 1 (or back) as it turns round. */
  readonly turn: number;
  /** Cosmetic vertical offset of the drawn ship, in base units (1/30 of a gunship's hit radius, 1/18 of a ghost's). */
  readonly bob: number;
  /** Cosmetic lean, radians clockwise on screen. */
  readonly bank: number;
  /** Rotor spin (rev/s) and blade phase (radians). */
  readonly rotorSpin: number;
  readonly rotorPhase: number;
  /** Rotor tilt into the thrust, radians clockwise on screen (world terms; the drawing mirrors it with the hull). */
  readonly rotorTilt: number;
  /** Hit and shield flash strength, 1 at the hit fading to 0. */
  readonly flash: number;
  readonly shieldFlash: number;
  readonly damage: DamageStage;
  /** Seconds since the gunship was destroyed; -1 while alive, `Infinity` when it was never seen alive. */
  readonly wreck: number;
  /** True on the one update in which a ship that was alive is seen destroyed, and only if it was not already
   * exploding a moment ago: it keys the wreck burst, which must not fire twice for one destruction. */
  readonly died: boolean;
  /** Seconds before another destruction may burst again: a rollback that flickers a ship dead, alive, dead must not
   * explode it twice. 0 when free. */
  readonly burstHold: number;
  /** Last seen hp, shield and alive, for spotting hits and destruction. */
  readonly hp: number;
  readonly shield: number;
  readonly alive: boolean;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
const finite = (v: number, fallback = 0): number =>
  Number.isFinite(v) ? v : fallback;

/** Moves `value` toward `target` exponentially with time constant `tau` (s). */
export function ease(
  value: number,
  target: number,
  tau: number,
  dt: number,
): number {
  return target + (value - target) * Math.exp(-dt / tau);
}

/** The damage stage for `hp` out of `maxHp`. */
export function damageStage(hp: number, maxHp: number): DamageStage {
  if (!(maxHp > 0)) return 0;
  const f = hp / maxHp;
  return f <= 0.25 ? 2 : f <= 0.5 ? 1 : 0;
}

/** The way the hull faces after this frame: it turns only once the gunship flies the other way faster than
 * `FACING_SPEED`, so drifting around zero keeps the last facing. */
export function nextFacing(facing: 1 | -1, vx: number): 1 | -1 {
  if (vx > FACING_SPEED) return 1;
  if (vx < -FACING_SPEED) return -1;
  return facing;
}

/** Cosmetic bob (base units) at `time` for a ship with `seed`: bounded by `BOB.amplitude`. */
export function bobAt(time: number, seed: number): number {
  return (
    BOB.amplitude * Math.sin((2 * Math.PI * time) / BOB.period + seed * 1.7)
  );
}

/** Rotor spin (rev/s) the rotors spin up to for a thrust of this size (0 to 1). */
export function rotorTarget(thrust: number): number {
  return ROTOR.idle + (ROTOR.full - ROTOR.idle) * clamp(thrust, 0, 1);
}

/** The first pose of a gunship or ghost. `facing` is the side it faces before it has flown anywhere. */
export function initialPose(
  input: PoseInput,
  seed: number,
  facing: 1 | -1 = 1,
): Pose {
  const f = nextFacing(facing, finite(input.vx));
  const hp = finite(input.hp, finite(input.maxHp));
  return {
    time: 0,
    facing: f,
    turn: f,
    bob: bobAt(0, seed),
    bank: 0,
    rotorSpin: ROTOR.idle,
    rotorPhase: seed,
    rotorTilt: 0,
    flash: 0,
    shieldFlash: 0,
    damage: damageStage(hp, input.maxHp),
    wreck: input.alive ? -1 : Infinity,
    died: false,
    burstHold: 0,
    hp,
    shield: finite(input.shield),
    alive: input.alive,
  };
}

/**
 * The pose after `dt` seconds (capped at `MAX_DT`) with `input` as the latest state. A drop in hp or shield starts a
 * flash; going from alive to destroyed starts the wreck clock, and coming back alive (a new round, or a rollback that
 * undid the hit) clears it. Bob, lean, rotor spin and tilt ease toward their targets and never touch the hit circle.
 */
export function stepPose(
  prev: Pose,
  input: PoseInput,
  dt: number,
  seed: number,
): Pose {
  const d = clamp(finite(dt), 0, MAX_DT);
  const time = prev.time + d;
  const vx = finite(input.vx);
  const tx = clamp(finite(input.thrustX), -1, 1);
  const ty = clamp(finite(input.thrustY), -1, 1);
  const facing = nextFacing(prev.facing, vx);
  const turnRate = (2 / TURN_TIME) * d;
  const turn =
    prev.turn < facing
      ? Math.min(facing, prev.turn + turnRate)
      : Math.max(facing, prev.turn - turnRate);
  const thrust = Math.min(1, Math.sqrt(tx * tx + ty * ty));
  const rotorSpin = ease(prev.rotorSpin, rotorTarget(thrust), 0.25, d);
  // A number that is not finite keeps the last good one, so one bad frame cannot blind the hit detection for good.
  const hp = finite(input.hp, prev.hp);
  const shield = finite(input.shield, prev.shield);
  const hit = input.alive && prev.alive && hp < prev.hp;
  const shieldHit = input.alive && prev.alive && shield < prev.shield;
  const dying = prev.alive && !input.alive;
  const wreck = input.alive
    ? -1
    : prev.alive
      ? 0
      : prev.wreck === Infinity
        ? Infinity
        : prev.wreck + d;
  return {
    time,
    facing,
    turn,
    bob: bobAt(time, seed),
    bank: ease(prev.bank, MAX_BANK * clamp(vx / BANK_SPEED, -1, 1), 0.3, d),
    rotorSpin,
    rotorPhase: (prev.rotorPhase + 2 * Math.PI * rotorSpin * d) % (2 * Math.PI),
    rotorTilt: ease(prev.rotorTilt, ROTOR.tilt * tx, 0.2, d),
    flash: hit ? 1 : Math.max(0, prev.flash - d / FLASH_TIME),
    shieldFlash: shieldHit
      ? 1
      : Math.max(0, prev.shieldFlash - d / SHIELD_FLASH_TIME),
    damage: damageStage(hp, input.maxHp),
    wreck,
    died: dying && prev.burstHold <= 0,
    burstHold:
      dying && prev.burstHold <= 0
        ? WRECK_TIME
        : Math.max(0, prev.burstHold - d),
    hp,
    shield,
    alive: input.alive,
  };
}

/** Narrowest the hull is drawn mid-turn, as a fraction of its width: about its end-on look, never a sliver. */
export const MIN_TURN_SCALE = 0.4;

/** The hull's drawn x scale for a `turn`: its sign is the side it faces, and it never gets thinner than
 * `MIN_TURN_SCALE`, so a turning ship snaps through end-on rather than vanishing into a line. */
export function turnScale(turn: number): number {
  const side = turn < 0 ? -1 : 1;
  return side * Math.max(MIN_TURN_SCALE, Math.min(1, Math.abs(turn)));
}

/** True while the ship itself is drawn: alive, or inside its wreck animation. */
export function shipVisible(pose: Pose): boolean {
  return pose.wreck < WRECK_TIME;
}

/** How far (base units) the gondola has fallen `t` seconds into its wreck. */
export function wreckDrop(t: number): number {
  return t <= 0 ? 0 : 0.5 * 300 * t * t;
}

/** True while a wreck is playing (`wreck` is -1 while the ship lives and `Infinity` if it was never seen alive). */
const wrecking = (pose: Pose): boolean =>
  pose.wreck >= 0 && pose.wreck < Infinity;

/** The turn of the hull container on screen (radians clockwise): the lean, and in a wreck the tipping toward the bow. */
export function hullRotation(pose: Pose): number {
  return (
    pose.bank + (wrecking(pose) ? pose.facing * WRECK_SPIN * pose.wreck : 0)
  );
}

/** The hull container's drop (base units) below the bob: the fall of a wreck, nothing while it flies. */
export function hullDrop(pose: Pose): number {
  return wrecking(pose) ? wreckDrop(pose.wreck) : 0;
}

/** The hull's opacity: full, then fading out over the last `WRECK_FADE` seconds of the wreck. */
export function wreckAlpha(pose: Pose): number {
  const into = pose.wreck - (WRECK_TIME - WRECK_FADE);
  return into > 0 ? Math.max(0, 1 - into / WRECK_FADE) : 1;
}

/** How strongly the shield bubble is drawn (0 to 1): the shield, or while it flashes the flash, so the hit that
 * breaks the last of a shield still shows the bubble for the length of the flash. */
export function bubbleStrength(shield: number, flash: number): number {
  return Math.max(clamp(finite(shield), 0, 1), clamp(finite(flash), 0, 1));
}

/** Where a point of the ship drawing lands in the world: `(px, py)` in base units (x toward the bow) on a ship
 * centred at `(x, y)` with `unit` px per base unit, after the hull's turn, bob, lean and, in a wreck, its tipping and
 * fall: exactly where the hull container in gunship-art.ts puts it. */
export function shipPoint(
  pose: Pose,
  x: number,
  y: number,
  unit: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const lx = px * turnScale(pose.turn);
  const rotation = hullRotation(pose);
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return {
    x: x + unit * (lx * c - py * s),
    y: y + unit * (pose.bob + hullDrop(pose) + lx * s + py * c),
  };
}

export type ParticleKind =
  "exhaust" | "smoke" | "soot" | "spark" | "shred" | "fire" | "wisp";

/** One cosmetic particle in world px. */
export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and seconds to live. */
  age: number;
  life: number;
  /** Start and end radius (px), and spin (radians, for shreds). */
  size: number;
  grow: number;
  spin: number;
}

/** Downward pull (px/s²) on sparks, shreds and other falling bits. */
const GRAVITY: Partial<Record<ParticleKind, number>> = {
  spark: 320,
  shred: 360,
  smoke: -28,
  soot: -36,
};
/** Air drag (1/s) per kind: exhaust and fire slow down fast. */
const DRAG: Partial<Record<ParticleKind, number>> = {
  exhaust: 3,
  fire: 4,
  wisp: 2,
  smoke: 0.8,
  soot: 0.8,
  shred: 0.6,
};

/** A gunship's cosmetic particles and the generator that scatters them; `seed` makes a run repeatable. */
export interface Particles {
  readonly list: Particle[];
  /** Linear congruential generator state. */
  rng: number;
  /** Fractional particles owed per emitter, so low rates still emit at the right average. */
  readonly owed: Record<string, number>;
}

export function createParticles(seed: number): Particles {
  return { list: [], rng: (seed * 2654435761 + 1) >>> 0, owed: {} };
}

/** A cosmetic random number in [0, 1). */
export function random(p: Particles): number {
  p.rng = (Math.imul(p.rng, 1664525) + 1013904223) >>> 0;
  return p.rng / 4294967296;
}

/** Adds a particle, replacing the oldest once `MAX_PARTICLES` are alive. */
export function addParticle(p: Particles, particle: Particle): void {
  if (p.list.length < MAX_PARTICLES) {
    p.list.push(particle);
    return;
  }
  let oldest = 0;
  for (let i = 1; i < p.list.length; i++)
    if (
      p.list[i]!.age / p.list[i]!.life >
      p.list[oldest]!.age / p.list[oldest]!.life
    )
      oldest = i;
  p.list[oldest] = particle;
}

/** How many particles an emitter running at `rate` per second owes after `dt`; keeps the fraction for next time. */
export function owed(
  p: Particles,
  emitter: string,
  rate: number,
  dt: number,
): number {
  const total =
    (p.owed[emitter] ?? 0) +
    Math.max(0, finite(rate)) * clamp(finite(dt), 0, MAX_DT);
  const n = Math.floor(total);
  p.owed[emitter] = total - n;
  return n;
}

/** Ages, moves and drops particles after `dt` seconds (capped at `MAX_DT`). */
export function advanceParticles(p: Particles, dt: number): void {
  const d = clamp(finite(dt), 0, MAX_DT);
  let kept = 0;
  for (const q of p.list) {
    q.age += d;
    if (q.age >= q.life) continue;
    const drag = Math.exp(-(DRAG[q.kind] ?? 0) * d);
    q.vx *= drag;
    q.vy = q.vy * drag + (GRAVITY[q.kind] ?? 0) * d;
    q.x += q.vx * d;
    q.y += q.vy * d;
    if (q.kind === "shred") q.spin += d * 9;
    p.list[kept++] = q;
  }
  p.list.length = kept;
}

/** Fraction of its life a particle has lived, 0 to 1. */
export const lived = (q: Particle): number => clamp(q.age / q.life, 0, 1);

/** Radius (px) of a particle now. */
export const radiusOf = (q: Particle): number =>
  q.size + (q.grow - q.size) * lived(q);

type Spawn = (
  kind: ParticleKind,
  at: { x: number; y: number },
  vx: number,
  vy: number,
  life: number,
  size: number,
  grow: number,
  spin?: number,
) => void;

/** A function that adds fresh particles to `p`; `size` and `grow` are radii in base units, scaled by `unit`. */
const spawner =
  (p: Particles, unit: number): Spawn =>
  (kind, at, vx, vy, life, size, grow, spin = 0) =>
    addParticle(p, {
      ...{ kind, x: at.x, y: at.y, vx, vy, age: 0, life },
      ...{ size: size * unit, grow: grow * unit, spin },
    });

/**
 * The particles a gunship gives off this frame: exhaust puffs from both rotors away from the thrust, smoke from the
 * envelope at damage stage 1, soot, flames and sparks at stage 2, and at the moment it is destroyed a burst of
 * envelope shreds, fire and sparks, then smoke trailing the falling gondola. `unit` is px per base unit.
 */
export function emitGunship(
  p: Particles,
  pose: Pose,
  state: Pick<GunshipState, "x" | "y" | "vx" | "vy" | "thrustX" | "thrustY">,
  unit: number,
  dt: number,
): void {
  const d = clamp(finite(dt), 0, MAX_DT);
  const put = spawner(p, unit);
  const r = (): number => random(p);
  const jitter = (n: number): number => (r() - 0.5) * n;
  const [x, y] = [finite(state.x), finite(state.y)];
  const [vx, vy] = [finite(state.vx), finite(state.vy)];
  const at = (px: number, py: number) => shipPoint(pose, x, y, unit, px, py);
  if (pose.alive) {
    const tx = clamp(finite(state.thrustX), -1, 1);
    const ty = clamp(finite(state.thrustY), -1, 1);
    const thrusting = tx * tx + ty * ty > 0.0025;
    for (let i = owed(p, "exhaust", thrusting ? 18 : 0, d); i > 0; i--) {
      const hub = at((r() < 0.5 ? -1 : 1) * 24, 6);
      const ex = -tx * 90 + jitter(30) + vx * 0.2;
      const ey = -ty * 90 + jitter(30) + 20 + vy * 0.2;
      put("exhaust", hub, ex, ey, 0.35 + r() * 0.15, 1.6, 4.5);
    }
    const smoke = [0, 7, 14][pose.damage] ?? 0;
    for (let i = owed(p, "smoke", smoke, d); i > 0; i--) {
      const from = at(-8 + r() * 12, -20 + r() * 6);
      const sx = -pose.facing * 14 + jitter(14) + vx * 0.15;
      const kind = pose.damage === 2 ? "soot" : "smoke";
      put(kind, from, sx, -18 - r() * 12, 0.9 + r() * 0.5, 3, 10);
    }
    if (pose.damage < 2) return;
    for (let i = owed(p, "flame", 8, d); i > 0; i--) {
      const from = at(13 + jitter(8), -10 + jitter(4));
      const fy = -30 - r() * 20 + vy * 0.3;
      put("fire", from, jitter(16) + vx * 0.3, fy, 0.25 + r() * 0.15, 2.5, 4);
    }
    for (let i = owed(p, "spark", 9, d); i > 0; i--) {
      const [a, v] = [r() * Math.PI * 2, 70 + r() * 80];
      const from = at(jitter(26), 13 + r() * 6);
      const [sx, sy] = [Math.cos(a) * v, Math.sin(a) * v - 40];
      put("spark", from, sx, sy, 0.25 + r() * 0.15, 1.2, 0.6);
    }
    return;
  }
  if (pose.died) {
    const centre = at(0, -6);
    const burst = (
      kind: ParticleKind,
      n: number,
      speed: number,
      life: number,
      size: number,
      grow: number,
    ) => {
      for (let i = 0; i < n; i++) {
        const [a, v, s] = [r() * Math.PI * 2, speed * (0.5 + r()), 0.7 + r()];
        const [c, sn] = [Math.cos(a), Math.sin(a)];
        const from = {
          x: centre.x + c * 6 * unit,
          y: centre.y + sn * 6 * unit,
        };
        const [bx, by] = [c * v + vx * 0.3, sn * v - speed * 0.4 + vy * 0.3];
        const l = life * (0.7 + r() * 0.6);
        put(kind, from, bx, by, l, size * s, grow * s, r() * Math.PI);
      }
    };
    burst("fire", 9, 70, 0.5, 6, 13);
    burst("shred", 12, 190, 1.2, 4, 4);
    burst("spark", 10, 220, 0.45, 1.2, 0.5);
    burst("soot", 6, 40, 1.3, 4, 12);
    return;
  }
  if (pose.wreck >= WRECK_TIME * 0.8) return;
  for (let i = owed(p, "trail", 22, d); i > 0; i--) {
    const from = at(jitter(16), 15);
    const kind = r() < 0.3 ? "fire" : "soot";
    put(kind, from, jitter(20), -10 - r() * 10, 0.5 + r() * 0.5, 2.5, 7);
  }
}

/** The ghost's faint wisps, trailing from its stern. */
export function emitGhost(
  p: Particles,
  pose: Pose,
  state: Pick<GhostState, "x" | "y" | "vx" | "vy">,
  unit: number,
  dt: number,
): void {
  const d = clamp(finite(dt), 0, MAX_DT);
  const put = spawner(p, unit);
  const r = (): number => random(p);
  for (let i = owed(p, "wisp", 7, d); i > 0; i--) {
    const [px, py] = [-16 - r() * 4, -2 + r() * 8];
    const from = shipPoint(
      pose,
      finite(state.x),
      finite(state.y),
      unit,
      px,
      py,
    );
    const wx = -pose.facing * 12 + finite(state.vx) * 0.1;
    put("wisp", from, wx, -6 + (r() - 0.5) * 8, 0.6 + r() * 0.3, 2.2, 4.5);
  }
}
