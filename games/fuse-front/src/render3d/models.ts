/**
 * Procedural models in Z's chunky style, built once from three.js primitives: a model is a list of parts, one merged
 * geometry per paint, so a unit kind draws as a few instanced meshes. Team colour goes on the large `team` surfaces
 * (white here, tinted per instance); trims are dark metal and visors glow. Every part carries baked vertex colour —
 * dirt toward the feet, shade under overhangs, worn bright edges — and the metal paints share one procedural panel
 * map (grooves, seams, rivets, grime streaks) for their normals, roughness and colour. Heroes' legs are a separate
 * shared model so each instance can swing them; the robot units are built from the concept kit in `kit/`. Models face
 * +z and stand on y = 0, one tile is one unit of length.
 * Presentation only: nothing here reads or writes the simulation.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildingKind, HeroView, UnitKind } from "../engine/view.js";
import { hash, normalMap, tileNoise } from "./terrain.js";
import { decalAtlas } from "./kit/decals.js";

// prettier-ignore
export const PAINTS = {
  team: { color: 0xffffff, roughness: 0.42, metalness: 0.25 },
  steel: { color: 0x7d838a, roughness: 0.3, metalness: 0.85 },
  /** The radar dish is an open shell, seen from inside as often as from behind. */
  dish: { color: 0x9aa0a6, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide },
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
  /** Track rubber: links scroll along z by the instance colour's red channel (`treadPhase`), so it is never tinted. */
  tread: { color: 0x2c2a28, roughness: 0.9, metalness: 0.2 },
  /** Near-black gunmetal for weapons. */
  gun: { color: 0x1f2124, roughness: 0.45, metalness: 0.7 },
  /** Stencilled squad numbers: cut out of the shared atlas (`decalAtlas`) and drawn just over the plate under them. */
  decal: { color: 0xffffff, roughness: 0.7, metalness: 0, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 },
} as const;
export type Paint = keyof typeof PAINTS;
/** The paints the panel map details. */
const DETAILED: readonly Paint[] = [
  "team",
  "steel",
  "dark",
  "orange",
  "gold",
  "gun",
];

export interface Part {
  paint: Paint;
  geometry: THREE.BufferGeometry;
}
export type Model = Part[];

export const HERO_KINDS = ["brick", "vix", "rivet", "tally"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
export type ModelKind = UnitKind | "tankTurret" | HeroKind;
/** Shared parts drawn per instance: a hero's leg (unit size, hip at the origin), a mine. Robots' are in `kit/units`. */
export type PartKind = "leg" | "mine";

/** Each hero's legs: hip half-width, leg length and thickness, in tiles (robots' are `ROBOT_LEGS`). */
// prettier-ignore
export const LEGS: Partial<Record<ModelKind, { hip: number; len: number; w: number }>> = {
  brick: { hip: 0.12, len: 0.24, w: 0.14 }, vix: { hip: 0.055, len: 0.24, w: 0.07 },
  rivet: { hip: 0.09, len: 0.18, w: 0.1 }, tally: { hip: 0.07, len: 0.26, w: 0.065 },
};

function texture(data: Uint8Array, n: number, srgb = false): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, n, n);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = tex.needsUpdate = true;
  return tex;
}

/** Yellow and black diagonal stripes for doors, 16 × 16 texels. */
function hazardTexture(): THREE.DataTexture {
  const n = 16,
    data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const on = ((i % n) + Math.floor(i / n)) % 8 < 4;
    data.set(on ? [240, 196, 32, 255] : [24, 22, 20, 255], i * 4);
  }
  const tex = texture(data, n, true);
  tex.magFilter = THREE.NearestFilter;
  tex.repeat.set(2, 1);
  return tex;
}

/**
 * One armour panel per face, after the concept kit: a groove round the border, a seam boxing in the upper panel,
 * rivets at the corners and the waist, hammered grain, and faces pillowing up toward their edges.
 */
