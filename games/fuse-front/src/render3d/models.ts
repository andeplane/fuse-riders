/**
 * Procedural models in Z's chunky style, built once from three.js primitives: a model is a list of parts, one merged
 * geometry per paint, so a unit kind draws as a few instanced meshes. Team colour goes on the large `team` surfaces
 * (white here, tinted per instance); trims are dark metal and visors glow. Units face +z and stand on y = 0, one
 * tile is one unit of length. Presentation only: nothing here reads or writes the simulation.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildingKind, HeroView, UnitKind } from "../engine/view.js";

// prettier-ignore
export const PAINTS = {
  team: { color: 0xffffff, roughness: 0.42, metalness: 0.25 },
  steel: { color: 0x7d838a, roughness: 0.3, metalness: 0.85 },
  dark: { color: 0x26282c, roughness: 0.65, metalness: 0.55 },
  orange: { color: 0xe0701c, roughness: 0.5, metalness: 0.3 },
  gold: { color: 0xe8b828, roughness: 0.45, metalness: 0.45 },
  visor: { color: 0x082028, emissive: 0x38e8ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 },
  flame: { color: 0x301008, emissive: 0xff7a1c, emissiveIntensity: 2.4, roughness: 0.4, metalness: 0 },
  amber: { color: 0x302008, emissive: 0xffd028, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 },
  eye: { color: 0x300808, emissive: 0xff2a2a, emissiveIntensity: 3, roughness: 0.2, metalness: 0 },
  concrete: { color: 0xb4ab9a, roughness: 0.92, metalness: 0 },
  glass: { color: 0x9fd4e4, roughness: 0.08, metalness: 0.7 },
  hazard: { color: 0xffffff, roughness: 0.6, metalness: 0.2 },
  char: { color: 0x2a2420, roughness: 1, metalness: 0 },
} as const;
export type Paint = keyof typeof PAINTS;

export interface Part {
  paint: Paint;
  geometry: THREE.BufferGeometry;
}
export type Model = Part[];

export const HERO_KINDS = ["brick", "vix", "rivet", "tally"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
export type ModelKind = UnitKind | "tankTurret" | HeroKind;

/** Yellow and black diagonal stripes for doors, 16 × 16 texels. */
function hazardTexture(): THREE.DataTexture {
  const n = 16,
    data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const on = ((i % n) + Math.floor(i / n)) % 8 < 4;
    data.set(on ? [240, 196, 32, 255] : [24, 22, 20, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.repeat.set(2, 1);
  tex.needsUpdate = true;
  return tex;
}

/** One PBR material per paint; dispose each (and the hazard map) when done. */
export function paintMaterials(): Record<Paint, THREE.MeshStandardMaterial> {
  const out = {} as Record<Paint, THREE.MeshStandardMaterial>;
  for (const [paint, spec] of Object.entries(PAINTS) as [Paint, object][])
    out[paint] = new THREE.MeshStandardMaterial(spec);
  out.hazard.map = hazardTexture();
  // The radar dish is an open shell, seen from inside as often as from behind.
  out.steel.side = THREE.DoubleSide;
  return out;
}

/** Collects primitives by paint and merges each paint into one geometry. */
class Kit {
  private readonly groups = new Map<Paint, THREE.BufferGeometry[]>();
  add(paint: Paint, ...geometries: THREE.BufferGeometry[]): this {
    const list = this.groups.get(paint) ?? [];
    this.groups.set(paint, list.concat(geometries));
    return this;
  }
  build(): Model {
    return [...this.groups].map(([paint, list]) => {
      const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
      const geometry = mergeGeometries(flat)!;
      for (const g of new Set([...list, ...flat])) g.dispose();
      geometry.computeBoundingBox();
      return { paint, geometry };
    });
  }
}

// prettier-ignore
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) =>
  g.rotateX(rx).rotateZ(rz).translate(x, y, z);
/** A box with rounded edges. */
const block = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  r = 0.025,
) =>
  at(
    new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)),
    x,
    y,
    z,
  );
