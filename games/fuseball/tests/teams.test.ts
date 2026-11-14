import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  CAPACITY,
  COUNTDOWN_STEPS,
  GOAL_STEPS,
  MAPS,
  MAP_IDS,
  STEPS_PER_TICK,
  TARGET,
  TEAM_MAPS,
  TEAM_MAP_IDS,
  TEAM_MAX,
  botInput,
  copyWorld,
  createWorld,
  decodeWorld,
  encodeWorld,
  isMapId,
  isTeamMapId,
  levelFaults,
  mapOf,
  paceTick,
  stepWorld,
  teamSizeOf,
  toView,
  winnerOf,
  type TeamArenaId,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import {
  SIDE,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  parseSettings,
  settingsFor,
  view,
  type Entry,
  type Room,
  type Settings,
} from "../src/online/game.js";
import { matchResult } from "../src/online/result.js";
import { validFuseballField } from "../src/platform.js";
import { MAP_ORDER, present } from "../src/app/presenter.js";
import { MIN_RIDER_CSS, cameraFor } from "../src/render/scene.js";
import { blend } from "../src/render/interpolate.js";
import { cues } from "../src/render/effects.js";

/**
 * The team modes: 2v2 and 3v3 on the team arenas. What a duel already covers (the motion, the bubbles, the pace) is
 * covered where it always was; this file is what is new with more than one rider a side.
 */
const ids = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `r${i}`);
/** A match of `count` riders on a team arena, past its countdown, nothing held. */
function playing(count: number, mapId: TeamArenaId = "mainframe"): World {
  const world = createWorld(mapId, ids(count));
  while (world.phase === "countdown") stepWorld(world, new Map());
  return world;
}
/** Puts the ball, at rest, in `team`'s goal: the next step scores. */
function ballInGoal(world: World, team: 0 | 1): void {
  const goal = mapOf(world.mapId).goals.find((each) => each.team === team)!;
  const [x, y] =
    "r" in goal ? [goal.x, goal.y] : [goal.x + goal.w / 2, goal.y + goal.h / 2];
  Object.assign(world.ball, { x: x * SUB, y: y * SUB, vx: 0, vy: 0 });
}

test("the team arenas are bigger than a duel's, valid, mirrored and marked for three a side", () => {
  assert.ok(TEAM_MAP_IDS.length >= 3, "several team arenas");
  assert.equal(TEAM_MAX, 3);
  assert.equal(CAPACITY, 2 * TEAM_MAX);
  for (const id of TEAM_MAP_IDS) {
    const map = TEAM_MAPS[id];
    assert.equal(map.id, id);
    assert.equal(mapOf(id), map);
    assert.ok(isMapId(id) && isTeamMapId(id));
    assert.ok(map.w * map.h >= 2 * 640 * 360, `${id}: at least twice the room`);
    assert.equal(teamSizeOf(map), 3, `${id}: three marks a side`);
    assert.ok(map.solids.length >= 8, `${id}: walls and ledges`);
    assert.deepEqual(levelFaults(map), [], id);
    // The sides take turns down the marks, each facing its mirror image.
    map.spawns.forEach((spawn, place) => {
      const mirror = map.spawns[place ^ 1]!;
      assert.equal(spawn.x, map.w - mirror.x, `${id}: mark ${place}`);
      assert.equal(
        spawn.x < map.w / 2,
        place % 2 === 0,
        `${id}: mark ${place}`,
      );
    });
  }
  for (const id of MAP_IDS) {
    assert.ok(!isTeamMapId(id));
    assert.equal(teamSizeOf(MAPS[id]), 1);
    assert.deepEqual([MAPS[id].w, MAPS[id].h], [640, 360]);
  }
  assert.equal(
    new Set([...MAP_IDS, ...TEAM_MAP_IDS]).size,
    MAP_IDS.length + TEAM_MAP_IDS.length,
    "no id twice",
  );
});

