import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { HeroView } from "../src/engine/view.js";
import {
  HERO_KINDS,
  LEGS,
  PAINTS,
  RING,
  approachAngle,
  bob,
  buildingModel,
  detailMaps,
  heroKindOf,
  legSwing,
  paintMaterials,
  panelHeights,
  partModel,
  recoil,
  ruinModel,
  setDetail,
  shade,
  treadPhase,
  unitModel,
  waveCloth,
  type Model,
  type ModelKind,
} from "../src/render3d/models.js";
import { propSpots } from "../src/render3d/props.js";

const box = (model: Model) =>
  model.reduce(
    (b, part) => b.union(part.geometry.boundingBox!),
    new THREE.Box3(),
  );
const size = (model: Model) => box(model).getSize(new THREE.Vector3());
const footprint = (model: Model) => {
  const s = size(model);
  return s.x * s.z;
};

const KINDS: ModelKind[] = [
  "grunt",
  "torch",
  "lightTank",
  "tankTurret",
  ...HERO_KINDS,
];

test("every model merges to one non-empty geometry per paint, stands on the ground and wears team colour", () => {
  for (const kind of KINDS) {
    const model = unitModel(kind);
    const paints = model.map((p) => p.paint);
    assert.equal(new Set(paints).size, paints.length, `${kind}: paints merged`);
    assert.ok(paints.includes("team"), `${kind}: has a team surface`);
    assert.ok(model.length <= 6, `${kind}: ${model.length} draw calls`);
    for (const part of model)
      assert.ok(part.geometry.getAttribute("position").count > 0);
    if (kind !== "tankTurret")
      assert.ok(Math.abs(box(model).min.y) < 0.01, `${kind} stands on y = 0`);
  }
});

test("unit kinds read apart by footprint: grunt < torch < light tank, and every hero outsizes them in height", () => {
  const [grunt, torch, tank] = (["grunt", "torch", "lightTank"] as const).map(
    (k) => unitModel(k),
  );
  assert.ok(footprint(grunt!) < footprint(torch!));
  assert.ok(footprint(torch!) < footprint(tank!));
  // A tank is long and low, robots are tall and narrow.
  assert.ok(size(tank!).z > size(tank!).y * 1.5);
  assert.ok(size(grunt!).y > size(grunt!).x);
  for (const hero of HERO_KINDS) {
    const tall = size(unitModel(hero)).y;
    assert.ok(tall > size(torch!).y * 1.3, `${hero} is ${tall} tall`);
  }
  assert.ok(RING.grunt < RING.torch && RING.torch < RING.lightTank);
  assert.ok(RING.lightTank < RING.hero);
});

test("team surfaces are white so the per-instance team colour shows true; visors glow", () => {
  const materials = paintMaterials();
  assert.deepEqual(Object.keys(materials).sort(), Object.keys(PAINTS).sort());
  assert.equal(materials.team.color.getHex(), 0xffffff);
  for (const glow of ["visor", "flame", "amber", "eye"] as const)
    assert.ok(materials[glow].emissiveIntensity > 1, glow);
  assert.ok(materials.hazard.map instanceof THREE.DataTexture);
  assert.ok(materials.steel.metalness > materials.concrete.metalness);
  assert.equal(materials.dish.side, THREE.DoubleSide);
  assert.equal(materials.steel.side, THREE.FrontSide);
});

test("buildings: the fort's radar spins, the turret's head aims, factories smoke; ruins are low and vary", () => {
  const fort = buildingModel("fort"),
    turret = buildingModel("turret");
  assert.equal(fort.pivot?.aims, false);
  assert.equal(turret.pivot?.aims, true);
  for (const kind of ["robotFactory", "vehicleFactory"] as const) {
    const factory = buildingModel(kind);
    assert.ok(factory.smoke && factory.smoke[1] > factory.height);
    assert.ok(factory.body.some((p) => p.paint === "glass"));
    assert.ok(factory.body.some((p) => p.paint === "hazard"));
  }
  assert.ok(size(fort.body).x > size(turret.body).x * 2);
  assert.ok(
    size(buildingModel("vehicleFactory").body).x >
      size(buildingModel("robotFactory").body).x,
  );
  const [a, b] = [ruinModel(1.5, 1.5, 1), ruinModel(1.5, 1.5, 2)];
  assert.ok(size(a).y < size(fort.body).y * 0.6);
  assert.notDeepEqual(box(a).max.toArray(), box(b).max.toArray());
});