const slab = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
) => at(new THREE.BoxGeometry(w, h, d), x, y, z, rx);
const ball = (r: number, x: number, y: number, z: number, sy = 1, sz = 1) =>
  at(new THREE.SphereGeometry(r, 16, 12).scale(1, sy, sz), x, y, z);
/** A cylinder along y, or along z (`rx` = π/2) or x (`rz` = π/2). */
// prettier-ignore
const rod = (r: number, len: number, x: number, y: number, z: number, rx = 0, rz = 0, r2 = r, seg = 12) =>
  at(new THREE.CylinderGeometry(r, r2, len, seg), x, y, z, rx, rz);
const pair = (make: (side: number) => THREE.BufferGeometry) => [
  make(-1),
  make(1),
];
const Z = Math.PI / 2;

/** Stubby legs with dark feet, for robots of a given hip width and leg length. */
const legs = (kit: Kit, hip: number, len: number, w: number) =>
  kit
    .add("dark", ...pair((s) => block(w, len, w * 1.1, s * hip, len / 2, 0)))
    .add(
      "steel",
      ...pair((s) => block(w * 1.2, 0.04, w * 1.6, s * hip, 0.02, 0.02, 0.012)),
    );

/** Height ≈ 0.5: the smallest, roundest robot with a long cyan visor and a rifle held forward. */
// prettier-ignore
function grunt(): Model {
  const kit = legs(new Kit(), 0.065, 0.13, 0.07);
  return kit
    .add("team", block(0.22, 0.15, 0.17, 0, 0.2, 0, 0.04), ball(0.15, 0, 0.38, 0, 0.82))
    .add("visor", block(0.2, 0.05, 0.08, 0, 0.385, 0.1, 0.02))
    .add("dark", block(0.12, 0.1, 0.06, 0, 0.22, -0.1), rod(0.155, 0.03, 0, 0.32, 0))
    .add("steel", block(0.035, 0.045, 0.32, 0.14, 0.2, 0.08, 0.01), rod(0.012, 0.08, 0.14, 0.2, 0.27, Z))
    .build();
}

/** Height ≈ 0.57 and broad: twin orange fuel tanks on the back and a flamer nozzle with a hot tip. */
// prettier-ignore
function torch(): Model {
  const kit = legs(new Kit(), 0.09, 0.14, 0.09);
  return kit
    .add("team", block(0.32, 0.2, 0.24, 0, 0.25, 0, 0.05), ball(0.14, 0, 0.44, 0.02, 0.8))
    .add("flame", block(0.18, 0.045, 0.07, 0, 0.445, 0.12, 0.02), ball(0.035, 0.17, 0.22, 0.4))
    .add("orange", ...pair((s) => rod(0.065, 0.28, s * 0.075, 0.32, -0.17, 0, 0, 0.065, 14)))
    .add("dark", ...pair((s) => ball(0.064, s * 0.075, 0.46, -0.17, 0.6)), block(0.24, 0.05, 0.08, 0, 0.18, -0.15))
    .add("steel", rod(0.04, 0.22, 0.17, 0.22, 0.24, Z, 0, 0.03), block(0.08, 0.08, 0.1, 0.17, 0.22, 0.1, 0.02))
    .build();
}

// prettier-ignore
function lightTank(): Model {
  const kit = new Kit()
    .add("dark", ...pair((s) => block(0.13, 0.14, 0.7, s * 0.21, 0.07, 0, 0.05)))
    .add("steel", ...[-0.22, 0, 0.22].flatMap((z) => pair((s) => rod(0.05, 0.02, s * 0.285, 0.075, z, 0, Z))))
    .add("team", block(0.36, 0.13, 0.6, 0, 0.19, 0, 0.04), slab(0.34, 0.03, 0.12, 0, 0.21, 0.31, -0.5));
  return kit.build();
}

