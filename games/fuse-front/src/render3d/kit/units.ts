/**
 * The four robot units from the concept art, in Z's chunky style: rounded riveted plates in team colour over a
 * gunmetal frame, cyan visors, hazard stripes and stencilled squad numbers. Each is drawn in concept metres and scaled
 * to tiles; it faces +z and stands on y = 0. Walkers' legs and the tank's tracks are separate shared parts so each
 * instance can swing or scroll them, and the tank's turret turns on its own. Presentation only.
 */
import type { UnitKind } from "../../engine/view.js";
import type { Quality } from "../fx.js";
import type { Model } from "../models.js";
import { Rig, type Detail, type V3 } from "./rig.js";

export type RobotKind = UnitKind | "tankTurret";
export type RobotPart = "robotLeg" | "treads";
/** Camera distance (tiles) past which a unit draws its far model: past the default view's edge, and every strategic zoom. */
export const LOD_FAR = 30;
/** Tiles a far unit must come inside `LOD_FAR` before it turns near again, so one on the line does not flicker. */
export const LOD_BAND = 2;

/** Which model a unit at `distance` from the camera draws, given what it drew last (`was`); low quality is always far. */
export function detailAt(distance: number, quality: Quality, was: Detail = "near"): Detail {
  if (quality === "low") return "far";
  return distance > LOD_FAR - (was === "far" ? LOD_BAND : 0) ? "far" : "near";
} // prettier-ignore

const H = Math.PI / 2,
  X: V3 = [H, 0, 0],
  Z: V3 = [0, 0, H];
/** Concept metres to tiles, per kind. */
const SCALE: Record<UnitKind, number> = {
  grunt: 0.4,
  torch: 0.45,
  lightTank: 0.35,
  sentry: 0.48,
};

/** Each walker's legs in tiles: hip half-width, hip height (leg length) and boot width. */
// prettier-ignore
export const ROBOT_LEGS: Partial<Record<UnitKind, { hip: number; len: number; w: number }>> = {
  grunt: { hip: 0.13 * 0.4, len: 0.4 * 0.4, w: 0.2 * 0.4 },
  torch: { hip: 0.21 * 0.45, len: 0.4 * 0.45, w: 0.27 * 0.45 },
};

/** A leg in a frame where the hip is at y = 0.4 and the boot 0.2 wide: thigh, knee, team shin plate, boot, toe cap. */
// prettier-ignore
export function leg(r: Rig): void {
  r.add("dark", r.box(0.13, 0.18, 0.14, 0.03), [0, 0.3, 0])
    .add("team", r.box(0.16, 0.15, 0.18, 0.04), [0, 0.13, 0.02])
    .add("dark", r.box(0.2, 0.08, 0.3, 0.03), [0, 0.04, 0.05]);
  // The shared leg is built at unit size, so `FAR_MIN` cannot tell its knee and toe cap are small: leave them out far.
  if (!r.far) r.add("steel", r.cyl(0.065, 0.065, 0.16, 10), [0, 0.21, 0.01], Z).add("steel", r.box(0.21, 0.025, 0.12, 0.008), [0, 0.02, 0.15]);
}

/** A small rifle along +z, its grip at the origin. */
// prettier-ignore
function rifle(g: Rig): void {
  g.add("gun", g.box(0.07, 0.11, 0.42, 0.015), [0, 0.02, 0.06]).add("steel", g.cyl(0.018, 0.018, 0.34, 8), [0, 0.04, 0.42], X)
    .add("gun", g.cyl(0.03, 0.03, 0.08, 8), [0, 0.04, 0.55], X).add("gun", g.box(0.05, 0.16, 0.07, 0.01), [0, -0.09, 0.12], [0.25, 0, 0])
    .add("gun", g.box(0.06, 0.09, 0.2, 0.02), [0, -0.01, -0.2]).add("dark", g.box(0.04, 0.05, 0.12, 0.01), [0, 0.1, 0.06]);
}

