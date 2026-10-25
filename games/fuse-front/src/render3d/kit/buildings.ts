/**
 * The buildings from the concept art, built with the robot kit in concept metres and scaled to tiles: the fort (four
 * crenellated towers and a keep with a radar dish, banners, a hazard door and lights round a courtyard the hero
 * respawns in), the robot factory (saw-tooth roof, hazard-banded chimney, hazard door and ramp), the vehicle factory
 * (the "MOTOR POOL" hangar under a gantry crane), the turret (twin guns on a sandbagged pad), the flag's sandbagged
 * base, and the fort's and turret's ruins. Each faces +z with its centre on its tile; team paint is swapped per
 * building (grey while neutral). Presentation only.
 */
import * as THREE from "three";
import type { BuildingKind } from "../../engine/view.js";
import type { BuildingModel, Model } from "../models.js";
import { Rig, type Detail, type V3 } from "./rig.js";

const PI = Math.PI,
  H = PI / 2,
  X: V3 = [H, 0, 0],
  Z: V3 = [0, 0, H];

/** A flat-sided frustum of `n` sides, a side square to +z. */
function frustum(top: number, bottom: number, h: number, n: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top, bottom, h, n).rotateY(PI / n).toNonIndexed();
  g.computeVertexNormals();
  return g;
} // prettier-ignore

/** A lightning bolt outline, `s` high: the side's emblem. */
const BOLT = (s: number) => ([[0.1, 0.5], [-0.25, -0.02], [0, -0.02], [-0.1, -0.5], [0.25, 0.08], [0, 0.08]] as const).map(([x, y]) => [x * s, y * s] as const); // prettier-ignore

/** Sandbags in rows round an arc of radius `rad` about (cx, cz), from angle `from` to `to` (0 is +z). */
// prettier-ignore
function sandbags(r: Rig, cx: number, cz: number, rad: number, from: number, to: number, rows = 2): void {
  const n = Math.max(1, Math.floor(((to - from) * rad) / 0.42));
  for (let row = 0; row < (r.far ? 1 : rows); row++)
    for (let i = 0; i <= n; i++) {
      const a = from + ((i + (row % 2) * 0.5) / n) * (to - from);
      if (a <= to) r.add("sand", r.box(0.44, 0.17, 0.26, 0.08), [cx + Math.sin(a) * rad, 0.085 + row * 0.16, cz + Math.cos(a) * rad], [0, a, 0]);
    }
}

/** A round tower `h` high at (x, z) with a team band and a crenellated crown, a light on top. */
// prettier-ignore
function tower(r: Rig, x: number, z: number, h: number): void {
  r.add("concrete", r.cyl(1, 1.15, h, 16), [x, h / 2, z]).add("team", r.cyl(1.03, 1.03, 0.4, 16), [x, h * 0.72, z])
    .add("concrete", r.cyl(1.25, 1.1, 0.5, 16), [x, h + 0.25, z]).add("dark", r.cyl(1, 1, 0.08, 16), [x, h + 0.5, z])
    .add("amber", r.sphere(0.14), [x, h + 0.65, z]);
  for (let k = 0; k < 8; k++) r.add("concrete", r.box(0.45, 0.4, 0.3, 0.05), [x + Math.sin((k * PI) / 4) * 1.1, h + 0.7, z + Math.cos((k * PI) / 4) * 1.1], [0, (k * PI) / 4, 0]);
}

/** A hazard-striped door `w` × `h` in a wall face at `z`, a gunmetal leaf inside its frame, lamps either side. */
// prettier-ignore
function door(r: Rig, w: number, h: number, z: number, lamps = true): void {
  r.add("hazard", r.box(w, h, 0.3, 0.04), [0, h / 2 + 0.3, z]).add("gun", r.box(w * 0.8, h * 0.85, 0.2, 0.03), [0, h * 0.45 + 0.3, z + 0.08]);
  if (lamps) r.pair((s) => r.add("amber", r.sphere(0.1), [s * (w / 2 + 0.3), h + 0.45, z + 0.1]));
}

