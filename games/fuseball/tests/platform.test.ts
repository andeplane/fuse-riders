import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, LEAVE, type StreamEntries } from "fuse-netcode";
import {
  Platform,
  attestationsNeeded,
  parseMatchResult,
  type AccountRules,
} from "fuse-platform";
import {
  COUNTDOWN_STEPS,
  STEPS_PER_TICK,
  TARGET,
  GOAL_TICKS,
  mapOf,
  type Slot,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import { MOST_BUBBLES, validName } from "../src/basics.js";
import {
  DEFAULT_SETTINGS,
  createRoom,
  foldTick,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { matchResult, roundResult } from "../src/online/result.js";
import { dueReports } from "../src/app/reports.js";
import {
  emptyFuseballTotals,
  fuseballRegistration,
  parseFuseballStats,
  validFuseballField,
  type FuseballStats,
} from "../src/platform.js";

/** The account rules a service would pass: Fuseball's own name rule, and any avatar. */
const account: AccountRules = {
  validName,
  validAvatar: (value): value is string => typeof value === "string",
  nameRule: "1 to 18 characters",
  fallbackName: "Rider",
};
const A = "a".repeat(24),
  B = "b".repeat(24);

let seq = 0;
function fold(room: Room, bodies: readonly unknown[][] = []): void {
  const tick = room.tick + 1;
  foldTick(
    room,
    A,
    new Map<string, StreamEntries<Entry>>([
      [
        A,
        {
          generation: 1,
          entries: bodies.map((body) => [++seq, tick, ...body] as Entry),
        },
      ],
    ]),
  );
}
const run = (room: Room, ticks: number) => {
  for (let i = 0; i < ticks; i++) fold(room);
};
/** A match in play between `A` (slot 0) and `B` or a bot (slot 1). */
function playing(bot = false): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, [
    [JOIN, A, "Ada", 0, "robot", 1],
    bot ? [BOT, "add", "bot:1", "Volta", 1] : [JOIN, B, "Bo", 1, "cat", 1],
  ]);
  fold(room, [[ACTION, "start", "match-1"]]);
  run(room, COUNTDOWN_STEPS / STEPS_PER_TICK);
  return room;
}
/** One point for `team`, with `toucher` the last to send the ball: the other side's touch makes it an own goal. */
function point(room: Room, team: Slot, toucher: Slot = team): void {
  const world = room.world!;
  const goal = mapOf(world.mapId).goals.find((each) => each.team === team)!;
  const [x, y] =
    "r" in goal ? [goal.x, goal.y] : [goal.x + goal.w / 2, goal.y + goal.h / 2];
  Object.assign(world.ball, {
    x: x * SUB,
    y: y * SUB,
    vx: 0,
    vy: 0,
    touch: toucher,
  });
  fold(room);
  run(room, GOAL_TICKS);
  if (room.stage === "running") run(room, COUNTDOWN_STEPS / STEPS_PER_TICK);
}
/** A 3–1 win for `A`: two goals and one own goal by `B` against one goal. */
function finished(bot = false): Room {
  const room = playing(bot);
  point(room, 0);
  point(room, 1);
  point(room, 0, 1);
  point(room, 0);
  assert.equal(room.stage, "over");
  return room;
}
const winner: FuseballStats = {
  playerId: A,
  name: "Ada",
  slot: 0,
  roundsPlayed: 1,
  roundWins: 1,
  matchScoreUnits: 3,
  matchPlacement: 1,
  earlyExits: 0,
  goals: 2,
  ownGoals: 0,
  bubbles: 0,
  pops: 0,
};
const loser: FuseballStats = {
  ...winner,
  playerId: B,
  name: "Bo",
  slot: 1,
  roundWins: 0,
  matchScoreUnits: 1,
  matchPlacement: 2,
  goals: 1,
  ownGoals: 1,
};

test("a finished match reports goals, own goals, bubbles and pops, and the platform accepts it", () => {
  const room = finished();
  room.world!.bubbles[1].seq = 7;
  room.world!.riders[0].pops = 2;
  const result = matchResult(room)!;
  assert.deepEqual(result, {
    matchId: "match-1",
    length: 1,
    winnerId: A,
    finishers: [A, B],
    players: [
      { ...winner, pops: 2 },
      { ...loser, bubbles: 7 },
    ],
  });
  // Over the wire and back, through the platform's boundary and this game's.
  const wire: unknown = JSON.parse(JSON.stringify(result));
  assert.deepEqual(
    parseMatchResult(fuseballRegistration, account, wire),
    result,
  );
  assert.equal(attestationsNeeded(result), 2);
  // The same match as the round the platform rates.
  const receipt = roundResult(room)!;
  assert.deepEqual(receipt, { ...result, round: 1 });
  assert.deepEqual(
    parseMatchResult(
      fuseballRegistration,
      account,
      JSON.parse(JSON.stringify(receipt)),
    ),
    receipt,
  );
  // The registration is one the platform takes.
  const platform = new Platform(account, [fuseballRegistration]);
  assert.equal(platform.game("fuseball"), fuseballRegistration);
});

