/**
 * Combat effects as numbers, without three.js: engine events become cues (`cuesOf`), cues become particles in a fixed
 * pool (`emit`), and the pool writes each frame's live particles into instance arrays (`Particles.render`). Particles
 * move on closed-form paths from their birth, so nothing integrates or allocates per frame. Presentation only:
 * wall-clock milliseconds, never the simulation's state.
 */
import {
  SUB,
  TILE_PX,
  type CombatEvent,
  type Mark,
  type UnitKind,
} from "../engine/view.js";

const TILE = SUB * TILE_PX;

/** How a particle draws: a camera-facing glow or smoke puff, a streak along its `d`, a ring or a decal on the ground. */
export const Mode = {
  Glow: 0,
  Smoke: 1,
  Streak: 2,
  Ring: 3,
  Decal: 4,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];
/** Additive modes go to the glow mesh; the rest blend over. */
export const additive = (mode: number) =>
  mode === Mode.Glow || mode === Mode.Streak || mode === Mode.Ring;

/** One effect an event starts, in tiles. */
export interface Cue {
  // prettier-ignore
  kind: "tracer" | "shell" | "flame" | "boom" | "shockwave" | "rally" | "ironHide" | "drop" | "levelUp" | "respawn"
    | "snipe" | "cloak" | "mine" | "mineBlast" | "hijack" | "repair" | "turretDrop" | "fortify" | "overclock" | "dash"
    | "flare" | "blitz";
  x: number;
  z: number;
  /** The far end of a shot or beam (DASH's start). */
  x2: number;
  z2: number;
  /** Explosion or spell radius in tiles; a hero's shot is 1.5. */
  size: number;
  team: number;
}

/** What `cuesOf` asks of the scene: who fired, where buildings and heroes stand. */
export interface CueContext {
  kindOf(unit: number): UnitKind | undefined;
  teamOf(mark: Mark): number;
  site(building: number): { x: number; z: number } | undefined;
  heroAt(seat: number): { x: number; z: number; team: number } | undefined;
  /** The centres of a team's standing factories, for OVERCLOCK. */
  factories(team: number): { x: number; z: number }[];
}

/** The cues one (deduplicated) engine event starts: a torch's shot is a flame, a tank's or a building's a shell. */
// prettier-ignore
export function cuesOf(event: CombatEvent, ctx: CueContext): Cue[] {
  const cue = (kind: Cue["kind"], x: number, z: number, size = 1, team = -1, x2 = x, z2 = z): Cue =>
    ({ kind, x, z, x2, z2, size, team });
  const at = "x" in event ? ([event.x / TILE, event.y / TILE] as const) : ([0, 0] as const);
  switch (event.type) {
    case "shot": {
      const { from, to } = event, kind = from.of === "unit" ? ctx.kindOf(from.id) : undefined;
      const shape = kind === "torch" ? "flame" : kind === "lightTank" || from.of === "building" ? "shell" : "tracer";
      return [cue(shape, from.x / TILE, from.y / TILE, from.of === "hero" ? 1.5 : 1, ctx.teamOf(from), to.x / TILE, to.y / TILE)];
    }
    case "death": return [cue("boom", ...at, event.kind === "lightTank" ? 1 : 0.55)];
    case "heroDeath": return [cue("boom", ...at, 1.1)];
    case "destroyed": {
      const foot = ctx.site(event.building);
      return foot ? [cue("boom", foot.x, foot.z, 1.8)] : [];
    }
    case "respawn": return [cue("respawn", ...at)];
    case "levelUp": {
      const hero = ctx.heroAt(event.seat);
      return hero ? [cue("levelUp", hero.x, hero.z, 1, hero.team)] : [];
    }
    case "cast": {
      // Self spells play on the caster, beams run from the caster to what they touched, the rest play where they land.
      const e = event.effect, team = ctx.heroAt(event.seat)?.team ?? -1, to = [event.toX / TILE, event.toY / TILE] as const;
      if (e === "overclock") return ctx.factories(team).map((f) => cue(e, f.x, f.z, 1, team));
      if (e === "shockwave" || e === "rally" || e === "ironHide" || e === "cloak" || e === "blitz") return [cue(e, ...at, 3, team)];
      if (e === "snipe" || e === "hijack" || e === "repair" || e === "dash") return [cue(e, ...at, 1, team, ...to)];
      if (e === "spotter") return [];
      return [cue(e === "orbitalDrop" ? "drop" : e === "stickyMine" ? "mine" : e, ...to, 3, team)];
    }
    case "mine": return [cue("mineBlast", ...at, 0.8)];
    default: return [];
  }
}