// prettier-ignore
function fort(r: Rig): void {
  r.add("concrete", r.box(9.6, 0.3, 9.6, 0.05), [0, 0.15, 0]);
  // The courtyard the hero respawns in stays open to the camera: low walls at the sides and the gate, the keep behind.
  r.pair((s) => r.add("concrete", r.box(0.5, 2, 6.4, 0.05), [s * 3.7, 1.3, 0.6]).add("team", r.box(0.56, 0.35, 6.4, 0.03), [s * 3.7, 2.1, 0.6])
    .add("concrete", r.box(2.3, 2, 0.5, 0.05), [s * 2.45, 1.3, 3.8]).add("team", r.box(2.3, 0.35, 0.56, 0.03), [s * 2.45, 2.1, 3.8])
    .add("team", r.box(1.1, 1.6, 0.06, 0.02), [s * 2.4, 1.2, 4.08]).add("dark", r.extrude(BOLT(0.9), 0.04, 0.008), [s * 2.4, 1.25, 4.12]));
  door(r, 2.4, 1.9, 3.8);
  r.add("concrete", frustum(3.2 * Math.SQRT2, 3.5 * Math.SQRT2, 3.4, 4).scale(1, 1, 0.4), [0, 2, -3.1])
    .add("team", frustum(3.15 * Math.SQRT2, 3.2 * Math.SQRT2, 0.35, 4).scale(1, 1, 0.4), [0, 3.85, -3.1])
    .add("concrete", r.box(3.8, 1.4, 2, 0.06), [0, 4.7, -3]).add("dark", r.box(3.7, 0.15, 1.9, 0.02), [0, 5.45, -3]);
  for (const [y, z, n] of [[2.6, -1.75, 4], [4.7, -1.95, 2]] as const)
    for (let i = 0; i < n; i++)
      r.add("dark", r.box(0.6, 0.22, 0.2, 0.04), [(i - (n - 1) / 2) * 1.2, y, z]).add("amber", r.box(0.46, 0.08, 0.05, 0.01), [(i - (n - 1) / 2) * 1.2, y, z + 0.1]);
  for (const x of [-1, 1]) for (const z of [-1, 1]) tower(r, x * 3.9, z * 3.9, 4.6);
  r.add("steel", r.cyl(0.12, 0.18, 1.6, 8), [1.2, 6.2, -3]).add("dark", r.box(0.8, 0.4, 0.8, 0.06), [1.2, 5.7, -3])
    .add("steel", r.cyl(0.04, 0.04, 2.4, 6), [-1.4, 6.6, -3.4]).add("eye", r.sphere(0.12), [-1.4, 7.85, -3.4])
    .add("orange", r.box(0.8, 0.6, 0.6, 0.05), [-2.6, 0.6, 2]).add("dark", r.box(0.6, 0.5, 0.6, 0.05), [-2.5, 0.55, 2.8]);
}

/** The fort's radar dish on its pivot: a paraboloid tipped up, its feed and a red tip; it spins. */
// prettier-ignore
function dish(r: Rig): void {
  const d = r.sub([0, 0, 0], [-0.5, 0, 0]);
  const n = d.far ? 5 : 10, bowl = Array.from({ length: n }, (_, i) => new THREE.Vector2(0.05 + (i / (n - 1)) * 1.5, ((i / (n - 1)) * 1.5) ** 2 * 0.25));
  d.add("dish", new THREE.LatheGeometry(bowl, d.far ? 10 : 28), [0, 0, 0], X)
    .add("steel", d.cyl(0.03, 0.03, 0.9, 6), [0, 0, 0.45], X).add("eye", d.sphere(0.09), [0, 0, 0.92])
    .add("dark", d.cyl(0.22, 0.22, 0.25, 12), [0, 0, -0.1], X);
}