/** About 1.2 m: a stubby trooper under a big rounded helmet with a full-width visor, rifle at port arms. */
// prettier-ignore
function grunt(r: Rig): void {
  r.add("dark", r.box(0.34, 0.12, 0.24, 0.04), [0, 0.41, 0]).add("dark", r.box(0.42, 0.28, 0.32, 0.07), [0, 0.56, 0])
    .add("team", r.extrude([[-0.19, -0.1], [0.19, -0.1], [0.21, 0.06], [0.14, 0.13], [-0.14, 0.13], [-0.21, 0.06]], 0.06), [0, 0.56, 0.16])
    .add("dark", r.box(0.3, 0.26, 0.16, 0.04), [0, 0.6, -0.22]).add("steel", r.cyl(0.025, 0.025, 0.2, 8), [0.1, 0.62, -0.31])
    .add("eye", r.sphere(0.022), [-0.1, 0.7, -0.305]);
  const h = r.sub([0, 0.88, 0.02]);
  h.add("team", h.box(0.66, 0.44, 0.62, 0.15, 2), [0, 0.02, 0]).add("team", h.box(0.14, 0.08, 0.54, 0.035), [0, 0.25, -0.02])
    .add("dark", h.box(0.58, 0.14, 0.1, 0.035), [0, -0.02, 0.29]).add("visor", h.box(0.48, 0.05, 0.04, 0.012), [0, -0.015, 0.335])
    .add("dark", h.box(0.68, 0.05, 0.16, 0.02), [0, 0.07, 0.29], [-0.12, 0, 0]).add("dark", h.box(0.44, 0.1, 0.16, 0.035), [0, -0.19, 0.2])
    .pair((s) => h.add("dark", h.cyl(0.1, 0.11, 0.08, 12), [s * 0.35, -0.03, 0.02], Z).add("steel", h.cyl(0.06, 0.06, 0.03, 10), [s * 0.395, -0.03, 0.02], Z)
      .decal("07", 0.2, [s * 0.336, 0.04, -0.08], [0, s * H, 0]))
    .add("steel", h.cyl(0.008, 0.008, 0.42, 4), [-0.3, 0.36, -0.15], [-0.15, 0, 0.1]).add("eye", h.sphere(0.02), [-0.32, 0.57, -0.18]);
  r.pair((s) => r.add("team", r.box(0.17, 0.12, 0.2, 0.04), [s * 0.29, 0.67, 0])
    .add("dark", r.beam([s * 0.28, 0.62, 0], [s * 0.27, 0.48, 0.08], 0.08, true)).add("dark", r.box(0.1, 0.09, 0.1, 0.025), [s * 0.22, 0.47, 0.17]));
  rifle(r.sub([0.08, 0.5, 0.2], [-0.08, -0.25, 0.1]));
}

/** About 1.25 m and broad: a barrel body with its head sunk in, twin fuel tanks, a flamer arm with a hot nozzle. */
// prettier-ignore
function torch(r: Rig): void {
  r.add("team", r.box(0.8, 0.5, 0.56, 0.14, 2), [0, 0.64, 0]).add("dark", r.box(0.82, 0.09, 0.58, 0.03), [0, 0.43, 0])
    .add("team", r.extrude([[-0.3, -0.12], [0.3, -0.12], [0.33, 0.1], [-0.33, 0.1]], 0.05), [0, 0.62, 0.285])
    .decal("13", 0.22, [-0.17, 0.62, 0.312])
    .add("dark", r.box(0.36, 0.22, 0.26, 0.06), [0, 0.92, 0.14]).add("team", r.box(0.44, 0.09, 0.34, 0.04), [0, 1.04, 0.1])
    .add("flame", r.box(0.26, 0.04, 0.03, 0.01), [0, 0.965, 0.27]);
  for (let i = 0; i < 4; i++) r.add("steel", r.box(0.26, 0.018, 0.03, 0), [0, 0.835 + i * 0.03, 0.27]);
  r.pair((s) => r.add("orange", r.capsule(0.14, 0.36), [s * 0.18, 0.86, -0.4]).add("hazard", r.cyl(0.145, 0.145, 0.07, 14), [s * 0.18, 0.72, -0.4])
    .add("dark", r.cyl(0.06, 0.08, 0.06, 8), [s * 0.18, 1.19, -0.4]).add("steel", r.cyl(0.03, 0.03, 0.05, 8), [s * 0.18, 1.24, -0.4])
    .add("dark", r.beam([s * 0.24, 0.6, -0.36], [0.44, 0.5, 0.04], 0.05, true)));
  const f = r.sub([0.52, 0.6, 0.18]);
  f.add("team", f.box(0.28, 0.22, 0.32, 0.07), [0, 0.18, -0.15]).add("steel", f.cyl(0.09, 0.1, 0.5, 12), [0, 0, 0.12], X)
    .add("orange", f.cyl(0.105, 0.105, 0.06, 12), [0, 0, 0.02], X).add("dark", f.cyl(0.105, 0.105, 0.04, 12), [0, 0, 0.22], X)
    .add("dark", f.cyl(0.12, 0.06, 0.16, 12), [0, 0, 0.44], X).add("flame", f.sphere(0.05), [0, 0.01, 0.53])
    .add("steel", f.cyl(0.012, 0.012, 0.12, 6), [0, -0.09, 0.45], X).add("flame", f.sphere(0.02), [0, -0.09, 0.52]);
  r.add("dark", r.beam([-0.46, 0.75, 0], [-0.5, 0.5, 0.08], 0.11, true)).add("team", r.box(0.22, 0.2, 0.26, 0.06), [-0.45, 0.78, -0.02])
    .add("dark", r.box(0.2, 0.18, 0.2, 0.05), [-0.5, 0.42, 0.1]);
}

