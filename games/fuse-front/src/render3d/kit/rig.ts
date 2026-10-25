/**
 * The robot kit's builder, ported from the concept art: parts are added in a posed hierarchy (`sub` frames with their
 * own offset, turn and scale), then baked to one shaded geometry per paint, so a model draws as one instanced mesh per
 * paint. Each model is built at two levels of detail: `near` with rounded plates and decals, `far` with plain boxes,
 * coarse curves and no part smaller than `FAR_MIN`. Presentation only.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { shade, type Model, type Paint } from "../models.js";
import { labelUv, type Label } from "./decals.js";

export type Detail = "near" | "far";
export type V3 = readonly [number, number, number];
const O: V3 = [0, 0, 0];
/** A part whose bounding radius (tiles, as drawn) is under this is left out of the far model. */
export const FAR_MIN = 0.022;

const local = (p: V3, r: V3, s: V3) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    new THREE.Vector3(...s),
  );

export class Rig {
  constructor(
    readonly detail: Detail,
    private readonly parts = new Map<Paint, THREE.BufferGeometry[]>(),
    private readonly frame = new THREE.Matrix4(),
  ) {}

  get far(): boolean {
    return this.detail === "far";
  }

  /** Places `g` at `p`, turned by `r` (XYZ Euler) in this frame; the far model drops it if it is tiny. */
  add(paint: Paint, g: THREE.BufferGeometry, p: V3 = O, r: V3 = O): this {
    g.applyMatrix4(this.frame.clone().multiply(local(p, r, [1, 1, 1])));
    g.computeBoundingSphere();
    // Far away bare metal and gunmetal read as the dark frame: two draw calls fewer.
    const as =
      this.far && (paint === "steel" || paint === "gun") ? "dark" : paint;
    if (this.far && g.boundingSphere!.radius < FAR_MIN) g.dispose();
    else this.parts.set(as, [...(this.parts.get(as) ?? []), g]);
    return this;
  }

  /** A child frame: a head on a neck, a gun in a hand, or a whole unit scaled from concept metres to tiles. */
  sub(p: V3, r: V3 = O, s: number | V3 = 1): Rig {
    const scale: V3 = typeof s === "number" ? [s, s, s] : s;
    return new Rig(this.detail, this.parts, this.frame.clone().multiply(local(p, r, scale)));
  } // prettier-ignore

  /** Mirrored left (−1) and right (+1). */
  pair(make: (side: number) => void): this {
    make(-1);
    make(1);
    return this;
  }

  /** A plate with rounded edges; a plain box far away or when the rounding would not show. */
  box(w: number, h: number, d: number, r = 0.02, seg = 1): THREE.BufferGeometry {
    const round = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
    return this.far || round < 0.012 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, seg, round);
  } // prettier-ignore

  /** A cylinder along y, coarser far away. */
  cyl(top: number, bottom: number, h: number, seg = 12): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(top, bottom, h, this.far ? 6 : seg);
  }

  sphere(r: number, sy = 1): THREE.BufferGeometry {
    return new THREE.SphereGeometry(r, this.far ? 6 : 12, this.far ? 4 : 8).scale(1, sy, 1);
  } // prettier-ignore

  /** A capsule along y: a fuel tank. */
  capsule(r: number, len: number): THREE.BufferGeometry {
    return new THREE.CapsuleGeometry(r, len, this.far ? 2 : 4, this.far ? 6 : 12);
  } // prettier-ignore

  /** An outline (x, y) extruded `depth` along z, centred, with a bevel near by. */
  extrude(pts: readonly (readonly [number, number])[], depth: number, bevel = 0.015): THREE.BufferGeometry {
    const b = this.far ? 0 : bevel;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))),
      { depth: Math.max(0.001, depth - 2 * b), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: 1 });
    return g.translate(0, 0, -depth / 2 + b);
  } // prettier-ignore

  /** A side profile (z, y) extruded `width` across x: a hull. */
  hull(profile: readonly (readonly [number, number])[], width: number, bevel = 0.03): THREE.BufferGeometry {
    return this.extrude(profile, width, bevel).rotateY(-Math.PI / 2);
  } // prettier-ignore

  /** A top outline (x, z) extruded `height` up from y = 0: a turret. */
  plan(outline: readonly (readonly [number, number])[], height: number, bevel = 0.02): THREE.BufferGeometry {
    return this.extrude(outline.map(([x, z]) => [x, -z] as const), height, bevel).rotateX(-Math.PI / 2).translate(0, height / 2, 0);
  } // prettier-ignore

  /** A strut from `a` to `b`, `w` thick: a box, or a rod when `round`. */
  beam(a: V3, b: V3, w: number, round = false): THREE.BufferGeometry {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const g = round ? this.cyl(w / 2, w / 2, len, 8) : this.box(w, len, w, 0.015);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  } // prettier-ignore

  /** A squad number stencilled `w` wide at `p`, facing +z turned by `r`; too small to read far away, so left out. */
  decal(label: Label, w: number, p: V3, r: V3 = O): this {
    if (this.far) return this;
    const g = new THREE.PlaneGeometry(w, (w * 5) / 7), uv = g.getAttribute("uv"), [u0, u1, v0, v1] = labelUv(label);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return this.add("decal", g, p, r);
  } // prettier-ignore

  /** Merges each paint's parts into one geometry with grime baked in (darker toward `floor`, worn bright edges). */
  bake(floor = 0, span = 0.35): Model {
    return [...this.parts].map(([paint, list]) => {
      const flat = list.map((g) => shade(g.index ? g.toNonIndexed() : g, floor, span));
      for (const g of flat) g.clearGroups();
      const geometry = mergeGeometries(flat)!;
      for (const g of new Set([...list, ...flat])) g.dispose();
      geometry.computeBoundingBox();
      return { paint, geometry };
    });
  } // prettier-ignore
}
