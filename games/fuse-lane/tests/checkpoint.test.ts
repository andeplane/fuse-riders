import test from "node:test";
import assert from "node:assert/strict";
import { ACTION } from "fuse-netcode";
import {
  BRIEFING,
  HANDOFF,
  createRoom,
  decodeRoom,
  encodeRoom,
  fuseLaneView,
  hashRoom,
  isFuseLaneEntry,
  type FuseLaneRoom,
} from "../src/game/index.js";
import {
  FAST,
  TURNS,
  addBot,
  fold,
  runWhile,
  started,
  walk,
} from "./fixtures/lane.js";

/** A room with bots that have played a few weeks: jobs, goods, savings and holdings all in it. */
function lived(weeks = 8): FuseLaneRoom {
  const room = started(FAST, [addBot("bot:1", 2), addBot("bot:2", 3)]);
  runWhile(room, () => room.week < weeks, 60_000);
  return room;
}

function roundTrip(room: FuseLaneRoom): FuseLaneRoom {
  // What a snapshot carries is plain data: a JSON round trip is at least as lossy.
  const fields = JSON.parse(JSON.stringify(encodeRoom(room))) as unknown[];
  const decoded = decodeRoom(fields, room.tick);
  assert.ok(
    decoded,
    `stage ${room.stage}, week ${room.week}, phase ${room.phase}`,
  );
  return decoded;
}

test("every stage of a room survives the checkpoint whole: the same hash, and it folds on identically", () => {
  const lobby = createRoom("m0", FAST);
  fold(lobby, { a: [[10, "a", "Ada", 0, "fox", 1], addBot("bot:1", 1)] });
  const walking = started();
  fold(walking, { a: [walk(walking, 5)] });
  const briefing = lived(3);
  runWhile(briefing, () => briefing.phase !== BRIEFING, 5000);
  const over = started(FAST, [addBot("bot:1", 2)]);
  over.players.a!.goals = [10, 10, 10, 10];
  Object.assign(over.players.a!, {
    cash: 2000,
    happiness: 30,
    job: 0,
    wage: 4,
    dep: 40,
  });
  over.players.a!.courses[0] = 10;
  fold(over, { a: [[2, 1]], b: [[2, 1]] });
  runWhile(over, () => over.stage === "running", 5000);
  assert.equal(over.stage, "over");

  for (const room of [lobby, walking, lived(6), briefing, over]) {
    const copy = roundTrip(room);
    assert.equal(hashRoom(copy), hashRoom(room));
    assert.deepEqual(fuseLaneView(copy), fuseLaneView(room));
    for (let tick = 0; tick < 300; tick++) {
      fold(room);
      fold(copy);
    }
    assert.equal(
      hashRoom(copy),
      hashRoom(room),
      `${room.stage} folds on alike`,
    );
  }
});

