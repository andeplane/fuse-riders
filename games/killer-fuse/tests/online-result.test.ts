import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, LEAVE, PRESENCE, type StreamEntries } from "fuse-netcode";
import { parseMatchResult, type AccountRules } from "fuse-platform";
import {
  DEFAULT_SETTINGS,
  OUTRO_TICKS,
  BETWEEN_TICKS,
  createRoom,
  foldTick,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { matchResult, roundResult } from "../src/online/result.js";
import {
  TOTAL_KEYS,
  emptyKillerFuseTotals,
  killerFuseRegistration as registration,
  parseKillerFuseStats,
  type KillerFuseStats,
} from "../src/platform.js";
import { ID, decide, join } from "./fixtures/room.js";

const ACCOUNT: AccountRules = {
  validName: (value): value is string =>
    typeof value === "string" && /^[A-Za-z0-9 ]{1,18}$/.test(value),
  validAvatar: (value): value is string => value === "bee",
  nameRule: "A username is 1 to 18 characters",
  fallbackName: "Player",
};
const parse = (raw: unknown) => parseMatchResult(registration, ACCOUNT, raw);

/** A room whose members carry the ids the platform takes; `ID.a` created it. */
let seq = 0;
function fold(room: Room, bodies: readonly (readonly unknown[])[] = []): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  streams.set(ID.a, {
    generation: 1,
    entries: bodies.map((body) => [++seq, tick, ...body] as Entry),
  });
  foldTick(room, ID.a, streams);
}
const run = (room: Room, ticks: number): void => {
  for (let i = 0; i < ticks; i++) fold(room);
};
/** The running game decided for `team`, shown and recorded. */
function win(room: Room, team: number): void {
  run(room, room.startAt - room.tick);
  decide(room, team, "economy");
  run(room, OUTRO_TICKS);
}
const next = (room: Room): void => run(room, BETWEEN_TICKS);
const NAMES = ["Ada", "Bo", "Cy", "Di", "Eve", "Fay"];
const PEOPLE = [ID.a, ID.b, ID.c, ID.d, ID.e, ID.f];
/** A set to `wins` with the first `people` members seated in slot order (Cyan even, Pink odd). */
function set(people: number, wins = 2): Room {
  const room = createRoom("m0", { ...DEFAULT_SETTINGS, wins });
  fold(
    room,
    PEOPLE.slice(0, people).map((id, slot) => join(id, NAMES[slot]!, slot)),
  );
  fold(room, [[ACTION, "start", "set-1"]]);
  return room;
}

test("a game of the set is a rating receipt the platform takes: winners first, losers behind them", () => {
  const room = set(3);
  assert.equal(roundResult(room, 1), undefined, "not decided yet");
  win(room, 0);
  const receipt = roundResult(room, 1)!;
  assert.deepEqual(parse(structuredClone(receipt)), receipt);
  assert.equal(receipt.matchId, "set-1");
  assert.equal(receipt.round, 1);
  assert.equal(receipt.length, 1);
  assert.equal(receipt.winnerId, ID.a);
  assert.deepEqual(receipt.finishers, [ID.a, ID.b, ID.c]);
  assert.deepEqual(
    receipt.players.map((p) => [p.name, p.slot, p.won, p.matchPlacement]),
    [
      ["Ada", 0, 1, 1],
      ["Bo", 1, 0, 3],
      ["Cy", 2, 1, 1],
    ],
  );
  for (const player of receipt.players) {
    assert.equal(player.roundsPlayed, 1);
    assert.equal(player.roundWins, player.won);
    assert.equal(player.matchScoreUnits, player.won);
    assert.equal(player.earlyExits, 0);
  }
  assert.equal(roundResult(room, 2), undefined);
  assert.equal(matchResult(room), undefined, "the set goes on");
});