test("a match seats two, four or six riders, the sides taking turns, each on a mark of its own", () => {
  for (const count of [2, 4, 6]) {
    const world = createWorld("mainframe", ids(count));
    assert.equal(world.riders.length, count);
    assert.equal(world.bubbles.length, count);
    world.riders.forEach((rider, index) => {
      const mark = TEAM_MAPS.mainframe.spawns[index]!;
      assert.deepEqual(
        [rider.index, rider.slot, rider.x, rider.y, rider.facing],
        [
          index,
          index % 2,
          mark.x * SUB,
          mark.y * SUB,
          index % 2 === 0 ? 1 : -1,
        ],
      );
    });
    assert.ok(decodeWorld(encodeWorld(world)));
  }
  assert.throws(() => createWorld("mainframe", ids(3)), /seat/);
  assert.throws(() => createWorld("mainframe", ids(8)), /seat/);
  assert.throws(() => createWorld("mainframe", ids(1)), /seat/);
  assert.throws(() => createWorld("gridlock", ids(4)), /seat/, "a duel arena");
});

test("a goal is the side's: every rider of the other side is zapped, and the rider who sent it is credited", () => {
  const world = playing(6);
  // Rider 2 (left side) was the last to touch it, and it falls into the left side's goal.
  world.ball.touch = 2;
  ballInGoal(world, 0);
  stepWorld(world, new Map());
  assert.equal(world.phase, "zap");
  assert.deepEqual(world.score, [1, 0]);
  assert.deepEqual(
    world.riders.map((rider) => rider.zapped),
    [false, true, false, true, false, true],
  );
  assert.deepEqual(
    world.riders.map((rider) => rider.goals),
    [0, 0, 1, 0, 0, 0],
  );
  const seen = toView(world);
  assert.equal(seen.lastScorer, 0);
  assert.equal(seen.ball.touch, 0, "the view names the side that sent it");
  assert.ok(decodeWorld(encodeWorld(world)), "a zap checkpoints");
  for (let step = 0; step < GOAL_STEPS; step++) stepWorld(world, new Map());
  assert.equal(world.phase, "countdown");
  assert.ok(world.riders.every((rider) => !rider.zapped));

  // An own goal is the rider's who sent it, and the point still goes to the goal's side.
  while (world.phase === "countdown") stepWorld(world, new Map());
  world.ball.touch = 5;
  ballInGoal(world, 0);
  stepWorld(world, new Map());
  assert.deepEqual(world.score, [2, 0]);
  assert.equal(world.riders[5]!.ownGoals, 1);
  // Sent by nobody: the side's first rider has it.
  for (let step = 0; step < GOAL_STEPS + COUNTDOWN_STEPS; step++)
    stepWorld(world, new Map());
  world.ball.touch = -1;
  ballInGoal(world, 0);
  stepWorld(world, new Map());
  assert.equal(world.riders[0].goals, 1);
  assert.equal(world.score[0], TARGET);
  for (let step = 0; step < GOAL_STEPS; step++) stepWorld(world, new Map());
  assert.equal(world.phase, "over");
  assert.equal(winnerOf(world), 0);
  assert.ok(decodeWorld(encodeWorld(world)));
});

test("riders of one side pass through each other's bubbles; the other side's pop or stop them", () => {
  const world = playing(4);
  const [a, b, mate] = world.riders;
  for (const [index, bubble] of world.bubbles.entries())
    Object.assign(bubble, {
      active: index === 0,
      x: 480 * SUB,
      y: 300 * SUB,
      hard: false,
    });
  const at = (rider: (typeof world.riders)[number]) =>
    Object.assign(rider, {
      x: 480 * SUB,
      y: 300 * SUB,
      vx: 0,
      vy: 0,
      grounded: false,
    });
  at(mate!);
  stepWorld(world, new Map());
  assert.ok(world.bubbles[0].active, "a team mate does not pop it");
  assert.equal(mate!.pops, 0);
  mate!.x = 100 * SUB;
  at(b);
  stepWorld(world, new Map());
  assert.ok(!world.bubbles[0].active, "the other side pops it");
  assert.equal(b.pops, 1);
  assert.equal(a.pops, 0);
});

