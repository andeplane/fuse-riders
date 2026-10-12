import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT } from "fuse-netcode";
import {
  APPLY,
  BRIEFING,
  BRIEFING_TICKS,
  BUY,
  CLASS,
  END_WEEK,
  ENROLL,
  GOALS,
  JOBHUB,
  JOBS,
  KEYNEST,
  MAX_NET_WORTH,
  MONO,
  COLLEGE,
  PAY_RENT,
  PLACES,
  READY,
  RELAX,
  ROOMSHARE,
  UNITS_PER_HOUR,
  WEEK,
  WEEK_UNITS,
  WORK,
  createRoom,
  decodeRoom,
  encodeRoom,
  hashRoom,
  isFuseLaneEntry,
  marketWage,
  matchResult,
  stats,
} from "../src/game/index.js";
import {
  FAST,
  act,
  addBot,
  endWeekEntry,
  enter,
  fold,
  nextWeek,
  ready,
  runWhile,
  started,
  walk,
} from "./fixtures/lane.js";
import { parseFuseLaneStats } from "../src/platform.js";

const COOK = JOBS.findIndex((job) => job.sure === true);
const BURGER = 3;

test("a match starts everyone at home in week 1 with the original's starting kit", () => {
  const room = started();
  assert.equal(room.stage, "running");
  assert.equal(room.week, 1);
  assert.equal(room.phase, WEEK);
  for (const id of ["a", "b"]) {
    const player = room.players[id]!;
    assert.equal(player.pos, PLACES[ROOMSHARE]!.ring);
    assert.equal(player.cash, 200);
    assert.deepEqual(player.clothes, [6, 0, 0]);
    assert.equal(player.rentWeeks, 3);
    assert.equal(player.dep, 20);
    assert.deepEqual(player.goals, [50, 50, 50, 50]);
  }
  assert.equal(room.phaseEnd - room.phaseStart, FAST.weekSeconds * 20);
});

test("walking costs one hour per 15 steps and entering costs 2 hours; avatars move 2 steps a tick the short way", () => {
  const room = started();
  fold(room, { a: [walk(room, KEYNEST)] });
  const a = room.players.a!;
  // Roomshare (ring 1) to KeyNest (ring 164) is 7 steps backwards round the loop.
  assert.equal(a.pos, 169);
  assert.equal(a.dest, KEYNEST);
  runWhile(room, () => a.inside !== KEYNEST, 20);
  assert.equal(a.pos, 164);
  assert.equal(a.time, 7 + 2 * UNITS_PER_HOUR);
  assert.equal(room.tick, 6, "4 ticks of walking after the start");
  // Walking to the place you stand at enters it at once, for the entry fee only.
  fold(room, { a: [walk(room, ROOMSHARE)] });
  const before = a.time;
  enter(room, "a", KEYNEST);
  assert.ok(a.time > before + 2 * UNITS_PER_HOUR);
});

test("the clock stops a walk at 60 hours, and that player's week is over", () => {
  const room = started();
  const a = room.players.a!;
  a.time = WEEK_UNITS - 5;
  fold(room, {
    a: [
      walk(
        room,
        PLACES.findIndex((place) => place.id === "college"),
      ),
    ],
  });
  runWhile(room, () => !a.done, 50);
  assert.equal(a.time, WEEK_UNITS);
  assert.equal(a.inside, -1);
  assert.ok(a.done);
  // A finished player's entries do nothing.
  const pos = a.pos;
  fold(room, { a: [walk(room, KEYNEST)] });
  fold(room);
  assert.equal(a.pos, pos);
});

test("hiring: the Line Cook is a sure thing, a shift costs 6 hours and pays 8 at the locked wage", () => {
  const room = started();
  enter(room, "a", JOBHUB);
  fold(room, { a: [act(room, JOBHUB, APPLY, COOK)] });
  const a = room.players.a!;
  assert.equal(a.job, COOK);
  assert.equal(a.wage, marketWage(room.economy, JOBS[COOK]!));
  assert.equal(a.happiness, 3);
  assert.equal(a.exp, 12, "experience +2 on hiring");
  enter(room, "a", MONO);
  const time = a.time,
    cash = a.cash;
  fold(room, { a: [act(room, MONO, WORK)] });
  assert.equal(a.time, time + 6 * UNITS_PER_HOUR);
  assert.equal(a.cash, cash + Math.round(a.wage * 8));
  assert.equal(a.dep, 21);
  assert.equal(stats(a, room.economy)[3], 20, "career = 10 × ⌊21 / 8⌋");
});

