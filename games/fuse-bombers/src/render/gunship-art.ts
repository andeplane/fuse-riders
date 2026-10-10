// The gunships and ghosts of the sky overhaul, drawn in code with Phaser Graphics: a balloon envelope in the player's
// colour over a gondola with a tilting rotor on each side and a ball turret whose launcher points any way round, and a
// small translucent ghost blimp. Each ship owns its game objects; `update` takes plain values each frame and draws
// them. What moves on its own (bob, lean, rotors, flashes, smoke, the wreck) is cosmetic, comes from gunship-pose.ts
// and advances only by the frame time it is given; the hit circle is always the engine's (x, y) and radius.

import type Phaser from "phaser";
import {
  advanceParticles,
  createParticles,
  emitGhost,
  emitGunship,
  GHOST_RADIUS,
  GUNSHIP_RADIUS,
  initialPose,
  lived,
  radiusOf,
  shipVisible,
  stepPose,
  turnScale,
  wreckDrop,
  WRECK_TIME,
  type GhostState,
  type GunshipState,
  type Particles,
  type Pose,
} from "./gunship-pose.js";

export {
  GHOST_RADIUS,
  GUNSHIP_RADIUS,
  WRECK_TIME,
  type GhostState,
  type GunshipState,
  type Pose,
};

/** How a ship looks: fixed for a seat, though `update` takes it every frame and redraws what changes. */
export interface GunshipLook {
  /** Player colour, `0xrrggbb`. */
  readonly color: number;
  /** Hit circle radius (px) to draw for; the art scales with it. Defaults to `GUNSHIP_RADIUS` (`GHOST_RADIUS`). */
  readonly radius?: number;
  /** Varies the bob phase and particle scatter between ships (read on the first update); the seat id works. */
  readonly seed?: number;
  /** Which way the hull faces before the ship has flown anywhere. */
  readonly facing?: 1 | -1;
}

/** The launcher pivots on the hit circle's centre; its muzzle is this far out, in 1/30 of the gunship radius. */
export const LAUNCHER_LENGTH = 26;
/** How far below a ghost's centre its loaded bomb hangs, in 1/18 of the ghost radius. */
export const GHOST_HOOK = 18.5;
/** Shield bubble radius, in 1/30 of the gunship radius. */
export const SHIELD_RADIUS = 38;

const INK = 0x1b1e28;
const METAL = 0x4a5160;
const METAL_LIGHT = 0x8a93a3;
const METAL_DARK = 0x2f343f;
const RIGGING = 0x9aa2b3;
const BLADE_COLOR = 0xd5dae4;
const WINDOW = 0xffe28a;
const BURNT = 0x24262d;

/** `a` blended toward `b` by `t` (0 to 1). */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
const lighten = (c: number, t: number) => mix(c, 0xffffff, t);
const darken = (c: number, t: number) => mix(c, 0x000000, t);

interface Point {
  x: number;
  y: number;
}
type Graphics = Phaser.GameObjects.Graphics;

/** Points from flat coordinates: `pts(x0, y0, x1, y1, …)`. */
const pts = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({
    x: xy[2 * i]!,
    y: xy[2 * i + 1]!,
  }));

/** Traces `points` as the current path, closed unless `open`. */
function trace(g: Graphics, points: readonly Point[], open = false): void {
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  if (!open) g.closePath();
}
const fill = (g: Graphics, points: readonly Point[]) => {
  trace(g, points);
  g.fillPath();
};
const stroke = (g: Graphics, points: readonly Point[], open = false) => {
  trace(g, points, open);
  g.strokePath();
};

/** An envelope outline (or its arc from angle `from` to `to`): an ellipse whose stern half narrows a little. */
function envelope(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from = 0,
  to = 2 * Math.PI,
  n = 44,
): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    const c = Math.cos(a);
    const taper = c < 0 ? 1 - 0.2 * c * c : 1;
    return { x: cx + rx * c, y: cy + ry * Math.sin(a) * taper };
  });
}

/** An ellipse turned by `turn` radians, as a polygon. */
function ellipse(cx: number, cy: number, rx: number, ry: number, turn = 0) {
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  return Array.from({ length: 16 }, (_, i) => {
    const [u, v] = [
      rx * Math.cos((i * Math.PI) / 8),
      ry * Math.sin((i * Math.PI) / 8),
    ];
    return { x: cx + u * c - v * s, y: cy + u * s + v * c };
  });
}