test("the checkpoint refuses a team world that does not add up", () => {
  const world = playing(4, "uplink");
  const sound = encodeWorld(world);
  assert.deepEqual(encodeWorld(decodeWorld(sound)!), sound);
  const damaged = (change: (fields: unknown[]) => void) => {
    const fields = structuredClone(sound);
    change(fields);
    return decodeWorld(fields);
  };
  const riders = (fields: unknown[]) => fields[9] as unknown[][],
    bubbles = (fields: unknown[]) => fields[10] as unknown[][];
  assert.equal(
    damaged((f) => riders(f).pop()),
    undefined,
    "three riders",
  );
  assert.equal(
    damaged((f) => bubbles(f).pop()),
    undefined,
    "a rider with no bubble",
  );
  assert.equal(
    damaged((f) => {
      riders(f).push(...structuredClone(riders(f)));
      bubbles(f).push(...structuredClone(bubbles(f)));
    }),
    undefined,
    "eight riders",
  );
  assert.equal(
    damaged((f) => (riders(f)[3]![0] = riders(f)[0]![0])),
    undefined,
    "one id twice",
  );
  assert.equal(
    damaged((f) => ((f[11] as unknown[])[6] = 4)),
    undefined,
    "a touch by a rider who is not there",
  );
  assert.ok(damaged((f) => ((f[11] as unknown[])[6] = 3)));
  assert.equal(
    damaged((f) => (riders(f)[2]![12] = 1)),
    undefined,
    "a goal the board does not show",
  );
  assert.equal(
    damaged((f) => (riders(f)[2]![1] = 961 * SUB)),
    undefined,
    "a rider past the arena's edge",
  );
  assert.equal(
    damaged((f) => (f[1] = 200)),
    undefined,
    "an arena unknown",
  );
  // A duel arena never carries more than two.
  const duel = encodeWorld(createWorld("gridlock", ids(2)));
  (duel[9] as unknown[]).push(...structuredClone(duel[9] as unknown[]));
  (duel[10] as unknown[]).push(...structuredClone(duel[10] as unknown[]));
  assert.equal(decodeWorld(duel), undefined);
});

/** One log tick of a world with every rider a bot. */
function botTick(world: World): void {
  const count = paceTick(world);
  const inputs = new Map(
    world.riders.map((rider) => [rider.id, botInput(world, rider)]),
  );
  for (let step = 0; step < count; step++) stepWorld(world, inputs);
}

test("a 3v3 of bots replays to the same bits, from the start and from a copy taken on the way", () => {
  const first = createWorld("backbone", ids(6)),
    second = createWorld("backbone", ids(6));
  let branch: World | undefined;
  for (let tick = 0; tick < 500; tick++) {
    botTick(first);
    botTick(second);
    if (tick === 180) branch = copyWorld(first);
    else if (branch) botTick(branch);
    if (tick % 50 === 0)
      assert.ok(decodeWorld(encodeWorld(first)), `sound at tick ${tick}`);
  }
  assert.deepEqual(encodeWorld(second), encodeWorld(first));
  assert.deepEqual(encodeWorld(branch!), encodeWorld(first), "a rollback");
  assert.ok(
    first.riders.some((rider) => rider.jumps > 0) && first.ball.bounces > 0,
    "they played",
  );
});

test("bots finish a 2v2, and both sides' riders go for the ball while one minds the goal", () => {
  const world = createWorld("uplink", ids(4));
  let ticks = 0;
  while (world.phase !== "over" && ticks < 20 * 420) {
    botTick(world);
    ticks++;
  }
  assert.equal(world.phase, "over", "a winner inside seven minutes");
  assert.ok(decodeWorld(encodeWorld(world)));
  // The keeper: of two bots on a side, only the one nearer the ball closes on it at the start.
  const fresh = playing(4);
  const far = (index: number) =>
    Math.abs(fresh.riders[index]!.x - fresh.ball.x) +
    Math.abs(fresh.riders[index]!.y - fresh.ball.y);
  const before = [0, 2].map(far);
  for (let tick = 0; tick < 40; tick++) botTick(fresh);
  const after = [0, 2].map(far);
  assert.ok(after[0]! < before[0]!, "the nearer rider goes for the ball");
  assert.ok(
    before[1]! - after[1]! < before[0]! - after[0]!,
    "the other holds back",
  );
});

// ---- the room ----
let seq = 0;
type Bodies = Record<string, readonly unknown[][]>;
function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
const TEAMS: Settings = {
  display: false,
  mapId: "mainframe",
  seed: 0,
  size: 2,
};