test("a short last shift is prorated, and garnishment takes half of what it actually paid (the original's bug fixed)", () => {
  const room = started();
  enter(room, "a", JOBHUB);
  fold(room, { a: [act(room, JOBHUB, APPLY, COOK)] });
  enter(room, "a", MONO);
  const a = room.players.a!;
  a.rentOwed = 100;
  a.time = WEEK_UNITS - 3 * UNITS_PER_HOUR;
  const cash = a.cash,
    full = Math.round(a.wage * 8),
    paid = Math.floor((full * 3) / 6);
  fold(room, { a: [act(room, MONO, WORK)] });
  assert.equal(a.cash, cash + paid - Math.floor(paid / 2));
  assert.equal(a.rentOwed, 100 - Math.floor(paid / 2));
  assert.equal(a.rentExt, -1, "no more extensions after a garnishment");
  assert.equal(a.time, WEEK_UNITS);
});

test("one player per position: two applications in the same tick go to the stronger candidate, a tie to the lower slot", () => {
  const room = started();
  enter(room, "a", JOBHUB);
  enter(room, "b", JOBHUB);
  room.players.b!.dep = 30;
  fold(room, {
    a: [act(room, JOBHUB, APPLY, COOK)],
    b: [act(room, JOBHUB, APPLY, COOK)],
  });
  assert.equal(room.players.b!.job, COOK, "b is the stronger candidate");
  assert.equal(room.players.a!.job, -1);
  assert.match(room.players.a!.msg, /Bo holds that job/);
  assert.equal(
    room.players.a!.time,
    room.players.b!.time,
    "both paid the 4 hours",
  );

  const tie = started();
  enter(tie, "a", JOBHUB);
  enter(tie, "b", JOBHUB);
  fold(tie, {
    b: [act(tie, JOBHUB, APPLY, COOK)],
    a: [act(tie, JOBHUB, APPLY, COOK)],
  });
  assert.equal(
    tie.players.a!.job,
    COOK,
    "equal candidates: the lower slot wins",
  );
  assert.equal(tie.players.b!.job, -1);
});

test("study: enroll pays the fee, each class costs 6 hours, and a degree lifts education, dependability and the caps", () => {
  const room = started();
  enter(room, "a", COLLEGE);
  const a = room.players.a!;
  a.cash = 1000;
  fold(room, { a: [act(room, COLLEGE, ENROLL, 0)] });
  assert.equal(a.courses[0], 0);
  assert.equal(a.cash, 950);
  for (let lesson = 0; lesson < 6; lesson++)
    fold(room, { a: [act(room, COLLEGE, CLASS, 0)] });
  assert.equal(a.courses[0], 6);
  a.courses[0] = 9;
  a.time = 0;
  fold(room, { a: [act(room, COLLEGE, CLASS, 0)] });
  assert.equal(a.courses[0], 10);
  assert.equal(stats(a, room.economy)[2], 10, "education = 1 + 9 × 1");
  assert.equal(a.dep, 25);
  assert.equal(a.eduCredit, 5);
  // A course needs its prerequisite: Engineering needs Pre-Engineering.
  fold(room, { a: [act(room, COLLEGE, ENROLL, 3)] });
  assert.equal(a.courses[3], -1);
  assert.match(a.msg, /needs Pre-Engineering/);
});

