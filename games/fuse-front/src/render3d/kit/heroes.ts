/**
 * The four heroes from the concept art, about twice a Grunt's height and each with its own silhouette: Brick's massive
 * shoulders and cannon, Vix's hood, cloak and very long rifle, Rivet's hard hat and crane arm, Tally's round head,
 * antennae and jump jets. Built with the robot kit in concept metres and scaled to tiles; each faces +z, stands on
 * y = 0 and walks on the shared robot leg (`ROBOT_LEGS`' part, scaled by `HERO_LEGS`). Presentation only.
 */
import * as THREE from "three";
import type { HeroKind, Model } from "../models.js";
import { Rig, type Detail, type V3 } from "./rig.js";
import { leg } from "./units.js";

const PI = Math.PI,
  H = PI / 2,
  X: V3 = [H, 0, 0],
  Z: V3 = [0, 0, H];
/** Concept metres to tiles: one scale for all four, so Brick towers over Vix as in the concept. */
const SCALE = 0.42;

/** Each hero's legs in tiles: hip half-width, hip height (leg length) and boot width, from the concept's legs. */
// prettier-ignore
export const HERO_LEGS: Record<HeroKind, { hip: number; len: number; w: number }> = {
  brick: { hip: 0.3 * SCALE, len: 0.84 * SCALE, w: 0.4 * SCALE },
  vix: { hip: 0.14 * SCALE, len: 1.0 * SCALE, w: 0.15 * SCALE },
  rivet: { hip: 0.19 * SCALE, len: 0.62 * SCALE, w: 0.26 * SCALE },
  tally: { hip: 0.13 * SCALE, len: 0.72 * SCALE, w: 0.18 * SCALE },
};

const v2 = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([x, y]) => new THREE.Vector2(x, y));
const torus = (r: Rig, R: number, t: number, arc = PI * 2) => new THREE.TorusGeometry(R, t, r.far ? 4 : 6, r.far ? 8 : 20, arc); // prettier-ignore
const lathe = (r: Rig, pts: readonly (readonly [number, number])[], from = 0, arc = PI * 2) => new THREE.LatheGeometry(v2(pts), r.far ? 8 : 24, from, arc); // prettier-ignore
/** A five-pointed star outline, `R` across its points. */
const star = (R: number) => Array.from({ length: 10 }, (_, i) => [Math.sin((i * PI) / 5) * (i % 2 ? R * 0.42 : R), Math.cos((i * PI) / 5) * (i % 2 ? R * 0.42 : R)] as const); // prettier-ignore

/** An arm from the shoulder at `a` to the hand at `b`: a team shoulder pad, a dark limb and a dark fist. */
// prettier-ignore
function arm(r: Rig, a: V3, b: V3, w: number, pad: V3, fist: number): void {
  r.add("team", r.box(...pad, 0.05), a).add("dark", r.beam(a, b, w, true)).add("dark", r.box(fist, fist, fist, fist / 4), b);
}

/** The heavy bruiser: a barrel chest with a gold star plate, huge pauldrons, a sunken head with a yellow visor and a
 * cannon on the right shoulder. */