/** Saw-tooth roof teeth over a `w` × `d` roof at `y`: a steel slope each, glazed on its steep face. */
// prettier-ignore
function sawtooth(r: Rig, w: number, d: number, y: number, teeth: number): void {
  const step = d / teeth;
  for (let i = 0; i < teeth; i++) {
    const z0 = -d / 2 + i * step;
    r.add("steel", r.hull([[z0, y], [z0 + step, y], [z0 + step, y + step * 0.7]], w, 0.02))
      .add("glass", r.box(w * 0.94, step * 0.62, 0.04, 0.01), [0, y + step * 0.34, z0 + step + 0.025]);
    for (let k = 1; k < 6; k++) r.add("dark", r.box(0.05, step * 0.64, 0.06, 0.01), [-w / 2 + (k / 6) * w, y + step * 0.34, z0 + step + 0.045]);
  }
}

/** The chimney at (x, z) rising from `y0`: banded in hazard stripes with a red warning light at its lip. */
// prettier-ignore
function chimney(r: Rig, x: number, y0: number, z: number): void {
  r.add("dark", r.cyl(0.4, 0.5, 4.5, 14), [x, y0 + 2.25, z]).add("hazard", r.cyl(0.43, 0.43, 0.4, 14), [x, y0 + 3.6, z])
    .add("hazard", r.cyl(0.46, 0.46, 0.4, 14), [x, y0 + 1.4, z]).add("gun", r.cyl(0.48, 0.42, 0.25, 14), [x, y0 + 4.55, z])
    .add("eye", r.sphere(0.1), [x + 0.45, y0 + 4.55, z]);
}

const RF = { w: 7, d: 5.4, h: 3 };
// prettier-ignore
function robotFactory(r: Rig): void {
  const { w, d, h } = RF;
  r.add("concrete", r.box(w + 0.6, 0.3, d + 0.6, 0.05), [0, 0.15, 0]).add("concrete", r.box(w, h, d, 0.08), [0, h / 2 + 0.3, 0])
    .add("team", r.box(w + 0.06, 0.4, d + 0.06, 0.03), [0, h - 0.2, 0]).add("dark", r.box(w + 0.1, 0.12, d + 0.1, 0.02), [0, h + 0.3, 0]);
  sawtooth(r, w - 0.2, d - 0.2, h + 0.36, 4);
  door(r, 3, 2.1, d / 2 + 0.05);
  // The ramp: rollers in a dark frame out of the door.
  r.add("dark", r.box(2.6, 0.12, 1.9, 0.02), [0, 0.3, d / 2 + 1.1]);
  for (let i = 0; i < 6; i++) r.add("steel", r.cyl(0.07, 0.07, 2.4, 8), [0, 0.38, d / 2 + 0.35 + i * 0.3], Z);
  r.add("dark", r.box(2.8, 0.6, 0.08, 0.02), [0, h - 0.6, d / 2 + 0.05]).decal("ROBOTS", 2.4, [0, h - 0.6, d / 2 + 0.1])
    .add("team", r.extrude(BOLT(1.3), 0.05, 0.01), [w / 2 + 0.02, 1.8, 0.8], [0, H, 0]);
  chimney(r, w / 2 - 1, h + 0.3, -d / 2 + 0.9);
  r.add("orange", r.capsule(0.55, 1.4), [-w / 2 - 0.9, 1.25, -1], X).pair((s) => r.add("dark", r.box(0.3, 0.9, 0.3, 0.03), [-w / 2 - 0.9, 0.45, -1 + s * 0.4]))
    .add("steel", r.beam([-w / 2 - 0.15, 0.4, 1.8], [-w / 2 - 0.15, 2.7, 1.8], 0.2, true)).add("steel", r.beam([-w / 2 - 0.15, 2.7, 1.8], [-w / 2 - 0.15, 2.7, -1.6], 0.2, true));
  for (const x of [-2.2, 2.2]) {
    r.add("dark", r.box(0.8, 0.8, 0.12, 0.03), [x, 1.6, d / 2 + 0.02]);
    for (const y of [1.4, 1.6, 1.8]) r.add("steel", r.box(0.7, 0.04, 0.05, 0.01), [x, y, d / 2 + 0.09]);
  }
}