/** About 2.1 m long: a sloped hull with side skirts, road wheels, jerrycans and headlamps; the tracks are `treads`. */
// prettier-ignore
function lightTank(r: Rig): void {
  r.add("team", r.hull([[-1, 0.3], [-1.06, 0.58], [-0.9, 0.7], [0.5, 0.7], [1.05, 0.46], [1, 0.3]], 1, 0.04));
  r.pair((s) => {
    r.add("team", r.box(0.06, 0.2, 1.9, 0.02), [s * 0.79, 0.5, 0.02]).add("dark", r.box(0.32, 0.03, 2.1, 0.01), [s * 0.62, 0.6, 0])
      .add("dark", r.cyl(0.035, 0.035, 0.16, 8), [s * 0.36, 0.62, -1], X).add("amber", r.sphere(0.045), [s * 0.34, 0.6, 1.01]);
    for (const z of [-0.8, -0.4, 0, 0.4, 0.8])
      r.add("dark", r.cyl(0.15, 0.15, 0.04, 12), [s * 0.77, 0.17, z], Z).add("steel", r.cyl(0.06, 0.06, 0.06, 8), [s * 0.79, 0.17, z], Z);
  });
  r.add("hazard", r.box(0.8, 0.12, 0.02, 0), [0, 0.42, -1.04]).add("dark", r.box(0.3, 0.1, 0.4, 0.02), [-0.3, 0.75, -0.6])
    .add("orange", r.box(0.18, 0.24, 0.1, 0.02), [0.25, 0.82, -0.82]).add("orange", r.box(0.18, 0.24, 0.1, 0.02), [0.05, 0.82, -0.82]);
}

/** The tank's turret on its ring at the origin, so it turns toward what it shoots and kicks back along its barrel. */
// prettier-ignore
function tankTurret(r: Rig): void {
  const t = r.sub([0, 0.7, 0]);
  t.add("team", t.plan([[-0.42, -0.45], [0.42, -0.45], [0.48, 0.05], [0.28, 0.45], [-0.28, 0.45], [-0.48, 0.05]], 0.3, 0.05))
    .add("dark", t.box(0.36, 0.22, 0.14, 0.04), [0, 0.15, 0.47]).add("dark", t.cyl(0.14, 0.14, 0.06, 12), [-0.18, 0.33, -0.12])
    .add("steel", t.box(0.06, 0.08, 0.06, 0.01), [-0.18, 0.39, -0.06]).add("steel", t.cyl(0.01, 0.01, 1, 4), [0.3, 0.8, -0.35])
    .add("eye", t.sphere(0.025), [0.3, 1.3, -0.35]).add("dark", t.box(0.6, 0.16, 0.18, 0.03), [0, 0.15, -0.52])
    .add("visor", t.box(0.1, 0.04, 0.02, 0), [0.22, 0.24, 0.44])
    .pair((s) => t.decal("21", 0.26, [s * 0.456, 0.15, 0.05], [0, s * (H - 0.1), 0]))
    .add("steel", t.cyl(0.05, 0.055, 1.2, 10), [0, 0.15, 1.1], X).add("gun", t.cyl(0.075, 0.075, 0.22, 10), [0, 0.15, 0.9], X)
    .add("gun", t.box(0.16, 0.1, 0.2, 0.02), [0, 0.15, 1.72]);
}