// prettier-ignore
function brick(r: Rig): void {
  r.add("dark", r.box(0.66, 0.22, 0.44, 0.07), [0, 0.86, 0]).add("dark", r.box(0.84, 0.5, 0.56, 0.12), [0, 1.08, -0.02])
    .add("team", r.box(1.02, 0.5, 0.6, 0.16, 2), [0, 1.3, 0])
    .add("team", r.extrude([[-0.38, -0.2], [0.38, -0.2], [0.44, 0.12], [0.3, 0.24], [-0.3, 0.24], [-0.44, 0.12]], 0.08, 0.025), [0, 1.27, 0.3])
    .add("gold", r.extrude([[-0.2, -0.13], [0.2, -0.13], [0.24, 0.05], [0, 0.16], [-0.24, 0.05]], 0.04, 0.012), [0, 1.27, 0.35])
    .add("dark", r.extrude(star(0.09), 0.02, 0.004), [0, 1.27, 0.375]);
  const h = r.sub([0, 1.62, 0.12]);
  h.add("dark", h.box(0.4, 0.28, 0.36, 0.08)).add("team", h.box(0.48, 0.16, 0.44, 0.07), [0, 0.15, -0.02])
    .add("gold", h.box(0.08, 0.06, 0.46, 0.02), [0, 0.25, -0.02]).add("dark", h.box(0.5, 0.06, 0.12, 0.02), [0, 0.07, 0.2], [-0.15, 0, 0])
    .add("amber", h.box(0.32, 0.055, 0.04, 0.015), [0, 0, 0.18]).add("steel", h.box(0.26, 0.09, 0.08, 0.02), [0, -0.1, 0.17]);
  r.pair((s) => {
    const p = r.sub([s * 0.72, 1.5, 0], [0, 0, s * -0.12]);
    p.add("team", p.box(0.56, 0.44, 0.66, 0.17, 2), [0, 0.06, 0]).add("gold", p.box(0.6, 0.06, 0.7, 0.025), [0, -0.15, 0])
      .add("team", p.box(0.5, 0.12, 0.58, 0.05), [0, -0.24, 0]).add("dark", p.box(0.44, 0.1, 0.5, 0.04), [0, -0.33, 0]);
    r.add("dark", r.beam([s * 0.78, 1.25, 0], [s * 0.8, 0.95, 0.06], 0.2, true)).add("team", r.box(0.32, 0.36, 0.36, 0.08), [s * 0.82, 0.9, 0.1])
      .add("dark", r.box(0.34, 0.28, 0.34, 0.09), [s * 0.84, 0.64, 0.14]);
  });
  const c = r.sub([0.72, 1.88, -0.05]);
  c.add("dark", c.box(0.32, 0.18, 0.4, 0.05)).add("team", c.box(0.3, 0.22, 0.5, 0.06), [0, 0.22, 0.05])
    .add("steel", c.cyl(0.075, 0.085, 0.95, 14), [0, 0.22, 0.65], X).add("gun", c.cyl(0.11, 0.11, 0.16, 14), [0, 0.22, 0.36], X)
    .add("gun", c.box(0.2, 0.14, 0.22, 0.03), [0, 0.22, 1.12]).add("amber", c.sphere(0.03), [0.1, 0.35, 0.25]);
  r.add("dark", r.box(0.78, 0.6, 0.34, 0.08), [0, 1.3, -0.42])
    .pair((s) => r.add("steel", r.cyl(0.07, 0.08, 0.56, 12), [s * 0.24, 1.78, -0.5]).add("gun", r.cyl(0.085, 0.085, 0.06, 12), [s * 0.24, 2.07, -0.5]));
}