test("Monday upkeep: hunger costs 20 hours, fast food feeds one week, clothes and rent count down, dependability decays", () => {
  const room = started();
  enter(room, "b", MONO);
  fold(room, { b: [act(room, MONO, BUY, BURGER)] });
  nextWeek(room);
  const a = room.players.a!,
    b = room.players.b!;
  assert.equal(room.week, 2);
  assert.ok(
    a.time === 20 * UNITS_PER_HOUR || a.time === 30 * UNITS_PER_HOUR,
    "a went hungry (and may have seen the doctor)",
  );
  assert.ok(a.notices.some((line) => /hungry/.test(line)));
  assert.ok(
    b.time <= 10 * UNITS_PER_HOUR,
    "b ate (and at most saw the doctor)",
  );
  assert.equal(b.meal, 0, "the burger is eaten");
  for (const player of [a, b]) {
    assert.equal(player.dep, 17);
    assert.equal(player.clothes[0], 5);
    assert.equal(player.rentWeeks, 2);
    assert.equal(player.pos, PLACES[ROOMSHARE]!.ring);
  }
});

test("groceries spoil without a fridge; with one they keep up to 6 weeks", () => {
  const room = started();
  const a = room.players.a!,
    b = room.players.b!;
  a.groceries = 4;
  b.groceries = 9;
  b.durables.fridge = { n: 1, paid: 876, cheap: false };
  nextWeek(room);
  assert.equal(a.groceries, 0);
  assert.ok(a.notices.some((line) => /spoiled/.test(line)));
  assert.equal(b.groceries, 5, "cut to 6, then a week eaten");
});

test("unpaid rent on rent day becomes arrears; paying gives the rest of the 4-week period", () => {
  const room = started();
  for (let week = 1; week < 4; week++) nextWeek(room);
  assert.equal(room.week, 4);
  const a = room.players.a!,
    b = room.players.b!;
  assert.equal(a.rentWeeks, 0);
  assert.ok(a.notices.some((line) => /Rent day/.test(line)));
  b.cash = 1000;
  enter(room, "b", KEYNEST);
  fold(room, { b: [act(room, KEYNEST, PAY_RENT)] });
  assert.equal(b.rentWeeks, 4);
  assert.equal(b.cash, 1000 - b.rent);
  nextWeek(room);
  assert.equal(a.rentOwed, a.rent);
  assert.equal(b.rentOwed, 0);
  assert.equal(b.rentWeeks, 3);
});

test("unspent hours are sleep: each 6 is one relax press, with the relax happiness once", () => {
  const room = started();
  enter(room, "b", ROOMSHARE);
  fold(room, { b: [act(room, ROOMSHARE, RELAX)] });
  assert.equal(room.players.b!.relax, 28);
  nextWeek(room);
  // a slept the whole week (10 presses, capped at 50); b had relaxed and slept 8 presses, also to the cap.
  assert.equal(room.players.a!.happiness >= 0, true);
  assert.equal(room.players.a!.relax, 49, "50 after sleep, −1 Monday decay");
  assert.equal(room.players.b!.relax, 49);
});

test("the week ends when the timer runs out, and the briefing waits for READY or its own timer", () => {
  const room = started();
  const end = room.phaseEnd;
  runWhile(room, () => room.phase === WEEK, 2000);
  assert.equal(room.tick, end);
  assert.equal(room.phase, BRIEFING);
  assert.equal(room.week, 2);
  // One READY is not enough; the briefing then continues by itself.
  fold(room, { a: [ready(room)] });
  assert.equal(room.phase, BRIEFING);
  const briefing = room.phaseStart;
  runWhile(room, () => room.phase === BRIEFING, 1000);
  assert.equal(room.tick, briefing + BRIEFING_TICKS);
  assert.equal(room.phase, WEEK);
  // Stale entries for last week change nothing.
  fold(room, { a: [[2, 1]] });
  assert.equal(room.players.a!.done, false);
});

test("calling it a week ends a player's week; when everyone is done the week ends early", () => {
  const room = started();
  fold(room, { a: [endWeekEntry(room)] });
  assert.ok(room.players.a!.done);
  assert.equal(room.phase, WEEK);
  fold(room, { b: [endWeekEntry(room)] });
  assert.equal(room.phase, BRIEFING);
});

function winner(
  room: ReturnType<typeof started>,
  id: string,
  extraCash: number,
): void {
  const player = room.players[id]!;
  player.goals = [10, 10, 10, 10];
  player.cash = 1000 + extraCash;
  player.happiness = 20;
  player.courses[0] = 10;
  player.job = 0;
  player.wage = 4;
  player.dep = 30;
}

