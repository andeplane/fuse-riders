import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, LEAVE, PRESENCE, SETTINGS } from "fuse-netcode";
import {
  BETWEEN_TICKS,
  BOT_HOLD_AT,
  DEFAULT_SETTINGS,
  HOLD,
  ROLL,
  TARGET,
  botDelay,
  botEntry,
  createRoom,
  fuseDriversGame,
  fuseDriversView,
  matchResult,
  roundResult,
  seatName,
  type FuseDriversRoom,
} from "../src/game/index.js";
import { FAST, addBot, fold, rig, runTo, started } from "./fixtures/fuseDrivers.js";

test("a match starts with the first seat's turn, a timer and zeroed scores", () => {
  const room = started();
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m1");
  assert.equal(room.turn, "a");
  assert.equal(room.turnNo, 1);
  assert.equal(room.deadline, 2 + FAST.turnTicks);
  assert.deepEqual(room.scores, { a: 0, b: 0 });
  const view = fuseDriversView(room);
  assert.equal(view.phase, "running");
  assert.equal(view.currentId, "a");
  assert.equal(view.turn, 1);
  assert.equal(view.timerTicks, FAST.turnTicks);
  assert.equal(view.lastRoll, undefined);
  assert.deepEqual(
    view.players.map((player) => [player.id, player.score, player.roundWins]),
    [
      ["a", 0, 0],
      ["b", 0, 0],
    ],
  );
});

test("a roll adds to the turn total and restarts the timer; a 1 busts, loses the total and passes the turn", () => {
  const room = started();
  rig(room, 4);
  assert.deepEqual(fold(room, { a: [[ROLL, 1]] }), [
    { type: "roll", id: "a", value: 4 },
  ]);
  assert.equal(room.turnTotal, 4);
  assert.equal(room.deadline, 3 + FAST.turnTicks);
  rig(room, 5);
  fold(room, { a: [[ROLL, 1]] });
  assert.equal(room.turnTotal, 9);
  assert.deepEqual(fuseDriversView(room).lastRoll, { id: "a", value: 5, n: 2 });
  rig(room, 1);
  assert.deepEqual(fold(room, { a: [[ROLL, 1]] }), [
    { type: "roll", id: "a", value: 1 },
    { type: "bust", id: "a" },
  ]);
  assert.equal(room.scores.a, 0, "the bust banks nothing");
  assert.equal(room.turn, "b");
  assert.equal(room.turnNo, 2);
  assert.equal(room.turnTotal, 0);
  assert.equal(room.deadline, 5 + FAST.turnTicks);
  assert.deepEqual(room.stats.a, {
    rolls: 3,
    holds: 0,
    busts: 1,
    bestTurn: 0,
  });
});

test("a match keeps each player's rolls, holds, busts and best turn, and reports them with the whole match only", () => {
  const room = started();
  rig(room, 6);
  fold(room, { a: [[ROLL, 1]] });
  rig(room, 5);
  fold(room, { a: [[ROLL, 1]] });
  fold(room, { a: [[HOLD, 1]] });
  rig(room, 3);
  fold(room, { b: [[ROLL, 2]] });
  fold(room, { b: [[HOLD, 2]] });
  assert.deepEqual(room.stats, {
    a: { rolls: 2, holds: 1, busts: 0, bestTurn: 11 },
    b: { rolls: 1, holds: 1, busts: 0, bestTurn: 3 },
  });
  const view = fuseDriversView(room);
  assert.deepEqual(
    view.players.map((p) => [p.id, p.rolls, p.busts, p.bestTurn]),
    [
      ["a", 2, 0, 11],
      ["b", 1, 0, 3],
    ],
  );
  room.scores.a = TARGET - 1;
  rig(room, 4);
  fold(room, { a: [[ROLL, 3]] });
  fold(room, { a: [[HOLD, 3]] });
  assert.equal(room.history[0]!.tick, room.tick, "the round's decision tick");
  const receipt = roundResult(room, 1)!;
  assert.deepEqual(
    receipt.players.map((p) => [p.rolls, p.holds, p.busts, p.bestTurn]),
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    "a round receipt carries no play",
  );
  runTo(room, room.resumeAt);
  room.scores[room.turn] = TARGET;
  const second = room.turn;
  fold(room, { [second]: [[HOLD, room.turnNo]] });
  if (room.stage !== "over") {
    runTo(room, room.resumeAt);
    room.scores[room.turn] = TARGET;
    fold(room, { [room.turn]: [[HOLD, room.turnNo]] });
  }
  const result = matchResult(room)!;
  const a = result.players.find((p) => p.playerId === "a")!;
  assert.equal(a.rolls, 3);
  assert.equal(a.bestTurn, 11);
  // A rematch starts every player's play from nothing.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.deepEqual(room.stats, {});
});