/** A splayed tripod under a boxy head with twin barrels, an ammo drum and a red sensor. */
// prettier-ignore
function sentry(r: Rig): void {
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 3, fx = Math.sin(a) * 0.5, fz = Math.cos(a) * 0.5;
    r.add("dark", r.beam([0, 0.42, 0], [fx, 0.05, fz], 0.06)).add("steel", r.beam([fx * 0.3, 0.3, fz * 0.3], [fx * 0.7, 0.14, fz * 0.7], 0.035, true))
      .add("dark", r.cyl(0.07, 0.08, 0.04, 10), [fx, 0.02, fz]);
  }
  r.add("steel", r.cyl(0.1, 0.11, 0.14, 12), [0, 0.43, 0]).add("hazard", r.cyl(0.115, 0.115, 0.05, 12), [0, 0.4, 0])
    .add("dark", r.cyl(0.08, 0.08, 0.1, 10), [0, 0.54, 0]);
  const h = r.sub([0, 0.7, 0]);
  h.add("team", h.box(0.38, 0.24, 0.42, 0.07)).add("team", h.box(0.42, 0.06, 0.34, 0.02), [0, 0.14, -0.03])
    .add("dark", h.box(0.26, 0.18, 0.08, 0.03), [0, -0.01, 0.22]).add("eye", h.sphere(0.035), [0, 0.09, 0.25])
    .pair((s) => h.add("dark", h.cyl(0.03, 0.03, 0.5, 8), [s * 0.07, -0.03, 0.45], X).add("dark", h.cyl(0.045, 0.045, 0.12, 8), [s * 0.07, -0.03, 0.66], X)
      .add("steel", h.cyl(0.048, 0.048, 0.03, 8), [s * 0.07, -0.03, 0.32], X))
    .add("orange", h.cyl(0.12, 0.12, 0.12, 12), [0.25, -0.02, -0.04], Z).add("dark", h.cyl(0.06, 0.06, 0.13, 8), [0.25, -0.02, -0.04], Z)
    .decal("S3", 0.18, [-0.192, 0, -0.05], [0, -H, 0]);
}

/** One side's track belt: a loop round two end wheels, drawn in the tread paint so its links scroll. */
// prettier-ignore
function track(r: Rig, x: number): void {
  const rad = 0.18, half = 0.88, steps = r.far ? 2 : 8, loop: [number, number][] = [];
  for (const [end, from] of [[half, 0], [-half, Math.PI]] as const)
    for (let i = 0; i <= steps; i++) {
      const a = from + (i / steps) * Math.PI;
      loop.push([end + Math.sin(a) * rad, rad + Math.cos(a) * rad]);
    }
  r.add("tread", r.hull(loop, 0.28, 0.02), [x, 0, 0]);
}

const BUILDERS: Record<RobotKind, (r: Rig) => void> = {
  grunt,
  torch,
  lightTank,
  sentry,
  tankTurret,
};

/** A unit's model. Legs and tracks stand still in it unless `moving` parts are left out to be drawn on their own. */
// prettier-ignore
export function robotModel(kind: RobotKind, detail: Detail = "near", moving = true): Model {
  const root = new Rig(detail), unit = kind === "tankTurret" ? "lightTank" : kind, spec = ROBOT_LEGS[unit];
  BUILDERS[kind](root.sub([0, 0, 0], [0, 0, 0], SCALE[unit]));
  if (moving && spec) root.pair((s) => leg(root.sub([s * spec.hip, 0, 0], [0, 0, 0], [spec.w / 0.2, spec.len / 0.4, spec.w / 0.2])));
  if (moving && kind === "lightTank") root.pair((s) => track(root.sub([0, 0, 0], [0, 0, 0], SCALE.lightTank), s * 0.62));
  return root.bake();
}

/**
 * A shared moving part: a walker's leg (unit size, hip at the origin, foot at y = −1, drawn scaled by `ROBOT_LEGS`)
 * or both of a tank's tracks.
 */
// prettier-ignore
export function robotPart(kind: RobotPart, detail: Detail = "near"): Model {
  const root = new Rig(detail);
  if (kind === "robotLeg") leg(root.sub([0, -1, 0], [0, 0, 0], [5, 2.5, 5]));
  else root.pair((s) => track(root.sub([0, 0, 0], [0, 0, 0], SCALE.lightTank), s * 0.62));
  return root.bake(kind === "robotLeg" ? -1 : 0, kind === "robotLeg" ? 1 : 0.35);
}