test("a gun turns the short way round and stops on its aim", () => {
  assert.equal(approachAngle(0, 0.05, 0.1), 0.05);
  assert.equal(approachAngle(0, 1, 0.1), 0.1);
  // From just short of +π to just past −π is a small step forward, not a whole turn back.
  const turned = approachAngle(3, -3, 0.1);
  assert.ok(Math.abs(turned - 3.1) < 1e-9);
});

test("walkers hop, tanks barely shake, and idle bodies breathe gently", () => {
  const hops = [0, 50, 100, 150].map((t) => bob(true, t, 1, false));
  assert.ok(Math.max(...hops) > 0.02);
  for (const t of [0, 50, 100]) {
    assert.ok(bob(true, t, 1, true) < 0.01);
    assert.ok(bob(false, t, 1, true) === 0);
    assert.ok(bob(false, t, 1, false) <= 0.012);
  }
});

test("a hero wears the model of its kind", () => {
  // prettier-ignore
  const hero: HeroView = { seat: 0, kind: "brick", team: 0, x: 0, y: 0, hp: 1, maxHp: 1, level: 1, respawn: 0, energy: 0, maxEnergy: 0, xp: 0, spells: [], cloaked: false, blitzing: false, flare: -1 };
  assert.equal(heroKindOf(hero), "brick");
  assert.equal(heroKindOf({ ...hero, kind: "vix" }), "vix");
});

test("at a glance: every kind has its own bounding box, and each hero its signature parts", () => {
  const all: ModelKind[] = [...KINDS, "sentry"];
  const dims = all.map((k) => size(unitModel(k)).toArray().map((v) => v.toFixed(2)).join());
  assert.equal(new Set(dims).size, all.length, dims.join(" | "));
  const paints = (k: ModelKind) => unitModel(k).map((p) => p.paint);
  assert.ok(size(unitModel("brick")).x > Math.max(...(["vix", "rivet", "tally"] as const).map((k) => size(unitModel(k)).x)), "Brick is the broadest");
  assert.ok(paints("vix").includes("eye") && size(unitModel("vix")).z > 0.75, "Vix: a red eye and a long rifle");
  assert.ok(paints("rivet").includes("gold") && paints("rivet").includes("visor"), "Rivet: hard hat and goggles");
  assert.ok(size(unitModel("tally")).y > size(unitModel("brick")).y, "Tally's antenna tops them all");
  assert.ok(paints("lightTank").includes("tread") && !paints("lightTank").includes("eye"));
  for (const k of all) assert.ok(unitModel(k).length <= 7, `${k}: ${unitModel(k).length} draw calls`);
}); // prettier-ignore

test("walkers' legs come off the body and hang from a shared unit leg; tracks come off the tank", () => {
  for (const [kind, spec] of Object.entries(LEGS) as [ModelKind, { len: number }][]) {
    assert.ok(box(unitModel(kind, false)).min.y > spec.len * 0.55, `${kind} floats on its hips`);
    assert.ok(Math.abs(box(unitModel(kind)).min.y) < 0.01, `${kind} stands with its legs`);
  }
  assert.ok(!unitModel("lightTank", false).some((p) => p.paint === "tread"));
  const leg = box(partModel("leg"));
  assert.ok(Math.abs(leg.min.y + 1) < 0.01 && leg.max.y < 0.05, "hip at the origin, foot at −1");
  assert.deepEqual(partModel("treads").map((p) => p.paint), ["tread"]);
  assert.ok(partModel("mine").some((p) => p.paint === "team"));
}); // prettier-ignore

