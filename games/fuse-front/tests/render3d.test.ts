import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Batch, writeMatrix } from "../src/render3d/instances.js";
import { uploadLive } from "../src/render3d/effects3d.js";
import * as rig from "../src/render3d/rig.js";
import { LOD_BAND, LOD_FAR } from "../src/render3d/kit/units.js";
import { mapById } from "../src/online/maps.js";
import {
  DECK_Y,
  RES,
  WATER_Y,
  heightAt,
  heightField,
  normalMap,
  standY,
  terrainBuffers,
  terrainChunks,
} from "../src/render3d/terrain.js";

// Open sand, a cliff, a river and a bridge: each tile is 3 × 3 vertices inside, shared edges averaged.
const MAP = {
  width: 6,
  height: 3,
  terrain: ["..^^..", "..~~..", "..==.."],
};

test("the height field has a vertex grid of width·res + 1 by height·res + 1", () => {
  const field = heightField(MAP);
  assert.equal(field.res, RES);
  assert.equal(field.cols, MAP.width * RES + 1);
  assert.equal(field.rows, MAP.height * RES + 1);
  assert.equal(field.heights.length, field.cols * field.rows);
});

test("cliffs rise, rivers sink and sand stays near zero", () => {
  const field = heightField(MAP);
  assert.ok(heightAt(field, 2.5, 0.5) > 1, "cliff top");
  assert.ok(heightAt(field, 2.5, 1.5) < -0.5, "riverbed");
  assert.ok(Math.abs(heightAt(field, 0.5, 1.5)) < 0.25, "sand");
  // A cliff face climbs within one tile: the edge vertex sits halfway.
  const edge = heightAt(field, 2, 0.5);
  assert.ok(edge > 0.4 && edge < 1.1, `edge ${edge}`);
});

test("walkers stand on the bridge deck, never under the water", () => {
  const field = heightField(MAP);
  assert.equal(standY(MAP, field, 2.5, 2.5), DECK_Y);
  assert.equal(standY(MAP, field, 3.5, 1.5), WATER_Y);
});

test("terrain buffers fill every vertex and index only real vertices; steep faces turn to rock", () => {
  const field = heightField(MAP);
  const { positions, colors, uvs, indices } = terrainBuffers(field);
  const count = field.cols * field.rows;
  assert.equal(positions.length, count * 3);
  assert.equal(colors.length, count * 3);
  assert.equal(uvs.length, count * 2);
  assert.equal(indices.length, (field.cols - 1) * (field.rows - 1) * 6);
  assert.ok(Math.max(...indices) < count);
  // The cliff face (x = 2, z ≈ 0.33) is darker rock than the open sand beside it (x ≈ 0.33).
  const light = (i: number, j: number) => {
    const v = (j * field.cols + i) * 3;
    return colors[v]! + colors[v + 1]! + colors[v + 2]!;
  };
  assert.ok(light(2 * RES, 1) < light(1, 1) * 0.7);
});

test("a flat height texture makes a straight-up normal map", () => {
  const out = normalMap(new Float32Array(16).fill(0.5), 4);
  assert.deepEqual([...out.subarray(0, 4)], [128, 128, 255, 255]);
});

test("instance matrices match three.js composing scale, yaw and position", () => {
  const out = new Float32Array(32);
  writeMatrix(out, 1, 3, 0.5, -2, 0.7, 1.5, 2, 0.5);
  const expected = new THREE.Matrix4().compose(
    new THREE.Vector3(3, 0.5, -2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7),
    new THREE.Vector3(1.5, 2, 0.5),
  );
  [...out.subarray(16)].forEach((v, i) =>
    assert.ok(Math.abs(v - expected.elements[i]!) < 1e-6, `element ${i}`),
  );
  // A leg's swing tilts about x before the yaw: three.js's YXZ Euler order.
  writeMatrix(out, 0, 1, 2, 3, 0.7, 0.1, 0.3, 0.1, 0.4);
  const swung = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, 0, "YXZ")),
    new THREE.Vector3(0.1, 0.3, 0.1),
  );
  [...out.subarray(0, 16)].forEach((v, i) =>
    assert.ok(Math.abs(v - swung.elements[i]!) < 1e-6, `swung element ${i}`),
  );
});

