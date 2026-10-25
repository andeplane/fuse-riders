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
  levelXp,
  nextBuy,
  ITEMS,
  teamOf,
  type Command,
  type Difficulty,
  type Hero,
  type HeroKind,
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

test("a fight: taken against a weaker hero within 10 tiles, let go of one walking away out of reach", () => {
  const fight = (gap: number, away: boolean, focused: boolean) => {
    const world = lane(80, 95);
    const foe = world.heroes[1]!;
    Object.assign(foe, {
      hp: 300,
      respawn: 0,
      x: centreOf(80 + gap),
      y: centreOf(95 - gap),
    });
    if (away) foe.goal = (95 - 2 * gap) * duel.width + 80 + 2 * gap;
    if (focused) Object.assign(hero(world), { focusOf: 1, focus: 1 });
    return botCommands(duel, world, 0, "normal");
  };
  const attacks = (sent: Command[]) =>
    sent.some((c) => c.type === "attack" && c.of === 1 && c.id === 1);
  // 4.2 and 8.5 tiles off: taken (beyond 8 tiles it used to stand off).
  assert.ok(attacks(fight(3, false, false)));
  assert.ok(attacks(fight(6, false, false)));
  // Walking away 7 tiles off, out of its 5-tile gun: the focus goes, with a walk or a stop.
  const gone = fight(5, true, true);
  assert.ok(
    !attacks(gone) &&
      gone.some((c) => c.type === "move" || c.type === "attackMove"),
  );
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

test("help: a hard or normal bot walks to a teammate's fight on its own half, an easy one doesn't", () => {
  const map = mapById("twin-wilds");
  const sent = (difficulty: Difficulty) => {
    const world = createWorld(map, [0, 1, 2, 3], 1);
    const place = (seat: number, x: number, y: number) =>
      Object.assign(world.heroes[seat]!, { x: centreOf(x), y: centreOf(y) });
    // On mid, team 0's half: seat 0 21 tiles behind its teammate, whom an enemy hero faces 6 tiles off.
    place(0, 30, 145);
    place(2, 45, 130);
    place(1, 49, 126);
    Object.assign(world.heroes[3]!, { hp: 0, respawn: 900 });
    const at = { ...world, step: thinking(0, difficulty) };
    return walks(botCommands(map, at, 0, difficulty));
  };
  assert.deepEqual(sent("hard"), {
    seat: 0,
    type: "attackMove",
    x: 45,
    y: 130,
  });
  assert.deepEqual(sent("normal"), {
    seat: 0,
    type: "attackMove",
    x: 45,
    y: 130,
  });
  assert.notDeepEqual(sent("easy"), {
    seat: 0,
    type: "attackMove",
    x: 45,
    y: 130,
  });
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

test("ultimates go where they pay: none at level 6 with nothing about, ORBITAL DROP in a fight it takes", () => {
  const casts = (kind: HeroKind, foe: boolean) => {
    const world = createWorld(duel, [0, 1], 1, { 0: kind });
    const [hero, other] = world.heroes as [Hero, Hero];
    Object.assign(hero, { x: centreOf(60), y: centreOf(115) });
    Object.assign(hero, { xp: levelXp(6), energy: 200 });
    // A hurt enemy hero 4 tiles off, or none.
    if (foe)
      Object.assign(other, { x: centreOf(63), y: centreOf(112), hp: 100 });
    else Object.assign(other, { hp: 0, respawn: 900 });
    return botCommands(
      duel,
      { ...world, step: thinking(0, "hard") },
      0,
      "hard",
    ).flatMap((c) => (c.type === "cast" ? [c.slot] : []));
  };
  for (const kind of ["brick", "rivet", "tally", "vix"] as const)
    assert.deepEqual(casts(kind, false), [], kind);
  assert.deepEqual(casts("brick", true), [3]);
});
test("the fountain: a hurt hero rests there, and one with the gold for its next item walks home in a lull", () => {
  const home = duel.sites.find((s) => s.kind === "fort" && s.seat === 0)!;
  const resting = lane(home.x, home.y);
  Object.assign(hero(resting), { hp: 300, goal: 80 * duel.width + 95 });
  assert.deepEqual(walks(botCommands(duel, resting, 0, "normal")), {
    seat: 0,
    type: "move",
    x: home.x,
    y: home.y,
  });
  const rich = lane(80, 95);
  hero(rich).gold = ITEMS[nextBuy(hero(rich))]!.cost;
  assert.deepEqual(walks(botCommands(duel, rich, 0, "normal")), {
    seat: 0,
    type: "move",
    x: home.x,
    y: home.y,
  });
});