/** The light tank's turret, drawn on its own so it can turn toward what it shoots. */
// prettier-ignore
function tankTurret(): Model {
  return new Kit()
    .add("team", block(0.26, 0.11, 0.28, 0, 0.31, -0.02, 0.05))
    .add("steel", rod(0.025, 0.36, 0, 0.31, 0.28, Z), rod(0.06, 0.04, 0.07, 0.38, -0.08))
    .add("dark", rod(0.035, 0.06, 0, 0.31, 0.46, Z))
    .add("visor", block(0.1, 0.025, 0.02, -0.06, 0.34, 0.12, 0.008))
    .build();
}

/** Height ≈ 0.8, nearly 0.6 wide: the heavy bruiser with gold-trimmed shoulder pads and a yellow visor. */
// prettier-ignore
function brick(): Model {
  return legs(new Kit(), 0.11, 0.24, 0.13)
    .add("team", block(0.46, 0.32, 0.3, 0, 0.42, 0, 0.07), block(0.26, 0.21, 0.24, 0, 0.7, 0.01, 0.06),
      ...pair((s) => block(0.2, 0.15, 0.26, s * 0.3, 0.58, 0, 0.06)))
    .add("amber", block(0.22, 0.06, 0.06, 0, 0.71, 0.12, 0.02))
    .add("gold", ...pair((s) => block(0.21, 0.03, 0.27, s * 0.3, 0.66, 0, 0.012)), block(0.06, 0.06, 0.02, 0.1, 0.5, 0.155, 0.01))
    .add("steel", ...pair((s) => rod(0.055, 0.22, s * 0.31, 0.39, 0)), block(0.48, 0.05, 0.31, 0, 0.27, 0, 0.02))
    .add("dark", ...pair((s) => block(0.12, 0.12, 0.13, s * 0.31, 0.23, 0.02, 0.04)))
    .build();
}

/** Tall and narrow: a hooded cloak, one red eye and a rifle longer than the body is wide. */
// prettier-ignore
function vix(): Model {
  return legs(new Kit(), 0.06, 0.22, 0.08)
    .add("dark", rod(0.1, 0.42, 0, 0.42, 0, 0, 0, 0.19, 10), ball(0.13, 0, 0.72, -0.01, 1.15))
    .add("team", ball(0.105, 0, 0.71, 0.02), block(0.26, 0.08, 0.2, 0, 0.6, 0, 0.03))
    .add("eye", ball(0.035, 0, 0.72, 0.11))
    .add("steel", block(0.03, 0.04, 0.7, -0.15, 0.48, 0.12, 0.01), rod(0.03, 0.12, -0.15, 0.53, 0.06, Z))
    .build();
}

/** A hard hat with a brim, round goggles, a toolpack on the back and a big wrench. */
// prettier-ignore
function rivet(): Model {
  return legs(new Kit(), 0.09, 0.18, 0.1)
    .add("team", block(0.36, 0.26, 0.26, 0, 0.33, 0, 0.06), block(0.22, 0.17, 0.2, 0, 0.56, 0, 0.05))
    .add("gold", ball(0.14, 0, 0.64, 0, 0.6), rod(0.17, 0.02, 0, 0.64, 0.01))
    .add("visor", ...pair((s) => rod(0.035, 0.03, s * 0.05, 0.57, 0.105, Z)))
    .add("steel", block(0.03, 0.3, 0.03, 0.22, 0.33, 0.1, 0.01), rod(0.05, 0.04, 0.22, 0.48, 0.1, Z))
    .add("dark", block(0.26, 0.16, 0.1, 0, 0.36, -0.17, 0.03))
    .build();
}

/** A round head with a big cyan eye and an antenna: the lightest-looking hero. */
// prettier-ignore
function tally(): Model {
  return legs(new Kit(), 0.07, 0.24, 0.07)
    .add("team", ball(0.19, 0, 0.6, 0), block(0.24, 0.18, 0.18, 0, 0.32, 0, 0.05))
    .add("visor", ball(0.08, 0, 0.62, 0.13, 0.6, 0.6))
    .add("steel", rod(0.008, 0.3, 0.08, 0.9, -0.02), block(0.03, 0.03, 0.22, 0.15, 0.32, 0.1, 0.01))
    .add("amber", ball(0.03, 0.08, 1.06, -0.02))
    .build();
}

