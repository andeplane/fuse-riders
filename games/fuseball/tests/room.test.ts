import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
  type StreamEntries,
} from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  PLAY,
  createFuseballGame,
  createRoom,
  decode,
  encode,
  firstStepBits,
  foldTick,
  fuseballGame,
  hash,
  isEntry,
  parseSettings,
  steps,
  view,
  type BotInput,
  type Entry,
  type Room,
  type Settings,
} from "../src/online/game.js";
import { seatName } from "../src/online/names.js";
import { matchResult } from "../src/online/result.js";
import {
  BTN,
  CLOUD_STEPS_PER_TICK,
  COUNTDOWN_STEPS,
  DOWN,
  LEFT,
  MAP_IDS,
  RIGHT,
  STEPS_PER_TICK,
  TARGET,
  UP,
  ZAP_STEPS,
  mapOf,
  type Slot,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
function fold(room: Room, bodies: Bodies = {}, bot?: BotInput): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams, bot);
}
const run = (room: Room, ticks: number, bodies: () => Bodies = () => ({})) => {
  for (let i = 0; i < ticks; i++) fold(room, bodies());
};
const COUNTDOWN_TICKS = COUNTDOWN_STEPS / STEPS_PER_TICK,
  ZAP_TICKS = ZAP_STEPS / STEPS_PER_TICK;

/** `a` and `b` seated in a lobby. */
function seated(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("m0", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  return room;
}
/** `a` against `b` in match `m1`, still in its first countdown. */
function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = seated(settings);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
/** The same match with the countdown run out. */
function playing(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = started(settings);
  run(room, COUNTDOWN_TICKS);
  assert.equal(room.world!.phase, "play");
  return room;
}
const rider = (room: Room, slot: Slot) => room.world!.riders[slot];
/** Drops the ball, at rest, into `team`'s goal: the next fold scores the point. */
function ballInGoal(room: Room, team: Slot): void {
  const world = room.world!;
  const goal = mapOf(world.mapId).goals.find((each) => each.team === team)!;
  const [x, y] =
    "r" in goal ? [goal.x, goal.y] : [goal.x + goal.w / 2, goal.y + goal.h / 2];
  Object.assign(world.ball, { x: x * SUB, y: y * SUB, vx: 0, vy: 0 });
}
/** Scores one point for `team` and plays on to the next countdown's end, or to the end of the match. */
function point(room: Room, team: Slot): void {
  ballInGoal(room, team);
  fold(room);
  assert.equal(room.world!.phase, "zap");
  run(room, ZAP_TICKS);
  if (room.stage === "running") run(room, COUNTDOWN_TICKS);
}

test("settings are exactly a display flag and a known map", () => {
  assert.deepEqual(parseSettings({ display: true, mapId: "halo" }), {
    display: true,
    mapId: "halo",
  });
  for (const mapId of MAP_IDS)
    assert.ok(parseSettings({ display: false, mapId }));
  for (const bad of [
    null,
    [],
    "gridlock",
    {},
    { display: false },
    { mapId: "gridlock" },
    { display: 1, mapId: "gridlock" },
    { display: false, mapId: "nowhere" },
    { display: false, mapId: "gridlock", extra: 1 },
    { display: false, mapId: "toString" },
  ])
    assert.equal(parseSettings(bad), undefined, JSON.stringify(bad));
});

test("entries: play names a match and carries stick bits; management uses the shared kinds", () => {
  assert.ok(isEntry([1, 5, PLAY, "m1", RIGHT | BTN]));
  assert.ok(isEntry([1, 5, PLAY, "m1", 0]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", LEFT | RIGHT]), "both ways at once");
  assert.ok(!isEntry([1, 5, PLAY, "m1", UP | DOWN]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 32]), "unknown bits");
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1.5]));
  assert.ok(!isEntry([1, 5, PLAY, "m1"]), "short");
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, BTN]), "no round field");
  assert.ok(!isEntry([0, 5, PLAY, "m1", BTN]), "seq from 1");
  assert.ok(!isEntry([1, 0, PLAY, "m1", BTN]), "tick from 1");
  assert.ok(!isEntry([1, 5, PLAY, "", BTN]), "a match id");
  assert.ok(isEntry([1, 5, JOIN, "a", "Ada", 1, "robot", 1]));
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 2, "robot", 1]), "two seats");
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 0, "nobody", 1]));
  assert.ok(!isEntry([1, 5, JOIN, "constructor", "Ada", 0, "robot", 1]));
  assert.ok(isEntry([1, 5, SETTINGS, { display: false, mapId: "halo" }]));
  assert.ok(!isEntry([1, 5, SETTINGS, { display: false, mapId: "moon" }]));
  assert.ok(isEntry([1, 5, ACTION, "rematch", "m2"]));
  assert.ok(!isEntry([1, 5, ACTION, "start", "has space"]));
  assert.ok(isEntry([1, 5, BOT, "add", "bot:1", "Fizz", 1]));
  assert.ok(isEntry([1, 5, SPECTATOR, "join", "w", "Wes", 1]));
  assert.equal(seatName("  Neon Rider  "), "Neon Rider");
  assert.equal(seatName("\u0007"), undefined);
});