test("entries from a player whose turn it is not, or naming another turn, are ignored", () => {
  const room = started();
  fold(room, { b: [[ROLL, 1]] });
  fold(room, { b: [[HOLD, 1]] });
  fold(room, { a: [[ROLL, 2]] });
  fold(room, { a: [[HOLD, 7]] });
  assert.equal(room.turn, "a");
  assert.equal(room.turnTotal, 0);
  assert.equal(room.rolls, 0);
  const idle = started();
  runTo(idle, room.tick);
  assert.equal(
    fuseDriversGame.hash(room),
    fuseDriversGame.hash(idle),
    "as if nobody pressed",
  );

  // Within one tick, entries after the turn passes are for a turn that is over.
  rig(room, 3);
  const events = fold(room, {
    a: [
      [ROLL, 1],
      [HOLD, 1],
      [ROLL, 1],
    ],
    b: [[ROLL, 2]],
  });
  assert.deepEqual(
    events.map((event) => event.type),
    ["roll", "hold"],
  );
  assert.equal(room.scores.a, 3);
  assert.equal(room.turn, "b");
  assert.equal(room.turnTotal, 0, "b's entry was read before its turn began");
});

test("hold banks the turn total; reaching 50 wins the round, and two round wins take the match", () => {
  const room = started();
  room.scores.a = TARGET - 6;
  rig(room, 6);
  fold(room, { a: [[ROLL, 1]] });
  const won = fold(room, { a: [[HOLD, 1]] });
  assert.deepEqual(won, [
    { type: "hold", id: "a", banked: 6, score: TARGET, auto: false },
    { type: "round", id: "a", round: 1 },
  ]);
  assert.equal(room.stage, "between");
  assert.equal(room.turn, "");
  assert.equal(room.resumeAt, room.tick + BETWEEN_TICKS);
  assert.deepEqual(room.wins, { a: 1 });
  assert.deepEqual(room.played, { a: 1, b: 1 });
  assert.equal(fuseDriversView(room).roundWinnerId, "a");
  assert.equal(fuseDriversView(room).timerTicks, 0);
  assert.equal(fuseDriversView(room).currentId, undefined);
  assert.deepEqual(
    roundResult(room, 1)?.players.map((p) => [
      p.playerId,
      p.matchPlacement,
      p.roundWins,
    ]),
    [
      ["a", 1, 1],
      ["b", 2, 0],
    ],
  );
  assert.equal(roundResult(room, 2), undefined);
  assert.equal(matchResult(room), undefined, "the match is not over");

  // Entries between rounds do nothing; the next round opens by itself, with the other seat first.
  fold(room, { a: [[ROLL, 1]], b: [[ROLL, 2]] });
  assert.equal(room.rolls, 1);
  runTo(room, room.resumeAt - 1);
  assert.equal(room.stage, "between");
  fold(room);
  assert.equal(room.stage, "running");
  assert.equal(room.round, 2);
  assert.equal(room.turn, "b");
  assert.deepEqual(room.scores, { a: 0, b: 0 });
  assert.equal(fuseDriversView(room).roundWinnerId, undefined);

  // b takes round 2, a round 3 and the match.
  room.scores.b = TARGET - 2;
  rig(room, 2);
  fold(room, { b: [[ROLL, room.turnNo]] });
  fold(room, { b: [[HOLD, room.turnNo]] });
  assert.deepEqual(room.wins, { a: 1, b: 1 });
  runTo(room, room.resumeAt);
  assert.equal(room.turn, "a", "round 3 opens with slot 0 again");
  room.scores.a = TARGET - 3;
  rig(room, 3);
  fold(room, { a: [[ROLL, room.turnNo]] });
  const match = fold(room, { a: [[HOLD, room.turnNo]] });
  assert.deepEqual(match.slice(-2), [
    { type: "round", id: "a", round: 3 },
    { type: "match", id: "a" },
  ]);
  assert.equal(room.stage, "over");
  assert.equal(room.winner, "a");
  assert.equal(fuseDriversView(room).winnerId, "a");
  assert.equal(fuseDriversGame.stage(room), "over");
  const result = matchResult(room)!;
  assert.equal(result.matchId, "m1");
  assert.equal(result.length, 3);
  assert.equal(result.winnerId, "a");
  assert.deepEqual(result.finishers, ["a", "b"]);
  assert.deepEqual(
    result.players.map((p) => [
      p.playerId,
      p.name,
      p.slot,
      p.roundsPlayed,
      p.roundWins,
      p.matchScoreUnits,
      p.matchPlacement,
      p.earlyExits,
      p.points,
    ]),
    [
      ["a", "Ada", 0, 3, 2, 2, 1, 0, TARGET + 0 + TARGET],
      ["b", "Bo", 1, 3, 1, 1, 2, 0, 0 + TARGET + 0],
    ],
  );

  // Rematch starts a fresh match; lobby returns to the lobby.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.equal(room.round, 1);
  assert.deepEqual(room.wins, {});
  assert.deepEqual(room.history, []);
  assert.equal(room.turnNo, 1);
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.turn, "");
  assert.equal(fuseDriversView(room).currentId, undefined);
});