const VF = { w: 8, d: 6.4, h: 2.4, arc: PI * 0.36 };
// prettier-ignore
function vehicleFactory(r: Rig): void {
  const { w, d, h, arc } = VF, base = h + 0.3 - (w / 2) * Math.cos(arc), top = base + w / 2;
  r.add("concrete", r.box(w + 0.6, 0.3, d + 0.6, 0.05), [0, 0.15, 0]).add("concrete", r.box(w, h, d, 0.08), [0, h / 2 + 0.3, 0])
    .add("team", r.box(w + 0.06, 0.35, d + 0.06, 0.03), [0, h + 0.05, 0])
    .add("steel", new THREE.CylinderGeometry(w / 2, w / 2, d, r.far ? 10 : 28, 1, true, -arc, arc * 2), [0, base, 0], X);
  for (let i = -6; i <= 6; i += r.far ? 3 : 1) {
    const a = (i / 6) * arc;
    r.add("dark", r.box(0.08, 0.08, d + 0.05, 0.01), [(Math.sin(a) * w) / 2, base + (Math.cos(a) * w) / 2 + 0.03, 0], [0, 0, -a]);
  }
  // The gable ends close the arch over the walls.
  const gable = Array.from({ length: 13 }, (_, i) => -arc + (i / 12) * arc * 2).map((a) => new THREE.Vector2((-Math.sin(a) * w) / 2, base + (Math.cos(a) * w) / 2 - h - 0.3));
  for (const z of [-d / 2, d / 2]) r.add("concrete", new THREE.ShapeGeometry(new THREE.Shape(gable)), [0, h + 0.3, z * 1.0005], [0, z > 0 ? 0 : PI, 0]);
  // A roller door half up on a glowing bay, a ramp down and the sign over it.
  r.add("hazard", r.box(5, 2.5, 0.3, 0.04), [0, 1.55, d / 2 + 0.05]).add("amber", r.box(4.4, 1.2, 0.05, 0.01), [0, 0.95, d / 2 + 0.14]);
  for (let i = 0; i < 9; i++) r.add("steel", r.box(4.5, 0.12, 0.08, 0.02), [0, 1.65 + i * 0.11, d / 2 + 0.22]);
  r.add("concrete", r.hull([[d / 2, 0.3], [d / 2 + 1.8, 0], [d / 2 + 1.8, 0.05], [d / 2, 0.32]], 4.4, 0.01))
    .add("dark", r.box(5.2, 0.6, 0.1, 0.02), [0, h + 1.1, d / 2 + 0.05]).decal("MOTOR POOL", 4.6, [0, h + 1.1, d / 2 + 0.11]);
  // The gantry crane straddling the door.
  r.pair((s) => r.add("gold", r.box(0.3, top + 0.6, 0.3, 0.04), [s * (w / 2 + 0.4), (top + 0.6) / 2, d / 2 + 1.2]).add("hazard", r.box(0.32, 0.6, 0.32, 0.03), [s * (w / 2 + 0.4), 0.6, d / 2 + 1.2]))
    .add("team", r.box(w + 1.2, 0.4, 0.4, 0.05), [0, top + 0.6, d / 2 + 1.2]).add("dark", r.box(0.6, 0.4, 0.6, 0.05), [1.4, top + 0.3, d / 2 + 1.2])
    .add("steel", r.cyl(0.03, 0.03, 1.4, 4), [1.4, top - 0.6, d / 2 + 1.2])
    .add("steel", new THREE.TorusGeometry(0.15, 0.05, 6, 12, PI * 1.5), [1.4, top - 1.35, d / 2 + 1.2], [0, 0, PI * 0.75]);
  for (const z of [-1.6, 0, 1.6]) r.add("dark", r.cyl(0.55, 0.55, 0.2, 14), [w / 2 + 0.08, 1.6, z], Z).add("gun", r.cyl(0.14, 0.14, 0.1, 8), [w / 2 + 0.22, 1.6, z], Z);
  r.pair((s) => r.add("orange", r.capsule(0.6, 2.2), [-w / 2 - 1, 0.9, 0.2 + s * 0.8], X))
    .pair((s) => r.add("amber", r.sphere(0.12), [s * 2.7, 2.6, d / 2 + 0.2]));
}