/** Fills `points`, then outlines them twice: dark ink under a thin neon line in a light tint of `color`. */
function neonShape(g: Graphics, points: Point[], body: number, color: number) {
  g.fillStyle(body);
  fill(g, points);
  g.lineStyle(3.6, INK);
  stroke(g, points);
  g.lineStyle(1.5, lighten(color, 0.6), 0.95);
  stroke(g, points);
}

// Gunship geometry in base units (the hit radius is 30), facing right: +x is the bow, y grows down. The drawing stays
// close to the hit circle; only the thin tail and the rotor tips reach a few units past it.
const ENV = { cx: 0, cy: -9, rx: 27, ry: 16 } as const;
const HULL = pts(-13, 12, 13, 12, 17, 13.5, 12, 21, -9, 21, -14, 16.5);
/** The upper fin and the horizontal stabiliser (seen edge-on), behind the envelope. */
const TAIL = [
  pts(-12, -21, -23, -27, -29, -25, -25, -13),
  pts(-19, -13, -32, -15, -32, -5.5, -19, -4),
];
/** Rotor nacelles, one each side, with the rotor mast standing on them. */
const NACELLE = { x: 24, y: 14.5 } as const;
const MAST = 7;
const BLADE = 9;

/** Half the envelope's height at `x` (base units). */
function halfHeight(x: number): number {
  const c = Math.max(-1, Math.min(1, x / ENV.rx));
  return ENV.ry * Math.sqrt(1 - c * c) * (c < 0 ? 1 - 0.2 * c * c : 1);
}

/** The envelope: glow, tail, body with a shaded belly, seams, neon outline, highlight and, once damaged, patches. */
function drawEnvelope(g: Graphics, color: number, damage: number): void {
  const { cx, cy, rx, ry } = ENV;
  const outline = envelope(cx, cy, rx, ry);
  g.clear().lineStyle(10, lighten(color, 0.35), 0.2);
  stroke(g, outline);
  for (const fin of TAIL) neonShape(g, fin, darken(color, 0.3), color);
  g.fillStyle(color);
  fill(g, outline);
  g.fillStyle(darken(color, 0.22));
  fill(g, envelope(cx, cy, rx, ry, 0.3, Math.PI - 0.3, 24));
  // Two ring frames bulging toward the bow, and a gore seam along the belly line.
  g.lineStyle(1.4, darken(color, 0.35), 0.55);
  for (const x0 of [-10, 8]) {
    const h = halfHeight(x0) * 0.96;
    const seam = Array.from({ length: 11 }, (_, i) => -1 + i / 5);
    stroke(
      g,
      seam.map((t) => ({ x: x0 + 3 * (1 - t * t), y: cy + t * h })),
      true,
    );
  }
  stroke(
    g,
    envelope(cx, cy + 2, rx * 0.94, ry * 0.4, 0.2, Math.PI - 0.2, 18),
    true,
  );
  if (damage >= 1) patch(g, 6, -18, 0.3, color);
  if (damage >= 2) {
    patch(g, -11, -5, -0.25, color);
    g.lineStyle(1.8, INK);
    stroke(g, pts(12, -8, 14.5, -12, 16.5, -7, 19, -11), true);
  }
  g.lineStyle(4, INK);
  stroke(g, outline);
  g.lineStyle(1.8, lighten(color, 0.62), 0.95);
  stroke(g, outline);
  g.lineStyle(3.6, 0xffffff, 0.5);
  stroke(
    g,
    envelope(cx + 1, cy - 1, rx * 0.76, ry * 0.66, -2.55, -1.1, 14),
    true,
  );
  g.fillStyle(0xffffff, 0.8).fillCircle(15, -20, 1.8);
}

/** A stitched patch on the envelope. */
function patch(g: Graphics, x: number, y: number, turn: number, color: number) {
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const at = (u: number, v: number) => ({
    x: x + u * c - v * s,
    y: y + u * s + v * c,
  });
  const quad = [at(-4.5, -3.2), at(4.5, -3.2), at(4.5, 3.2), at(-4.5, 3.2)];
  g.fillStyle(darken(color, 0.5));
  fill(g, quad);
  g.lineStyle(1.2, INK);
  stroke(g, quad);
  g.lineStyle(1.1, lighten(color, 0.55));
  for (const u of [-3, 0, 3]) stroke(g, [at(u - 1, -4.4), at(u + 1, -2)], true);
}

