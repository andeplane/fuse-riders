import test from "node:test";
import assert from "node:assert/strict";
import {
  HERO,
  NO_WINNER,
  RAZE_WAVES,
  STEPS_PER_SECOND,
  TOWER,
  TOWERS_PER_SIDE,
  WAVE_FIRST,
  centreOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  enemyAt,
  levelOf,
  ownerOf,
  respawnSteps,
  shielded,
  botCommands,
  hashWorld,
  spawnWaves,
  step,
  stepTick,
  type Building,
  type CombatEvent,
  type World,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import { addUnit, benchHeroes } from "./fixtures/heroes.js";

const duel = mapById("neon-duel");
const twin = mapById("twin-wilds");

/** The building of team `team`'s structure of `tier` on lane 0 (Neon Duel's mid). */
function structure(world: World, team: number, tier: number): Building {
  const site = duel.sites.find(
    (s) => s.lane === 0 && s.team === team && s.tier === tier,
  )!;
  return world.buildings.find((b) => b.id === site.id)!;
}
const at = (b: Building) => duel.sites[b.id]!;
const fort = (world: World, seat: number) =>
  world.buildings.find(
    (b) => duel.sites[b.id]!.kind === "fort" && duel.sites[b.id]!.seat === seat,
  )!;
/** The shots a building fired in `events`. */
const shotsOf = (events: readonly CombatEvent[], id: number) =>
  events.flatMap((e) =>
    e.type === "shot" && e.from.of === "building" && e.from.id === id
      ? [e]
      : [],
  );

test("each lane side stands two towers and a gate as turrets of its team on its slots, at their tier's hit points", () => {
  for (const map of [duel, twin]) {
    const world = createWorld(map, [0, 1], 1);
    for (const [lane, each] of map.lanes.entries())
      for (const [team, side] of each.sides.entries())
        for (const [tier, slot] of [...side.towers, side.gate].entries()) {
          const site = map.sites.find(
            (s) => s.lane === lane && s.team === team && s.tier === tier,
          )!;
          assert.deepEqual(
            [site.kind, site.x, site.y],
            ["turret", slot.x, slot.y],
          );
          const building = world.buildings.find((b) => b.id === site.id)!;
          assert.equal(building.hp, TOWER.hp[tier]);
          assert.equal(ownerOf(map, world, building), team);
        }
  }
});

test("no backdoor: each structure is shielded while the one in front stands, and the fort until a gate falls", () => {
  const world = createWorld(duel, [0, 1], 1);
  const [outer, inner, gate] = [0, 1, TOWERS_PER_SIDE].map((tier) =>
    structure(world, 1, tier),
  ) as [Building, Building, Building];
  const core = fort(world, 1);
  assert.deepEqual(
    [outer, inner, gate, core].map((b) => shielded(duel, world, b)),
    [false, true, true, true],
  );
  assert.equal(enemyAt(duel, world, 0, 2, inner.id), undefined);
  outer.hp = 0;
  assert.deepEqual(
    [inner, gate, core].map((b) => shielded(duel, world, b)),
    [false, true, true],
  );
  inner.hp = 0;
  assert.ok(!shielded(duel, world, gate) && shielded(duel, world, core));
  gate.hp = 0;
  assert.ok(!shielded(duel, world, core));
  assert.ok(enemyAt(duel, world, 0, 2, core.id));
});

test("a shielded structure shoots but takes no shot, until the one in front falls", () => {
  const run = (outerDown: boolean) => {
    let world = benchHeroes(createWorld(duel, [0, 1], 1));
    if (outerDown) structure(world, 1, 0).hp = 0;
    const inner = structure(world, 1, 1);
    addUnit(world, 0, "grunt", at(inner).x - 3, at(inner).y);
    let fired = 0;
    for (let index = 0; index < 3 * STEPS_PER_SECOND; index++) {
      world = step(duel, world);
      fired += shotsOf(world.events, inner.id).length;
    }
    assert.ok(fired > 0, "the inner tower fires");
    return structure(world, 1, 1).hp;
  };
  assert.equal(run(false), TOWER.hp[1]);
  assert.ok(run(true) < TOWER.hp[1]!);
});

test("bot matches on a lane map decode at every checkpoint, tower targets and ramps included", () => {
  let world = createWorld(duel, [0, 1], 4);
  let aimed = false;
  for (let tick = 0; tick < 5 * 60 * 20; tick++) {
    world = stepTick(
      duel,
      world,
      world.players.flatMap((p) => botCommands(duel, world, p.seat, "hard")),
    );
    if (tick % 25 !== 0) continue;
    aimed ||= world.buildings.some((b) => b.ramp > 1);
    const decoded = decodeWorld(
      JSON.parse(JSON.stringify(encodeWorld(world))),
      duel,
    );
    assert.ok(decoded, `tick ${tick}`);
    assert.equal(hashWorld(decoded), hashWorld(world));
  }
  assert.ok(aimed, "a tower ramps on a target");
});

test("a tower takes the nearest enemy unit over a hero, keeps it, and ramps its damage shot by shot", () => {
  let world = benchHeroes(createWorld(duel, [0, 1], 1));
  const outer = structure(world, 1, 0);
  const [tx, ty] = [at(outer).x, at(outer).y];
  addUnit(world, 0, "grunt", tx - 5, ty, 100_000);
  // Seat 0's hero stands nearer, but a tower picks units first.
  Object.assign(world.heroes[0]!, {
    hp: 900,
    respawn: 0,
    x: centreOf(tx - 2),
    y: centreOf(ty),
  });
  const damage: number[] = [];
  for (let index = 0; damage.length < 9; index++) {
    world = step(duel, world);
    world.heroes[0]!.hp = 900;
    for (const shot of shotsOf(world.events, outer.id)) {
      assert.equal(shot.to.of, "unit");
      damage.push(shot.damage);
    }
  }
  const ramp = (k: number) =>
    Math.floor(
      (TOWER.damage * (100 + TOWER.ramp * Math.min(k, TOWER.rampMax))) / 100,
    );
  assert.deepEqual(
    damage,
    damage.map((_, k) => ramp(k)),
  );
});

test("a tower turns on an enemy hero that shoots a friendly hero in its range, and ramps from the start", () => {
  let world = benchHeroes(createWorld(duel, [0, 1], 1));
  const outer = structure(world, 1, 0);
  const [tx, ty] = [at(outer).x, at(outer).y];
  addUnit(world, 0, "grunt", tx - 2, ty + 2, 100_000);
  const place = (seat: number, x: number, y: number) =>
    Object.assign(world.heroes[seat]!, {
      hp: 5000,
      respawn: 0,
      x: centreOf(x),
      y: centreOf(y),
      cooldown: 0,
    });
  place(1, tx - 4, ty - 2);
  // Seat 0 stands close to seat 1, and far enough from the grunt that seat 1 is its nearest enemy.
  place(0, tx - 6, ty - 2);
  let switched = false;
  for (let index = 0; index < 4 * STEPS_PER_SECOND && !switched; index++) {
    world = step(duel, world);
    for (const each of world.heroes) each.hp = 5000;
    for (const shot of shotsOf(world.events, outer.id))
      if (shot.to.of === "hero") {
        assert.equal(shot.to.id, 0);
        // The first shot of a new ramp.
        const tower = structure(world, 1, 0);
        assert.deepEqual([tower.aimOf, tower.aim, tower.ramp], [1, 0, 1]);
        switched = true;
      }
  }
  assert.ok(switched, "the tower shot seat 0's hero");
});

test("destroying the enemy fort wins; while a gate stands nothing can hurt it", () => {
  let world = benchHeroes(createWorld(duel, [0, 1], 1));
  const core = fort(world, 1);
  core.hp = 1;
  const tank = addUnit(world, 0, "lightTank", 0, 0, 100_000);
  // The tank stands in range of the fort, held there, as it would be in a push.
  const hold = () =>
    Object.assign(
      world.units.find((u) => u.id === tank.id)!,
      {
        x: centreOf(at(core).x - 3),
        y: centreOf(at(core).y + 3),
      },
    );
  for (let index = 0; index < 3 * STEPS_PER_SECOND; index++)
    world = step(duel, (hold(), world));
  assert.equal(world.winner, NO_WINNER);
  assert.equal(fort(world, 1).hp, 1);
  structure(world, 1, TOWERS_PER_SIDE).hp = 0;
  for (let index = 0; index < 3 * STEPS_PER_SECOND; index++)
    world = step(duel, (hold(), world));
  assert.equal(world.winner, 0);
});

test("each enemy structure razed makes a team's later waves tougher", () => {
  const world = { ...createWorld(duel, [0, 1], 1), step: WAVE_FIRST };
  structure(world, 1, 0).hp = 0;
  spawnWaves(duel, world);
  const grade = (team: number) =>
    world.units.find((u) => u.owner === team)!.wave;
  assert.deepEqual([grade(0), grade(1)], [1 + RAZE_WAVES, 1]);
  assert.ok(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world))), duel));
  // A grade no razing explains is refused.
  const wire = structuredClone(encodeWorld(world)) as unknown[];
  const units = wire[6] as number[][];
  units.find((u) => u[2] === 1)![11] = 1 + RAZE_WAVES;
  assert.equal(decodeWorld(wire, duel), undefined);
});