test("a result stops counting bubbles and pops at what the service accepts, however far the world's counters ran", () => {
  const room = finished();
  room.world!.bubbles[0].seq = 0xffff;
  room.world!.bubbles[1].seq = MOST_BUBBLES + 1;
  room.world!.riders[0].pops = MOST_BUBBLES;
  room.world!.riders[1].pops = 0xffff;
  const result = matchResult(room)!;
  assert.deepEqual(
    result.players.map((player) => [player.bubbles, player.pops]),
    [
      [MOST_BUBBLES, MOST_BUBBLES],
      [MOST_BUBBLES, MOST_BUBBLES],
    ],
  );
  assert.deepEqual(
    parseMatchResult(
      fuseballRegistration,
      account,
      JSON.parse(JSON.stringify(result)),
    ),
    result,
  );
  // The cap is far past an ordinary match and short of where the engine's counter wraps.
  assert.ok(MOST_BUBBLES >= 1000 && MOST_BUBBLES < 0xffff);
});

test("a bot and a rider who left are in the result but not among those who attest it", () => {
  const solo = finished(true);
  const result = matchResult(solo)!;
  assert.deepEqual(result.finishers, [A]);
  assert.deepEqual(
    result.players.map((p) => [p.playerId, p.name, p.earlyExits]),
    [
      [A, "Ada", 0],
      ["bot:1", "Volta", 0],
    ],
  );
  assert.ok(parseMatchResult(fuseballRegistration, account, result));
  assert.equal(attestationsNeeded(result), 1);

  const left = playing();
  point(left, 0);
  point(left, 0);
  fold(left, [[LEAVE, B]]);
  point(left, 0);
  const walkover = matchResult(left)!;
  assert.deepEqual(walkover.finishers, [A]);
  assert.equal(walkover.players[1]!.earlyExits, 1);
  assert.ok(parseMatchResult(fuseballRegistration, account, walkover));
  // Who owes a report: the finisher, once the deciding tick is confirmed; never the leaver, and nothing mid-match.
  const clock = left.decided!.clock;
  assert.equal(dueReports(left, A, clock, new Set()).length, 2);
  assert.equal(dueReports(left, A, clock - 1, new Set()).length, 0);
  assert.equal(dueReports(left, B, clock, new Set()).length, 0);
  assert.equal(dueReports(left, "", clock, new Set()).length, 0);
  assert.deepEqual(
    dueReports(left, A, clock, new Set(["match-1:1"])).map((r) => r.path),
    ["results"],
  );
  assert.equal(matchResult(playing()), undefined);
  assert.equal(roundResult(playing()), undefined);
  assert.equal(dueReports(playing(), A, 1e9, new Set()).length, 0);
});