/** The gondola: rigging, hull with windows and a stripe in the player's colour, rotor arms and nacelles. */
function drawGondola(
  g: Graphics,
  color: number,
  damage: number,
  burnt: boolean,
) {
  const [body, rim] = burnt ? [BURNT, 0x34363e] : [METAL, METAL_LIGHT];
  g.clear().lineStyle(1.8, burnt ? rim : RIGGING);
  for (const [x0, x1] of [
    [-13, -10],
    [-5, -4],
    [5, 4],
    [13, 10],
  ] as const)
    g.lineBetween(x0, ENV.cy + halfHeight(x0) - 1, x1, 12.5);
  for (const side of [-1, 1]) {
    const [x0, x1] = [side * 12, side * NACELLE.x];
    g.lineStyle(5.4, INK).lineBetween(x0, 16.5, x1, NACELLE.y);
    g.lineStyle(2.4, rim).lineBetween(x0, 16.5, x1, NACELLE.y);
  }
  g.fillStyle(body);
  fill(g, HULL);
  g.fillStyle(rim).fillRect(-12.5, 12, 26, 2.4);
  g.fillStyle(burnt ? 0x3a2a22 : color).fillRect(-11.5, 17.6, 24, 2);
  g.fillStyle(burnt ? 0x2b2b2b : damage >= 2 ? 0xff9a3a : WINDOW);
  for (const x of [-7.5, -2, 3.5]) g.fillRect(x, 14.6, 3.2, 2.4);
  g.lineStyle(2.2, INK);
  stroke(g, HULL);
  for (const side of [-1, 1]) {
    const x = side * NACELLE.x;
    g.fillStyle(rim).fillEllipse(x, NACELLE.y, 9, 6.5);
    g.fillStyle(burnt ? 0x3a2a22 : color).fillRect(
      x - 1.2,
      NACELLE.y - 3,
      2.4,
      6,
    );
    g.lineStyle(1.8, INK).strokeEllipse(x, NACELLE.y, 9, 6.5);
  }
}

/** The ball turret and the launcher, pointing right (the object turns to the launcher angle). */
function drawGun(g: Graphics, color: number): void {
  g.clear().fillStyle(INK).fillRoundedRect(1.5, -3.7, 21, 7.4, 3);
  g.fillStyle(METAL_LIGHT).fillRoundedRect(3, -2.4, 18.5, 4.8, 2);
  g.fillStyle(METAL).fillRect(3.5, 0.3, 17.5, 2.1);
  g.fillStyle(color).fillRect(10, -2.4, 3.5, 4.8);
  g.fillStyle(INK).fillRoundedRect(19.5, -4.8, 7, 9.6, 2.2);
  g.fillStyle(METAL).fillRoundedRect(21, -3.4, 4.2, 6.8, 1.4);
  g.fillStyle(INK).fillCircle(0, 0, 6.6);
  g.fillStyle(METAL).fillCircle(0, 0, 5.2);
  g.fillStyle(METAL_LIGHT).fillCircle(-1.2, -1.4, 2.6);
  g.fillStyle(METAL_DARK).fillCircle(0, 0, 2.2);
}

/** A flat white silhouette of the ship for the hit flash. */
function drawFlash(g: Graphics): void {
  g.clear().fillStyle(0xffffff);
  fill(g, envelope(ENV.cx, ENV.cy, ENV.rx + 1.5, ENV.ry + 1.5));
  for (const shape of [HULL, ...TAIL]) fill(g, shape);
}