test("settings tie the size to the arena: teams on team arenas, a duel everywhere else", () => {
  assert.deepEqual(parseSettings(TEAMS), TEAMS);
  assert.ok(parseSettings({ ...TEAMS, size: 3 }));
  for (const bad of [
    { ...TEAMS, size: 1 },
    { ...TEAMS, size: 4 },
    { ...TEAMS, size: 0 },
    { ...TEAMS, size: 2.5 },
    { ...TEAMS, size: "2" },
    { ...TEAMS, mapId: "gridlock" },
    { ...TEAMS, mapId: "random", seed: 3 },
    { display: false, mapId: "mainframe", seed: 0 },
  ])
    assert.equal(parseSettings(bad), undefined, JSON.stringify(bad));
  // Changing the mode keeps an arena that suits it and otherwise takes the mode's first.
  const duel: Settings = { display: true, mapId: "random", seed: 9, size: 1 };
  assert.deepEqual(settingsFor(duel, 3), {
    display: true,
    mapId: TEAM_MAP_IDS[0],
    seed: 0,
    size: 3,
  });
  assert.deepEqual(settingsFor({ ...TEAMS, mapId: "uplink" }, 3), {
    ...TEAMS,
    mapId: "uplink",
    size: 3,
  });
  assert.deepEqual(settingsFor({ ...TEAMS, mapId: "uplink" }, 1), {
    display: false,
    mapId: MAP_IDS[0],
    seed: 0,
    size: 1,
  });
  assert.deepEqual(settingsFor(duel, 1), duel);
  for (const size of [1, 2, 3])
    assert.ok(parseSettings(settingsFor(duel, size)), `size ${size}`);
});

test("a team match seats by side, fills the empty places with bots and grows to seat everybody", () => {
  const room = createRoom("m0", TEAMS);
  // Ada and Cy on the left (seats 0 and 2); nobody on the right.
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "c", "Cy", 2, "cat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.world!.riders.map((rider) => [rider.id, rider.slot]),
    [
      ["a", 0],
      ["bot:1", 1],
      ["c", 0],
      ["bot:2", 1],
    ],
  );
  assert.deepEqual(
    room.roster.map((entrant) => [entrant.name, entrant.slot, entrant.bot]),
    [
      ["Ada", 0, false],
      ["Volta", 1, true],
      ["Cy", 0, false],
      ["Ohm", 1, true],
    ],
  );
  assert.equal(room.play.size, 2);
  assert.equal(room.settings.size, 2, "the lobby's choice is its own");
  const copy = decode(encode(room), room.tick);
  assert.ok(copy);
  assert.equal(hash(copy), hash(room));

  // A fifth seat makes it a 3v3, whatever the lobby said.
  const big = createRoom("m0", TEAMS);
  fold(big, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "e", "Eve", 4, "cat", 1],
      [BOT, "add", "bot:7", "Fizz", 1],
    ],
  });
  fold(big, { a: [[ACTION, "start", "m1"]] });
  assert.equal(big.play.size, 3);
  assert.deepEqual(
    big.world!.riders.map((rider) => rider.id),
    ["a", "bot:7", "bot:1", "bot:2", "e", "bot:3"],
  );
  assert.ok(decode(encode(big), big.tick));
  // The checkpoint ties the world's size to the match's.
  const fields = encode(big);
  (fields[4] as Settings).size = 2;
  assert.equal(decode(fields, big.tick), undefined);
});

test("in the lobby a seat changes sides to the other side's lowest free place, and nowhere when it is full", () => {
  const room = createRoom("m0", TEAMS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  fold(room, { b: [[SIDE, "m0"]] });
  assert.equal(room.seats.get("b")!.slot, 2, "Bo joins Ada's side");
  fold(room, { b: [[SIDE, "m0"]] });
  assert.equal(room.seats.get("b")!.slot, 1, "and back");
  fold(room, { b: [[SIDE, "other-match"]] });
  assert.equal(room.seats.get("b")!.slot, 1, "an entry for another match");
  fold(room, {
    a: [
      [BOT, "add", "bot:1", "Fizz", 2],
      [BOT, "add", "bot:2", "Volta", 4],
    ],
  });
  fold(room, { b: [[SIDE, "m0"]] });
  assert.equal(room.seats.get("b")!.slot, 1, "the left side is full");
  assert.ok(decode(encode(room), room.tick));
  // Not once the match is on.
  fold(room, { a: [[ACTION, "start", "m1"]] });
  fold(room, { a: [[SIDE, "m1"]] });
  assert.equal(room.seats.get("a")!.slot, 0);
});

test("a duel with more than two seated plays the two lowest seats; the rest watch", () => {
  const room = createRoom("m0", {
    display: false,
    mapId: "halo",
    seed: 0,
    size: 1,
  });
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "c", "Cy", 2, "cat", 1],
      [JOIN, "d", "Di", 3, "cat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.deepEqual(
    room.world!.riders.map((rider) => rider.id),
    ["a", "c"],
  );
  const model = present(view(room), {
    me: "d",
    host: false,
    solo: false,
    display: false,
  });
  assert.equal(model.riding, false);
  assert.equal(model.localIndex, -1);
  assert.equal(model.note, "You ride in the next match");
});