test("a batch refills each frame and doubles when a frame outgrows it, keeping what it holds", () => {
  const batch = new Batch(2);
  batch.begin();
  for (let i = 0; i < 5; i++) batch.push(i, 0, 0, 0, 1, 1, 1, [i, 0, 1]);
  assert.equal(batch.count, 5);
  assert.equal(batch.capacity, 8);
  assert.ok(batch.grown);
  assert.equal(batch.matrices.length, 8 * 16);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => batch.matrices[i * 16 + 12]),
    [0, 1, 2, 3, 4],
  );
  assert.equal(batch.colors[4 * 3], 4);
  const arrays = batch.matrices;
  batch.begin();
  batch.push(9, 0, 0, 0, 1, 1, 1, [0, 0, 0]);
  assert.equal(batch.count, 1);
  assert.ok(!batch.grown);
  assert.equal(batch.matrices, arrays, "no new arrays once grown");
});

test("a frame uploads only its live instances, and nothing when none are live", () => {
  const attr = new THREE.InstancedBufferAttribute(
    new Float32Array(3072 * 4),
    4,
  );
  attr.addUpdateRange(0, 8);
  const version = attr.version;
  // An empty range would reach WebGL2 as bufferSubData(..., 0, 0): a length of 0 uploads the whole array.
  uploadLive(attr, 0);
  assert.deepEqual([attr.updateRanges, attr.version], [[], version]);
  uploadLive(attr, 3);
  assert.deepEqual(attr.updateRanges, [{ start: 0, count: 12 }]);
  assert.equal(attr.version, version + 1);
});

test("the rig looks down at 55°, clamps to the map and zooms within bounds", () => {
  const r: rig.Rig = { x: 10, z: 10, distance: 20 };
  const at = rig.eye(r);
  assert.ok(
    Math.abs(Math.atan2(at.y, at.z - r.z) - (55 * Math.PI) / 180) < 1e-9,
  );
  rig.panRig(r, -10000, 10000, 600);
  rig.clampRig(r, 96, 56);
  // Pushed past the south-west corner, it stops where the view's edges meet the map's.
  assert.deepEqual([r.x, r.z], [12, 56 - 5]);
  // A map smaller than the view keeps the camera on its centre.
  rig.clampRig(r, 8, 6);
  assert.deepEqual([r.x, r.z], [4, 3]);
  rig.zoomRig(r, 100);
  assert.equal(r.distance, rig.NEAR);
  rig.zoomRig(r, 0.001);
  assert.equal(r.distance, rig.FAR);
});

test("an upright phone's narrow view keeps a hero by the map's west edge in the middle of the screen", () => {
  // Neon Duel's west fort stands 9 tiles in; the opening zoom on a 348×762 board is about 23 tiles out.
  const [x, aspect] = [9, 348 / 762];
  const desk: rig.Rig = { x, z: 166, distance: 23 };
  rig.clampRig(desk, 176, 176);
  assert.ok(
    desk.x > 13,
    "a 5:3 view keeps over half the distance from the edge",
  );
  const phone: rig.Rig = { x, z: 166, distance: 23 };
  rig.clampRig(phone, 176, 176, aspect);
  assert.equal(phone.x, x, "the phone's target stays on the hero");
  // Further in than its half-width, it still stops where the view's edge meets the map's.
  const edge: rig.Rig = { x: 0, z: 166, distance: 23 };
  rig.clampRig(edge, 176, 176, aspect);
  const half = 23 * Math.tan((rig.FOV * Math.PI) / 360) * aspect;
  assert.ok(Math.abs(edge.x - half) < 1e-9);
  // A pinch about the middle of the phone's view keeps the same clamp: the hero doesn't jump off the edge.
  const pinch: rig.Rig = { x, z: 166, distance: 23 };
  rig.zoomRigAt(pinch, 1.1, 0, 0, aspect, 176, 176);
  assert.ok(Math.abs(pinch.x - x) < 1e-9, `${pinch.x}`);
});

test("the zoom-out limit grows with the map until a big map fits the 4:3 board", () => {
  assert.equal(rig.farFor(64, 40), rig.FAR, "a small map keeps the old limit");
  for (const id of ["rust-canyon", "glass-lakes", "iron-delta"]) {
    const map = mapById(id);
    const far = rig.farFor(map.width, map.height);
    assert.ok(far > rig.FAR, id);
    const r: rig.Rig = { x: 0, z: 0, distance: 1e6 };
    rig.clampRig(r, map.width, map.height);
    assert.equal(r.distance, far, `${id} clamps to its own limit`);
    rig.zoomRig(r, 1e-6, far);
    assert.equal(r.distance, far);
    // Fully out, a 4:3 view takes in the whole width across its middle and over 90% of the height.
    const camera = new THREE.PerspectiveCamera(rig.FOV, 4 / 3, 0.5, 2000);
    const at = rig.eye(r);
    camera.position.set(at.x, at.y, at.z);
    camera.lookAt(r.x, 0, r.z);
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = (x: number, y: number) => {
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      return ray.ray.intersectPlane(ground, new THREE.Vector3())!;
    };
    const top = hit(-1, 1),
      bottom = hit(-1, -1);
    assert.ok(hit(-1, 0).x <= 0 && hit(1, 0).x >= map.width, `${id} width`);
    assert.ok(bottom.z - top.z >= map.height * 0.9, `${id} height`);
  }
});