/** A rotor seen edge-on: a blur disc that firms up with spin, `blades` blades and the hub, tilted by `tilt`. */
function rotor(
  g: Graphics,
  hub: Point,
  tilt: number,
  pose: Pose,
  blades: number,
  reach: number,
) {
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
  const blur = Math.max(0, Math.min(1, (pose.rotorSpin - 3) / 5));
  g.fillStyle(0xffffff, 0.14 + 0.26 * blur);
  fill(g, ellipse(hub.x, hub.y, reach + 1, 2 + 1.5 * blur, tilt));
  for (let k = 0; k < blades; k++) {
    const r = reach * Math.cos(pose.rotorPhase + (k * 2 * Math.PI) / blades);
    const [x, y] = [hub.x + r * c, hub.y + r * s];
    g.lineStyle(3.6, INK, 1 - 0.5 * blur).lineBetween(hub.x, hub.y, x, y);
    g.lineStyle(1.8, BLADE_COLOR, 1 - 0.4 * blur).lineBetween(
      hub.x,
      hub.y,
      x,
      y,
    );
  }
  g.fillStyle(INK).fillCircle(hub.x, hub.y, 2.2);
}

/** The two rotors on their masts, tilted into the thrust. */
function drawRotors(g: Graphics, pose: Pose, color: number): void {
  g.clear();
  // The hull container mirrors x when it faces left, so the world tilt is mirrored back here.
  const tilt = pose.rotorTilt * (pose.turn < 0 ? -1 : 1);
  for (const side of [-1, 1]) {
    const [x, y] = [side * NACELLE.x, NACELLE.y - 2];
    const hub = { x: x + MAST * Math.sin(tilt), y: y - MAST * Math.cos(tilt) };
    g.lineStyle(4, INK).lineBetween(x, y, hub.x, hub.y);
    g.lineStyle(1.8, METAL_LIGHT).lineBetween(x, y, hub.x, hub.y);
    rotor(g, hub, tilt, pose, 3, BLADE);
    g.fillStyle(lighten(color, 0.3)).fillCircle(hub.x, hub.y, 1.2);
  }
}

const FRONT: ReadonlySet<string> = new Set(["spark", "shred", "fire"]);
/** Tint and opacity of the round puffs; -1 takes a light tint of the ship's colour. */
const PUFFS = {
  exhaust: [0xe4ecff, 0.45],
  smoke: [0xa7acb8, 0.62],
  soot: [0x34363f, 0.78],
  wisp: [-1, 0.3],
} as const;

/** Draws the cosmetic particles (world px): the `front` kinds, or the rest. */
function drawParticles(
  g: Graphics,
  p: Particles,
  color: number,
  front: boolean,
) {
  for (const q of p.list) {
    if (FRONT.has(q.kind) !== front) continue;
    const [k, r] = [lived(q), radiusOf(q)];
    if (q.kind === "spark") {
      g.lineStyle(Math.max(1, r * 1.3), mix(0xfff6c0, 0xff8a2a, k), 1 - k / 2);
      g.lineBetween(q.x, q.y, q.x - q.vx * 0.035, q.y - q.vy * 0.035);
    } else if (q.kind === "shred") {
      // Two-sided fabric: the shade flips as it tumbles.
      const shade = Math.cos(2 * q.spin) > 0 ? color : darken(color, 0.35);
      g.fillStyle(shade, 1 - k * k * k);
      fill(g, ellipse(q.x, q.y, r, r * 0.55, q.spin));
    } else if (q.kind === "fire") {
      g.fillStyle(mix(0xfff1a8, 0xff4a1a, k), 0.9 * (1 - k));
      g.fillCircle(q.x, q.y, r);
      if (k < 0.35)
        g.fillStyle(0xffffff, 0.8 - 2.3 * k).fillCircle(q.x, q.y, r / 2);
    } else {
      const [tint, alpha] = PUFFS[q.kind];
      g.fillStyle(tint < 0 ? lighten(color, 0.5) : tint, alpha * (1 - k));
      g.fillCircle(q.x, q.y, r);
    }
  }
}

const radiusOr = (r: number | undefined, fallback: number) =>
  r !== undefined && Number.isFinite(r) && r > 0 ? r : fallback;

/**
 * One gunship's art. Create it once per seat, call `update` every frame with the gunship's state and the frame time,
 * and `destroy` it with the round. Depths: exhaust and smoke at `depth - 0.5`, the ship at `depth`, sparks, fire and
 * wreck debris at `depth + 0.5`.
 */