// prettier-ignore
const BUILDERS: Record<ModelKind, () => Model> = {
  grunt, torch, lightTank, tankTurret, brick, vix, rivet, tally,
};

/** Which hero model a hero wears: its `kind` once the view carries one (E2), Brick until then. */
export function heroKindOf(hero: HeroView): HeroKind {
  const kind = "kind" in hero ? hero.kind : undefined;
  return HERO_KINDS.find((k) => k === kind) ?? "brick";
}

export function unitModel(kind: ModelKind): Model {
  return BUILDERS[kind]();
}

/** The ground ring's outer radius under a body, in tiles: bigger bodies, bigger rings. */
export const RING: Record<UnitKind | "hero", number> = {
  grunt: 0.27,
  torch: 0.33,
  lightTank: 0.46,
  hero: 0.56,
};

export interface BuildingModel {
  body: Model;
  /** A part on a pivot above the roof: the fort's radar dish spins, the turret's head aims. */
  pivot?: { model: Model; x: number; y: number; z: number; aims: boolean };
  /** Where smoke leaves the chimney. */
  smoke?: [number, number, number];
  /** The roof's height, for the health bar. */
  height: number;
}

/** Saw-tooth glass roof: triangular prisms along x, steep glass faces to the north. */
// prettier-ignore
const sawtooth = (kit: Kit, w: number, d: number, y: number, teeth: number) => {
  for (let i = 0; i < teeth; i++)
    kit.add("glass", at(new THREE.CylinderGeometry(0.2, 0.2, w, 3), 0, y + 0.08, -d / 2 + (i + 0.5) * (d / teeth), Math.PI, Z));
};

/** A hazard-striped door on the south face (+z). */
const door = (kit: Kit, w: number, h: number, d: number) =>
  kit
    .add("hazard", slab(w, h, 0.04, 0, h / 2, d / 2 + 0.02))
    .add("dark", slab(w + 0.08, 0.05, 0.06, 0, h + 0.02, d / 2 + 0.02));

// prettier-ignore
function factory(w: number, h: number, d: number, teeth: number, doorW: number): BuildingModel {
  const kit = new Kit().add("concrete", block(w, h, d, 0, h / 2, 0, 0.05))
    .add("team", slab(w + 0.02, 0.1, d + 0.02, 0, h * 0.72, 0))
    .add("dark", rod(0.09, 0.9, w / 2 - 0.2, h + 0.4, -d / 2 + 0.2, 0, 0, 0.11), rod(0.1, 0.04, w / 2 - 0.2, h + 0.85, -d / 2 + 0.2));
  sawtooth(kit, w * 0.92, d * 0.8, h, teeth);
  door(kit, doorW, h * 0.6, d);
  return { body: kit.build(), smoke: [w / 2 - 0.2, h + 0.9, -d / 2 + 0.2], height: h + 0.3 };
}

// prettier-ignore
function fort(): BuildingModel {
  const kit = new Kit().add("concrete", block(1.5, 0.75, 1.5, 0, 0.375, 0, 0.06),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => rod(0.24, 1.05, sx * 0.72, 0.525, sz * 0.72, 0, 0, 0.27, 14))))
    .add("team", slab(1.54, 0.12, 1.54, 0, 0.6, 0),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => rod(0.27, 0.12, sx * 0.72, 1.1, sz * 0.72, 0, 0, 0.27, 14))))
    .add("steel", rod(0.04, 0.3, 0, 0.9, 0));
  door(kit, 0.5, 0.42, 1.5);
  const dish = new Kit()
    .add("steel", at(new THREE.SphereGeometry(0.34, 16, 6, 0, Math.PI * 2, 0, 0.9), 0, 0, 0.12, -Z * 1.3))
    .add("dark", rod(0.02, 0.24, 0, 0, 0.12, Z)).add("visor", ball(0.03, 0, 0, 0.24));
  return { body: kit.build(), pivot: { model: dish.build(), x: 0, y: 1.08, z: 0, aims: false }, height: 1.2 };
}