test("a team result places each side as one, and the service's field check accepts it", () => {
  const room = createRoom("m0", { ...TEAMS, size: 3 });
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  const world = room.world!;
  for (let point = 0; point < TARGET; point++) {
    while (world.phase !== "play") fold(room);
    world.ball.touch = point === 0 ? 3 : 2;
    ballInGoal(world, 0);
    fold(room);
  }
  while (room.stage === "running") fold(room);
  assert.equal(room.stage, "over");
  assert.deepEqual(
    [room.decided!.winner, room.decided!.side, room.decided!.finishers],
    ["a", 0, ["a", "b"]],
  );
  const result = matchResult(room)!;
  assert.equal(result.winnerId, "a");
  assert.deepEqual(
    result.players.map((p) => [
      p.slot,
      p.matchPlacement,
      p.roundWins,
      p.matchScoreUnits,
      p.goals,
      p.ownGoals,
    ]),
    [
      [0, 1, 1, 3, 0, 0],
      [1, 2, 0, 0, 0, 0],
      [2, 1, 1, 3, 2, 0],
      [3, 2, 0, 0, 0, 1],
      [4, 1, 1, 3, 0, 0],
      [5, 2, 0, 0, 0, 0],
    ],
  );
  assert.ok(validFuseballField(result.players));
  assert.ok(decode(encode(room), room.tick));

  const seen = view(room);
  assert.equal(seen.winnerSide, 0);
  const mine = present(seen, {
      me: "a",
      host: true,
      solo: false,
      display: false,
    }),
    theirs = present(seen, {
      me: "b",
      host: false,
      solo: false,
      display: false,
    });
  assert.equal(mine.result?.title, "YOU WIN!");
  assert.equal(theirs.result?.title, "CYAN WINS");
  assert.equal(mine.result?.lines[0], "Cyan 3 – 0 Magenta");
  assert.equal(mine.result?.lines.length, 7);
  assert.equal(mine.names, undefined, "the banner names the colour");
});

test("the lobby offers the modes, the mode's arenas and a change of sides", () => {
  const room = createRoom("m0", TEAMS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 2, "cat", 1],
    ],
  });
  const model = present(view(room), {
    me: "b",
    host: false,
    solo: false,
    display: false,
  });
  assert.deepEqual(
    model.lobby.modes.map((mode) => [mode.size, mode.selected]),
    [
      [1, false],
      [2, true],
      [3, false],
    ],
  );
  assert.deepEqual(
    model.lobby.maps.map((map) => map.id),
    [...TEAM_MAP_IDS],
  );
  assert.ok(model.lobby.maps.every((map) => map.blurb.length > 10));
  assert.deepEqual(
    model.lobby.members.map((member) => [member.name, member.side]),
    [
      ["Ada", 0],
      ["Bo", 0],
    ],
  );
  assert.equal(model.lobby.canSwitch, true);
  assert.equal(model.lobby.canStart, true);
  room.settings = { display: false, mapId: "gridlock", seed: 0, size: 1 };
  const duel = present(view(room), {
    me: "b",
    host: false,
    solo: false,
    display: false,
  });
  assert.equal(duel.lobby.canSwitch, false, "a duel has no sides to change");
  assert.deepEqual(
    duel.lobby.maps.map((map) => map.id),
    [...MAP_ORDER],
  );
});