export class GunshipArt {
  private readonly root: Phaser.GameObjects.Container;
  private readonly hull: Phaser.GameObjects.Container;
  private readonly envelopeG: Graphics;
  private readonly gondolaG: Graphics;
  private readonly flashG: Graphics;
  private readonly rotorsG: Graphics;
  private readonly gunG: Graphics;
  private readonly overlayG: Graphics;
  private readonly back: Graphics;
  private readonly front: Graphics;
  private particles: Particles | undefined;
  private current: Pose | undefined;
  private drawn = "";
  private gunColor = -1;
  private visible = true;

  constructor(scene: Phaser.Scene, depth = 0) {
    const add = () => scene.add.graphics();
    [this.gondolaG, this.rotorsG, this.envelopeG, this.flashG] = [
      add(),
      add(),
      add(),
      add(),
    ];
    const hullParts = [
      this.gondolaG,
      this.rotorsG,
      this.envelopeG,
      this.flashG,
    ];
    this.hull = scene.add.container(0, 0, hullParts);
    [this.gunG, this.overlayG] = [add(), add()];
    this.root = scene.add.container(0, 0, [
      this.hull,
      this.gunG,
      this.overlayG,
    ]);
    this.root.setDepth(depth);
    this.back = add().setDepth(depth - 0.5);
    this.front = add().setDepth(depth + 0.5);
    drawFlash(this.flashG);
  }

  /** The latest pose, e.g. to know when the wreck animation is over (`pose.wreck >= WRECK_TIME`). */
  get pose(): Pose | undefined {
    return this.current;
  }

  /** Shows or hides everything, particles included; a hidden ship still animates on `update`. */
  setVisible(visible: boolean): this {
    this.visible = visible;
    this.back.setVisible(visible);
    this.front.setVisible(visible);
    this.root.setVisible(
      visible && (!this.current || shipVisible(this.current)),
    );
    return this;
  }

  /** Draws the gunship for this frame; `dt` is the frame time in seconds. */
  update(look: GunshipLook, state: GunshipState, dt: number): void {
    const seed = look.seed ?? 0;
    const unit = radiusOr(look.radius, GUNSHIP_RADIUS) / 30;
    const pose = this.current
      ? stepPose(this.current, state, dt, seed)
      : initialPose(state, seed, look.facing);
    this.current = pose;
    const key = `${look.color}:${pose.damage}:${pose.alive}`;
    if (key !== this.drawn) {
      this.drawn = key;
      drawEnvelope(this.envelopeG, look.color, pose.damage);
      drawGondola(this.gondolaG, look.color, pose.damage, !pose.alive);
    }
    if (this.gunColor !== look.color) {
      this.gunColor = look.color;
      drawGun(this.gunG, look.color);
    }
    const particles = (this.particles ??= createParticles(seed));
    advanceParticles(particles, dt);
    emitGunship(particles, pose, state, unit, dt);
    drawParticles(this.back.clear(), particles, look.color, false);
    drawParticles(this.front.clear(), particles, look.color, true);

    const shown = shipVisible(pose);
    this.root.setVisible(this.visible && shown);
    if (!shown) return;
    this.root.setPosition(state.x, state.y).setScale(unit);
    const wreck = pose.wreck;
    const wrecked = wreck >= 0;
    this.hull
      .setPosition(0, pose.bob + (wrecked ? wreckDrop(wreck) : 0))
      .setRotation(pose.bank + (wrecked ? pose.facing * 1.7 * wreck : 0))
      .setScale(turnScale(pose.turn), 1)
      .setAlpha(wreck > 0.9 ? Math.max(0, 1 - (wreck - 0.9) / 0.7) : 1);
    this.envelopeG.setVisible(!wrecked);
    this.flashG.setVisible(pose.flash > 0).setAlpha(0.85 * pose.flash);
    drawRotors(this.rotorsG, pose, look.color);
    this.gunG
      .setVisible(!wrecked)
      .setPosition(0, pose.bob)
      .setRotation(-state.angle);
    this.drawOverlay(look.color, state, pose);
  }