test("a player's stats are refused unless every field is present, known and within one match's bounds", () => {
  assert.deepEqual(parseFuseballStats({ ...winner }, 1), winner);
  assert.deepEqual(parseFuseballStats({ ...loser }, 1), loser);
  // Rebuilt in one key order, whatever order the client sent.
  const shuffled = Object.fromEntries(Object.entries(loser).reverse());
  assert.equal(
    JSON.stringify(parseFuseballStats(shuffled, 1)),
    JSON.stringify(loser),
  );
  assert.ok(
    parseFuseballStats({ ...loser, playerId: "bot:12", ownGoals: 3 }, 1),
  );
  assert.ok(
    parseFuseballStats(
      { ...winner, bubbles: MOST_BUBBLES, pops: MOST_BUBBLES },
      1,
    ),
  );
  const { pops: _pops, ...short } = winner;
  const bad: [string, unknown, number?][] = [
    ["not an object", null],
    ["a list", [winner]],
    ["a missing stat", short],
    ["an unknown field", { ...winner, rolls: 1 }],
    ["a match of two rounds", winner, 2],
    ["an id that is no seat", { ...winner, playerId: "solo" }],
    ["a prototype key as id", { ...winner, playerId: "__proto__" }],
    ["a padded name", { ...winner, name: " Ada" }],
    ["a third slot", { ...winner, slot: 2 }],
    ["two rounds played", { ...winner, roundsPlayed: 2 }],
    ["no round played", { ...winner, roundsPlayed: 0 }],
    ["a loser with no round played", { ...loser, roundsPlayed: 0 }],
    ["more goals than the target", { ...winner, goals: TARGET + 1 }],
    ["more own goals than the target", { ...loser, ownGoals: TARGET + 1 }],
    ["more goals than points", { ...loser, goals: 2 }],
    ["a score past the target", { ...winner, matchScoreUnits: TARGET + 1 }],
    ["a win short of the target", { ...winner, matchScoreUnits: 2 }],
    ["the target without the win", { ...loser, matchScoreUnits: TARGET }],
    ["a winner placed second", { ...winner, matchPlacement: 2 }],
    ["a loser placed first", { ...loser, matchPlacement: 1 }],
    ["a place of zero", { ...loser, matchPlacement: 0 }],
    ["two early exits", { ...winner, earlyExits: 2 }],
    ["more bubbles than a match has", { ...winner, bubbles: MOST_BUBBLES + 1 }],
    ["more pops than a match has", { ...loser, pops: MOST_BUBBLES + 1 }],
    ["the engine's whole counter", { ...winner, bubbles: 0xffff }],
    ["negative pops", { ...winner, pops: -1 }],
    ["fractional pops", { ...winner, pops: 0.5 }],
    ["a stat as text", { ...winner, goals: "2" }],
  ];
  for (const [name, raw, rounds] of bad)
    assert.equal(parseFuseballStats(raw, rounds ?? 1), undefined, name);
});

test("the field is two riders on two sides with one winner and a board that adds up", () => {
  assert.ok(validFuseballField([winner, loser]));
  assert.ok(!validFuseballField([winner]), "one rider");
  assert.ok(!validFuseballField([winner, loser, loser]), "three riders");
  assert.ok(!validFuseballField([winner, { ...loser, slot: 0 }]), "one side");
  assert.ok(
    !validFuseballField([winner, { ...loser, ownGoals: 0 }]),
    "a point nobody scored",
  );
  assert.ok(
    !validFuseballField([{ ...winner, goals: 3 }, loser]),
    "a goal too many",
  );
  // The platform runs the same check on a whole result.
  const result = {
    matchId: "match-1",
    length: 1,
    winnerId: A,
    finishers: [A, B],
    players: [winner, loser],
  };
  assert.ok(parseMatchResult(fuseballRegistration, account, result));
  for (const players of [
    [winner, { ...loser, ownGoals: 0 }],
    [winner],
    [winner, { ...winner, playerId: B, slot: 1 }],
  ])
    assert.equal(
      parseMatchResult(fuseballRegistration, account, { ...result, players }),
      undefined,
    );
  assert.equal(
    parseMatchResult(fuseballRegistration, account, { ...result, length: 2 }),
    undefined,
    "a match is one round",
  );
});

test("a confirmed match adds to an account's totals, which are stored and read back strictly", () => {
  const standing = fuseballRegistration.emptyTotals();
  assert.deepEqual(standing.totals, emptyFuseballTotals());
  const players = [
    { ...winner, bubbles: 9, pops: 2 },
    { ...loser, bubbles: 4 },
  ];
  fuseballRegistration.addTotals(
    standing,
    fuseballRegistration.credit(players[0]!, players),
  );
  fuseballRegistration.addTotals(
    standing,
    fuseballRegistration.credit(players[1]!, players),
  );
  assert.deepEqual(standing.totals, {
    matches: 2,
    wins: 1,
    goals: 3,
    ownGoals: 1,
    bubbles: 13,
    pops: 2,
  });
  assert.deepEqual(
    fuseballRegistration.parseTotals({ totals: { ...standing.totals } }),
    standing,
  );
  assert.deepEqual(fuseballRegistration.parseTotals({ rating: 1200 }), {
    totals: emptyFuseballTotals(),
  });
  assert.equal(
    fuseballRegistration.parseTotals({ totals: { matches: -1 } }),
    undefined,
  );
  assert.equal(
    fuseballRegistration.parseTotals({
      totals: { ...standing.totals, goals: "3" },
    }),
    undefined,
  );
  assert.equal(fuseballRegistration.parseTotals({ totals: [] }), undefined);
  assert.equal(fuseballRegistration.isBot("bot:1"), true);
  assert.equal(fuseballRegistration.isBot(A), false);
});
