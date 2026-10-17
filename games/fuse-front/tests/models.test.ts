import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { HeroView } from "../src/engine/view.js";
import {
  HERO_KINDS,
  PAINTS,
  RING,
  approachAngle,
  bob,
  buildingModel,
  heroKindOf,
  paintMaterials,
  ruinModel,
  unitModel,
  waveCloth,
  type Model,
  type ModelKind,
} from "../src/render3d/models.js";

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

test("a hero wears Brick until the view names its kind", () => {
  // prettier-ignore
  const hero: HeroView = { seat: 0, team: 0, x: 0, y: 0, hp: 1, maxHp: 1, level: 1, respawn: 0, energy: 0, maxEnergy: 0, xp: 0, spells: [] };
  assert.equal(heroKindOf(hero), "brick");
  const named = { ...hero, kind: "vix" };
  assert.equal(heroKindOf(named), "vix");
  const unknown = { ...hero, kind: "nobody" };
  assert.equal(heroKindOf(unknown), "brick");
});

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
    if (base[i * 3] === 0) assert.equal(out.getZ(i), 0);
  }
  assert.ok([...Array(out.count).keys()].some((i) => out.getZ(i) !== 0));
});
