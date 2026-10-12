import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
  type StreamEntries,
} from "fuse-netcode";
import {
  APPLY,
  BRIEFING,
  HANDOFF,
  JOBHUB,
  JOBS,
  READY,
  WALK,
  WEEK,
  createPlayer,
  createRoom,
  defaultGoals,
  employer,
  foldTick,
  fuseLaneGame,
  fuseLaneView,
  hasDegree,
  isFuseLaneEntry,
  matchResult,
  nameOf,
  parseSettings,
  playerOrder,
  progress,
  seatName,
  type FuseLaneEntry,
  type FuseLaneRoom,
} from "../src/game/index.js";
import {
  FAST,
  TURNS,
  act,
  addBot,
  endWeekEntry,
  fold,
  nextWeek,
  ready,
  runWhile,
  started,
  walk,
} from "./fixtures/lane.js";

/** Meets every goal of 10 the coming Monday. */
function winning(room: FuseLaneRoom, id: string): void {
  const player = room.players[id]!;
  player.goals = [10, 10, 10, 10];
  player.cash = 1000;
  player.happiness = 20;
  player.courses[0] = 10;
  player.job = 0;
  player.wage = 4;
  player.dep = 30;
}

test("a player who drops out mid-week plays no more of it: the others' week goes on, and Monday does not wait", () => {
  const room = started();
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  const b = room.players.b!;
  assert.equal(room.seats.get("b")!.connected, false);
  assert.ok(b.done, "an absent seat plays no week");
  const pos = b.pos;
  fold(room, { b: [walk(room, JOBHUB)] });
  assert.equal(b.pos, pos, "a dropped seat's entries are not read");
  fold(room, { a: [endWeekEntry(room)] });
  assert.equal(
    room.phase,
    BRIEFING,
    "the week ends when everyone here is done",
  );
  assert.ok(
    !b.notices.some((line) => /slept off/.test(line)),
    "no sleep news for someone who is not here",
  );
  fold(room, { a: [ready(room)] });
  assert.equal(room.phase, WEEK, "the briefing waits only for who is here");
  assert.equal(room.week, 2);
});