/** The sniper: thin under a peaked hood and an open cloak with a team lining, one red eye, and a very long rifle. */
// prettier-ignore
function vix(r: Rig): void {
  r.add("dark", r.box(0.3, 0.14, 0.2, 0.04), [0, 1.02, 0]).add("dark", r.box(0.24, 0.24, 0.16, 0.04), [0, 1.2, 0])
    .add("team", r.extrude([[-0.11, -0.1], [0.11, -0.1], [0.13, 0.09], [0, 0.14], [-0.13, 0.09]], 0.04, 0.012), [0, 1.38, 0.1])
    .add("dark", r.box(0.34, 0.26, 0.22, 0.06), [0, 1.4, -0.02]);
  // The cloak's panels hang open at the front; the lining is the same curve turned inward, in team colour.
  const cloak = [[0.16, 1.56], [0.24, 1.48], [0.25, 1.3], [0.27, 1], [0.31, 0.7], [0.36, 0.42]] as const, open = 0.85;
  r.add("dark", lathe(r, [...cloak].reverse(), open, PI * 2 - open * 2))
    .add("team", lathe(r, cloak.map(([x, y]) => [x - 0.012, y] as const), open, PI * 2 - open * 2))
    .add("dark", lathe(r, [[0.33, 1.36], [0.3, 1.5], [0.2, 1.62]], 0.35, PI * 2 - 0.7))
    .pair((s) => r.add("team", r.box(0.05, 0.3, 0.14, 0.02), [s * 0.2, 0.86, 0.06], [0, 0, s * 0.08]));
  const h = r.sub([0, 1.72, 0.02]);
  h.add("dark", new THREE.SphereGeometry(0.22, h.far ? 8 : 18, h.far ? 6 : 12, H + 0.62, PI * 2 - 1.24, 0, PI * 0.74).scale(1, 1.12, 1.18))
    .add("dark", new THREE.ConeGeometry(0.13, 0.34, h.far ? 6 : 12, 1, true), [0, 0.17, -0.13], [-0.75, 0, 0])
    .add("team", torus(h, 0.15, 0.017).scale(1, 1.25, 1), [0, -0.02, 0.16]).add("dark", h.sphere(0.16), [0, -0.02, -0.01])
    .add("gun", h.box(0.2, 0.14, 0.1, 0.045), [0, -0.05, 0.08]).add("eye", h.sphere(0.055), [0, 0, 0.15]);
  arm(r, [0.2, 1.42, 0], [0.1, 1.06, 0.16], 0.07, [0.16, 0.1, 0.2], 0.08);
  arm(r, [-0.2, 1.42, 0], [-0.08, 0.95, 0.56], 0.07, [0.16, 0.1, 0.2], 0.08);
  const g = r.sub([0.1, 1.08, 0.2], [0.35, -0.45, 0]);
  g.add("gun", g.box(0.06, 0.1, 0.6, 0.015), [0, 0, 0.1]).add("steel", g.cyl(0.018, 0.018, 1.1, 8), [0, 0.02, 0.95], X)
    .add("gun", g.cyl(0.032, 0.032, 0.3, 8), [0, 0.02, 1.4], X)
    .add("gun", g.extrude([[0, 0], [0.32, 0.02], [0.34, -0.13], [0.22, -0.1], [0.06, -0.04]], 0.05, 0.01), [0, 0, -0.2], [0, H, 0])
    .add("dark", g.cyl(0.03, 0.03, 0.3, 10), [0, 0.1, 0.12], X).add("eye", g.cyl(0.026, 0.026, 0.01, 10), [0, 0.1, 0.275], X)
    .add("team", g.box(0.065, 0.035, 0.3, 0.01), [0, 0.06, 0.45]);
}