// prettier-ignore
function turret(): BuildingModel {
  const kit = new Kit().add("concrete", rod(0.3, 0.38, 0, 0.19, 0, 0, 0, 0.36, 16)).add("team", rod(0.31, 0.08, 0, 0.32, 0, 0, 0, 0.31, 16));
  const head = new Kit().add("team", block(0.36, 0.2, 0.36, 0, 0.1, 0, 0.06))
    .add("steel", ...pair((s) => rod(0.03, 0.42, s * 0.07, 0.1, 0.36, Z)))
    .add("visor", block(0.2, 0.04, 0.02, 0, 0.15, 0.18, 0.01));
  return { body: kit.build(), pivot: { model: head.build(), x: 0, y: 0.36, z: 0, aims: true }, height: 0.6 };
}

const BUILDING_BUILDERS: Record<BuildingKind, () => BuildingModel> = {
  fort,
  robotFactory: () => factory(1.6, 0.75, 1.35, 3, 0.5),
  vehicleFactory: () => factory(1.9, 0.6, 1.6, 4, 0.9),
  turret,
};

export function buildingModel(kind: BuildingKind): BuildingModel {
  return BUILDING_BUILDERS[kind]();
}

/** A burnt-out ruin over a `w` × `d` footprint: a charred floor, broken wall stumps and bent rebar. */
// prettier-ignore
export function ruinModel(w: number, d: number, seed: number): Model {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const kit = new Kit().add("char", block(w * 0.95, 0.08, d * 0.95, 0, 0.04, 0, 0.02));
  for (let i = 0; i < 7; i++) {
    const cw = 0.15 + r() * w * 0.3, ch = 0.12 + r() * 0.4, cd = 0.15 + r() * d * 0.25;
    const chunk = slab(cw, ch, cd, 0, 0, 0, (r() - 0.5) * 0.6).rotateY(r() * 3).translate((r() - 0.5) * w * 0.75, ch / 2, (r() - 0.5) * d * 0.75);
    kit.add(i % 3 ? "concrete" : "char", chunk);
  }
  for (let i = 0; i < 4; i++)
    kit.add("steel", rod(0.012, 0.35, (r() - 0.5) * w * 0.7, 0.16, (r() - 0.5) * d * 0.7, (r() - 0.5) * 1.2, (r() - 0.5) * 1.2));
  return kit.build();
}

/** Turns `from` toward `to` by at most `step` radians, the short way round. */
export function approachAngle(from: number, to: number, step: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return Math.abs(delta) <= step ? to : from + Math.sign(delta) * step;
}

/** How high a body bobs this frame: a walking hop while it moves, a slow breath while it stands. */
export function bob(
  moving: boolean,
  now: number,
  id: number,
  tracked: boolean,
): number {
  if (tracked) return moving ? Math.abs(Math.sin(now / 45 + id)) * 0.008 : 0;
  return moving
    ? Math.abs(Math.sin(now / 95 + id)) * 0.045
    : (Math.sin(now / 700 + id) + 1) * 0.006;
}

/** Bends a flag cloth's vertices (built along +x from the pole) into a travelling wave; the pole edge stays put. */
export function waveCloth(
  base: ArrayLike<number>,
  out: { setZ(i: number, z: number): unknown },
  now: number,
): void {
  for (let i = 0; i < base.length / 3; i++) {
    const x = base[i * 3]!;
    out.setZ(
      i,
      Math.sin(x * 9 - now / 160) * 0.09 * x + Math.sin(now / 500) * 0.04 * x,
    );
  }
}