test("zooming out tilts the camera toward top-down and fades strategic markers in past a threshold", () => {
  assert.equal(rig.pitchAt(rig.START), rig.PITCH);
  assert.equal(rig.pitchAt(rig.TILT_FROM), rig.PITCH);
  assert.equal(rig.pitchAt(1000), rig.TOP_PITCH);
  assert.ok(rig.pitchAt(100) > rig.PITCH && rig.pitchAt(100) < rig.TOP_PITCH);
  assert.equal(rig.markerFade(rig.START), 0);
  assert.equal(rig.markerFade(rig.MARKER_FROM), 0);
  assert.equal(rig.markerFade(rig.MARKER_TO), 1);
  const mid = rig.markerFade((rig.MARKER_FROM + rig.MARKER_TO) / 2);
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
  // Markers are fully in before the farthest zoom of every map, and none show at the default zoom.
  assert.ok(rig.MARKER_TO <= rig.FAR && rig.MARKER_FROM > rig.START);
});

test("a match opens on a close tactical zoom: some 34 tiles across a desktop board, every robot on its near model", () => {
  // The middle row's ground from edge to edge, for a cssW × cssH board at its opening zoom.
  const across = (cssW: number, cssH: number) => {
    const d = rig.startFor(cssH),
      aspect = cssW / cssH;
    return (
      rig.groundOffset(d, 1, 0, aspect)!.x -
      rig.groundOffset(d, -1, 0, aspect)!.x
    );
  };
  for (const [w, h] of [
    [1402, 628],
    [1218, 428],
    [1840, 720],
  ] as const) {
    const tiles = across(w, h);
    assert.ok(
      tiles >= 28 && tiles <= 46,
      `${w}x${h}: ${tiles.toFixed(1)} tiles`,
    );
    assert.ok(
      Math.abs(w / tiles - rig.START_TILE_PX) < 1,
      `${w}x${h}: px per tile`,
    );
  }
  // A short phone board stays close; a tall screen stops short of the robots' far models and the tilt.
  assert.equal(rig.startFor(160), rig.START_MIN);
  assert.equal(rig.startFor(4000), rig.START_MAX);
  assert.ok(
    rig.START_MAX < LOD_FAR - LOD_BAND && rig.START_MAX <= rig.TILT_FROM,
  );
  assert.equal(rig.markerFade(rig.START_MAX), 0);
  assert.ok(rig.START_MIN > rig.NEAR);
});

/** Where three.js's own ray through device point `nx`, `ny` meets the plane at height `h`, for the rig's camera. */
function picked(r: rig.Rig, nx: number, ny: number, aspect: number, h = 0) {
  const camera = new THREE.PerspectiveCamera(rig.FOV, aspect, 0.5, 2000);
  const at = rig.eye(r);
  camera.position.set(at.x, at.y, at.z);
  camera.lookAt(r.x, 0, r.z);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
  return ray.ray.intersectPlane(plane, new THREE.Vector3())!;
}

test("the rig's ground offset is the point three.js picks under the cursor, at any tilt and height", () => {
  for (const distance of [rig.NEAR, rig.START, 60, 120, 300])
    for (const [nx, ny] of [
      [0, 0],
      [-0.95, 0.9],
      [0.8, -0.95],
      [0.3, 0.4],
    ] as const)
      for (const h of [0, 0.6]) {
        const r: rig.Rig = { x: 50, z: 40, distance };
        const want = picked(r, nx, ny, 16 / 9, h);
        const got = rig.groundOffset(distance, nx, ny, 16 / 9, h)!;
        const at = `${distance} ${nx},${ny} h${h}`;
        assert.ok(Math.abs(r.x + got.x - want.x) < 1e-6, at);
        assert.ok(Math.abs(r.z + got.z - want.z) < 1e-6, at);
      }
});

