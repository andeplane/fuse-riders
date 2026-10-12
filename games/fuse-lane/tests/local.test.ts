import test from "node:test";
import assert from "node:assert/strict";
import {
  ACT,
  APPLY,
  END_WEEK,
  HANDOFF,
  JOBHUB,
  READY,
  WALK,
  WEEK,
  WEEK_UNITS,
  BRIEFING,
  hashRoom,
  progress,
  type Goals,
} from "../src/game/index.js";
import { LocalMatch, validSetup, type LocalSetup } from "../src/app/local.js";

const GOALS: Goals = [50, 50, 50, 50];
const setup = (humans: number, bots: number, level = 2): LocalSetup => ({
  humans: ["Ada", "Bo", "Cy", "Di"].slice(0, humans).map((name, index) => ({
    name,
    avatar: ["fox", "cat", "owl", "robot"][index]!,
  })),
  bots,
  level,
  goals: GOALS,
  weekSeconds: 45,
  seed: "local-1",
});
function runWhile(match: LocalMatch, going: () => boolean, most = 5000): void {
  for (let n = 0; n < most && going(); n++) match.step();
}
/** The tap that moves the device on: a handoff's READY names its turn, Monday's does not. */
const tap = (match: LocalMatch): boolean =>
  match.play(
    match.room.phase === HANDOFF
      ? [READY, match.room.week, match.room.turn]
      : [READY, match.room.week],
  );
/** The current player walks into `place` and the device folds until they are inside. */
function enter(match: LocalMatch, place: number): void {
  const id = match.current();
  match.play([WALK, match.room.week, place]);
  runWhile(
    match,
    () => match.room.players[id]!.inside !== place && match.current() === id,
    500,
  );
}

test("the menu's setup is checked: seats, names, goals, week length", () => {
  assert.ok(validSetup(setup(1, 3)));
  assert.ok(validSetup(setup(4, 1)));
  assert.ok(!validSetup(setup(4, 2)), "six seats");
  assert.ok(
    !validSetup({
      ...setup(2, 0),
      humans: [
        { name: "Ada", avatar: "fox" },
        { name: "Ada", avatar: "cat" },
      ],
    }),
  );
  assert.ok(!validSetup({ ...setup(1, 1), goals: [55, 50, 50, 50] }));
  assert.ok(!validSetup({ ...setup(1, 1), weekSeconds: 30 }));
  assert.ok(!validSetup({ ...setup(1, 1), level: 3 }));
});

test("solo: bots ahead of you play their week at once, and your week starts without a handoff", () => {
  const match = LocalMatch.create(setup(1, 3));
  const room = match.room;
  assert.equal(room.stage, "running");
  assert.equal(room.phase, WEEK);
  assert.equal(match.current(), "p1");
  const index = room.order.indexOf("p1");
  for (const id of room.order.slice(0, index)) {
    assert.ok(room.players[id]!.done, `${id} has played`);
    assert.ok(room.players[id]!.time > 0, `${id} used hours`);
  }
  for (const id of room.order.slice(index + 1))
    assert.equal(room.players[id]!.time, 0, `${id} waits for its turn`);
  // Calling it a week lets the remaining bots play, and Monday comes.
  match.play([END_WEEK, room.week]);
  match.step();
  assert.equal(room.phase, BRIEFING);
  assert.equal(room.week, 2);
  match.play([READY, 2]);
  match.step();
  assert.equal(room.phase === WEEK || room.phase === BRIEFING, true);
  assert.equal(room.week, 2);
});

test("hot-seat: each human waits on a handoff, plays alone, and the turn passes on", () => {
  const match = LocalMatch.create(setup(2, 1));
  const room = match.room;
  runWhile(match, () => room.phase !== HANDOFF, 10);
  assert.equal(room.phase, HANDOFF);
  const first = match.current();
  assert.ok(first === "p1" || first === "p2");
  const second = first === "p1" ? "p2" : "p1";
  // The handoff waits for the person, however long they take: no clock runs.
  runWhile(match, () => true, 200);
  assert.equal(room.phase, HANDOFF);
  assert.equal(room.players[first]!.time, 0);
  tap(match);
  match.step();
  assert.equal(room.phase, WEEK);
  // Only the current player's entries count: a walk logged on the other seat's stream is ignored by the rules.
  const other = room.players[second]!;
  const before = other.pos;
  enter(match, JOBHUB);
  assert.equal(room.players[first]!.inside, JOBHUB);
  assert.equal(other.pos, before);
  assert.equal(other.time, 0);
  match.play([END_WEEK, room.week]);
  runWhile(match, () => match.current() === first, 5);
  assert.ok(room.players[first]!.done);
  // The bot may sit between them; either way the next human gets a handoff of their own.
  assert.equal(match.current(), second);
  assert.equal(room.phase, HANDOFF);
});

test("a turn whose clock runs out ends there: the unspent hours are sleep", () => {
  const match = LocalMatch.create(setup(2, 0));
  const room = match.room;
  const first = match.current();
  tap(match);
  match.step();
  const start = room.tick;
  runWhile(match, () => match.current() === first, 2000);
  assert.equal(room.tick - start, room.weekTicks, "the turn lasted its clock");
  const player = room.players[first]!;
  assert.ok(player.done);
  assert.ok(player.time < WEEK_UNITS);
  assert.equal(room.phase, HANDOFF);
});