/** Floats per particle: position, velocity, fall, birth, life, size from and to, colour, alpha, mode, streak. */
const STRIDE = 19;
// prettier-ignore
const X = 0, Y = 1, Z = 2, VX = 3, VY = 4, VZ = 5, FALL = 6, BORN = 7, LIFE = 8, S0 = 9, S1 = 10, R = 11, A = 14,
  MODE = 15, DX = 16;

type Rgb = readonly [number, number, number];
/** A particle to spawn; omitted fields are zero (no motion, no fall, no streak). */
export interface Spawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Downward acceleration in tiles per second². */
  fall?: number;
  born: number;
  life: number;
  size: number;
  grow?: number;
  rgb: Rgb;
  alpha: number;
  mode: Mode;
  dx?: number;
  dy?: number;
  dz?: number;
}

/** One frame's instances for a particle mesh: position, streak, (size, alpha, mode, age) and colour. */
export class Frame {
  count = 0;
  constructor(
    readonly capacity: number,
    readonly pos = new Float32Array(capacity * 3),
    readonly dir = new Float32Array(capacity * 3),
    readonly data = new Float32Array(capacity * 4),
    readonly rgb = new Float32Array(capacity * 3),
  ) {}
}

/**
 * A fixed ring of particles: a spawn takes the next slot, so once full the oldest gives way. A particle born in the
 * future (a shell's trail, a delayed blast) waits unseen until its time.
 */
export class Particles {
  private readonly f: Float32Array;
  private cursor = 0;
  constructor(readonly capacity: number) {
    this.f = new Float32Array(capacity * STRIDE);
    this.clear();
  }

  // prettier-ignore
  spawn(p: Spawn): void {
    const o = this.cursor * STRIDE, f = this.f;
    this.cursor = (this.cursor + 1) % this.capacity;
    f[o + X] = p.x; f[o + Y] = p.y; f[o + Z] = p.z;
    f[o + VX] = p.vx ?? 0; f[o + VY] = p.vy ?? 0; f[o + VZ] = p.vz ?? 0; f[o + FALL] = p.fall ?? 0;
    f[o + BORN] = p.born; f[o + LIFE] = p.life; f[o + S0] = p.size; f[o + S1] = p.grow ?? p.size;
    f[o + R] = p.rgb[0]; f[o + R + 1] = p.rgb[1]; f[o + R + 2] = p.rgb[2]; f[o + A] = p.alpha; f[o + MODE] = p.mode;
    f[o + DX] = p.dx ?? 0; f[o + DX + 1] = p.dy ?? 0; f[o + DX + 2] = p.dz ?? 0;
  }

  /** Particles alive at `now` (born and not yet expired). */
  live(now: number): number {
    let n = 0;
    for (let o = 0; o < this.f.length; o += STRIDE) if (this.alive(o, now)) n++;
    return n;
  }

  clear(): void {
    for (let o = 0; o < this.f.length; o += STRIDE) this.f[o + LIFE] = -1;
  }

  private alive(o: number, now: number): boolean {
    const age = now - this.f[o + BORN]!;
    return age >= 0 && age < this.f[o + LIFE]!;
  }