/** The turret's pad: an octagonal plinth banded in hazard stripes inside a ring of sandbags. */
// prettier-ignore
function turret(r: Rig): void {
  r.add("concrete", frustum(1.7, 1.9, 0.3, 8), [0, 0.15, 0]).add("concrete", frustum(1.3, 1.6, 0.9, 8), [0, 0.75, 0])
    .add("hazard", frustum(1.32, 1.32, 0.2, 8), [0, 1.1, 0]).add("dark", r.cyl(0.9, 0.95, 0.3, 16), [0, 1.35, 0]);
  sandbags(r, 0, 0, 2.15, -PI * 0.8, PI * 0.8);
}

/** The turret's head on its ring: team armour, a mantlet with a red sensor, an ammo box and twin barrels on +z. */
// prettier-ignore
function turretHead(r: Rig): void {
  r.add("team", r.plan([[-0.8, -0.8], [0.8, -0.8], [0.95, 0.1], [0.55, 0.85], [-0.55, 0.85], [-0.95, 0.1]], 0.75, 0.08))
    .add("team", r.plan([[-0.5, -0.6], [0.5, -0.6], [0.6, 0.1], [0.3, 0.5], [-0.3, 0.5], [-0.6, 0.1]], 0.2, 0.05), [0, 0.75, -0.1])
    .add("dark", r.box(0.9, 0.5, 0.3, 0.06), [0, 0.38, 0.9]).add("eye", r.sphere(0.09), [0.45, 0.62, 0.9])
    .add("orange", r.box(0.4, 0.4, 0.6, 0.05), [-0.9, 0.35, -0.3]).add("dark", r.box(0.6, 0.3, 0.3, 0.05), [0, 0.6, -0.9])
    .add("steel", r.cyl(0.02, 0.02, 1.4, 4), [0.6, 1.3, -0.6]);
  for (const x of [-0.2, 0.2])
    r.add("steel", r.cyl(0.075, 0.085, 2, 10), [x, 0.38, 1.9], X).add("gun", r.cyl(0.12, 0.12, 0.35, 10), [x, 0.38, 1.15], X)
      .add("gun", r.box(0.2, 0.18, 0.3, 0.03), [x, 0.38, 2.9]);
}

/** The flag's base, pole and gold finial; the team banner waves from `FLAG_CLOTH` on it. */
// prettier-ignore
function flag(r: Rig): void {
  r.add("concrete", frustum(0.6, 0.75, 0.4, 6), [0, 0.2, 0]).add("hazard", frustum(0.62, 0.62, 0.1, 6), [0, 0.42, 0])
    .add("steel", r.cyl(0.06, 0.08, 5, 8), [0, 2.9, 0]).add("gold", r.sphere(0.12), [0, 5.45, 0]);
  sandbags(r, 0, 0, 0.95, 0, PI * 2 - 0.3);
}

/** Concept metres to tiles per building. */
const SCALE: Record<BuildingKind | "flag", number> = { fort: 0.19, robotFactory: 0.2, vehicleFactory: 0.2, turret: 0.19, flag: 0.3 }; // prettier-ignore
const BUILDERS: Record<BuildingKind, (r: Rig) => void> = { fort, robotFactory, vehicleFactory, turret }; // prettier-ignore

const built = (s: number, detail: Detail, make: (r: Rig) => void, floor = 0, span = 0.6): Model => {
  const root = new Rig(detail);
  make(root.sub([0, 0, 0], [0, 0, 0], s));
  return root.bake(floor, span);
}; // prettier-ignore