test("a fallen hero's wait follows its level, not the match clock, and a checkpoint holds it to that", () => {
  let world = benchHeroes(createWorld(duel, [0, 1], 1));
  world = { ...world, step: 20 * 60 * STEPS_PER_SECOND };
  const hero = world.heroes[0]!;
  hero.respawn = respawnSteps(levelOf(hero.xp));
  assert.ok(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world))), duel));
  hero.respawn += 1;
  assert.equal(
    decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world))), duel),
    undefined,
  );
});

type Corrupt = (tower: unknown[], wire: unknown[]) => void;
const corruptions: [string, Corrupt][] = [
  ["a tower above its tier's hit points", (t) => (t[1] = TOWER.hp[0] + 1)],
  ["a tower reloading too long", (t) => (t[4] = TOWER.cooldown + 1)],
  [
    "a ramp past the most",
    (t) => ([t[5], t[6], t[7]] = [0, 1, TOWER.rampMax + 1]),
  ],
  ["a ramp with no target", (t) => (t[7] = 1)],
  ["a target on a friendly hero", (t) => ([t[5], t[6]] = [1, 1])],
  ["a target on a seat not in play", (t) => ([t[5], t[6]] = [1, 2])],
  ["a target on a unit not yet made", (t) => ([t[5], t[6]] = [0, 99])],
  ["a ruin with a target", (t) => ([t[1], t[5], t[6]] = [0, 0, 1])],
  ["a building target", (t) => ([t[5], t[6]] = [2, 0])],
  [
    "a target on a factory",
    (_, wire) => {
      const factory = (wire[5] as unknown[][])[0]!;
      [factory[5], factory[6]] = [0, 1];
    },
  ],
];

for (const [label, corrupt] of corruptions)
  test(`a checkpoint with ${label} is refused`, () => {
    const world = createWorld(duel, [0, 1], 1);
    world.nextId = 2;
    const wire = structuredClone(encodeWorld(world)) as unknown[];
    assert.ok(decodeWorld(structuredClone(wire), duel));
    const buildings = wire[5] as unknown[][];
    // Team 1's outer tower on mid.
    const id = structure(world, 1, 0).id;
    corrupt(
      buildings.find((b) => b[0] === id)!,
      wire,
    );
    assert.equal(decodeWorld(wire, duel), undefined);
  });