/** The engineer: a hard hat with a work lamp, round goggles, a crane arm off the back and a giant wrench. */
// prettier-ignore
function rivet(r: Rig): void {
  r.add("dark", r.box(0.46, 0.16, 0.34, 0.05), [0, 0.66, 0]).add("dark", r.box(0.5, 0.06, 0.38, 0.02), [0, 0.72, 0])
    .pair((s) => r.add("orange", r.box(0.1, 0.12, 0.08, 0.02), [s * 0.18, 0.68, 0.2]))
    .add("team", r.box(0.62, 0.46, 0.46, 0.13, 2), [0, 0.96, 0]).add("orange", r.box(0.63, 0.06, 0.47, 0.02), [0, 0.8, 0])
    .add("team", r.extrude([[-0.24, -0.14], [0.24, -0.14], [0.26, 0.1], [-0.26, 0.1]], 0.05, 0.015), [0, 0.98, 0.235])
    .add("dark", r.cyl(0.06, 0.06, 0.08, 10), [0, 1.2, 0]);
  const h = r.sub([0, 1.36, 0.03]);
  h.add("team", h.box(0.4, 0.3, 0.36, 0.1)).add("steel", h.box(0.3, 0.12, 0.06, 0.03), [0, -0.08, 0.17])
    .add("dark", h.box(0.42, 0.06, 0.38, 0.02), [0, 0.05, 0])
    .pair((s) => h.add("dark", h.cyl(0.075, 0.08, 0.08, 16), [s * 0.085, 0.05, 0.2], X).add("steel", torus(h, 0.075, 0.014), [s * 0.085, 0.05, 0.24])
      .add("visor", h.cyl(0.06, 0.06, 0.01, 16), [s * 0.085, 0.05, 0.245], X));
  const hat = h.sub([0, 0.14, 0], [0, 0, 0], [1, 1, 1.06]);
  hat.add("gold", lathe(hat, [[0.001, 0.2], [0.1, 0.19], [0.18, 0.13], [0.22, 0.04], [0.23, 0], [0.001, 0]]))
    .add("gold", hat.cyl(0.3, 0.3, 0.025, 20), [0, 0, 0.03]).add("gold", hat.box(0.05, 0.05, 0.42, 0.02), [0, 0.18, 0])
    .add("dark", hat.box(0.1, 0.08, 0.05, 0.01), [0, 0.1, 0.22]).add("amber", hat.cyl(0.035, 0.035, 0.02, 12), [0, 0.1, 0.25], X);
  r.add("dark", r.box(0.5, 0.5, 0.3, 0.06), [0, 1, -0.36]).add("orange", r.capsule(0.08, 0.3), [-0.17, 0.98, -0.55])
    .add("steel", r.cyl(0.1, 0.12, 0.12, 14), [0.12, 1.3, -0.38]);
  // The crane: two rails up and over the head with rungs between, a cable and a hook at the tip.
  const c = r.sub([0.12, 1.38, -0.38], [0, -0.35, 0]), B: V3 = [0, 0.75, 0.25], C: V3 = [0, 0.95, 0.85];
  for (const x of [-0.05, 0.05]) c.add("gold", c.beam([x, 0, 0], [x, B[1], B[2]], 0.04)).add("gold", c.beam([x, B[1], B[2]], [x, C[1], C[2]], 0.035));
  for (let i = 1; i < 6; i++)
    for (const [a, b] of [[[0, 0, 0], B], [B, C]] as const) {
      const y = a[1] + (b[1] - a[1]) * (i / 6), z = a[2] + (b[2] - a[2]) * (i / 6);
      c.add("dark", c.beam([-0.05, y, z], [0.05, y, z], 0.02, true));
    }
  c.add("steel", c.cyl(0.05, 0.05, 0.14, 12), B, Z).add("dark", c.cyl(0.04, 0.04, 0.14, 12), C, Z)
    .add("steel", c.cyl(0.006, 0.006, 0.4, 4), [0, C[1] - 0.22, C[2]]).add("orange", c.box(0.08, 0.1, 0.06, 0.01), [0, C[1] - 0.45, C[2]])
    .add("steel", torus(c, 0.045, 0.012, PI * 1.4), [0, C[1] - 0.54, C[2]], [0, H, PI * 0.8]).add("amber", c.sphere(0.025), [0, C[1] + 0.06, C[2]]);
  r.pair((s) => arm(r, [s * 0.36, 1.12, 0], [s * 0.4, 0.78, 0.1], 0.1, [0.2, 0.16, 0.24], 0.14));
  const w = r.sub([0.42, 0.78, 0.14], [0.5, 0, -0.15], 1.3);
  w.add("steel", w.box(0.06, 0.62, 0.03, 0.012), [0, 0.2, 0]).add("orange", w.box(0.07, 0.22, 0.04, 0.012))
    .add("steel", w.extrude([[-0.11, 0], [0.11, 0], [0.13, 0.12], [0.06, 0.2], [0.04, 0.1], [-0.04, 0.1], [-0.06, 0.2], [-0.13, 0.12]], 0.04, 0.008), [0, 0.5, 0]);
  const gun = r.sub([-0.4, 0.76, 0.22]);
  gun.add("orange", gun.box(0.1, 0.12, 0.24, 0.025)).add("steel", gun.cyl(0.025, 0.02, 0.14, 8), [0, 0.02, 0.18], X)
    .add("dark", gun.box(0.06, 0.14, 0.06, 0.012), [0, -0.1, -0.04]);
}