  /** The loaded glow or reload ring on the turret, the shield bubble, and the wreck's flash and shock ring. */
  private drawOverlay(color: number, state: GunshipState, pose: Pose): void {
    const g = this.overlayG.clear();
    if (pose.wreck >= 0) {
      const t = pose.wreck;
      if (t < 0.14) g.fillStyle(0xffffff, 0.9 - 6.4 * t).fillCircle(0, -4, 36);
      if (t < 0.45) {
        const k = t / 0.45;
        g.lineStyle(1 + 7 * (1 - k), lighten(color, 0.5), 1 - k);
        g.strokeCircle(0, -4, 30 * (0.5 + 1.7 * k));
      }
      return;
    }
    const y = pose.bob;
    if (state.loaded) {
      const pulse = 0.5 + 0.5 * Math.sin(pose.time * 7);
      const [cos, sin] = [Math.cos(state.angle), Math.sin(state.angle)];
      const tip = {
        x: cos * (LAUNCHER_LENGTH - 1),
        y: y - sin * (LAUNCHER_LENGTH - 1),
      };
      g.fillStyle(color, 0.35 + 0.35 * pulse).fillCircle(0, y, 3.4 + pulse);
      g.fillStyle(lighten(color, 0.6)).fillCircle(0, y, 2);
      g.fillStyle(color, 0.3 + 0.3 * pulse).fillCircle(tip.x, tip.y, 5 + pulse);
      g.fillStyle(lighten(color, 0.7)).fillCircle(tip.x, tip.y, 2.2);
    } else {
      const done = Math.max(0, Math.min(1, state.reload));
      g.lineStyle(4.4, INK, 0.7).strokeCircle(0, y, 9.5);
      const start = -Math.PI / 2;
      if (done > 0) g.lineStyle(2.4, 0xffffff, 0.95).beginPath();
      if (done > 0)
        g.arc(0, y, 9.5, start, start + done * 2 * Math.PI).strokePath();
    }
    const shield = Math.max(0, Math.min(1, state.shield));
    if (shield <= 0) return;
    const [f, r, sweep] = [pose.shieldFlash, SHIELD_RADIUS, pose.time * 1.3];
    g.fillStyle(
      lighten(color, 0.75),
      0.06 + 0.08 * shield + 0.25 * f,
    ).fillCircle(0, 0, r);
    g.lineStyle(6, lighten(color, 0.4), 0.2 + 0.2 * shield).strokeCircle(
      0,
      0,
      r,
    );
    g.lineStyle(2.2, 0xffffff, 0.4 + 0.5 * shield + 0.1 * f).strokeCircle(
      0,
      0,
      r,
    );
    g.lineStyle(3.5, 0xffffff, 0.6 * shield + 0.3 * f).beginPath();
    g.arc(0, 0, r - 5, Math.PI * 1.08, Math.PI * 1.36).strokePath();
    g.lineStyle(2, 0xffffff, 0.35 * shield).beginPath();
    g.arc(0, 0, r - 2.5, sweep, sweep + 0.7).strokePath();
  }

  destroy(): void {
    for (const object of [this.root, this.back, this.front]) object.destroy();
  }
}

// Ghost geometry in base units (the ghost radius is 18).
const GHOST_ENV = { cx: 0, cy: -2, rx: 17, ry: 10.5 } as const;
const GHOST_TAIL = [
  pts(-9, -9, -16, -13, -18.5, -11, -14, -5),
  pts(-9, 5, -16, 9, -18.5, 7, -14, 1),
];
const GHOST_GONDOLA = pts(-5, 10, 6, 10, 4, 14, -3, 14);

/** The ghost blimp: envelope with a friendly face, tail fins and a little gondola. */
function drawGhostBody(g: Graphics, color: number): void {
  const { cx, cy, rx, ry } = GHOST_ENV;
  const outline = envelope(cx, cy, rx, ry);
  g.clear().lineStyle(8, lighten(color, 0.5), 0.3);
  stroke(g, outline);
  for (const fin of GHOST_TAIL) neonShape(g, fin, darken(color, 0.2), color);
  g.lineStyle(1.6, RIGGING)
    .lineBetween(-3, 7.5, -4, 10)
    .lineBetween(3, 7.5, 4, 10);
  neonShape(g, GHOST_GONDOLA, METAL, color);
  g.fillStyle(WINDOW).fillRect(-2.5, 11.2, 2, 1.8).fillRect(1.2, 11.2, 2, 1.8);
  neonShape(g, outline, color, color);
  g.fillStyle(darken(color, 0.2));
  fill(g, envelope(cx, cy, rx - 2, ry - 2, 0.35, Math.PI - 0.35, 16));
  g.lineStyle(3, 0xffffff, 0.55);
  stroke(g, envelope(cx, cy - 1, rx * 0.7, ry * 0.6, -2.6, -1.2, 12), true);
  g.fillStyle(0xfbfbf2)
    .fillEllipse(7.5, -3.5, 6, 8)
    .fillEllipse(13.2, -3.5, 4.8, 7);
  g.lineStyle(1.3, INK)
    .strokeEllipse(7.5, -3.5, 6, 8)
    .strokeEllipse(13.2, -3.5, 4.8, 7);
  g.fillStyle(INK).fillCircle(9, -3, 1.7).fillCircle(14.2, -3, 1.4);
  g.fillStyle(0xffffff).fillCircle(9.6, -3.8, 0.6).fillCircle(14.7, -3.7, 0.5);
}