test("a corrupt or hostile checkpoint is refused whole", () => {
  const room = lived(5);
  const good = encodeRoom(room);
  const mutate = (change: (fields: any[]) => void) => {
    const fields = JSON.parse(JSON.stringify(good)) as any[];
    change(fields);
    return decodeRoom(fields, room.tick);
  };
  assert.ok(mutate(() => {}));
  const someone = (fields: any[]) => fields[3].players.a;
  const cases: [string, (fields: any[]) => void][] = [
    ["negative cash", (f) => (someone(f).cash = -1)],
    ["fractional cash", (f) => (someone(f).cash = 1.5)],
    ["unknown player key", (f) => (someone(f).cheat = 1)],
    ["missing player key", (f) => delete someone(f).relax],
    [
      "walking and inside at once",
      (f) => Object.assign(someone(f), { dest: 3, inside: 4 }),
    ],
    ["time past the week", (f) => (someone(f).time = 901)],
    [
      "unknown durable",
      (f) => (someone(f).durables.yacht = { n: 1, paid: 1, cheap: false }),
    ],
    ["bad goal", (f) => (someone(f).goals = [55, 50, 50, 50])],
    [
      "two holders of one job",
      (f) => {
        f[3].players.a.job = 5;
        f[3].players.a.wage = 6;
        f[3].players.b.job = 5;
        f[3].players.b.wage = 6;
      },
    ],
    [
      "wage without a job",
      (f) => Object.assign(someone(f), { job: -1, wage: 9 }),
    ],
    ["short price list", (f) => f[3].economy.prices.pop()],
    ["NaN in the economy", (f) => (f[3].economy.growth = null)],
    ["sentiment out of range", (f) => (f[3].economy.sentiment = 2)],
    [
      "player without a roster entry",
      (f) => (f[3].players.zed = f[3].players.a),
    ],
    [
      "prototype key",
      (f) =>
        Object.defineProperty(f[3].roster, "__proto__", {
          value: { name: "x", slot: 0 },
          enumerable: true,
        }),
    ],
    ["over without a ranking", (f) => (f[0][1] = "over")],
    ["lobby in week 5", (f) => (f[0][1] = "lobby")],
    ["duplicate slot", (f) => (f[1][1][2] = f[1][0][2])],
    ["bad week length", (f) => (f[0][3] = 999)],
    ["bad settings", (f) => (f[2] = { weekSeconds: 30, display: false })],
    ["seated without a life", (f) => delete f[3].players.b],
    ["phase end beyond a week", (f) => (f[3].phaseEnd = room.tick + 99_999)],
    [
      "too many headlines",
      (f) => (f[3].headlines = Array.from({ length: 20 }, () => "x")),
    ],
  ];
  for (const [name, change] of cases)
    assert.equal(mutate(change), undefined, name);
  assert.equal(decodeRoom(good.slice(0, 3), room.tick), undefined);
  assert.equal(decodeRoom(good, -1), undefined);
});

test("the entry parser accepts play entries and the shared management entries, and nothing else", () => {
  assert.ok(isFuseLaneEntry([1, 1, 0, 1, 12]));
  assert.ok(isFuseLaneEntry([1, 1, 1, 1, 4, 15, 9, 100]));
  assert.ok(isFuseLaneEntry([1, 1, 2, 3]));
  assert.ok(isFuseLaneEntry([1, 1, 3, 3]));
  assert.ok(isFuseLaneEntry([1, 1, ACTION, "start", "m1"]));
  for (const bad of [
    [1, 1, 0, 1, 13],
    [1, 1, 0, 1],
    [0, 1, 2, 1],
    [1, 0, 2, 1],
    [1, 1, 1, 1, 4, 0, 0, 0],
    [1, 1, 1, 1, 4, 18, 0, 0],
    [1, 1, 1, 1, 4, 15, -1, 0],
    [1, 1, 1, 1, 4, 15, 1.5, 0],
    [1, 1, 2, 1, "extra"],
    [1, 1, 9, 1],
    [1, 1, 4, 0, 50, 50, 50, 5],
    "walk",
    null,
  ])
    assert.equal(isFuseLaneEntry(bad), false, JSON.stringify(bad));
});

test("a hot-seat room round-trips at a handoff, and turn state that does not fit its mode is refused", () => {
  const room = started(TURNS, [addBot("bot:1", 2)]);
  runWhile(room, () => room.phase !== HANDOFF, 50);
  assert.equal(room.phase, HANDOFF);
  const copy = roundTrip(room);
  assert.equal(hashRoom(copy), hashRoom(room));
  assert.deepEqual(copy.order, room.order);
  assert.equal(copy.turn, room.turn);
  const fields = JSON.parse(JSON.stringify(encodeRoom(room))) as unknown[];
  const game = fields[3] as Record<string, unknown>;
  for (const broken of [
    { turns: false },
    { turn: 9 },
    { order: [...room.order, room.order[0]] },
    { order: ["nobody"] },
    { level: 5 },
  ]) {
    const bad = [...fields];
    bad[3] = { ...game, ...broken };
    assert.equal(decodeRoom(bad, room.tick), undefined, JSON.stringify(broken));
  }
});
