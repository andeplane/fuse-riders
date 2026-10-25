import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILES,
  STEPS_PER_TICK,
  botCommands,
  botLane,
  centreOf,
  createWorld,
  div,
  heroGun,
  heroMaxHp,
  teamOf,
  type Command,
  type Difficulty,
  type World,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import { addUnit } from "./fixtures/heroes.js";

const duel = mapById("neon-duel");

/** The first step from `from` on which `seat` thinks at `difficulty` (`bot.ts` staggers seats and teams). */
function thinking(seat: number, difficulty: Difficulty, from = 4800): number {
  const { think } = PROFILES[difficulty];
  for (let step = from; ; step += STEPS_PER_TICK) {
    const tick =
      div(step, STEPS_PER_TICK) +
      div(seat, 2) * 5 +
      teamOf(seat) * div(think, 2);
    if (tick % think === 0) return step;
  }
}

/**
 * Neon Duel two minutes in with no units: seat 0's Brick on the mid lane at tile (x, y) and seat 1's hero dead, so
 * only what a test adds is about; the world is set to a step on which seat 0 thinks at `difficulty`.
 */
function lane(x: number, y: number, difficulty: Difficulty = "normal"): World {
  const world = createWorld(duel, [0, 1], 1);
  Object.assign(world.heroes[0]!, { x: centreOf(x), y: centreOf(y) });
  Object.assign(world.heroes[1]!, { hp: 0, respawn: 900 });
  return { ...world, step: thinking(0, difficulty) };
}

/** A wave unit of `owner`'s on the mid lane. */
function wave(world: World, owner: number, x: number, y: number, hp = 60) {
  const unit = addUnit(world, owner, "grunt", x, y, hp);
  unit.lane = 0;
  return unit;
}

const hero = (world: World) => world.heroes[0]!;
const walks = (commands: Command[]) =>
  commands.find((c) => c.type === "move" || c.type === "attackMove");
/** Tiles from seat 0's fort on Neon Duel, (9, 166). */
const fromFort = (x: number, y: number) => Math.hypot(x - 9, y - 166);

test("lanes: 1v1 plays mid, 3v3 one hero a lane, 2v2 top and bottom, or mid and a roamer when hard", () => {
  const names = (id: string, size: number, difficulty: Difficulty) => {
    const map = mapById(id);
    const world = createWorld(map, [...Array(2 * size).keys()], 1);
    return world.players
      .map((p) => botLane(map, world, p.seat, PROFILES[difficulty]))
      .map((index) => (index < 0 ? "roam" : map.lanes[index]!.name))
      .join();
  };
  assert.equal(names("neon-duel", 1, "hard"), "mid,mid");
  assert.equal(names("crown-jungle", 3, "normal"), "top,top,mid,mid,bot,bot");
  assert.equal(names("twin-wilds", 2, "normal"), "top,top,bot,bot");
  assert.equal(names("twin-wilds", 2, "hard"), "mid,mid,roam,roam");
});

test("a last hit waits for the shot that kills: one hit point more and it holds fire, sloppier when easy", () => {
  const at = (hp: number, difficulty: Difficulty) => {
    const world = lane(80, 95, difficulty);
    wave(world, 0, 83, 92);
    const prey = wave(world, 1, 82, 93, hp);
    const sent = botCommands(duel, world, 0, difficulty);
    return sent.some(
      (c) => c.type === "attack" && c.of === 0 && c.id === prey.id,
    );
  };
  const shot = heroGun(hero(lane(80, 95))).damage;
  assert.equal(at(shot, "normal"), true);
  assert.equal(at(shot + 1, "normal"), false);
  assert.equal(at(shot + 1, "hard"), false);
  // Easy swings at a unit with half a shot more than it can take, so its shot often lands early.
  assert.equal(at(div(shot * 14, 10), "easy"), true);
});

test("retreat thresholds: hurt below its profile's line it falls back toward its fort, otherwise it walks on", () => {
  const sent = (percent: number, difficulty: Difficulty) => {
    const world = lane(80, 95, difficulty);
    hero(world).hp = div(heroMaxHp(hero(world)) * percent, 100);
    wave(world, 0, 90, 85);
    const walk = walks(botCommands(duel, world, 0, difficulty));
    assert.ok(
      walk?.type === "move" || walk?.type === "attackMove",
      `${difficulty} ${percent}`,
    );
    // Positive: it walks toward its own fort.
    return fromFort(80, 95) - fromFort(walk.x, walk.y);
  };
  assert.ok(sent(27, "normal") > 0, "normal falls back at 27%");
  assert.ok(sent(27, "hard") < 0, "hard still walks on at 27%");
  assert.ok(sent(20, "hard") > 0, "hard falls back at 20%");
  assert.ok(sent(20, "easy") < 0, "easy still walks on at 20%");
  assert.ok(sent(60, "normal") < 0, "a scratch doesn't send it home");
});

test("towers: no standing in an enemy tower's reach without its wave, a siege while its wave tanks", () => {
  // Seat 1's outer mid tower stands on (100, 71); the hero stands about 5.8 tiles from it.
  const tower = duel.sites.find(
    (s) => s.lane === 0 && s.team === 1 && s.tier === 0,
  )!;
  const alone = lane(97, 76);
  const away = walks(botCommands(duel, alone, 0, "normal"))!;
  assert.ok(away.type === "move" || away.type === "attackMove");
  const gap = (x: number, y: number) => Math.hypot(x - tower.x, y - tower.y);
  assert.ok(gap(away.x, away.y) > gap(97, 76), "it steps away");

  const tanked = lane(97, 76);
  wave(tanked, 0, 99, 74, 300);
  wave(tanked, 0, 98, 73, 300);
  const siege = botCommands(duel, tanked, 0, "normal");
  assert.ok(
    siege.some((c) => c.type === "attack" && c.of === 2 && c.id === tower.id),
  );

  // A tower that turned on the hero sends it out even with its wave there.
  const index = tanked.buildings.findIndex((b) => b.id === tower.id);
  tanked.buildings[index] = { ...tanked.buildings[index]!, aimOf: 1, aim: 0 };
  const out = walks(botCommands(duel, tanked, 0, "normal"))!;
  assert.ok(out.type === "move" && gap(out.x, out.y) > gap(97, 76));
});

test("objectives: two heroes standing against none gather on the same enemy structure", () => {
  const map = mapById("twin-wilds");
  const base = createWorld(map, [0, 1, 2, 3], 1);
  base.heroes[1]!.hp = base.heroes[3]!.hp = 0;
  base.heroes[1]!.respawn = base.heroes[3]!.respawn = 900;
  const goals = [0, 2].map((seat) => {
    const world = { ...base, step: thinking(seat, "normal") };
    return walks(botCommands(map, world, seat, "normal"));
  });
  assert.ok(goals[0]?.type === "attackMove", JSON.stringify(goals));
  assert.deepEqual(goals[0], { ...goals[1]!, seat: 0 });
});
