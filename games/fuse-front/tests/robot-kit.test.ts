import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  LABELS,
  decalAtlas,
  labelMask,
  labelUv,
} from "../src/render3d/kit/decals.js";
import { FAR_MIN, Rig } from "../src/render3d/kit/rig.js";
import {
  LOD_BAND,
  LOD_FAR,
  detailAt,
  robotModel,
  robotPart,
  type RobotKind,
} from "../src/render3d/kit/units.js";
import {
  HERO_KINDS,
  paintMaterials,
  type HeroKind,
  type Model,
} from "../src/render3d/models.js";
import { heroModel } from "../src/render3d/kit/heroes.js";

const KINDS: RobotKind[] = [
  "grunt",
  "torch",
  "lightTank",
  "sentry",
  "tankTurret",
];
const tris = (model: Model) =>
  model.reduce((n, p) => n + p.geometry.getAttribute("position").count / 3, 0);
const size = (model: Model) =>
  model
    .reduce((b, p) => b.union(p.geometry.boundingBox!), new THREE.Box3())
    .getSize(new THREE.Vector3());

/** What one unit of a kind costs drawn: its body plus the shared parts it carries (legs, tracks, turret). */
function unitCost(kind: RobotKind, detail: "near" | "far"): { draws: number; tris: number } {
  const parts: Model[] = [robotModel(kind, detail, false)];
  if (kind === "grunt" || kind === "torch") parts.push(robotPart("robotLeg", detail), robotPart("robotLeg", detail));
  if (kind === "lightTank") parts.push(robotModel("tankTurret", detail, false), robotPart("treads", detail));
  return { draws: parts.reduce((n, m) => n + m.length, 0), tris: parts.reduce((n, m) => n + tris(m), 0) };
} // prettier-ignore

test("every robot reads apart at a glance, near and far, and keeps its size at either detail", () => {
  for (const detail of ["near", "far"] as const) {
    const dims = KINDS.map((k) => size(robotModel(k, detail)).toArray().map((v) => v.toFixed(2)).join());
    assert.equal(new Set(dims).size, KINDS.length, dims.join(" | "));
  }
  for (const kind of KINDS) {
    const near = size(robotModel(kind, "near")), far = size(robotModel(kind, "far"));
    assert.ok(near.distanceTo(far) < 0.08, `${kind}: the far model keeps the silhouette`);
  }
}); // prettier-ignore

test("team colour goes on the big plates only; frames are gunmetal, visors glow, squad numbers are stencilled near by", () => {
  for (const kind of KINDS) {
    const model = robotModel(kind), paints = model.map((p) => p.paint);
    assert.ok(paints.includes("team") && paints.includes("dark"), `${kind}: team plates on a dark frame`);
    const area = (paint: string) => tris(model.filter((p) => p.paint === paint));
    assert.ok(area("team") < tris(model) * 0.6, `${kind}: team colour is not the whole robot`);
    // The tank's number is on its turret.
    assert.ok(kind === "lightTank" || paints.includes("decal"), `${kind}: a squad number`);
    assert.ok(!robotModel(kind, "far").some((p) => p.paint === "decal"), `${kind}: no decals far away`);
  }
  for (const kind of ["grunt", "tankTurret"] as const) assert.ok(robotModel(kind).some((p) => p.paint === "visor"), kind);
  assert.ok(robotModel("torch").some((p) => p.paint === "flame") && robotModel("torch").some((p) => p.paint === "hazard"));
  assert.ok(robotModel("sentry").some((p) => p.paint === "eye"));
}); // prettier-ignore

test("draw calls are bounded per kind, and the far model is several times cheaper", () => {
  for (const kind of KINDS) {
    const near = unitCost(kind, "near"), far = unitCost(kind, "far");
    assert.ok(robotModel(kind).length <= 7, `${kind}: ${robotModel(kind).length} paints near`);
    assert.ok(robotModel(kind, "far").length <= 6, `${kind}: ${robotModel(kind, "far").length} paints far`);
    assert.ok(near.tris <= 6000, `${kind}: ${near.tris} triangles near`);
    assert.ok(far.tris * 3 < near.tris, `${kind}: ${far.tris} far vs ${near.tris} near`);
    assert.ok(far.draws < near.draws, `${kind}: ${far.draws} draws far vs ${near.draws} near`);
  }
  // Instanced per paint, a whole army costs the same draw calls as one unit of each kind at each detail.
  const total = KINDS.reduce((n, k) => n + robotModel(k).length + robotModel(k, "far").length, 0)
    + [robotPart("robotLeg"), robotPart("treads"), robotPart("robotLeg", "far"), robotPart("treads", "far")].reduce((n, m) => n + m.length, 0);
  assert.ok(total <= 64, `${total} robot draw calls at most`);
}); // prettier-ignore