/** The scout: a big round head with two big round eyes, twin antennae, an orange scarf and a jump-jet pack. */
// prettier-ignore
function tally(r: Rig): void {
  r.add("dark", r.box(0.3, 0.12, 0.2, 0.04), [0, 0.74, 0]).add("team", r.box(0.38, 0.34, 0.3, 0.1, 2), [0, 0.95, 0])
    .add("dark", r.box(0.22, 0.12, 0.04, 0.02), [0, 0.92, 0.15]).add("visor", r.box(0.06, 0.02, 0.01, 0.005), [-0.05, 0.93, 0.172]);
  const h = r.sub([0, 1.4, 0.02]);
  h.add("team", new THREE.SphereGeometry(0.3, h.far ? 10 : 24, h.far ? 7 : 16))
    .add("dark", new THREE.SphereGeometry(0.27, h.far ? 6 : 16, h.far ? 4 : 10, -PI * 0.3, PI * 0.6, PI * 0.3, PI * 0.38), [0, -0.01, 0.045])
    .pair((s) => h.add("gun", h.cyl(0.1, 0.1, 0.06, 20), [s * 0.11, 0, 0.25], X).add("steel", torus(h, 0.098, 0.018), [s * 0.11, 0, 0.282])
      .add("visor", h.sphere(0.082, 1).scale(1, 1, 0.5), [s * 0.11, 0, 0.25]).add("team", h.box(0.16, 0.04, 0.08, 0.018), [s * 0.11, 0.12, 0.25], [0.2, 0, -s * 0.12])
      .add("dark", h.cyl(0.06, 0.06, 0.06, 12), [s * 0.29, 0, 0], Z))
    .add("steel", h.cyl(0.01, 0.01, 0.42, 4), [0.1, 0.45, -0.06], [0, 0, -0.15]).add("flame", h.sphere(0.04), [0.135, 0.66, -0.06])
    .add("steel", h.cyl(0.01, 0.01, 0.3, 4), [-0.12, 0.4, -0.08], [0, 0, 0.3]).add("flame", h.sphere(0.03), [-0.165, 0.55, -0.08]);
  // The scarf: a collar and two tails blown back.
  r.add("orange", torus(r, 0.17, 0.05), [0, 1.13, 0], X);
  for (const [x, y, z, len, a] of [[0.22, 1.1, -0.38, 0.5, -0.35], [0.12, 0.98, -0.36, 0.42, -0.15]] as const)
    r.add("orange", r.box(0.12, 0.02, len, 0.005), [x, y, z], [0.3 + a, 0.4, 0]);
  r.add("dark", r.box(0.32, 0.36, 0.18, 0.05), [0, 0.98, -0.22])
    .pair((s) => r.add("steel", r.cyl(0.075, 0.08, 0.36, 14), [s * 0.14, 0.96, -0.32]).add("gun", r.cyl(0.07, 0.11, 0.12, 14), [s * 0.14, 0.74, -0.32])
      .add("flame", r.cyl(0.07, 0.05, 0.02, 14), [s * 0.14, 0.67, -0.32]).add("gun", r.cyl(0.081, 0.081, 0.04, 14), [s * 0.14, 1.08, -0.32])
      .add("team", r.extrude([[0, 0], [0.22, -0.08], [0.24, -0.16], [0, -0.14]], 0.03, 0.01), [s * 0.2, 1.06, -0.34], [0, s > 0 ? 0 : PI, 0]));
  r.pair((s) => {
    r.add("team", r.sphere(0.08), [s * 0.23, 1.06, 0]).add("dark", r.beam([s * 0.24, 1.04, 0], [s * 0.26, 0.86, 0.1], 0.06, true))
      .add("dark", r.box(0.08, 0.08, 0.08, 0.02), [s * 0.18, 0.84, 0.18]);
  });
  const g = r.sub([0.1, 0.86, 0.25], [-0.05, -0.2, 0]);
  g.add("gun", g.box(0.06, 0.09, 0.28, 0.015)).add("steel", g.cyl(0.014, 0.014, 0.16, 8), [0, 0.02, 0.2], X)
    .add("gun", g.box(0.04, 0.12, 0.05, 0.01), [0, -0.09, 0.02]);
}

const BUILDERS: Record<HeroKind, (r: Rig) => void> = {
  brick,
  vix,
  rivet,
  tally,
};

/** A hero's model. Its legs stand still in it unless `moving` parts are left out to be drawn (and swung) on their own. */
// prettier-ignore
export function heroModel(kind: HeroKind, detail: Detail = "near", moving = true): Model {
  const root = new Rig(detail), spec = HERO_LEGS[kind];
  BUILDERS[kind](root.sub([0, 0, 0], [0, 0, 0], SCALE));
  if (moving) root.pair((s) => leg(root.sub([s * spec.hip, 0, 0], [0, 0, 0], [spec.w / 0.2, spec.len / 0.4, spec.w / 0.2])));
  return root.bake();
}