test("legs swing opposite while walking, guns kick back and settle, tracks roll as far as the tank drives", () => {
  for (const t of [0, 40, 130]) {
    assert.equal(legSwing(true, t, 3, 1), -legSwing(true, t, 3, -1));
    assert.equal(legSwing(false, t, 3, 1), 0);
  }
  assert.ok(Math.max(...[0, 50, 100, 150].map((t) => Math.abs(legSwing(true, t, 1, 1)))) > 0.3);
  const kicks = [0, 50, 100, 200, 220, 1000, -5].map(recoil);
  assert.ok(kicks[0]! > 0.05 && kicks[0]! > kicks[1]! && kicks[1]! > kicks[2]! && kicks[2]! > kicks[3]!);
  assert.deepEqual(kicks.slice(4), [0, 0, 0]);
  const yaw = 0.6, d = 0.013, x = 4.2, z = 7.1;
  const moved = treadPhase(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, yaw) - treadPhase(x, z, yaw);
  assert.ok(Math.abs(moved - Math.round(moved) - ((d * 16) % 1)) < 1e-6);
  assert.equal(treadPhase(x + Math.cos(yaw) * 0.3, z - Math.sin(yaw) * 0.3, yaw).toFixed(6), treadPhase(x, z, yaw).toFixed(6), "sideways is not rolling");
}); // prettier-ignore

test("panels have grooved borders and raised rivets; grime darkens the feet and wear lightens edges", () => {
  const n = 64, h = panelHeights(n), at = (u: number, v: number) => h[Math.floor(v * n) * n + Math.floor(u * n)]!;
  assert.ok(at(0.035, 0.3) < at(0.3, 0.3) - 0.5, "a groove round the border");
  assert.ok(at(0.1, 0.1) > at(0.3, 0.3) + 0.4, "a rivet in the corner");
  const maps = detailMaps(32), paints = paintMaterials();
  setDetail(paints, maps);
  assert.equal(paints.team.normalMap, maps.normal);
  assert.equal(paints.visor.normalMap, null, "glowing glass stays smooth");
  setDetail(paints, undefined);
  assert.equal(paints.team.normalMap, null, "low quality drops the maps");
  const g = shade(new THREE.BoxGeometry(1, 1, 1, 1, 4, 1).translate(0, 0.5, 0), 0, 1);
  const c = g.getAttribute("color"), p = g.getAttribute("position"), side = [...Array(c.count).keys()].filter((i) => g.getAttribute("normal").getX(i) === 1);
  const low = side.find((i) => p.getY(i) === 0)!, high = side.find((i) => p.getY(i) === 1)!;
  assert.ok(c.getX(low) < c.getX(high) * 0.8, "dirtier at the feet");
  const round = shade(new THREE.SphereGeometry(1, 8, 6).translate(0, 2, 0), 0, 1).getAttribute("color");
  assert.ok(Math.max(...(round.array as Float32Array)) > 1.1, "worn bright where the surface turns off every axis");
}); // prettier-ignore

test("battlefield props: the same spots for the same map, only on open sand clear of anything else", () => {
  const terrain = Array.from({ length: 40 }, (_, y) => (y === 20 ? "#".repeat(60) : ".".repeat(60)));
  const spots = propSpots(terrain);
  assert.deepEqual(propSpots(terrain), spots);
  const all = [...spots.crater, ...spots.tracks, ...spots.scrap];
  assert.ok(spots.crater.length > 5 && spots.tracks.length > 5 && spots.scrap.length > 5, `${all.length} props`);
  assert.ok(all.length < 60 * 40 * 0.1, "litter, not a carpet");
  for (const p of all) assert.ok(Math.abs(Math.floor(p.z) - 20) > 1, `clear of the rock row at ${p.z}`);
}); // prettier-ignore

test("the flag cloth waves but stays tied to the pole", () => {
  const cloth = new THREE.PlaneGeometry(0.7, 0.45, 10, 1).translate(
    0.35,
    1.35,
    0,
  );
  const base = Float32Array.from(cloth.getAttribute("position").array);
  const out = cloth.getAttribute("position") as THREE.BufferAttribute;
  waveCloth(base, out, 1234);
  for (let i = 0; i < out.count; i++) {
    if (base[i * 3] === 0) assert.ok(out.getZ(i) === 0);
  }
  assert.ok([...Array(out.count).keys()].some((i) => out.getZ(i) !== 0));
});
