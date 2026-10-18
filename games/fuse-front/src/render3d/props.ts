/**
 * Battle litter on the open sand, placed once per match from tile hashes: shell craters, tyre tracks and scrap. Each
 * kind is one instanced mesh filled at build time, so the whole field of it costs a draw call. Only tiles whose
 * neighbours are all open sand get one, so nothing lands on a building, a flag, a rock or a bank. Presentation only.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash } from "./terrain.js";
import { shade } from "./models.js";

export interface Prop {
  x: number;
  z: number;
  yaw: number;
  size: number;
}
export type PropKind = "crater" | "tracks" | "scrap";

/** Where each prop goes: about one open tile in forty of each kind, the same for the same map. */
// prettier-ignore
export function propSpots(terrain: readonly string[]): Record<PropKind, Prop[]> {
  const out: Record<PropKind, Prop[]> = { crater: [], tracks: [], scrap: [] };
  const open = (x: number, y: number) => terrain[y]?.[x] === ".";
  for (let y = 0; y < terrain.length; y++)
    for (let x = 0; x < terrain[y]!.length; x++) {
      let clear = true;
      for (let k = 0; k < 9; k++) clear &&= open(x + (k % 3) - 1, y + Math.floor(k / 3) - 1);
      const h = hash(x, y, 51);
      if (!clear || h >= 0.075) continue;
      const kind: PropKind = h < 0.025 ? "crater" : h < 0.05 ? "tracks" : "scrap";
      out[kind].push({ x: x + 0.3 + 0.4 * hash(x, y, 52), z: y + 0.3 + 0.4 * hash(x, y, 53), yaw: hash(x, y, 54) * 6.28, size: 0.6 + 0.6 * hash(x, y, 55) });
    }
  return out;
}

/** A crater's raised rim and scorched floor, a pair of tyre ruts, and a bent plate with a wheel and a crate. */
// prettier-ignore
function shapes(): Record<PropKind, THREE.BufferGeometry> {
  // `dim` darkens a piece's baked colour: a crater's floor is scorched under its sandy rim.
  const merge = (list: THREE.BufferGeometry[], dim = [1, 1, 1]) => {
    const flat = list.map((g, i) => {
      const f = g.index ? g.toNonIndexed() : g;
      f.deleteAttribute("uv");
      const c = shade(f, 0, 0.15).getAttribute("color").array as Float32Array;
      for (let k = 0; k < c.length; k++) c[k]! *= dim[i]!;
      return f;
    });
    const out = mergeGeometries(flat)!;
    for (const g of new Set([...list, ...flat])) g.dispose();
    return out;
  };
  return {
    crater: merge([new THREE.TorusGeometry(0.42, 0.08, 5, 18).rotateX(Math.PI / 2).scale(1, 0.45, 1),
      new THREE.CircleGeometry(0.42, 18).rotateX(-Math.PI / 2).translate(0, 0.012, 0)], [1.6, 0.5]),
    tracks: merge([-1, 1].map((s) => new THREE.PlaneGeometry(0.1, 1.7, 1, 8).rotateX(-Math.PI / 2).translate(s * 0.17, 0.015, 0))),
    scrap: merge([new THREE.BoxGeometry(0.34, 0.025, 0.22).rotateZ(0.35).translate(0, 0.05, 0),
      new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10).rotateX(1.3).translate(0.2, 0.06, 0.12),
      new THREE.BoxGeometry(0.1, 0.08, 0.1).rotateY(0.6).translate(-0.18, 0.04, -0.1)]),
  };
}

const LOOKS: Record<PropKind, THREE.MeshStandardMaterialParameters> = {
  crater: { color: 0x9a7a58, roughness: 1 },
  tracks: {
    color: 0x5a4430,
    roughness: 1,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  },
  scrap: { color: 0x5c5650, roughness: 0.55, metalness: 0.7 },
};

/** The props for a map as three instanced meshes on the ground; dispose frees their geometry and materials. */
// prettier-ignore
export function buildProps(terrain: readonly string[], groundAt: (x: number, z: number) => number) {
  const group = new THREE.Group(), owned: { dispose(): void }[] = [];
  const geos = shapes(), spots = propSpots(terrain), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const kind of ["crater", "tracks", "scrap"] as const) {
    const material = new THREE.MeshStandardMaterial({ ...LOOKS[kind], vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1 });
    const mesh = new THREE.InstancedMesh(geos[kind], material, Math.max(1, spots[kind].length));
    mesh.count = spots[kind].length;
    spots[kind].forEach((p, i) => mesh.setMatrixAt(i, m.compose(v.set(p.x, groundAt(p.x, p.z), p.z), q.setFromAxisAngle(up, p.yaw), s.setScalar(p.size))));
    mesh.receiveShadow = true;
    mesh.castShadow = kind === "scrap";
    group.add(mesh);
    owned.push(geos[kind], material);
  }
  return { group, dispose: () => owned.forEach((o) => o.dispose()) };
}