// prettier-ignore
export function panelHeights(n: number): Float32Array {
  const grain = tileNoise(n, 6, 21), h = new Float32Array(n * n);
  const bump = (d: number, r: number) => Math.max(0, 1 - (d / r) ** 2);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n, edge = Math.min(u, 1 - u, v, 1 - v);
      const su = Math.min(Math.abs(u - 0.18), Math.abs(u - 0.82)), inner = u > 0.18 && u < 0.82, upper = v > 0.62 && v < 0.94;
      const seam = (upper ? bump(su, 0.012) : 0) + (inner ? bump(Math.abs(v - 0.62), 0.012) : 0);
      const ru = Math.min(Math.abs(u - 0.09), Math.abs(u - 0.91)), rv = Math.min(Math.abs(v - 0.09), Math.abs(v - 0.91), Math.abs(v - 0.35));
      h[y * n + x] = -bump(edge - 0.035, 0.022) - 0.6 * Math.min(1, seam) + 0.8 * Math.sqrt(bump(Math.hypot(ru, rv), 0.03))
        + (grain[y * n + x]! - 0.3) * 0.12 + Math.min(edge, 0.04) * 3;
    }
  return h;
}

/**
 * The shared panel maps: normals from `panelHeights`; roughness (green) dirtier in the grooves and smoother on
 * scuffs; and a grime colour map (multiplied into the paint) darker in the grooves, streaked down each face.
 */
// prettier-ignore
export function detailMaps(n = 64): { normal: THREE.DataTexture; rough: THREE.DataTexture; grime: THREE.DataTexture } {
  const h = panelHeights(n), streaks = tileNoise(n, 12, 23), mottle = tileNoise(n, 4, 25);
  const rough = new Uint8Array(n * n * 4), grime = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const groove = Math.max(0, -h[i]!), streak = Math.max(0, streaks[i % n]! - 0.45);
    const g = Math.min(255, Math.max(0, Math.round(215 + h[i]! * -90 - (mottle[i]! > 0.62 ? 50 : 0))));
    rough.set([g, g, g, 255], i * 4);
    const k = Math.round(255 * Math.min(1, Math.max(0.4, 0.97 + (mottle[i]! - 0.4) * 0.15 - groove * 0.3 - streak * 0.6)));
    grime.set([k, Math.round(k * 0.985), Math.round(k * 0.96), 255], i * 4);
  }
  const map = texture(grime, n, true);
  return { normal: texture(normalMap(h, n, 2.2), n), rough: texture(rough, n), grime: map };
}

/** Puts the panel maps on the metal paints, or takes them off (`maps` undefined: low quality). */
export function setDetail(
  paints: Record<Paint, THREE.MeshStandardMaterial>,
  maps?: { normal: THREE.Texture; rough: THREE.Texture; grime?: THREE.Texture },
): void {
  for (const paint of DETAILED) {
    paints[paint].normalMap = maps?.normal ?? null;
    paints[paint].roughnessMap = maps?.rough ?? null;
    paints[paint].map = maps?.grime ?? null;
    paints[paint].normalScale.setScalar(0.7);
    paints[paint].needsUpdate = true;
  }
}

/**
 * Track links: the tread paint's rubber darkens between links that run along z with the instance's phase, which
 * arrives as the instance colour's red channel and so is never applied as a tint.
 */
export function patchTread(shader: {
  vertexShader: string;
  fragmentShader: string;
}): void {
  const head = "varying float vTread;\n";
  shader.vertexShader =
    head +
    shader.vertexShader.replace(
      "#include <color_vertex>",
      "vTread = position.z * 16.0 + instanceColor.r;",
    );
  shader.fragmentShader =
    head +
    shader.fragmentShader.replace(
      "#include <color_fragment>",
      "diffuseColor.rgb *= 0.4 + 0.6 * smoothstep(0.25, 0.4, fract(vTread));",
    );
}

/** One PBR material per paint; dispose each (and the hazard map) when done. Detail maps go on with `setDetail`. */
export function paintMaterials(): Record<Paint, THREE.MeshStandardMaterial> {
  const out = {} as Record<Paint, THREE.MeshStandardMaterial>;
  for (const [paint, spec] of Object.entries(PAINTS) as [Paint, object][])
    out[paint] = new THREE.MeshStandardMaterial({
      ...spec,
      vertexColors: paint !== "tread",
    });
  out.hazard.map = hazardTexture();
  out.decal.map = decalAtlas();
  out.tread.onBeforeCompile = patchTread;
  out.tread.customProgramCacheKey = () => "tread";
  return out;
}

/**
 * Bakes grime into a geometry's vertex colour: darker toward `floor` (contact shade and dust), darker facing down,
 * a little mottled, and brighter where the normal leans off every axis — a bevel's worn edge.
 */