/**
 * One ghost's art: a translucent, smaller blimp in the player's colour with a rotor on top, trailing faint wisps;
 * loaded, a bomb hangs under it. Same lifecycle as `GunshipArt`.
 */
export class GhostArt {
  private readonly root: Phaser.GameObjects.Container;
  private readonly hull: Phaser.GameObjects.Container;
  private readonly bodyG: Graphics;
  private readonly liveG: Graphics;
  private readonly back: Graphics;
  private particles: Particles | undefined;
  private current: Pose | undefined;
  private drawn = -1;

  constructor(scene: Phaser.Scene, depth = 0) {
    [this.bodyG, this.liveG] = [scene.add.graphics(), scene.add.graphics()];
    this.hull = scene.add.container(0, 0, [this.bodyG]);
    this.root = scene.add
      .container(0, 0, [this.liveG, this.hull])
      .setDepth(depth);
    this.back = scene.add.graphics().setDepth(depth - 0.5);
  }

  get pose(): Pose | undefined {
    return this.current;
  }

  setVisible(visible: boolean): this {
    this.root.setVisible(visible);
    this.back.setVisible(visible);
    return this;
  }

  /** Draws the ghost for this frame; `dt` is the frame time in seconds. */
  update(look: GunshipLook, state: GhostState, dt: number): void {
    const seed = look.seed ?? 0;
    const unit = radiusOr(look.radius, GHOST_RADIUS) / 18;
    const input = { ...state, hp: 1, maxHp: 1, shield: 0, alive: true };
    const pose = this.current
      ? stepPose(this.current, input, dt, seed)
      : initialPose(input, seed, look.facing);
    this.current = pose;
    if (this.drawn !== look.color) {
      this.drawn = look.color;
      drawGhostBody(this.bodyG, look.color);
    }
    const particles = (this.particles ??= createParticles(seed + 101));
    advanceParticles(particles, dt);
    emitGhost(particles, pose, state, unit, dt);
    drawParticles(this.back.clear(), particles, look.color, false);

    const alpha = 0.66 + 0.08 * Math.sin(pose.time * 2.4 + seed);
    this.root.setPosition(state.x, state.y).setScale(unit).setAlpha(alpha);
    this.hull.setPosition(0, pose.bob).setRotation(pose.bank);
    this.hull.setScale(turnScale(pose.turn), 1);
    // The rotor on top stays level whichever way the ghost faces; a loaded bomb hangs under the gondola.
    const g = this.liveG.clear();
    const [s, c] = [Math.sin(pose.bank), Math.cos(pose.bank)];
    const hub = { x: s * 16, y: pose.bob - c * 16 };
    g.lineStyle(3.4, INK).lineBetween(s * 11, pose.bob - c * 11, hub.x, hub.y);
    rotor(g, hub, pose.bank, pose, 2, 7.5);
    if (!state.loaded) return;
    const y = pose.bob + GHOST_HOOK;
    g.lineStyle(1.4, INK).lineBetween(0, pose.bob + 14, 0, y - 3);
    g.fillStyle(look.color).fillTriangle(-3, y + 1, 3, y + 1, 0, y + 6.5);
    g.fillStyle(0x2a2d38).fillCircle(0, y, 3.8);
    g.lineStyle(1.2, 0x0c0d12).strokeCircle(0, y, 3.8);
    g.fillStyle(0xffffff, 0.5).fillCircle(-1.2, y - 1.3, 1.1);
  }

  destroy(): void {
    this.root.destroy();
    this.back.destroy();
  }
}