test("a zoom at the cursor keeps the ground under it there, across the tilt; the map clamp still wins", () => {
  const [W, H, aspect] = [4000, 3000, 16 / 9];
  // In the open middle of a big map, from close in through the strategic tilt and back, toward each corner.
  for (const start of [8, rig.START, 35, 90, 200])
    for (const factor of [1.25, 0.8, 3, 0.2])
      for (const [nx, ny] of [
        [-0.9, 0.85],
        [0.9, -0.9],
        [0.5, 0.1],
      ] as const) {
        const r: rig.Rig = { x: 2000, z: 1500, distance: start };
        const before = picked(r, nx, ny, aspect, 0.4);
        rig.zoomRigAt(r, factor, nx, ny, aspect, W, H, 0.4);
        const after = picked(r, nx, ny, aspect, 0.4);
        const at = `${start} ×${factor} at ${nx},${ny}`;
        assert.notEqual(r.distance, start, at);
        assert.ok(
          before.distanceTo(after) < 1e-6,
          `${at}: moved ${before.distanceTo(after)}`,
        );
      }
  // At the zoom limits the distance stops and the point holds anyway.
  const near: rig.Rig = { x: 2000, z: 1500, distance: rig.NEAR };
  const was = picked(near, 0.7, 0.7, aspect);
  rig.zoomRigAt(near, 4, 0.7, 0.7, aspect, W, H);
  assert.equal(near.distance, rig.NEAR);
  assert.ok(was.distanceTo(picked(near, 0.7, 0.7, aspect)) < 1e-9);
  // In a 400 × 300 map's north-west corner, the screen's top-left shows ground off the map. Zooming out from there
  // moves the view inward, which the clamp allows, so that point holds exactly.
  const [w, h] = [400, 300];
  const edge: rig.Rig = { x: 0, z: 0, distance: 30 };
  rig.clampRig(edge, w, h);
  const corner = picked(edge, -0.95, 0.95, aspect);
  assert.ok(corner.x < 0 && corner.z < 0, "off the map");
  rig.zoomRigAt(edge, 0.5, -0.95, 0.95, aspect, w, h);
  assert.equal(edge.distance, 60);
  assert.ok(corner.distanceTo(picked(edge, -0.95, 0.95, aspect)) < 1e-6);
  // Zooming in toward it would take the view off the map: the clamp wins and holds the view against the corner.
  const from = { ...edge };
  rig.clampRig(from, w, h);
  assert.deepEqual(from, edge, "the zoom left the view on the map");
  rig.zoomRigAt(edge, 4, -0.95, 0.95, aspect, w, h);
  assert.equal(edge.distance, 15);
  assert.deepEqual(
    [edge.x, edge.z],
    [15 * 0.6, 15 * 0.45],
    "held in the corner",
  );
});

test("a pick through the screen centre lands on the tile the rig looks at", () => {
  const map = {
    width: 20,
    height: 30,
    terrain: Array.from({ length: 30 }, () => ".".repeat(20)),
  };
  const { positions, indices } = terrainBuffers(heightField(map));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const ground = new THREE.Mesh(geometry);
  const r: rig.Rig = { x: 7.5, z: 15.5, distance: 18 };
  const camera = new THREE.PerspectiveCamera(rig.FOV, 16 / 9, 0.5, 200);
  const at = rig.eye(r);
  camera.position.set(at.x, at.y, at.z);
  camera.lookAt(r.x, 0, r.z);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = ray.intersectObject(ground)[0]!;
  assert.deepEqual([Math.floor(hit.point.x), Math.floor(hit.point.z)], [7, 15]);
  // The top of the screen looks further north (smaller z) than the bottom.
  ray.setFromCamera(new THREE.Vector2(0, 0.9), camera);
  const top = ray.intersectObject(ground)[0]!;
  ray.setFromCamera(new THREE.Vector2(0, -0.9), camera);
  const bottom = ray.intersectObject(ground)[0]!;
  assert.ok(top.point.z < bottom.point.z);
});

test("the ground's chunks tile the map and together hold exactly the whole mesh's triangles", () => {
  const map = {
    width: 150,
    height: 70,
    terrain: Array.from({ length: 70 }, () => ".".repeat(150)),
  };
  const field = heightField(map, 2);
  const chunks = terrainChunks(field, 64);
  assert.deepEqual(
    chunks.map((c) => [c.x0, c.z0, c.x1, c.z1]),
    [
      [0, 0, 64, 64],
      [64, 0, 128, 64],
      [128, 0, 150, 64],
      [0, 64, 64, 70],
      [64, 64, 128, 70],
      [128, 64, 150, 70],
    ],
  );
  const triangles = (indices: Uint32Array) => {
    const out: string[] = [];
    for (let k = 0; k < indices.length; k += 3)
      out.push(`${indices[k]},${indices[k + 1]},${indices[k + 2]}`);
    return out;
  };
  const whole = triangles(terrainBuffers(field).indices).sort();
  const parts = chunks.flatMap((c) => triangles(c.indices)).sort();
  assert.deepEqual(parts, whole);
});