test("the turn timer holds for an idle player; a HOLD stamped at the deadline tick comes first", () => {
  const idle = started();
  rig(idle, 3);
  fold(idle, { a: [[ROLL, 1]] });
  const deadline = idle.deadline;
  assert.deepEqual(runTo(idle, deadline - 1), []);
  assert.equal(fuseDriversView(idle).timerTicks, 1);
  assert.deepEqual(fold(idle), [
    { type: "hold", id: "a", banked: 3, score: 3, auto: true },
  ]);
  assert.equal(idle.turn, "b");
  assert.equal(idle.deadline, deadline + FAST.turnTicks);

  const pressed = started();
  rig(pressed, 3);
  fold(pressed, { a: [[ROLL, 1]] });
  runTo(pressed, deadline - 1);
  assert.deepEqual(fold(pressed, { a: [[HOLD, 1]] }), [
    { type: "hold", id: "a", banked: 3, score: 3, auto: false },
  ]);
  assert.equal(pressed.turn, "b");
});

test("an absent player's turn runs out on the timer, and later turns skip them", () => {
  const room = started(FAST, [[JOIN, "c", "Cy", 2, "owl", 1]]);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  fold(room, { a: [[HOLD, 1]] });
  assert.equal(room.turn, "c", "b is absent, so a's hold passes to c");
  fold(room, { c: [[HOLD, 2]] });
  assert.equal(room.turn, "a");
  // b leaving mid-match keeps its seat (seats are held while running) but b never takes a turn.
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(room.seats.get("b")?.connected, false);
  // An absent player whose turn it is: their entries are ignored and the timer passes the turn.
  fold(room, { a: [[PRESENCE, "a", false, 1]] });
  fold(room, { a: [[ROLL, 3]] });
  assert.equal(room.rolls, 0);
  runTo(room, room.deadline);
  assert.equal(room.turn, "c");
  // Nobody here: nobody's turn, until someone returns.
  fold(room, { a: [[PRESENCE, "c", false, 1]] });
  runTo(room, room.deadline);
  assert.equal(room.turn, "");
  assert.equal(fuseDriversView(room).timerTicks, 0);
  fold(room, { a: [[PRESENCE, "a", true, 1]] });
  fold(room);
  assert.equal(room.turn, "a");
});

test("a late joiner plays from the next pass, and a match counts only the seats that played", () => {
  const room = started();
  fold(room, { a: [[JOIN, "c", "Cy", 2, "owl", 1]] });
  fold(room, { a: [[HOLD, 1]] });
  assert.equal(room.turn, "b");
  fold(room, { b: [[HOLD, 2]] });
  assert.equal(room.turn, "c");
  rig(room, 2);
  fold(room, { c: [[ROLL, 3]] });
  fold(room, { c: [[HOLD, 3]] });
  assert.equal(room.scores.c, 2);
  assert.equal(fuseDriversView(room).players.length, 3);
});

test("the bot rolls at a human pace and holds at 20, or when the hold reaches 50", () => {
  const room = createRoom("m0", FAST);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "fox", 1], addBot("bot:1", 1)] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.seats.get("bot:1")?.bot, true);
  fold(room, { a: [[HOLD, 1]] });
  assert.equal(room.turn, "bot:1");
  const acts = room.nextAct;
  assert.equal(acts, room.tick + botDelay(room));
  assert.ok(acts - room.tick >= 12 && acts - room.tick <= 20);
  assert.deepEqual(runTo(room, acts - 1), [], "it waits like a person");
  rig(room, 5);
  assert.deepEqual(fold(room), [{ type: "roll", id: "bot:1", value: 5 }]);
  assert.ok(room.nextAct > room.tick + 11);

  const decide = (total: number, score: number) => {
    const probe = structuredClone(room);
    probe.turnTotal = total;
    probe.scores["bot:1"] = score;
    return botEntry(probe, probe.nextAct)?.[0];
  };
  assert.equal(decide(0, 0), ROLL);
  assert.equal(decide(BOT_HOLD_AT - 1, 0), ROLL);
  assert.equal(decide(BOT_HOLD_AT, 0), HOLD);
  assert.equal(decide(5, TARGET - 5), HOLD, "a hold that reaches the target");
  assert.equal(decide(5, TARGET - 6), ROLL);
  assert.equal(
    botEntry(room, room.nextAct)?.[1],
    room.turnNo,
    "it names its turn",
  );
  assert.equal(botEntry(room, room.nextAct - 1), undefined);
  const over = structuredClone(room);
  over.stage = "over";
  assert.equal(botEntry(over, over.nextAct), undefined);
});