test("people who lost to bots keep a valid placement and no win; a team of bots has no winner id", () => {
  const room = set(1);
  win(room, 1);
  const receipt = roundResult(room, 1)!;
  assert.deepEqual(parse(structuredClone(receipt)), receipt);
  assert.equal(receipt.winnerId, undefined);
  assert.equal(receipt.players[0]!.matchPlacement, 1);
  assert.equal(receipt.players[0]!.won, 0);
  // Two on one team, beaten by bots: both behind the winners that are not listed, and inside the field.
  const pair = createRoom("m0", DEFAULT_SETTINGS);
  fold(pair, [join(ID.a, "Ada", 0), join(ID.b, "Bo", 1), join(ID.c, "Cy", 2)]);
  fold(pair, [[LEAVE, ID.b]]);
  fold(pair, [[ACTION, "start", "set-2"]]);
  win(pair, 1);
  const lost = roundResult(pair, 1)!;
  assert.deepEqual(parse(structuredClone(lost)), lost);
  assert.deepEqual(
    lost.players.map((p) => [p.won, p.matchPlacement]),
    [
      [0, 2],
      [0, 2],
    ],
  );
});

test("a game six people played is not rated game by game, and five of them attest the set", () => {
  const room = set(6, 1);
  win(room, 1);
  assert.equal(roundResult(room, 1), undefined);
  const result = matchResult(room)!;
  assert.deepEqual(parse(structuredClone(result)), result);
  assert.equal(result.players.length, 6);
  assert.deepEqual(result.finishers, PEOPLE.slice(0, 5));
  assert.equal(result.winnerId, ID.b);
  assert.deepEqual(
    result.players.map((p) => p.matchPlacement),
    [4, 1, 4, 1, 4, 1],
  );
});

test("the finished set names everyone who played a game of it, with what each did", () => {
  const room = set(3);
  // Stats as the fold credits them during play.
  win(room, 0);
  room.stats[ID.a]!.kills = 4;
  room.stats[ID.b]!.deaths = 2;
  room.stats[ID.c]!.berries = 7;
  next(room);
  // Cy's link drops in game 2 and Bo leaves after it: a seat left mid-set stays, for its bot and for the result.
  fold(room, [[PRESENCE, ID.c, false, 1]]);
  win(room, 1);
  next(room);
  fold(room, [[LEAVE, ID.b]]);
  win(room, 0);
  assert.equal(room.stage, "over");
  const result = matchResult(room)!;
  assert.deepEqual(parse(structuredClone(result)), result);
  assert.equal(result.matchId, "set-1");
  assert.equal(result.round, undefined);
  assert.equal(result.length, 3);
  assert.equal(result.winnerId, ID.a);
  assert.deepEqual(result.finishers, [ID.a]);
  const rows = result.players.map((p) => [
    p.name,
    p.slot,
    p.roundsPlayed,
    p.roundWins,
    p.matchPlacement,
    p.earlyExits,
    p.won,
  ]);
  assert.deepEqual(rows, [
    ["Ada", 0, 3, 2, 1, 0, 1],
    ["Bo", 1, 3, 1, 3, 1, 0],
    ["Cy", 2, 3, 2, 1, 1, 1],
  ]);
  const [ada, bo, cy] = result.players;
  assert.deepEqual(
    [ada!.kills, bo!.deaths, cy!.berries, ada!.matchScoreUnits],
    [4, 2, 7, 2],
  );
  // The receipts of its games stand as they were recorded.
  assert.deepEqual(roundResult(room, 2)!.finishers, [ID.a, ID.b]);
  assert.equal(roundResult(room, 2)!.players[2]!.earlyExits, 1);
  assert.deepEqual(roundResult(room, 3)!.finishers, [ID.a]);
  // The same room on another device writes the same bytes.
  assert.equal(
    JSON.stringify(matchResult(structuredClone(room))),
    JSON.stringify(result),
  );
});

const good: KillerFuseStats = {
  playerId: ID.a,
  name: "Ada",
  slot: 0,
  roundsPlayed: 3,
  roundWins: 2,
  matchScoreUnits: 2,
  matchPlacement: 1,
  earlyExits: 0,
  won: 1,
  kills: 4,
  deaths: 1,
  berries: 9,
};