  /** Appends the live particles at `now` to `glow` (additive modes) or `blend`; a full frame drops the rest. */
  // prettier-ignore
  render(now: number, glow: Frame, blend: Frame): void {
    const f = this.f;
    for (let o = 0; o < f.length; o += STRIDE) {
      if (!this.alive(o, now)) continue;
      const out = additive(f[o + MODE]!) ? glow : blend;
      if (out.count === out.capacity) continue;
      const i = out.count++, age = now - f[o + BORN]!, t = age / 1000, k = age / f[o + LIFE]!;
      out.pos[i * 3] = f[o + X]! + f[o + VX]! * t;
      out.pos[i * 3 + 1] = f[o + Y]! + f[o + VY]! * t - 0.5 * f[o + FALL]! * t * t;
      out.pos[i * 3 + 2] = f[o + Z]! + f[o + VZ]! * t;
      for (let c = 0; c < 3; c++) {
        out.dir[i * 3 + c] = f[o + DX + c]!;
        out.rgb[i * 3 + c] = f[o + R + c]!;
      }
      // Smoke eases in, light starts at full, and both fade out; a decal stays until its slot is reused.
      const mode = f[o + MODE]!, fade = mode === Mode.Decal ? 1 : (mode === Mode.Smoke ? Math.min(1, k * 6) : 1) * (1 - k) * (1 - k * 0.3);
      out.data[i * 4] = f[o + S0]! + (f[o + S1]! - f[o + S0]!) * Math.sqrt(k);
      out.data[i * 4 + 1] = f[o + A]! * fade;
      out.data[i * 4 + 2] = f[o + MODE]!;
      out.data[i * 4 + 3] = k;
    }
  }
}

/** Linear HDR colours: above 1 they bloom. */
// prettier-ignore
const C = {
  fire: [3.6, 1.5, 0.4], flash: [4.5, 3, 1.5], spark: [5, 3, 1], smoke: [0.16, 0.14, 0.13], dust: [0.62, 0.5, 0.36],
  debris: [0.08, 0.07, 0.06], scorch: [0.03, 0.025, 0.02], gold: [7, 5.2, 1.4], heal: [1.6, 6, 1.2],
  shield: [1.4, 3.6, 7], drop: [8, 3, 1.4], beam: [5, 7, 9], snipe: [9, 2.4, 1.6], cloak: [1.2, 2.8, 4.4],
  hijack: [4.4, 1.2, 6.5], dash: [1.6, 4.2, 6.5], flare: [9, 1.8, 1], ember: [6, 2.4, 0.5],
} as const satisfies Record<string, Rgb>;
const TEAM_GLOW: readonly Rgb[] = [[3.2, 1, 0.5], [0.6, 1.3, 3.6]]; // prettier-ignore

/** The ground's height under a point, in tiles. */
export type GroundAt = (x: number, z: number) => number;
/** A light flash a cue asks for: where, how bright and for how long (ms). */
export interface Flash {
  x: number;
  y: number;
  z: number;
  power: number;
  life: number;
}

/**
 * Spawns a cue's particles at `now` into `pool`, and its lasting scorch decals into `scorch`. `rand` gives [0, 1)
 * (presentation only, so `Math.random` serves; tests pass a seeded one). Returns the light flashes the cue wants.
 */
