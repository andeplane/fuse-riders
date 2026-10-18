import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Batch, writeMatrix } from "../src/render3d/instances.js";
import * as rig from "../src/render3d/rig.js";
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