/** A building's model at a level of detail. */
// prettier-ignore
export function conceptBuilding(kind: BuildingKind, detail: Detail = "near"): BuildingModel {
  const s = SCALE[kind], body = built(s, detail, BUILDERS[kind]);
  if (kind === "fort") return { body, pivot: { model: built(s, detail, dish, -1, 1), x: 1.2 * s, y: 7.2 * s, z: -3 * s, aims: false }, height: 1.2 };
  if (kind === "turret") return { body, pivot: { model: built(s, detail, turretHead, -0.3, 0.6), x: 0, y: 1.5 * s, z: 0, aims: true }, height: 0.6 };
  if (kind === "robotFactory") return { body, smoke: [(RF.w / 2 - 1) * s, (RF.h + 4.8) * s, (-RF.d / 2 + 0.9) * s], height: (RF.h + 4.8) * s };
  return { body, height: (VF.h + 0.9 + (VF.w / 2) * (1 - Math.cos(VF.arc))) * s };
}

/** The flag's base and pole (its cloth is drawn and waved on its own). */
export const flagModel = (detail: Detail = "near"): Model => built(SCALE.flag, detail, flag); // prettier-ignore
/** The flag's cloth: its top edge's height on the pole (just under the finial), its width and its height, in tiles. */
export const FLAG_CLOTH = { y: 5.2 * SCALE.flag, w: 0.7, h: 0.45 };

/** The fort's ruin: broken tower stumps, the keep caved in to slabs, rubble and bent rebar. */
// prettier-ignore
function fortRuin(r: Rig): void {
  r.add("char", r.box(9.6, 0.3, 9.6, 0.05), [0, 0.15, 0]);
  [1.4, 2.6, 0.9, 1.9].forEach((h, i) => {
    const x = (i % 2 ? 1 : -1) * 3.9, z = (i < 2 ? -1 : 1) * 3.9;
    r.add(i % 2 ? "concrete" : "char", r.cyl(1, 1.15, h, 12), [x, h / 2 + 0.3, z]).add("concrete", r.box(0.6, 0.4, 0.5, 0.05), [x + 0.9, 0.5, z + 1], [0.3, i, 0.2]);
  });
  r.add("concrete", r.box(6, 0.5, 2.6, 0.05), [0, 1, -2.3], [0.25, 0, 0.12]).add("char", r.box(4, 0.4, 2, 0.05), [-0.5, 1.7, -2.5], [-0.2, 0.3, -0.15])
    .add("concrete", r.box(0.5, 1, 5, 0.05), [-3.7, 0.8, 0.8], [0, 0, 0.2]).add("char", r.box(0.5, 0.7, 4, 0.05), [3.7, 0.6, 0.4], [0, 0.1, -0.3])
    .add("dish", r.cyl(1.3, 0.2, 0.3, 12), [2.2, 0.5, 2], [0.9, 0, 0.4]);
  for (let i = 0; i < 5; i++) r.add("steel", r.cyl(0.05, 0.05, 1.6, 4), [-2 + i, 1.4, -1.6 + (i % 2)], [(i - 2) * 0.3, 0, (i % 3) * 0.3 - 0.3]);
}

/** The turret's ruin: its pad in its sandbags, the head knocked off beside it with a barrel bent down. */
// prettier-ignore
function turretRuin(r: Rig): void {
  r.add("concrete", frustum(1.7, 1.9, 0.3, 8), [0, 0.15, 0]).add("char", frustum(1.3, 1.6, 0.9, 8), [0, 0.75, 0], [0.08, 0, 0.05])
    .add("char", r.plan([[-0.8, -0.8], [0.8, -0.8], [0.95, 0.1], [0.55, 0.85], [-0.55, 0.85], [-0.95, 0.1]], 0.75, 0.08), [1.1, 0.2, -1.4], [0.5, 0.6, 0.3])
    .add("steel", r.cyl(0.075, 0.085, 2, 8), [0.2, 0.5, 0.6], [1.2, 0.4, 0]).add("dark", r.cyl(0.9, 0.95, 0.3, 12), [-0.2, 1.25, 0.1], [0.2, 0, -0.15]);
  sandbags(r, 0, 0, 2.15, -PI * 0.8, PI * 0.2);
}

/** The ruin a destroyed fort or turret leaves; factories fall to `ruinModel`'s rubble. */
export function conceptRuin(kind: "fort" | "turret"): Model {
  return built(SCALE[kind], "near", kind === "fort" ? fortRuin : turretRuin);
}