// prettier-ignore
export function emit(cue: Cue, now: number, ground: GroundAt, pool: Particles, scorch: Particles, rand: () => number): Flash[] {
  const flashes: Flash[] = [];
  const r = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const y0 = ground(cue.x, cue.z);
  const glow = (x: number, y: number, z: number, size: number, grow: number, life: number, rgb: Rgb, born = now) =>
    pool.spawn({ x, y, z, born, life, size, grow, rgb, alpha: 1, mode: Mode.Glow });
  const blast = (x: number, z: number, size: number, born: number) => {
    const g = ground(x, z), y = g + 0.15 * size;
    flashes.push({ x, y: y + 0.6, z, power: 6 * size, life: 320 });
    for (let i = 0; i < 9; i++)
      pool.spawn({ x, y: y + r(0, 0.3) * size, z, vx: r(-1, 1) * size, vy: r(0.3, 1.6) * size, vz: r(-1, 1) * size,
        born, life: r(260, 460), size: 0.25 * size, grow: r(0.7, 1.1) * size, rgb: C.fire, alpha: 1, mode: Mode.Glow });
    glow(x, y + 0.2, z, 0.4 * size, 1.0 * size, 140, C.flash, born);
    pool.spawn({ x, y: g + 0.06, z, born, life: 380, size: 0.2, grow: 2.4 * size, rgb: C.dust, alpha: 0.9, mode: Mode.Ring });
    for (let i = 0; i < 10; i++)
      pool.spawn({ x, y, z, vx: r(-3, 3) * size, vy: r(2, 5) * size, vz: r(-3, 3) * size, fall: 14, born,
        life: r(500, 900), size: r(0.05, 0.12), rgb: C.debris, alpha: 1, mode: Mode.Smoke });
    for (let i = 0; i < 6; i++)
      pool.spawn({ x: x + r(-0.2, 0.2), y, z: z + r(-0.2, 0.2), vx: r(0.05, 0.3), vy: r(0.5, 0.9), vz: r(-0.1, 0.1),
        born: born + 80 + i * 140, life: r(2200, 3600), size: 0.35 * size, grow: r(1.2, 1.8) * size, rgb: C.smoke,
        alpha: 0.7, mode: Mode.Smoke });
    scorch.spawn({ x, y: g + 0.05, z, born, life: 1e12, size: 1.3 * size, rgb: C.scorch, alpha: 0.6, mode: Mode.Decal });
  };
  const ring = (rgb: Rgb, radius: number, born = now, life = 520, x = cue.x, z = cue.z) =>
    pool.spawn({ x, y: ground(x, z) + 0.08, z, born, life, size: 0.3, grow: radius, rgb, alpha: 1, mode: Mode.Ring });
  const rise = (rgb: Rgb, n: number, x = cue.x, z = cue.z) => {
    for (let i = 0; i < n; i++) {
      const a = r(0, 6.28), d = r(0.1, 0.6);
      pool.spawn({ x: x + Math.cos(a) * d, y: ground(x, z) + r(0, 0.4), z: z + Math.sin(a) * d, vy: r(1, 2.4),
        born: now + r(0, 300), life: r(500, 900), size: 0.09, grow: 0.02, rgb, alpha: 1, mode: Mode.Glow });
    }
  };
  const beam = (rgb: Rgb, width: number, life: number) =>
    pool.spawn({ x: cue.x, y: y0 + 18, z: cue.z, born: now, life, size: width, grow: width * 0.3, rgb, alpha: 1,
      mode: Mode.Streak, dy: -18 });
  /** A still streak from the caster (chest high) to the far end, and the far end's height. */
  const line = (rgb: Rgb, width: number, life: number, lift = 0.7, born = now) => {
    const ay = y0 + lift, by = ground(cue.x2, cue.z2) + 0.4;
    pool.spawn({ x: cue.x, y: ay, z: cue.z, born, life, size: width, grow: width * 0.4, rgb, alpha: 1, mode: Mode.Streak,
      dx: cue.x2 - cue.x, dy: by - ay, dz: cue.z2 - cue.z });
    return by;
  };
  const sparks = (x: number, y: number, z: number, rgb: Rgb, n: number, up = 3, born = now) => {
    for (let i = 0; i < n; i++)
      pool.spawn({ x, y, z, vx: r(-2, 2), vy: r(0.5, up), vz: r(-2, 2), fall: 12, born, life: r(160, 340), size: 0.05,
        grow: 0.01, rgb, alpha: 1, mode: Mode.Glow });
  };
  const puffs = (x: number, y: number, z: number, n: number, rgb: Rgb, vy = 0.6, size = 0.25, born = now) => {
    for (let i = 0; i < n; i++)
      pool.spawn({ x: x + r(-0.15, 0.15), y, z: z + r(-0.15, 0.15), vx: r(-0.3, 0.3), vy: r(0.5, 1.5) * vy, vz: r(-0.3, 0.3),
        born: born + i * 60, life: r(900, 1600), size, grow: size * 3, rgb, alpha: 0.6, mode: Mode.Smoke });
  };
  switch (cue.kind) {
    case "tracer": case "shell": case "flame": {
      const shell = cue.kind === "shell", ax = cue.x, az = cue.z, ay = ground(ax, az) + (shell ? 0.55 : cue.size > 1 ? 0.95 : 0.5);
      const bx = cue.x2, bz = cue.z2, by = ground(bx, bz) + 0.4;
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const mx = ax + (dx / len) * 0.35, mz = az + (dz / len) * 0.35;
      flashes.push({ x: mx, y: ay, z: mz, power: shell ? 4 : 1.5 * cue.size, life: 90 });
      if (cue.kind === "flame") {
        for (let i = 0; i < 12; i++) {
          const k = r(0.7, 1.15), t = r(0.18, 0.28);
          pool.spawn({ x: mx, y: ay, z: mz, vx: (dx * k) / t, vy: (dy * k) / t + 0.6, vz: (dz * k) / t, born: now + i * 12,
            life: t * 1000, size: 0.08, grow: r(0.35, 0.55), rgb: C.fire, alpha: 1, mode: Mode.Glow });
        }
        return flashes;
      }
      glow(mx, ay, mz, 0.18 * cue.size, shell ? 0.7 : 0.4 * cue.size, 70, C.flash);
      let hit = now;
      if (shell) {
        // An arc at 18 tiles a second, with a trail of smoke puffs left where the shell has been.
        const t = Math.max(0.08, len / 18), fall = 10, vy = dy / t + 0.5 * fall * t;
        hit = now + t * 1000;
        pool.spawn({ x: mx, y: ay, z: mz, vx: dx / t, vy, vz: dz / t, fall, born: now, life: t * 1000, size: 0.12,
          rgb: C.spark, alpha: 1, mode: Mode.Glow });
        for (let i = 1; i <= 5; i++) {
          const s = (t * i) / 6;
          pool.spawn({ x: mx + (dx * i) / 6, y: ay + vy * s - 0.5 * fall * s * s, z: mz + (dz * i) / 6, vy: 0.25,
            born: now + s * 1000, life: 600, size: 0.08, grow: 0.3, rgb: C.smoke, alpha: 0.5, mode: Mode.Smoke });
        }
        glow(bx, by, bz, 0.3, 0.9, 160, C.fire, hit);
      } else
        // A streak two fifths of the shot long, running from the muzzle to the target.
        pool.spawn({ x: mx, y: ay, z: mz, vx: (bx - mx) / 0.2, vy: dy / 0.2, vz: (bz - mz) / 0.2, born: now, life: 120,
          size: 0.04 * cue.size, rgb: TEAM_GLOW[cue.team] ?? C.spark, alpha: 1, mode: Mode.Streak, dx: (bx - mx) * 0.4, dy: dy * 0.4, dz: (bz - mz) * 0.4 });
      for (let i = 0; i < 5; i++)
        pool.spawn({ x: bx, y: by, z: bz, vx: r(-2, 2), vy: r(0.5, 3), vz: r(-2, 2), fall: 12, born: hit,
          life: r(160, 300), size: 0.05, grow: 0.01, rgb: C.spark, alpha: 1, mode: Mode.Glow });
      pool.spawn({ x: bx, y: ground(bx, bz) + 0.1, z: bz, vy: 0.3, born: hit, life: 700, size: 0.12, grow: 0.5, rgb: C.dust,
        alpha: 0.45, mode: Mode.Smoke });
      return flashes;
    }
    case "boom":
      blast(cue.x, cue.z, cue.size, now);
      return flashes;
    case "shockwave":
      ring(C.gold, cue.size);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * 6.28;
        pool.spawn({ x: cue.x, y: y0 + 0.15, z: cue.z, vx: Math.cos(a) * 6, vy: 0.4, vz: Math.sin(a) * 6, born: now,
          life: 520, size: 0.2, grow: 0.8, rgb: C.dust, alpha: 0.7, mode: Mode.Smoke });
      }
      flashes.push({ x: cue.x, y: y0 + 1, z: cue.z, power: 6, life: 300 });
      return flashes;
    case "rally":
      ring(C.heal, cue.size);
      ring(C.heal, cue.size * 0.7, now + 220);
      rise(C.heal, 16);
      return flashes;
    case "snipe": {
      // A hot line that hangs a moment, smoke along it, and a spray of sparks where it hits.
      const by = line(C.snipe, 0.03, 300, 0.95);
      for (let i = 1; i <= 4; i++)
        puffs(cue.x + ((cue.x2 - cue.x) * i) / 5, y0 + 0.95 + ((by - y0 - 0.95) * i) / 5, cue.z + ((cue.z2 - cue.z) * i) / 5, 1, C.smoke, 0.2, 0.06);
      glow(cue.x2, by, cue.z2, 0.2, 0.9, 180, C.snipe);
      sparks(cue.x2, by, cue.z2, C.spark, 12, 4);
      flashes.push({ x: cue.x, y: y0 + 1, z: cue.z, power: 3, life: 120 }, { x: cue.x2, y: by + 0.3, z: cue.z2, power: 4, life: 220 });
      return flashes;
    }
    case "cloak":
      ring(C.cloak, 1.1);
      rise(C.cloak, 16);
      puffs(cue.x, y0 + 0.2, cue.z, 4, C.cloak, 0.3, 0.15);
      return flashes;
    case "mine":
      ring(C.flare, 0.5);
      glow(cue.x, y0 + 0.1, cue.z, 0.15, 0.3, 300, C.flare);
      puffs(cue.x, y0 + 0.05, cue.z, 2, C.dust, 0.3, 0.12);
      return flashes;
    case "mineBlast":
      blast(cue.x, cue.z, cue.size, now);
      ring(C.flare, 1.6);
      return flashes;
    case "hijack": {
      // Two pulses of a violet beam, then the tank crackles as it changes sides.
      line(C.hijack, 0.06, 420);
      const by = line(C.hijack, 0.03, 300, 0.7, now + 260);
      ring(C.hijack, 1, now + 300, 600, cue.x2, cue.z2);
      rise(C.hijack, 14, cue.x2, cue.z2);
      sparks(cue.x2, by, cue.z2, C.hijack, 10, 3, now + 300);
      flashes.push({ x: cue.x2, y: by + 0.4, z: cue.z2, power: 4, life: 600 });
      return flashes;
    }
    case "repair":
      line(C.heal, 0.04, 480);
      ring(C.heal, 0.8, now + 120, 520, cue.x2, cue.z2);
      rise(C.heal, 16, cue.x2, cue.z2);
      sparks(cue.x2, ground(cue.x2, cue.z2) + 0.4, cue.z2, C.spark, 6, 2);
      return flashes;
    case "turretDrop":
      // A short supply beam, then the sentry lands in a puff of dust.
      beam(C.beam, 0.22, 320);
      ring(C.dust, 1, now + 260, 500);
      puffs(cue.x, y0 + 0.05, cue.z, 6, C.dust, 0.4, 0.2, now + 260);
      sparks(cue.x, y0 + 0.1, cue.z, C.spark, 8, 2, now + 260);
      flashes.push({ x: cue.x, y: y0 + 1, z: cue.z, power: 4, life: 300 });
      return flashes;
    case "fortify":
      ring(C.shield, cue.size);
      ring(C.shield, cue.size * 0.6, now + 200);
      rise(C.shield, 20);
      flashes.push({ x: cue.x, y: y0 + 1.5, z: cue.z, power: 4, life: 500 });
      return flashes;
    case "overclock": {
      // The factory runs hot: an orange ring at its walls, embers and a burst of black smoke from the chimney.
      ring(C.ember, 1.6, now, 900);
      rise(C.ember, 16);
      const cx = cue.x + 0.6, cy = y0 + 1.5, cz = cue.z - 0.5;
      puffs(cx, cy, cz, 8, C.smoke, 1.4, 0.2);
      sparks(cx, cy, cz, C.ember, 10, 5);
      flashes.push({ x: cue.x, y: y0 + 1.2, z: cue.z, power: 5, life: 900 });
      return flashes;
    }
    case "dash": {
      // A speed streak from where Tally started to where it stopped, kicked-up dust along it.
      pool.spawn({ x: cue.x2, y: y0 + 0.45, z: cue.z2, born: now, life: 260, size: 0.14, grow: 0.02, rgb: C.dash, alpha: 1,
        mode: Mode.Streak, dx: cue.x - cue.x2, dz: cue.z - cue.z2 });
      for (let i = 0; i < 5; i++)
        puffs(cue.x2 + ((cue.x - cue.x2) * i) / 4, y0 + 0.05, cue.z2 + ((cue.z - cue.z2) * i) / 4, 1, C.dust, 0.3, 0.12, now + i * 40);
      return flashes;
    }
    case "flare":
      // A flare arcs up over the tile and hangs there, burning red; the beacon on the ground is drawn while it lasts.
      pool.spawn({ x: cue.x, y: y0 + 0.2, z: cue.z, vy: 5, born: now, life: 500, size: 0.12, rgb: C.flare, alpha: 1, mode: Mode.Glow });
      glow(cue.x, y0 + 2.5, cue.z, 0.4, 0.25, 2600, C.flare, now + 500);
      ring(C.flare, 1, now + 500);
      flashes.push({ x: cue.x, y: y0 + 2.4, z: cue.z, power: 7, life: 3000 });
      return flashes;
    case "blitz":
      ring(C.dash, 2.5);
      ring(C.dash, 1.6, now + 150);
      rise(C.dash, 14);
      return flashes;
    case "ironHide":
      ring(C.shield, 1.2);
      rise(C.shield, 10);
      return flashes;
    case "drop":
      beam(C.drop, 0.5, 520);
      ring(C.drop, cue.size, now + 300);
      blast(cue.x, cue.z, 1.5, now + 300);
      return flashes;
    case "respawn":
      beam(C.beam, 0.3, 600);
      ring(C.beam, 1.4);
      return flashes;
    case "levelUp":
      ring(C.gold, 1.2);
      ring(C.gold, 0.8, now + 160);
      rise(C.gold, 22);
      return flashes;
  }
}