test("two bots play a whole match to a winner, the same way every time", () => {
  const play = () => {
    const room = createRoom("m0", DEFAULT_SETTINGS);
    fold(room, { a: [addBot("bot:1", 0), addBot("bot:2", 1)] });
    fold(room, { a: [[ACTION, "start", "bots"]] });
    while (room.stage !== "over" && room.tick < 50_000) fold(room);
    return room;
  };
  const room = play();
  assert.equal(room.stage, "over");
  assert.ok(room.winner.startsWith("bot:"));
  assert.ok(room.history.length >= 2 && room.history.length <= 3);
  assert.ok(
    room.history.every((record) => record.scores[record.winnerId]! >= TARGET),
  );
  assert.equal(fuseDriversGame.hash(play()), fuseDriversGame.hash(room));
  const result = matchResult(room)!;
  assert.deepEqual(result.finishers, [], "bots never report");
});

test("settings, bot ids and names go through the shared management entries and helpers", () => {
  const room = started();
  fold(room, { a: [[SETTINGS, { turnTicks: 100, display: true }]] });
  assert.deepEqual(fuseDriversGame.settings(room), { turnTicks: 100, display: true });
  assert.equal(fuseDriversGame.seating.sharedScreen(room.settings), true);
  assert.deepEqual(fuseDriversGame.seating.soloSettings(room.settings), {
    turnTicks: 100,
    display: false,
  });
  // A settings entry from someone who is not managing the room does nothing.
  fold(room, { b: [[SETTINGS, { turnTicks: 200, display: false }]] });
  assert.equal(room.settings.turnTicks, 100);
  // A new bot never takes the id of one the match remembers.
  room.roster["bot:1"] = { name: "Bot 3", slot: 2 };
  assert.equal(fuseDriversGame.seating.botId(room, new Set()), "bot:2");
  assert.equal(fuseDriversGame.seating.botId(room, new Set(["bot:2"])), "bot:3");
  assert.equal(fuseDriversGame.seating.botName(2), "Bot 3");
  assert.equal(seatName("  Ada  "), "Ada");
  assert.equal(seatName("x".repeat(30)), "x".repeat(18));
  assert.equal(seatName("   "), undefined);
  assert.equal(seatName("ab"), undefined);
  assert.equal(fuseDriversGame.seat(room, "a")?.name, "Ada");
  assert.equal([...fuseDriversGame.members(room)].length, 2);
  assert.deepEqual(fuseDriversGame.scope(room), { matchId: "m1", round: 1 });
});

test("a player who leaves before the end is an early exit in the match result", () => {
  const room = started(FAST, [[JOIN, "c", "Cy", 2, "owl", 1]]);
  fold(room, { a: [[LEAVE, "c"]] });
  room.scores.a = TARGET;
  fold(room, { a: [[HOLD, 1]] });
  runTo(room, room.resumeAt);
  room.scores.b = TARGET;
  fold(room, { b: [[HOLD, room.turnNo]] });
  runTo(room, room.resumeAt);
  room.scores[room.turn] = TARGET;
  const third = room.turn;
  fold(room, { [third]: [[HOLD, room.turnNo]] });
  const result = matchResult(room)!;
  assert.equal(result.winnerId, third);
  const c = result.players.find((player) => player.playerId === "c")!;
  assert.equal(c.earlyExits, 1);
  assert.equal(c.roundsPlayed, 0);
  assert.deepEqual(result.finishers, ["a", "b"]);
});

test("a new room's view is an empty lobby", () => {
  const room: FuseDriversRoom = createRoom("m0", DEFAULT_SETTINGS);
  const view = fuseDriversView(room);
  assert.equal(view.phase, "lobby");
  assert.deepEqual(view.players, []);
  assert.equal(view.turnTicks, DEFAULT_SETTINGS.turnTicks);
});