test("the camera shows a duel as it always was, a team arena whole where it reads, and follows on a phone", () => {
  const duel = toView(createWorld("gridlock", ids(2)));
  assert.deepEqual(cameraFor(MAPS.gridlock, duel, 0, 0.5), {
    x: 320,
    y: 180,
    zoom: 1,
  });
  const map = TEAM_MAPS.mainframe,
    seen = toView(playing(6)),
    whole = { x: 480, y: 270, zoom: 640 / 960 };
  // A desktop or a TV: riders stay big enough at the whole arena.
  assert.deepEqual(cameraFor(map, seen, 0, 2), whole);
  assert.ok(18 * whole.zoom * 2 >= MIN_RIDER_CSS);
  // Nobody to follow: a watcher or the shared screen sees it all, however small.
  assert.deepEqual(cameraFor(map, seen, -1, 0.5), whole);
  // A phone: closer, on this device's rider and the ball, and never past the arena's edge.
  for (const local of [0, 1, 4, 5]) {
    const near = structuredClone(seen),
      me = near.riders[local]!;
    near.ball.x = me.x + (local % 2 === 0 ? 120 : -120);
    near.ball.y = me.y - 90;
    const eye = cameraFor(map, near, local, 1);
    assert.ok(eye.zoom > whole.zoom && eye.zoom <= 1, `rider ${local}: closer`);
    const halfW = 320 / eye.zoom,
      halfH = 180 / eye.zoom;
    assert.ok(eye.x - halfW >= 0 && eye.x + halfW <= map.w, "inside, sideways");
    assert.ok(
      eye.y - halfH >= 0 && eye.y + halfH <= map.h,
      "inside, up and down",
    );
    for (const body of [me, near.ball]) {
      assert.ok(Math.abs(body.x - eye.x) < halfW, `rider ${local}: in frame`);
      assert.ok(Math.abs(body.y - eye.y) < halfH, `rider ${local}: in frame`);
    }
  }
  // Far apart, the view opens up to keep both in frame, as far as the whole arena.
  const apart = structuredClone(seen);
  apart.riders[0].x = 40;
  apart.ball.x = 920;
  assert.equal(cameraFor(map, apart, 0, 1).zoom, whole.zoom);
});

test("views of a team match blend and cue rider by rider", () => {
  const world = playing(4);
  const older = toView(world);
  world.riders[2]!.x += 10 * SUB;
  world.riders[3]!.jumps++;
  world.bubbles[3]!.active = true;
  world.bubbles[3]!.seq++;
  world.step++;
  const newer = toView(world);
  const mid = blend(older, newer, 0.5);
  assert.equal(mid.riders.length, 4);
  assert.equal(mid.riders[2]!.x, older.riders[2]!.x + 5);
  assert.deepEqual(
    cues(older, newer).map((cue) => [
      cue.kind,
      "index" in cue ? cue.index : "slot" in cue ? cue.slot : -1,
    ]),
    [
      ["jump", 1],
      ["bubble", 3],
    ],
  );
  // A view of another size of match is not blended with this one.
  const duel = toView(createWorld("mainframe", ids(2)));
  assert.equal(blend(duel, newer, 0.5), newer);
  assert.deepEqual(cues(duel, newer), []);
});

test("a duel seats people before bots, and a duel's lobby has no change of sides", () => {
  const room = createRoom("m0", {
    display: false,
    mapId: "halo",
    seed: 0,
    size: 1,
  });
  fold(room, {
    a: [
      [BOT, "add", "bot:1", "Fizz", 0],
      [BOT, "add", "bot:2", "Volta", 1],
      [JOIN, "a", "Ada", 2, "robot", 1],
    ],
  });
  fold(room, { a: [[SIDE, "m0"]] });
  assert.equal(room.seats.get("a")!.slot, 2, "no sides to change in a duel");
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.deepEqual(
    room.world!.riders.map((rider) => rider.id),
    ["bot:1", "a"],
    "Ada rides, though two bots sit lower",
  );
});

test("the follow camera stays on the rider when the ball is nearer across a seam", () => {
  const map = TEAM_MAPS.backbone,
    seen = toView(playing(4, "backbone"));
  seen.riders[0]!.x = 20;
  seen.riders[0]!.y = 270;
  seen.ball.x = map.w - 20;
  seen.ball.y = 270;
  seen.ball.live = true;
  assert.equal(cameraFor(map, seen, 0, 0.5).zoom, 1);
});