test("back to the lobby clears the match and keeps the seats; a rematch after the end starts afresh", () => {
  const room = started(FAST, [addBot("bot:1", 2)]);
  fold(room, { a: [walk(room, JOBHUB)] });
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.matchId, "m2");
  assert.deepEqual(room.players, {});
  assert.equal(room.week, 0);
  assert.deepEqual(
    [...room.seats.keys()].sort(),
    ["a", "b", "bot:1"],
    "everyone is still seated",
  );
  const lobby = fuseLaneView(room);
  assert.equal(lobby.phase, "lobby");
  assert.deepEqual(lobby.holders, {});
  assert.equal(lobby.timerTicks, 0);

  fold(room, { a: [[ACTION, "start", "m3"]] });
  assert.equal(room.stage, "running");
  winning(room, "a");
  nextWeek(room);
  assert.equal(room.stage, "over");
  assert.deepEqual(room.winners, ["a"]);
  fold(room, { a: [[ACTION, "rematch", "m4"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m4");
  assert.equal(room.week, 1);
  assert.equal(room.players.a!.cash, 200, "a fresh life");
  assert.deepEqual(room.winners, []);
});

test("a seat's entries are read from the stream generation it follows, also once that stream has been retired", () => {
  const room = started();
  const tick = room.tick + 1;
  const streams = new Map<string, StreamEntries<FuseLaneEntry>>([
    [
      "a",
      {
        generation: 2,
        entries: [[90, tick, WALK, room.week, 3]],
        retired: [
          { generation: 1, entries: [[91, tick, WALK, room.week, JOBHUB]] },
        ],
      },
    ],
    // A stream from a generation the seat does not follow is not read.
    ["b", { generation: 5, entries: [[92, tick, WALK, room.week, JOBHUB]] }],
  ]);
  foldTick(room, "a", streams);
  assert.equal(room.players.a!.dest, JOBHUB);
  assert.equal(room.players.b!.dest, -1);
});

test("hot-seat: a player who drops out on their turn sleeps through it and the next player starts at once", () => {
  const room = started(TURNS, [addBot("bot:1", 2)]);
  runWhile(room, () => room.phase !== HANDOFF, 50);
  const first = room.order[room.turn]!,
    other = first === "a" ? "b" : "a";
  // The creator records the absence (its own, or the other player's).
  fold(room, { a: [[PRESENCE, first, false, 1]] });
  assert.ok(room.players[first]!.done);
  assert.equal(room.order[room.turn], other);
  assert.equal(room.phase, WEEK, "the only one left here needs no handoff");

  // The one left plays: an application from outside the Job Hub, or for no job, does nothing.
  fold(room, { [other]: [act(room, JOBHUB, APPLY, 3)] });
  assert.equal(room.players[other]!.job, -1);
  room.players[other]!.inside = JOBHUB;
  fold(room, { [other]: [act(room, JOBHUB, APPLY, JOBS.length)] });
  assert.equal(room.players[other]!.job, -1);
  fold(room, { [other]: [act(room, JOBHUB, APPLY, 3)] });
  assert.equal(room.players[other]!.job, 3);

  // An application logged after calling it a week, in the same moment, is too late.
  fold(room, { [other]: [endWeekEntry(room), act(room, JOBHUB, APPLY, 0)] });
  assert.equal(room.players[other]!.job, 3);
  assert.equal(room.phase, BRIEFING);
  // On Monday the absent seat's READY is not read, and nobody waits for it.
  fold(room, { [first]: [ready(room)] });
  assert.equal(room.phase, BRIEFING);
  const turns: string[] = [];
  const track = (events: ReturnType<typeof fold>) => {
    for (const event of events) if (event.type === "turn") turns.push(event.id);
  };
  track(fold(room, { [other]: [ready(room)] }));
  assert.equal(room.week, 2);
  assert.equal(room.order[room.turn], other);
  assert.equal(room.phase, WEEK);
  track(fold(room, { [other]: [endWeekEntry(room)] }));
  assert.equal(room.phase, BRIEFING);
  assert.equal(room.week, 3);
  assert.deepEqual(turns, [other], "an absent seat sleeps through its turn");
});

test("an empty hot-seat match just rolls its weeks over", () => {
  const room = createRoom("empty", TURNS);
  const events = foldTick(
    room,
    "a",
    new Map([
      ["a", { generation: 1, entries: [[1, 1, ACTION, "start", "m1"]] }],
    ]),
  );
  assert.equal(room.stage, "running");
  assert.deepEqual(room.order, []);
  // Nobody plays and nobody is waited for on Monday, so each tick is a whole week.
  assert.equal(room.week, 3);
  assert.deepEqual(
    events.map((event) => event.type),
    ["week", "briefing"],
  );
  foldTick(room, "a", new Map());
  assert.equal(room.week, 4);
  assert.equal(room.phase, BRIEFING);
});

test("the boundary refuses control characters in names, settings that are not an object, and hostile ids", () => {
  assert.equal(seatName("Ada\u0007"), undefined);
  assert.equal(seatName("  Ada  "), "Ada");
  for (const raw of [null, "settings", [], 7])
    assert.equal(parseSettings(raw), undefined, JSON.stringify(raw));
  assert.ok(isFuseLaneEntry([1, 1, SPECTATOR, "join", "w1", "Wes", 1]));
  assert.ok(!isFuseLaneEntry([1, 1, SPECTATOR, "join", "__proto__", "Wes", 1]));
  assert.ok(!isFuseLaneEntry([1, 1, BOT, "add", "constructor", "Bot", 1]));
  assert.ok(!isFuseLaneEntry([1, 1, LEAVE, "toString"]));
  assert.ok(isFuseLaneEntry([1, 1, SETTINGS, { ...FAST, level: 0 }]));
  assert.ok(!isFuseLaneEntry([1, 1, ACTION, "start", "a b"]));
  assert.ok(isFuseLaneEntry([1, 1, READY, 1]));
});

test("names and order for players the seats no longer know: the roster, then a stand-in", () => {
  const room = started();
  room.players.zed = createPlayer(defaultGoals());
  room.players.yan = createPlayer(defaultGoals());
  assert.deepEqual(playerOrder(room), ["a", "b", "yan", "zed"]);
  assert.equal(nameOf(room, "zed"), "Someone");
  room.seats.delete("b");
  assert.equal(nameOf(room, "b"), "Bo", "from the roster");
});

test("a match result: bots and players who left are no finishers, and leaving early is recorded", () => {
  const room = started(FAST, [addBot("bot:1", 2)]);
  assert.equal(matchResult(room), undefined, "nothing before the end");
  winning(room, "a");
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  nextWeek(room);
  assert.equal(room.stage, "over");
  const result = matchResult(room)!;
  assert.deepEqual(result.finishers, ["a"]);
  const row = (id: string) =>
    result.players.find((player) => player.playerId === id)!;
  assert.equal(row("a").weeks, 2, "the week a finished in");
  assert.equal(row("b").earlyExits, 1);
  assert.equal(row("bot:1").earlyExits, 0);
  assert.equal(row("b").weeks, room.week, "weeks played");
});

test("the view keeps players who left a finished match, lists watchers, and the seating names bots", () => {
  const room = started(FAST, [addBot("bot:1", 2)]);
  fold(room, {
    a: [
      [SPECTATOR, "join", "w2", "Wes", 1],
      [SPECTATOR, "join", "w1", "Una", 1],
      [SPECTATOR, "join", "w3", "Ivo", 1],
    ],
  });
  winning(room, "a");
  nextWeek(room);
  assert.equal(room.stage, "over");
  fold(room, {
    a: [
      [LEAVE, "b"],
      [BOT, "remove", "bot:1"],
    ],
  });
  assert.ok(!room.seats.has("b") && !room.seats.has("bot:1"));
  const view = fuseLaneView(room);
  const b = view.players.find((player) => player.id === "b")!;
  assert.deepEqual(
    [b.slot, b.avatarId, b.bot, b.present],
    [1, "robot", false, false],
  );
  const bot = view.players.find((player) => player.id === "bot:1")!;
  assert.deepEqual([bot.slot, bot.bot], [2, true]);
  assert.deepEqual(
    view.watchers.map((watcher) => watcher.id),
    ["w1", "w2", "w3"],
  );
  assert.deepEqual(
    [...fuseLaneGame.members(room)].map((seat) => seat.id),
    ["w1", "w2", "w3", "a"],
    "watchers first (slot −1), by id",
  );

  const seating = fuseLaneGame.seating!;
  assert.equal(seating.botId(room, new Set()), "bot:2", "bot:1 still played");
  assert.equal(seating.botId(room, new Set(["bot:2"])), "bot:3");
  assert.equal(seating.botName(0), "Jones");
  assert.equal(seating.botName(5), "Bot 6");
});

test("state helpers: no such course is no degree, no job is no employer, and no goals is no progress", () => {
  const player = createPlayer(defaultGoals());
  assert.equal(hasDegree(player, 99), false);
  assert.equal(employer(player), -1);
  player.goals = [0, 0, 0, 0];
  const room = started();
  assert.equal(progress(player, room.economy), 0);
});