test("a player's stats parse exactly: every field checked, unknown ones refused, one key order", () => {
  assert.deepEqual(parseKillerFuseStats(structuredClone(good), 3), good);
  const shuffled = Object.fromEntries(Object.entries(good).reverse());
  assert.equal(
    JSON.stringify(parseKillerFuseStats(shuffled, 3)),
    JSON.stringify(good),
  );
  assert.ok(parseKillerFuseStats({ ...good, playerId: "bot:2" }, 3));
  // A set never has more games than `MAX_GAMES`, whatever length the result claims.
  assert.ok(
    parseKillerFuseStats({ ...good, roundsPlayed: 5, roundWins: 3 }, 99),
  );
  const bad: unknown[] = [
    undefined,
    null,
    "stats",
    [good],
    { ...good, extra: 1 },
    Object.fromEntries(Object.entries(good).filter(([key]) => key !== "won")),
    { ...good, playerId: 7 },
    { ...good, playerId: "A".repeat(24) },
    { ...good, playerId: "a".repeat(23) },
    { ...good, name: "" },
    { ...good, name: 5 },
    { ...good, name: "x".repeat(40) },
    { ...good, slot: 6 },
    { ...good, slot: -1 },
    { ...good, slot: 0.5 },
    { ...good, roundsPlayed: 4 },
    { ...good, roundsPlayed: 1 },
    { ...good, roundWins: 4 },
    { ...good, matchScoreUnits: 4 },
    { ...good, matchPlacement: 0 },
    { ...good, matchPlacement: 129 },
    { ...good, matchPlacement: 2 },
    { ...good, earlyExits: 2 },
    { ...good, won: 2 },
    { ...good, won: "1" },
    { ...good, kills: -1 },
    { ...good, kills: 100_001 },
    { ...good, deaths: Number.NaN },
    { ...good, berries: 1e21 },
    { ...good, roundsPlayed: 6, roundWins: 0 },
  ];
  for (const raw of bad)
    assert.equal(parseKillerFuseStats(raw, 3), undefined, JSON.stringify(raw));
  assert.equal(
    parseKillerFuseStats({ ...good, roundsPlayed: 6 }, 99),
    undefined,
  );
});

test("the platform refuses a result whose fields the game's rules cannot hold", () => {
  const room = set(2, 1);
  win(room, 0);
  const result = matchResult(room)!;
  assert.ok(parse(structuredClone(result)));
  const change = (edit: (player: KillerFuseStats) => void) => {
    const copy = structuredClone(result);
    edit(copy.players[1]!);
    return parse(copy);
  };
  assert.equal(
    change((p) => (p.won = 1)),
    undefined,
    "a loser's placement with a win",
  );
  assert.equal(
    change((p) => (p.matchPlacement = 3)),
    undefined,
    "past the field",
  );
  assert.equal(
    change((p) => (p.kills = 100_001)),
    undefined,
  );
  assert.equal(
    change((p) => (p.name = "<b>")),
    undefined,
    "the account's name rule",
  );
  assert.equal(parse({ ...result, finishers: ["bot:1"] }), undefined);
});

test("a confirmed set adds to an account's totals, and stored totals parse strictly", () => {
  assert.equal(registration.id, "killer-fuse");
  assert.equal(registration.isBot("bot:3"), true);
  assert.equal(registration.isBot(ID.a), false);
  const standing = registration.emptyTotals();
  assert.deepEqual(standing, { totals: emptyKillerFuseTotals() });
  assert.deepEqual(Object.keys(standing.totals), [...TOTAL_KEYS]);
  const credit = registration.credit(good, [good]);
  assert.deepEqual(credit, {
    matches: 1,
    wins: 1,
    gameWins: 2,
    kills: 4,
    deaths: 1,
    berries: 9,
  });
  registration.addTotals(standing, credit);
  registration.addTotals(
    standing,
    registration.credit({ ...good, won: 0 }, [good]),
  );
  assert.deepEqual(standing.totals, {
    matches: 2,
    wins: 1,
    gameWins: 4,
    kills: 8,
    deaths: 2,
    berries: 18,
  });
  // An account that never played has no totals yet; malformed ones fail the read.
  assert.deepEqual(registration.parseTotals({}), {
    totals: emptyKillerFuseTotals(),
  });
  assert.deepEqual(
    registration.parseTotals({ totals: { ...standing.totals }, rating: 1500 }),
    standing,
  );
  for (const totals of [
    null,
    7,
    [1, 2],
    { ...standing.totals, wins: -1 },
    { ...standing.totals, kills: "4" },
    { matches: 1 },
  ])
    assert.equal(registration.parseTotals({ totals }), undefined);
});