// prettier-ignore
export function shade(g: THREE.BufferGeometry, floor = 0, span = 0.35): THREE.BufferGeometry {
  const p = g.getAttribute("position"), n = g.getAttribute("normal"), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const edge = 1 - Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    const ao = (0.55 + 0.45 * Math.min(1, Math.max(0, (p.getY(i) - floor) / span))) * (0.82 + 0.18 * (ny * 0.5 + 0.5));
    const mottle = 0.9 + 0.1 * hash(Math.round(p.getX(i) * 40), Math.round(p.getY(i) * 40 + p.getZ(i) * 17), 7);
    c.fill(ao * mottle * (1 + edge * 0.9), i * 3, i * 3 + 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/** Collects primitives by paint and merges each paint into one shaded geometry. */
class Kit {
  private readonly groups = new Map<Paint, THREE.BufferGeometry[]>();
  constructor(
    private readonly floor = 0,
    private readonly span = 0.35,
  ) {}
  add(paint: Paint, ...geometries: THREE.BufferGeometry[]): this {
    const list = this.groups.get(paint) ?? [];
    this.groups.set(paint, list.concat(geometries));
    return this;
  }
  build(): Model {
    return [...this.groups].map(([paint, list]) => {
      const flat = list.map((g) =>
        shade(g.index ? g.toNonIndexed() : g, this.floor, this.span),
      );
      for (const g of flat) g.clearGroups();
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
/** The top half of a sphere: a helmet or a dome. */
const cap = (r: number, x: number, y: number, z: number, sy = 1) =>
  at(
    new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(
      1,
      sy,
      1,
    ),
    x,
    y,
    z,
  );
/** A cylinder along y, or along z (`rx` = π/2) or x (`rz` = π/2). */
// prettier-ignore
const rod = (r: number, len: number, x: number, y: number, z: number, rx = 0, rz = 0, r2 = r, seg = 12) =>
  at(new THREE.CylinderGeometry(r, r2, len, seg), x, y, z, rx, rz);
/** A ring lying in the xz plane (or turned by `rx`). */
// prettier-ignore
const hoop = (r: number, t: number, x: number, y: number, z: number, rx = Math.PI / 2) =>
  at(new THREE.TorusGeometry(r, t, 6, 20), x, y, z, rx);
const pair = (make: (side: number) => THREE.BufferGeometry) => [
  make(-1),
  make(1),
];
const Z = Math.PI / 2;
/** A unit leg hanging from a hip at the origin to a foot at y = −1: drawn scaled by `LEGS` and swung per instance. */
// prettier-ignore
function leg(): Model {
  return new Kit(-1, 1)
    .add("dark", block(1, 0.78, 1, 0, -0.42, 0, 0.3))
    .add("steel", ball(0.62, 0, -0.42, 0.05, 0.55), block(1.25, 0.24, 1.7, 0, -0.88, 0.22, 0.1))
    .build();
}

/** Vix's sticky mine: a dark puck with a team band and three prongs; its light blinks on its own. */
// prettier-ignore
function mine(): Model {
  return new Kit().add("dark", rod(0.11, 0.05, 0, 0.025, 0, 0, 0, 0.13, 14))
    .add("team", rod(0.115, 0.02, 0, 0.045, 0, 0, 0, 0.115, 14))
    .add("steel", ...[0, 2.1, 4.2].map((a) => rod(0.012, 0.09, Math.sin(a) * 0.1, 0.06, Math.cos(a) * 0.1, 0.5, 0)))
    .build();
}

/** Height ≈ 0.85, nearly 0.65 wide: the heavy bruiser, chest plate, gold-trimmed shoulder pads, fists and exhaust stacks. */
// prettier-ignore
function brick(kit: Kit): Kit {
  return kit
    .add("team", block(0.46, 0.32, 0.3, 0, 0.42, 0, 0.07), block(0.24, 0.19, 0.22, 0, 0.7, 0.01, 0.06),
      ...pair((s) => block(0.22, 0.16, 0.28, s * 0.31, 0.59, 0, 0.07)), block(0.32, 0.18, 0.04, 0, 0.45, 0.16, 0.03))
    .add("amber", block(0.2, 0.05, 0.05, 0, 0.71, 0.11, 0.02))
    .add("gold", ...pair((s) => block(0.23, 0.03, 0.29, s * 0.31, 0.68, 0, 0.012)), block(0.06, 0.06, 0.02, 0.1, 0.5, 0.18, 0.01))
    .add("steel", ...pair((s) => rod(0.055, 0.2, s * 0.32, 0.4, 0)), block(0.48, 0.05, 0.31, 0, 0.27, 0, 0.02))
    .add("dark", ...pair((s) => block(0.13, 0.13, 0.14, s * 0.32, 0.24, 0.03, 0.04)), ...pair((s) => rod(0.03, 0.22, s * 0.1, 0.72, -0.18)),
      block(0.3, 0.2, 0.1, 0, 0.47, -0.19, 0.03));
}

/** Tall and slim: a hooded cloak with a peaked hood, one red eye and a scoped rifle longer than the body is wide. */
// prettier-ignore
function vix(kit: Kit): Kit {
  return kit
    .add("dark", rod(0.09, 0.44, 0, 0.44, 0, 0, 0, 0.18, 10), ball(0.13, 0, 0.74, -0.015, 1.15), at(new THREE.ConeGeometry(0.06, 0.16, 8), 0, 0.84, -0.09, -0.9),
      slab(0.2, 0.3, 0.02, 0, 0.36, -0.15, 0.25))
    .add("team", ball(0.1, 0, 0.72, 0.025), block(0.26, 0.08, 0.2, 0, 0.62, 0, 0.03))
    .add("eye", ball(0.032, 0, 0.73, 0.115))
    .add("steel", block(0.03, 0.04, 0.78, -0.15, 0.5, 0.14, 0.01), rod(0.022, 0.16, -0.15, 0.56, 0.1, Z), rod(0.009, 0.2, -0.15, 0.5, 0.6, Z))
    .add("visor", ball(0.018, -0.15, 0.56, 0.18));
}

/** A ridged hard hat with a brim, round goggles, a big wrench and a toolpack with a gas bottle on the back. */
// prettier-ignore
function rivet(kit: Kit): Kit {
  return kit
    .add("team", block(0.36, 0.26, 0.26, 0, 0.33, 0, 0.06), block(0.22, 0.17, 0.2, 0, 0.56, 0, 0.05))
    .add("gold", cap(0.14, 0, 0.63, 0, 0.75), rod(0.18, 0.02, 0, 0.635, 0.01), block(0.03, 0.03, 0.26, 0, 0.73, 0, 0.012))
    .add("visor", ...pair((s) => rod(0.035, 0.03, s * 0.055, 0.575, 0.105, Z)))
    .add("dark", ...pair((s) => hoop(0.04, 0.01, s * 0.055, 0.575, 0.12, 0)), block(0.26, 0.18, 0.11, 0, 0.36, -0.18, 0.03))
    .add("orange", rod(0.045, 0.24, 0.08, 0.42, -0.24))
    .add("steel", block(0.03, 0.32, 0.03, 0.22, 0.35, 0.1, 0.01), at(new THREE.TorusGeometry(0.05, 0.016, 6, 12, 4.4), 0.22, 0.53, 0.1, 0, 2.2));
}

/** A round head with a big cyan eye and an antenna, a trailing orange scarf: the lightest-looking hero. */
// prettier-ignore
function tally(kit: Kit): Kit {
  return kit
    .add("team", ball(0.19, 0, 0.62, 0), block(0.24, 0.18, 0.18, 0, 0.34, 0, 0.05))
    .add("visor", ball(0.08, 0, 0.64, 0.13, 0.6, 0.6))
    .add("dark", hoop(0.085, 0.012, 0, 0.64, 0.14, 0))
    .add("orange", hoop(0.12, 0.035, 0, 0.45, 0), slab(0.08, 0.22, 0.02, 0.05, 0.36, -0.15, 0.5), slab(0.07, 0.16, 0.02, -0.03, 0.34, -0.16, 0.7))
    .add("steel", rod(0.008, 0.3, 0.08, 0.92, -0.02), block(0.03, 0.03, 0.22, 0.15, 0.34, 0.1, 0.01))
    .add("amber", ball(0.03, 0.08, 1.08, -0.02));
}

// prettier-ignore
const BUILDERS: Record<HeroKind, (kit: Kit) => Kit> = { brick, vix, rivet, tally };

/** Which hero model a hero wears: its `kind`'s (Brick for one without a model). */
export function heroKindOf(hero: HeroView): HeroKind {
  return HERO_KINDS.find((k) => k === hero.kind) ?? "brick";
}

/**
 * A hero's model. Its legs stand still in it unless `moving` parts are left out to be drawn (and swung) on their own.
 * The robot units are built by `kit/units`.
 */
// prettier-ignore
export function unitModel(kind: HeroKind, moving = true): Model {
  const kit = BUILDERS[kind](new Kit()), spec = LEGS[kind];
  if (moving && spec) kit.add("dark", ...pair((s) => block(spec.w, spec.len, spec.w, s * spec.hip, spec.len / 2, 0, spec.w / 3)));
  return kit.build();
}

export function partModel(kind: PartKind): Model {
  return { leg, mine }[kind]();
}

/** The ground ring's outer radius under a body, in tiles: bigger bodies, bigger rings. */
export const RING: Record<UnitKind | "hero", number> = {
  grunt: 0.27,
  torch: 0.33,
  lightTank: 0.46,
  sentry: 0.3,
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
  const kit = new Kit(0, 0.6).add("concrete", block(w, h, d, 0, h / 2, 0, 0.05))
    .add("team", slab(w + 0.02, 0.1, d + 0.02, 0, h * 0.72, 0))
    .add("dark", rod(0.09, 0.9, w / 2 - 0.2, h + 0.4, -d / 2 + 0.2, 0, 0, 0.11), rod(0.1, 0.04, w / 2 - 0.2, h + 0.85, -d / 2 + 0.2));
  sawtooth(kit, w * 0.92, d * 0.8, h, teeth);
  door(kit, doorW, h * 0.6, d);
  return { body: kit.build(), smoke: [w / 2 - 0.2, h + 0.9, -d / 2 + 0.2], height: h + 0.3 };
}

// prettier-ignore
function fort(): BuildingModel {
  // An open courtyard, so the hero who respawns here stays in sight: four walls between corner towers.
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * 0.72, sz * 0.72] as const));
  const walls = (h: number, y: number, t: number) => [-1, 1].flatMap((s) => [slab(1.5, h, t, 0, y, s * 0.7), slab(t, h, 1.5, s * 0.7, y, 0)]);
  const kit = new Kit(0, 0.8).add("concrete", block(1.5, 0.06, 1.5, 0, 0.03, 0, 0.02), ...walls(0.6, 0.3, 0.16),
    ...corners.map(([x, z]) => rod(0.24, 1.05, x, 0.525, z, 0, 0, 0.27, 14)))
    .add("team", ...walls(0.1, 0.52, 0.18), ...corners.map(([x, z]) => rod(0.27, 0.12, x, 1.1, z, 0, 0, 0.27, 14)))
    .add("steel", rod(0.04, 0.3, 0.72, 1.3, -0.72));
  door(kit, 0.5, 0.42, 1.56);
  const dish = new Kit(-1, 1)
    .add("dish", at(new THREE.SphereGeometry(0.34, 16, 6, 0, Math.PI * 2, 0, 0.9), 0, 0, 0.12, -Z * 1.3))
    .add("dark", rod(0.02, 0.24, 0, 0, 0.12, Z)).add("visor", ball(0.03, 0, 0, 0.24));
  return { body: kit.build(), pivot: { model: dish.build(), x: 0.72, y: 1.48, z: -0.72, aims: false }, height: 1.4 };
}

// prettier-ignore
function turret(): BuildingModel {
  const kit = new Kit().add("concrete", rod(0.3, 0.38, 0, 0.19, 0, 0, 0, 0.36, 16)).add("team", rod(0.31, 0.08, 0, 0.32, 0, 0, 0, 0.31, 16));
  const head = new Kit(-0.3, 0.6).add("team", block(0.36, 0.2, 0.36, 0, 0.1, 0, 0.06))
    .add("steel", ...pair((s) => rod(0.03, 0.42, s * 0.07, 0.1, 0.36, Z)))
    .add("dark", ...pair((s) => rod(0.04, 0.06, s * 0.07, 0.1, 0.56, Z)))
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

/** A leg's swing in radians (forward positive) this frame: in step with `bob`'s hop, the two sides opposite. */
export function legSwing(
  moving: boolean,
  now: number,
  id: number,
  side: number,
): number {
  return moving ? Math.sin(now / 95 + id) * 0.6 * side : 0;
}

/** How far back (tiles) a gun has kicked `ms` after it fired: a sharp kick that eases home within 220 ms. */
export function recoil(ms: number): number {
  return ms >= 0 && ms < 220 ? 0.07 * (1 - ms / 220) ** 2 : 0;
}

/** Where a tank's track links stand: its position along its heading, so they roll exactly as far as it drives. */
export function treadPhase(x: number, z: number, yaw: number): number {
  const d = (x * Math.sin(yaw) + z * Math.cos(yaw)) * 16;
  return d - Math.floor(d);
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