test("the far model drops small parts and low quality always takes it", () => {
  assert.equal(detailAt(10, "high"), "near");
  assert.equal(detailAt(LOD_FAR, "high"), "near");
  assert.equal(detailAt(LOD_FAR + 0.1, "high"), "far");
  assert.equal(detailAt(10, "low"), "far");
  // A band keeps a unit on the line from flickering: once far, it turns near only well inside `LOD_FAR`.
  assert.equal(detailAt(LOD_FAR - 1, "high", "far"), "far");
  assert.equal(detailAt(LOD_FAR - LOD_BAND - 0.1, "high", "far"), "near");
  assert.equal(detailAt(LOD_FAR - 1, "high", "near"), "near");
  const rig = new Rig("far");
  rig.add("steel", rig.box(FAR_MIN, FAR_MIN, FAR_MIN)).add("team", rig.box(0.3, 0.3, 0.3, 0.05)).decal("07", 0.2, [0, 0, 0.2]);
  assert.deepEqual(rig.bake().map((p) => p.paint), ["team"]);
  const near = new Rig("near");
  near.add("team", near.box(0.3, 0.3, 0.3, 0.05)).sub([1, 0, 0], [0, 0, 0], 2).add("steel", near.box(0.1, 0.1, 0.1));
  const steel = near.bake().find((p) => p.paint === "steel")!.geometry.boundingBox!;
  assert.ok(Math.abs(steel.min.x - 0.9) < 1e-6 && Math.abs(steel.max.x - 1.1) < 1e-6, "a sub frame offsets and scales");
}); // prettier-ignore

test("squad numbers come from one shared pixel atlas", () => {
  const atlas = decalAtlas(), paints = paintMaterials();
  assert.equal(atlas.image.width, 8 * LABELS.length);
  assert.ok(paints.decal.map instanceof THREE.DataTexture && paints.decal.alphaTest > 0);
  // "07": the zero's hole is dark, the seven's top bar is lit.
  const mask = labelMask("07");
  assert.ok(!mask[3 * 8 + 1] && mask[5 * 8 + 4] && mask[5 * 8 + 6]);
  assert.equal(mask.filter(Boolean).length, 12 + 7);
  const [u0, u1] = labelUv("21"), [w0] = labelUv("S3");
  assert.ok(u0 < u1 && u1 <= w0, "cells do not overlap");
}); // prettier-ignore

test("heroes: each its own silhouette near and far, team plates on a dark frame, bounded draw calls", () => {
  for (const detail of ["near", "far"] as const) {
    const dims = HERO_KINDS.map((k) => size(heroModel(k, detail)).toArray().map((v) => v.toFixed(2)).join());
    assert.equal(new Set(dims).size, HERO_KINDS.length, dims.join(" | "));
  }
  // What a hero costs drawn: its body plus the shared robot leg twice (one instanced slot).
  const cost = (k: HeroKind, detail: "near" | "far") => {
    const body = heroModel(k, detail, false), leg = robotPart("robotLeg", detail);
    return { draws: body.length + leg.length, tris: tris(body) + 2 * tris(leg) };
  };
  for (const kind of HERO_KINDS) {
    const model = heroModel(kind), paints = model.map((p) => p.paint), near = cost(kind, "near"), far = cost(kind, "far");
    assert.ok(paints.includes("team") && paints.includes("dark"), `${kind}: team plates on a dark frame`);
    assert.ok(tris(model.filter((p) => p.paint === "team")) < tris(model) * 0.6, `${kind}: team colour is not the whole hero`);
    assert.ok(size(heroModel(kind)).distanceTo(size(heroModel(kind, "far"))) < 0.08, `${kind}: the far model keeps the silhouette`);
    assert.ok(heroModel(kind).length <= 7 && heroModel(kind, "far").length <= 5, `${kind}: paints near/far`);
    assert.ok(near.tris <= 7000 && far.tris * 3 < near.tris && far.draws < near.draws, `${kind}: ${near.tris}/${far.tris} triangles`);
    // Its glowing eye or visor survives the far model, so a hero still reads at low quality.
    assert.ok(heroModel(kind, "far").some((p) => ["eye", "amber", "visor"].includes(p.paint)), `${kind}: a light far away`);
  }
  assert.ok(heroModel("vix", "far").some((p) => p.paint === "eye"), "Vix's single red eye");
  assert.ok(size(heroModel("brick")).x > 2 * size(heroModel("vix")).x, "Brick's shoulders, Vix's thin frame");
}); // prettier-ignore