test("the goal check runs on Monday; of same-week finishers the top of the ranking wins, exact ties share", () => {
  const room = started();
  winner(room, "a", 0);
  winner(room, "b", 500);
  nextWeek(room);
  assert.equal(room.stage, "over");
  assert.deepEqual(room.ranking, ["b", "a"], "b overshoots wealth by 5 more");
  assert.deepEqual(room.winners, ["b"], "and only the top wins");
  assert.equal(room.players.a!.finished, 2);
  const result = matchResult(room)!;
  assert.equal(result.winnerId, "b");
  assert.deepEqual(
    result.players.map((row) => [row.playerId, row.roundWins]),
    [
      ["a", 0],
      ["b", 1],
    ],
  );

  const even = started();
  winner(even, "a", 0);
  winner(even, "b", 0);
  even.players.a!.durables.tv = { n: 1, paid: 525, cheap: false };
  nextWeek(even);
  assert.deepEqual(even.ranking, ["a", "b"]);
  assert.deepEqual(
    even.winners,
    ["a"],
    "equal overshoot: a's TV makes a richer, and the winner",
  );

  const tie = started();
  winner(tie, "a", 0);
  winner(tie, "b", 0);
  tie.players.b!.job = 1; // one player per position, as a checkpoint insists
  nextWeek(tie);
  assert.deepEqual(tie.winners, ["a", "b"], "an exact tie shares the win");
  assert.ok(decodeRoom(encodeRoom(tie), tie.tick), "and checkpoints");

  const nobody = started();
  winner(nobody, "a", 0);
  nobody.players.a!.goals = [10, 10, 10, 100];
  nextWeek(nobody);
  assert.equal(nobody.stage, "running");
});

test("goals are picked in the lobby and carried into the match; bots play the first human's goals", () => {
  const room = createRoom("m0", FAST);
  fold(room, { a: [[10, "a", "Ada", 0, "fox", 1], addBot("bot:1", 1)] });
  assert.ok(isFuseLaneEntry([1, 1, GOALS, 0, 80, 20, 30, 100]));
  assert.ok(!isFuseLaneEntry([1, 1, GOALS, 0, 85, 20, 30, 100]));
  // READY: Monday's has four fields, a handoff's names the turn it starts.
  assert.ok(isFuseLaneEntry([1, 1, READY, 2]));
  assert.ok(isFuseLaneEntry([1, 1, READY, 2, 3]));
  assert.ok(!isFuseLaneEntry([1, 1, READY, 2, -1]));
  assert.ok(!isFuseLaneEntry([1, 1, READY, 2, 1, 1]));
  assert.ok(!isFuseLaneEntry([1, 1, END_WEEK, 2, 1]));
  fold(room, { a: [[GOALS, 0, 80, 20, 30, 100]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.deepEqual(room.players.a!.goals, [80, 20, 30, 100]);
  assert.deepEqual(room.players["bot:1"]!.goals, [80, 20, 30, 100]);
});

test("bots play whole weeks on their own, identically on every replica", () => {
  const play = () => {
    const room = createRoom("m0", FAST);
    fold(room, {
      a: [
        addBot("bot:1", 0),
        addBot("bot:2", 1),
        [BOT, "add", "bot:3", "Bot 3", 2],
      ],
    });
    fold(room, { a: [[ACTION, "start", "bots"]] });
    runWhile(room, () => room.week < 6, 20_000);
    return room;
  };
  const one = play(),
    two = play();
  assert.equal(one.week, 6);
  assert.equal(hashRoom(one), hashRoom(two));
  const bot = one.players["bot:1"]!;
  assert.ok(bot.job >= 0, "a bot finds a job");
  assert.ok(bot.shifts > 0, "and works");
});

test("a match result clamps net worth to what the history boundary accepts", () => {
  const room = started();
  winner(room, "a", 0);
  room.players.a!.bank = 5_000_000_000;
  nextWeek(room);
  const row = matchResult(room)!.players.find((p) => p.playerId === "a")!;
  assert.equal(row.netWorth, MAX_NET_WORTH);
  assert.ok(parseFuseLaneStats({ ...row, playerId: "a".repeat(24) }, 1));
});