test("the first seat rotates each week, and contention resolves in play order", () => {
  const match = LocalMatch.create(setup(2, 0));
  const room = match.room;
  const week1 = [...room.order];
  // Both apply for the Line Cook post (a sure hire): whoever plays first this week gets it.
  for (let turn = 0; turn < 2; turn++) {
    tap(match);
    match.step();
    enter(match, JOBHUB);
    match.play([ACT, room.week, JOBHUB, APPLY, 3, 0]);
    match.step();
    match.play([END_WEEK, room.week]);
    match.step();
  }
  assert.equal(room.players[week1[0]!]!.job, 3);
  assert.notEqual(room.players[week1[1]!]!.job, 3);
  assert.match(room.players[week1[1]!]!.msg, /holds that job/);
  assert.equal(room.phase, BRIEFING);
  match.play([READY, room.week]);
  match.step();
  assert.deepEqual(room.order, [week1[1], week1[0]]);
});

test("a saved hot-seat match resumes exactly where it was", () => {
  const match = LocalMatch.create(setup(2, 2));
  tap(match);
  runWhile(match, () => true, 60);
  const saved = JSON.parse(JSON.stringify(match.save()));
  const resumed = LocalMatch.resume(saved)!;
  assert.ok(resumed);
  assert.equal(hashRoom(resumed.room), hashRoom(match.room));
  for (const copy of [match, resumed]) {
    copy.play([WALK, copy.room.week, JOBHUB]);
    runWhile(copy, () => true, 300);
  }
  assert.equal(hashRoom(resumed.room), hashRoom(match.room));
  assert.equal(LocalMatch.resume({ ...saved, v: 2 }), undefined);
  assert.equal(LocalMatch.resume({ ...saved, humans: ["bot:1"] }), undefined);
  assert.equal(
    LocalMatch.resume({ ...saved, humans: ["p1"] }),
    undefined,
    "p2 is seated but nobody on this device plays it",
  );
  assert.equal(
    LocalMatch.resume({ ...saved, humans: ["p1", "p1"] }),
    undefined,
  );
  assert.equal(LocalMatch.resume(null), undefined);
});

test("bot levels: harder bots get further toward their goals in the same weeks", () => {
  // Summed over a few seeds: one match's town events and luck can let a normal bot edge out a hard one.
  const worth = (level: number) =>
    ["levels", "levels-2", "levels-3"].reduce(
      (sum, seed) => sum + progressAfter(level, seed),
      0,
    );
  const progressAfter = (level: number, seed: string) => {
    const match = LocalMatch.create({ ...setup(1, 3, level), seed });
    const room = match.room;
    for (let week = 0; week < 12; week++) {
      runWhile(
        match,
        () => room.phase !== WEEK || match.current() !== "p1",
        50,
      );
      match.play([END_WEEK, room.week]);
      match.step();
      match.play([READY, room.week]);
      match.step();
    }
    return ["bot:1", "bot:2", "bot:3"].reduce(
      (sum, id) => sum + progress(room.players[id]!, room.economy),
      0,
    );
  };
  const easy = worth(0),
    normal = worth(1),
    hard = worth(2);
  assert.ok(hard > normal && normal > easy, `${easy} < ${normal} < ${hard}`);
});

test("a doubled tap never skips a handoff: a stale READY cannot start the next player's clock", () => {
  const match = LocalMatch.create(setup(2, 0));
  const room = match.room;
  // Week 1 played out by both, then Monday's READY tapped twice: the second tap lands on the first handoff.
  for (let turn = 0; turn < 2; turn++) {
    tap(match);
    match.step();
    match.play([END_WEEK, room.week]);
    match.step();
  }
  assert.equal(room.phase, BRIEFING);
  match.play([READY, room.week]);
  match.step();
  assert.equal(room.phase, HANDOFF);
  const first = match.current(),
    monday = room.players[first]!.time;
  match.play([READY, room.week]);
  runWhile(match, () => true, 20);
  assert.equal(room.phase, HANDOFF, "Monday's READY does not start a turn");
  assert.equal(room.players[first]!.time, monday);
  // The handoff tap, then a second one: it names the turn it was for, which is over by the time it lands.
  const stale = [READY, room.week, room.turn];
  match.play(stale);
  match.step();
  assert.equal(room.phase, WEEK);
  match.play([END_WEEK, room.week]);
  match.step();
  assert.equal(room.phase, HANDOFF);
  const second = match.current(),
    waiting = room.players[second]!.time;
  assert.notEqual(second, first);
  match.play(stale);
  runWhile(match, () => true, 20);
  assert.equal(room.phase, HANDOFF, "the stale tap is ignored");
  assert.equal(room.players[second]!.time, waiting);
  tap(match);
  match.step();
  assert.equal(room.phase, WEEK);
  assert.equal(match.current(), second);
});

test("the device waits on a person only at a handoff; on Monday only READY is taken, and nothing once it is over", () => {
  const match = LocalMatch.create(setup(2, 0));
  const room = match.room;
  assert.equal(room.phase, HANDOFF);
  assert.equal(match.waiting(), true, "a handoff waits for the next player");
  for (let turn = 0; turn < 2; turn++) {
    tap(match);
    match.step();
    assert.equal(match.waiting(), false, "a turn runs on the clock");
    match.play([END_WEEK, room.week]);
    match.step();
  }
  assert.equal(room.phase, BRIEFING);
  assert.equal(match.waiting(), false, "Monday runs on the clock");
  assert.equal(
    match.play([WALK, room.week, JOBHUB]),
    false,
    "no walks on Monday",
  );
  assert.equal(match.play([READY, room.week]), true);
  room.stage = "over";
  assert.equal(match.waiting(), false);
  assert.equal(match.play([READY, room.week]), false, "nothing after the end");
});