/** Renderer quality: `high` adds ambient occlusion, bloom, grading and antialiasing passes; `low` draws directly. */
export type Quality = "low" | "high";

/** `?quality=low|high` from a query string, else undefined (automatic). */
export function qualityParam(search: string): Quality | undefined {
  const q = new URLSearchParams(search).get("quality");
  return q === "low" || q === "high" ? q : undefined;
}

/** Whether a WebGL renderer string names a software rasteriser (SwiftShader, llvmpipe), where `high` cannot keep up. */
export function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}

/** The longest frame the governor counts as it is; longer ones count as this long. */
const LONG_FRAME = 250;

/**
 * Picks the quality: a forced one stays; otherwise it starts at `start` (high unless the device renders in software)
 * and drops to low for good once frames average slower than `budget` ms over `window` frames after a warm-up of
 * `warmup` frames or 3 s. A window already over budget decides early, so a device at a few frames a second drops in
 * seconds rather than minutes. A lone long frame (a hidden tab coming back) doesn't count; a run of them counts, each
 * as 250 ms.
 */
export class QualityGovernor {
  level: Quality;
  private sum = 0;
  private n = 0;
  private seen = 0;
  private warmed = 0;
  private long = false;
  constructor(
    readonly forced?: Quality,
    readonly budget = 34,
    readonly window = 90,
    readonly warmup = 30,
    start: Quality = "high",
  ) {
    this.level = forced ?? start;
  }
  /** Records one frame's milliseconds; true when the level changed. */
  sample(ms: number): boolean {
    if (this.forced || this.level === "low" || !(ms > 0)) return false;
    const long = ms > LONG_FRAME,
      lone = long && !this.long;
    this.long = long;
    if (lone) return false;
    ms = Math.min(ms, LONG_FRAME);
    this.warmed += ms;
    if (++this.seen <= this.warmup && this.warmed < 3000) return false;
    this.sum += ms;
    const over = this.sum > this.budget * this.window;
    if (++this.n < this.window && !over) return false;
    const slow = over || this.sum / this.n > this.budget;
    this.sum = this.n = 0;
    if (slow) this.level = "low";
    return slow;
  }
}