test("a duel needs both seats; it starts in slot order on the lobby's map, and watchers only watch", () => {
  const alone = createRoom("m0", DEFAULT_SETTINGS);
  fold(alone, { a: [[JOIN, "a", "Ada", 1, "robot", 1]] });
  fold(alone, { a: [[ACTION, "start", "m1"]] });
  assert.equal(alone.stage, "lobby", "one rider is not a duel");
  assert.equal(alone.world, null);

  const room = createRoom("m0", { display: false, mapId: "halo" });
  // Seated out of order, and a watcher beside them.
  fold(room, {
    a: [
      [JOIN, "b", "Bo", 0, "cat", 1],
      [JOIN, "a", "Ada", 1, "robot", 1],
      [SPECTATOR, "join", "w", "Wes", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m1");
  assert.deepEqual(
    room.world!.riders.map((r) => [r.id, r.slot]),
    [
      ["b", 0],
      ["a", 1],
    ],
  );
  assert.equal(room.world!.mapId, "halo");
  assert.deepEqual(
    room.roster.map((entrant) => entrant.name),
    ["Bo", "Ada"],
  );
  const seen = view(room);
  assert.equal(seen.seats.find((seat) => seat.id === "w")?.watcher, true);
  assert.equal(seen.world?.phase, "countdown");
  assert.equal(seen.world?.count, 3);
  assert.equal(fuseballGame.seating.capacity, 2);
  assert.deepEqual(fuseballGame.seating.solo, { name: "You", bots: 1 });
  assert.deepEqual(fuseballGame.scope(room), { matchId: "m1", round: 0 });
});

test("held controls ride from one entry on; a release, another match's entry and an absent seat hold nothing", () => {
  const room = playing();
  const x = rider(room, 1).x;
  fold(room, { b: [[PLAY, "m1", LEFT]] });
  run(room, 4);
  assert.ok(
    rider(room, 1).x < x,
    "b runs left on held bits, entry or no entry",
  );
  assert.equal(room.held.b, LEFT);
  assert.equal(room.held.a, undefined);
  fold(room, { b: [[PLAY, "m1", 0]] });
  assert.equal(room.held.b, undefined, "released");
  fold(room, { b: [[PLAY, "old", LEFT]] });
  assert.equal(room.held.b, undefined, "an entry for another match");
  fold(room, { b: [[PLAY, "m1", RIGHT]] });
  assert.equal(room.held.b, RIGHT);
  // b's page goes: the seat is kept for the match, and what it held is let go.
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(room.seats.get("b")?.connected, false);
  assert.equal(room.held.b, undefined);
  const parked = rider(room, 1).vx;
  run(room, 40);
  assert.ok(Math.abs(rider(room, 1).vx) <= Math.abs(parked));
  assert.equal(rider(room, 1).vx, 0, "it coasts to a stop");
});

test("a press and release inside one tick is still a press, on the tick's first step", () => {
  const tapped = playing(),
    control = playing();
  fold(tapped, {
    a: [
      [PLAY, "m1", BTN],
      [PLAY, "m1", 0],
    ],
  });
  fold(control);
  assert.equal(rider(tapped, 0).jumps, 1, "the tap jumped");
  assert.equal(rider(control, 0).jumps, 0);
  assert.ok(rider(tapped, 0).y < rider(control, 0).y);
  assert.equal(tapped.held.a, undefined, "nothing is held after it");
  // The stick never reads both ways: where a tap and the hold disagree, what is held at the tick's end wins.
  assert.equal(firstStepBits(0, BTN | DOWN), BTN | DOWN);
  assert.equal(firstStepBits(RIGHT, LEFT | BTN), RIGHT | BTN);
  assert.equal(firstStepBits(0, LEFT | RIGHT), 0);
  assert.equal(firstStepBits(UP, DOWN | LEFT), UP | LEFT);
});

test("a tick runs six steps, three while the ball is in a cloud, and the game clock follows", () => {
  const lobby = seated();
  assert.equal(steps(lobby), STEPS_PER_TICK);
  const room = playing();
  assert.equal(room.simulationTick, room.tick * STEPS_PER_TICK);
  assert.equal(steps(room), STEPS_PER_TICK);
  const cloud = mapOf(room.world!.mapId).clouds[0]!;
  Object.assign(room.world!.ball, {
    x: cloud.x * SUB,
    y: cloud.y * SUB,
    vx: 0,
    vy: 0,
  });
  assert.equal(steps(room), CLOUD_STEPS_PER_TICK);
  const clock = room.simulationTick,
    step = room.world!.step;
  fold(room);
  assert.equal(room.simulationTick - clock, CLOUD_STEPS_PER_TICK);
  assert.equal(room.world!.step - step, CLOUD_STEPS_PER_TICK);
  assert.equal(view(room).world?.slow, true);
  assert.equal(fuseballGame.clock(room), view(room).tick);
  assert.equal(fuseballGame.steps(room), steps(room));
  assert.ok(fuseballGame.maxSteps >= STEPS_PER_TICK);
  // A slowed room still checkpoints: its clock is inside the three-to-six window.
  assert.ok(decode(encode(room), room.tick));
});

test("what is held stays held across a point reset, without becoming a fresh press", () => {
  const room = playing();
  fold(room, { a: [[PLAY, "m1", RIGHT | BTN]] });
  const jumps = rider(room, 0).jumps;
  assert.equal(jumps, 1, "the press jumped");
  // The point goes to b; a is zapped, then both are back on their marks for the countdown.
  ballInGoal(room, 1);
  fold(room);
  assert.equal(room.world!.phase, "zap");
  assert.deepEqual(room.world!.score, [0, 1]);
  run(room, ZAP_TICKS);
  assert.equal(room.world!.phase, "countdown");
  assert.equal(room.held.a, RIGHT | BTN, "still held, no new entry needed");
  const mark = rider(room, 0).x;
  // The goal fell mid-tick, so the count ends inside the last of these ticks.
  run(room, COUNTDOWN_TICKS - 1);
  assert.equal(room.world!.phase, "countdown");
  assert.equal(rider(room, 0).x, mark, "frozen on the mark through the count");
  run(room, 4);
  assert.equal(room.world!.phase, "play");
  assert.ok(rider(room, 0).x > mark, "the held stick runs at once");
  assert.equal(rider(room, 0).jumps, jumps, "the held button is not a press");
  // Let go and press again: that one is a press.
  fold(room, { a: [[PLAY, "m1", RIGHT]] });
  fold(room, { a: [[PLAY, "m1", RIGHT | BTN]] });
  assert.equal(rider(room, 0).jumps, jumps + 1);

  // A release during the zap or the countdown is heard too: nothing runs when play resumes.
  const released = playing();
  fold(released, { a: [[PLAY, "m1", RIGHT]] });
  ballInGoal(released, 1);
  fold(released);
  run(released, ZAP_TICKS - 5);
  fold(released, { a: [[PLAY, "m1", 0]] });
  run(released, 5 + COUNTDOWN_TICKS + 3);
  assert.equal(released.world!.phase, "play");
  assert.equal(released.held.a, undefined);
  assert.equal(rider(released, 0).vx, 0);
});

test("the third point ends the match; rematch and lobby start over, and the lobby's map applies to the next match", () => {
  const room = playing();
  // The map is changed mid-match: the match in play keeps its own.
  fold(room, { a: [[SETTINGS, { display: false, mapId: "downlink" }]] });
  assert.equal(room.settings.mapId, "downlink");
  assert.equal(room.play.mapId, "gridlock");
  assert.equal(room.world!.mapId, "gridlock");
  point(room, 0);
  point(room, 1);
  assert.equal(room.stage, "running");
  assert.equal(matchResult(room), undefined, "nothing to report mid-match");
  point(room, 0);
  ballInGoal(room, 0);
  fold(room);
  run(room, ZAP_TICKS - 1);
  assert.equal(room.stage, "running", "the last zap plays inside the match");
  const before = room.simulationTick;
  fold(room);
  assert.equal(room.stage, "over");
  assert.deepEqual(room.world!.score, [TARGET, 1]);
  assert.deepEqual(room.decided, {
    clock: before + STEPS_PER_TICK,
    winner: "a",
    finishers: ["a", "b"],
  });
  assert.equal(view(room).winner, "a");
  assert.equal(view(room).world?.winner, 0);
  // Over is over: the world stands still while the clock keeps its rate.
  const step = room.world!.step;
  run(room, 3);
  assert.equal(room.world!.step, step);
  // A start does nothing now; a rematch is a new match on the map the lobby chose.
  fold(room, { a: [[ACTION, "start", "nope"]] });
  assert.equal(room.matchId, "m1");
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.equal(room.decided, null);
  assert.deepEqual(room.world!.score, [0, 0]);
  assert.equal(room.world!.mapId, "downlink");
  assert.equal(room.play.mapId, "downlink");
  assert.equal(view(room).winner, "");
  // Entries for the old match no longer steer anyone.
  run(room, COUNTDOWN_TICKS);
  fold(room, { a: [[PLAY, "m1", RIGHT]] });
  assert.equal(room.held.a, undefined);
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
  assert.deepEqual(room.roster, []);
  assert.equal(room.seats.size, 2);
});

test("a rider who left is no finisher, and a rematch without them falls back to the lobby", () => {
  const room = playing();
  point(room, 0);
  point(room, 0);
  fold(room, { a: [[LEAVE, "b"]] });
  point(room, 0);
  assert.equal(room.stage, "over");
  assert.deepEqual(room.decided?.finishers, ["a"]);
  const result = matchResult(room)!;
  assert.deepEqual(
    result.players.map((p) => [p.playerId, p.name, p.earlyExits]),
    [
      ["a", "Ada", 0],
      ["b", "Bo", 1],
    ],
  );
  // The rematch drops the absent seat first; one rider cannot duel.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
  assert.equal(room.seats.has("b"), false);
  assert.ok(decode(encode(room), room.tick));
});

test("a bot seat is steered by the injected bot once a tick, with ordinary bits and nothing logged", () => {
  const asked: number[] = [];
  const bot: BotInput = (world, each) => {
    asked.push(world.step);
    assert.equal(each.id, "bot:1");
    return LEFT;
  };
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [BOT, "add", "bot:1", "Fizz", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] }, bot);
  for (let i = 0; i < COUNTDOWN_TICKS + 4; i++) fold(room, {}, bot);
  assert.equal(room.roster[1]?.bot, true);
  assert.deepEqual(
    asked.slice(0, 3),
    [0, STEPS_PER_TICK, STEPS_PER_TICK * 2],
    "asked at the start of every tick",
  );
  assert.ok(rider(room, 1).vx < 0, "the bot's stick moves its rider");
  assert.equal(room.held["bot:1"], undefined, "a bot's bits are not logged");
  // An answer no stick could give is nothing held; the default bot (until the engine has one) stands idle.
  const wild: BotInput = () => LEFT | RIGHT | 64;
  const still = rider(room, 1);
  for (let i = 0; i < 60; i++) fold(room, {}, wild);
  assert.equal(still.vx, 0);
  // The game object carries its bot into the ticker the netcode folds with.
  const custom = createRoom("m0", DEFAULT_SETTINGS);
  const ticker = createFuseballGame(bot).createTicker();
  const streams = (bodies: unknown[][]) =>
    new Map<string, StreamEntries<Entry>>([
      [
        "a",
        {
          generation: 1,
          entries: bodies.map(
            (body) => [++seq, custom.tick + 1, ...body] as Entry,
          ),
        },
      ],
    ]);
  ticker(
    custom,
    "a",
    streams([
      [JOIN, "a", "Ada", 0, "robot", 1],
      [BOT, "add", "bot:1", "Fizz", 1],
    ]),
  );
  ticker(custom, "a", streams([[ACTION, "start", "m1"]]));
  for (let i = 0; i < COUNTDOWN_TICKS + 4; i++) ticker(custom, "a", new Map());
  assert.ok(custom.world!.riders[1].vx < 0);
  assert.equal(
    fuseballGame.seating.botId(custom, new Set(["bot:2"])),
    "bot:3",
    "a new bot never takes an id the match remembers or one pending",
  );
});

test("a checkpoint restores the room exactly in every stage and plays on identically", () => {
  const lobby = seated();
  const running = playing();
  fold(running, {
    a: [[PLAY, "m1", RIGHT | BTN]],
    b: [[PLAY, "m1", LEFT]],
  });
  run(running, 7);
  fold(running, {
    a: [
      [SPECTATOR, "join", "w", "Wes", 1],
      [PRESENCE, "b", false, 1],
    ],
  });
  const over = playing();
  for (let i = 0; i < TARGET; i++) point(over, 1);
  assert.equal(over.stage, "over");
  for (const room of [lobby, running, over]) {
    const fields = structuredClone(encode(room));
    const restored = decode(fields, room.tick)!;
    assert.ok(restored, room.stage);
    assert.equal(hash(restored), hash(room));
    assert.deepEqual(view(restored), view(room));
    assert.deepEqual(
      encode(restored),
      fields,
      "and encodes to the same fields",
    );
    for (const each of [room, restored]) {
      fold(each, { a: [[PLAY, each.matchId, RIGHT]] });
      run(each, 30);
    }
    assert.equal(hash(restored), hash(room), `${room.stage} plays on the same`);
  }
});

test("a corrupt checkpoint is refused whole, and refusing it changes nothing", () => {
  const room = playing();
  fold(room, { a: [[PLAY, "m1", RIGHT]] });
  run(room, 5);
  const over = playing();
  for (let i = 0; i < TARGET; i++) point(over, 0);
  const lobby = seated();
  const WORLD = 8;
  type Corrupt = (fields: unknown[]) => void;
  const at =
    (index: number, value: unknown): Corrupt =>
    (fields) => {
      fields[index] = value;
    };
  const seat =
    (change: (seat: Record<string, unknown>) => void): Corrupt =>
    (fields) =>
      change((fields[3] as Record<string, unknown>[])[0]!);
  const world =
    (change: (world: unknown[]) => void): Corrupt =>
    (fields) =>
      change(fields[WORLD] as unknown[]);
  const cases: [string, Room, Corrupt][] = [
    ["a missing field", room, (fields) => fields.pop()],
    ["an extra field", room, (fields) => fields.push(0)],
    ["a match id with a space", room, at(0, "m 1")],
    ["an unknown stage", room, at(1, "between")],
    ["a stage the world contradicts", room, at(1, "over")],
    ["a lobby with a world", room, at(1, "lobby")],
    [
      "settings with an unknown map",
      room,
      at(2, { display: false, mapId: "x" }),
    ],
    ["settings with an extra key", room, at(4, { ...room.play, extra: 1 })],
    [
      "a map the world is not on",
      room,
      at(4, { display: false, mapId: "halo" }),
    ],
    ["seats that are not a list", room, at(3, {})],
    ["a seat past the capacity", room, seat((s) => (s.slot = 2))],
    ["a seat with an unknown key", room, seat((s) => (s.extra = true))],
    [
      "a seat named for a prototype key",
      room,
      seat((s) => (s.id = "__proto__")),
    ],
    ["two seats in one slot", room, seat((s) => (s.slot = 1))],
    ["a human seat with no generation", room, seat((s) => delete s.generation)],
    ["held bits for a stranger", room, at(5, [["z", RIGHT]])],
    ["held bits no stick gives", room, at(5, [["a", LEFT | RIGHT]])],
    [
      "held bits listed twice",
      room,
      at(5, [
        ["a", RIGHT],
        ["a", RIGHT],
      ]),
    ],
    ["held zero", room, at(5, [["a", 0]])],
    ["a roster of one", room, at(6, [["a", "Ada", false]])],
    [
      "a roster out of order",
      room,
      at(6, [
        ["b", "Bo", false],
        ["a", "Ada", false],
      ]),
    ],
    [
      "a roster with a bad name",
      room,
      at(6, [
        ["a", " Ada", false],
        ["b", "Bo", false],
      ]),
    ],
    ["a decision before the end", room, at(7, [1, "a", ["a", "b"]])],
    ["a world that is not one", room, at(WORLD, [1, 2, 3])],
    ["no world in a match", room, at(WORLD, null)],
    [
      "a rider out of the field",
      room,
      world((w) => ((w[10] as unknown[])[1] = -5)),
    ],
    ["a score past the target", room, world((w) => (w[5] = TARGET + 1))],
    ["a clock ahead of the log", room, at(9, room.tick * STEPS_PER_TICK + 1)],
    [
      "a clock behind the log",
      room,
      at(9, room.tick * CLOUD_STEPS_PER_TICK - 1),
    ],
    ["a fractional clock", room, at(9, room.simulationTick + 0.5)],
    ["an ended match with no decision", over, at(7, null)],
    ["the wrong winner", over, at(7, [over.decided!.clock, "b", ["a", "b"]])],
    [
      "a stranger as winner",
      over,
      at(7, [over.decided!.clock, "z", ["a", "b"]]),
    ],
    [
      "a decision from the future",
      over,
      at(7, [over.simulationTick + 1, "a", ["a", "b"]]),
    ],
    ["unsorted finishers", over, at(7, [over.decided!.clock, "a", ["b", "a"]])],
    [
      "a finisher who never played",
      over,
      at(7, [over.decided!.clock, "a", ["a", "z"]]),
    ],
    ["an ended match marked running", over, at(1, "running")],
    ["something held after the end", over, at(5, [["a", RIGHT]])],
    [
      "a lobby with a roster",
      lobby,
      at(6, [
        ["a", "Ada", false],
        ["b", "Bo", false],
      ]),
    ],
    ["a lobby marked running", lobby, at(1, "running")],
  ];
  for (const [name, source, corrupt] of cases) {
    const fields = structuredClone(encode(source));
    assert.ok(decode(fields, source.tick), `${name}: sound before the damage`);
    corrupt(fields);
    const damaged = structuredClone(fields);
    assert.equal(decode(fields, source.tick), undefined, name);
    assert.deepEqual(fields, damaged, `${name}: the fields are left as given`);
  }
  assert.equal(decode(encode(room), -1), undefined, "a negative tick");
  assert.equal(decode(encode(room), room.tick + 0.5), undefined);
  assert.equal(
    decode(encode(room), room.tick * 3),
    undefined,
    "a tick this clock cannot belong to",
  );
});
