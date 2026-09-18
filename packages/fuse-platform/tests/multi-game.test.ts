import test from "node:test";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import {
  MemoryRoomDatabase,
  RoomError,
  RoomStore,
  digest,
  peerId,
  type HttpExtension,
} from "fuse-network-be";
import {
  HistoryStore,
  LEGACY_GAME_ID,
  MemoryHistoryDatabase,
  Platform,
  collectHistory,
  createHistoryHttp,
  gameRoute,
  matchRecordId,
  parseMatchRecord,
  parseMatchResult,
  parseProfile,
  rankFields,
  splitProfile,
  type AccountRules,
  type GameRegistration,
  type MatchRecord,
  type PlayerResult,
} from "../src/index.js";
import { calculateElo } from "../src/elo.js";

/**
 * Two fake games on one platform: `fuse-riders` (the legacy game, whose standing lives on the user document) and
 * `dice`. Neither knows anything about the real games; they only prove the platform keeps games apart.
 */
interface Seat extends PlayerResult {
  points: number;
  beat?: Record<string, number>;
}
interface Totals {
  tally: { matches: number; points: number };
}
const KEYS = [
  "playerId",
  "name",
  "slot",
  "roundsPlayed",
  "roundWins",
  "matchScoreUnits",
  "matchPlacement",
  "earlyExits",
  "points",
] as const;
function fakeGame(id: string): GameRegistration<Seat, Totals, number> {
  return {
    id,
    isBot: (playerId) => /^bot:[0-9]{1,6}$/.test(playerId),
    parseStats(raw) {
      if (!raw || typeof raw !== "object") return;
      const value = raw as Record<string, unknown>;
      if (
        !Object.keys(value).every((key) =>
          [...KEYS, "beat"].includes(key as never),
        ) ||
        !KEYS.every((key) => value[key] !== undefined) ||
        !Number.isSafeInteger(value.points)
      )
        return;
      const seat: Record<string, unknown> = Object.fromEntries(
        KEYS.map((key) => [key, value[key]]),
      );
      if (value.beat !== undefined) seat.beat = value.beat;
      return seat as unknown as Seat;
    },
    validField: (players) => players.every((p) => p.points >= 0),
    emptyTotals: () => ({ tally: { matches: 0, points: 0 } }),
    credit: (player) => player.points,
    addTotals(totals, points) {
      totals.tally.matches++;
      totals.tally.points += points;
    },
    parseTotals(document) {
      const tally = document.tally as Totals["tally"] | undefined;
      if (tally === undefined) return { tally: { matches: 0, points: 0 } };
      return Number.isSafeInteger(tally.matches) &&
        Number.isSafeInteger(tally.points)
        ? { tally: { ...tally } }
        : undefined;
    },
    rivals: (player, opponent) =>
      player.beat && opponent.beat
        ? {
            kills: player.beat[opponent.playerId] ?? 0,
            deaths: opponent.beat[player.playerId] ?? 0,
          }
        : undefined,
  };
}
const ACCOUNT: AccountRules = {
  validName: (value): value is string =>
    typeof value === "string" && /^[A-Za-z0-9 ]{1,18}$/.test(value),
  validAvatar: (value): value is string => value === "robot" || value === "cat",
  nameRule: "A username is 1 to 18 characters",
  fallbackName: "Player",
};
const legacy = fakeGame(LEGACY_GAME_ID),
  dice = fakeGame("dice");
const platform = new Platform(ACCOUNT, [legacy, dice]);

const token = (n: number) => n.toString(16).padStart(64, "0");
function seat(
  id: string,
  slot: number,
  placement: number,
  extra: Partial<Seat> = {},
): Seat {
  return {
    playerId: id,
    name: `Player ${slot + 1}`,
    slot,
    roundsPlayed: 1,
    roundWins: placement === 1 ? 1 : 0,
    matchScoreUnits: 10 - placement,
    matchPlacement: placement,
    earlyExits: 0,
    points: 10 * (3 - placement),
    ...extra,
  };
}

/** Records every rate-limit key it is asked about. */
class RecordingDatabase extends MemoryRoomDatabase {
  keys: string[] = [];
  override allowance(
    key: string,
    now: number,
    limit: number,
    consume?: boolean,
  ): Promise<boolean> {
    this.keys.push(key);
    return super.allowance(key, now, limit, consume);
  }
}

/** `sameIncarnation` gives every room one incarnation, so two games' rooms can map a result to one record id. */
async function fixture(sameIncarnation = false) {
  let now = 1_800_000_000_000,
    ids = 0;
  const roomDatabase = new RecordingDatabase();
  const rooms = new RoomStore(roomDatabase, {
    now: () => now,
    id: () => (sameIncarnation ? "room-id" : `id-${ids++}`),
    gameIds: platform.gameIds,
  });
  const database = new MemoryHistoryDatabase(platform, () => now);
  const store = new HistoryStore(platform, database, rooms, () => now);
  /** A room of `gameId` with two members; returns a reporter for each seat. */
  const room = async (gameId: string | undefined, first: number) => {
    const tokens = [token(first), token(first + 1)];
    const code = await rooms.createAvailable(tokens[0]!, undefined, gameId);
    for (const t of tokens) await rooms.admit(code, t, "gateway", gameId);
    return { code, tokens, ids: tokens.map(peerId) };
  };
  /** Both seats report `result` to `gameId`'s history, signed in as `uids`. */
  const play = async (
    gameId: string,
    where: { code: string; tokens: string[] },
    result: unknown,
    uids: string[],
    round = false,
  ) => {
    const history = store.game(gameId);
    for (let i = 0; i < where.tokens.length; i++)
      await history.submit(
        await history.admit(where.code, where.tokens[i]!, `ip-${i}`, round),
        { result, avatarId: "robot" },
        uids[i],
      );
  };
  return {
    rooms,
    roomDatabase,
    database,
    store,
    room,
    play,
    advance: (ms: number) => (now += ms),
  };
}
const round = (ids: string[], winner: number, matchId = "m1") => ({
  matchId,
  round: 1,
  length: 1,
  finishers: ids,
  winnerId: ids[winner],
  players: ids.map((id, slot) => seat(id, slot, slot === winner ? 1 : 2)),
});

test("a game registration is checked once: valid, unique ids and totals that stay off the platform's fields", () => {
  assert.throws(() => new Platform(ACCOUNT, []));
  assert.throws(() => new Platform(ACCOUNT, [dice, dice]));
  assert.throws(() => new Platform(ACCOUNT, [fakeGame("Dice!")]));
  assert.throws(
    () =>
      new Platform(ACCOUNT, [
        { ...fakeGame("x"), emptyTotals: () => ({ elo: 0 }) } as never,
      ]),
    /totals use elo/,
  );
  assert.deepEqual(platform.gameIds, [LEGACY_GAME_ID, "dice"]);
  assert.throws(() => platform.game("chess"), { status: 404 });
});

test("an unknown game is refused by the store, the routes and the record parser", async () => {
  const f = await fixture();
  assert.throws(
    () => f.store.game("chess"),
    (error: unknown) => {
      assert.ok(error instanceof RoomError);
      assert.equal(error.status, 404);
      return true;
    },
  );
  // A registration object that is not the one registered is a wiring bug, not a game.
  assert.throws(() => f.store.game(fakeGame("dice")), RangeError);
  assert.equal(f.store.game(dice), f.store.game("dice"));
  await assert.rejects(f.rooms.createAvailable(token(9), undefined, "chess"), {
    status: 400,
  });
  const http = createHistoryHttp(f.store, async () => undefined);
  const call = async (path: string) => {
    const response: { status?: number; body?: string } = {};
    const handled = await handle(http, "GET", path, response).catch(
      (error: unknown) => error,
    );
    return { handled, response };
  };
  const unknown = await call("/api/games/chess/leaderboard");
  assert.ok(unknown.handled instanceof RoomError);
  assert.equal(unknown.handled.status, 404);
  assert.equal((await call("/api/games/chess/elsewhere")).handled, false);
  assert.deepEqual(gameRoute("/api/games/dice/me"), {
    gameId: "dice",
    path: "/api/me",
  });
  assert.deepEqual(gameRoute("/api/me"), {
    gameId: LEGACY_GAME_ID,
    path: "/api/me",
  });
});

test("history routes address a game by prefix and refuse an unknown game or a room of another game", async () => {
  const f = await fixture();
  const arena = await f.room(undefined, 1);
  const http = createHistoryHttp(f.store, async () => undefined);
  const call = async (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) => {
    const response: { status?: number; body?: string } = {};
    const handled = await handle(
      http,
      method,
      path,
      response,
      headers,
      body,
    ).catch((error: unknown) => error);
    return { handled, response };
  };
  const refused = async (
    outcome: Promise<{ handled: unknown }>,
    status: number,
    message: string,
  ) => {
    const { handled } = await outcome;
    assert.ok(handled instanceof RoomError, message);
    assert.equal(handled.status, status);
    assert.equal(handled.message, message);
  };
  await refused(
    call("POST", "/api/games/chess/rooms/AB12/results", {}, { result: 1 }),
    404,
    "Unknown game",
  );
  await refused(
    call("PUT", "/api/games/chess/me", {}, { username: "Ace" }),
    404,
    "Unknown game",
  );
  await refused(
    call(
      "POST",
      `/api/games/dice/rooms/${arena.code}/results`,
      { authorization: `Bearer ${arena.tokens[0]!}` },
      { result: round(arena.ids, 0) },
    ),
    404,
    "Room is for another game",
  );
  // A signed-in round reporter whose identity cannot be verified must retry, never be settled as a guest.
  await refused(
    call(
      "POST",
      `/api/rooms/${arena.code}/round-results`,
      {
        authorization: `Bearer ${arena.tokens[0]!}`,
        "x-fuse-identity": "unverifiable",
      },
      { result: round(arena.ids, 0) },
    ),
    503,
    "Identity unavailable; retry round report",
  );
  const board = await call("GET", "/api/games/dice/leaderboard");
  assert.equal(board.handled, true);
  assert.deepEqual(JSON.parse(board.response.body!), { players: [] });
});

test("ratings and leaderboards are per game, while the account is shared", async () => {
  const f = await fixture();
  // The same two accounts: alice wins the legacy game's round, bob wins the dice round.
  const arena = await f.room(undefined, 1);
  await f.play(
    LEGACY_GAME_ID,
    arena,
    round(arena.ids, 0),
    ["alice", "bob"],
    true,
  );
  const table = await f.room("dice", 3);
  await f.play("dice", table, round(table.ids, 1), ["alice", "bob"], true);

  const legacyHistory = f.store.game(LEGACY_GAME_ID),
    diceHistory = f.store.game("dice");
  assert.equal((await legacyHistory.profile("alice"))!.rating!.value, 1016);
  assert.equal((await diceHistory.profile("alice"))!.rating!.value, 984);
  assert.equal((await diceHistory.profile("bob"))!.rating!.value, 1016);
  assert.equal((await legacyHistory.profile("alice"))!.rank, 1);
  assert.equal((await diceHistory.profile("alice"))!.rank, 2);
  const top = async (gameId: string) =>
    (await f.store.game(gameId).leaderboard("ip", "bob")).map(
      (entry) => `${entry.name}:${entry.elo}${entry.you ? "*" : ""}`,
    );
  assert.deepEqual(await top(LEGACY_GAME_ID), [
    "Player 1:1016",
    "Player 2:984*",
  ]);
  assert.deepEqual(await top("dice"), ["Player 2:1016*", "Player 1:984"]);

  // One rename, seen in both games: the username is the account's.
  await diceHistory.rename("alice", { username: "Ace" });
  assert.deepEqual(await top(LEGACY_GAME_ID), ["Ace:1016", "Player 2:984*"]);
  assert.deepEqual(await top("dice"), ["Player 2:1016*", "Ace:984"]);
  assert.equal((await legacyHistory.profile("alice"))!.username, "Ace");
  await assert.rejects(diceHistory.rename("alice", { username: "" }), {
    status: 400,
    message: ACCOUNT.nameRule,
  });

  // An account that only ever played dice has no legacy rating, and the reverse.
  const solo = await f.room("dice", 5);
  await f.play("dice", solo, round(solo.ids, 0, "m2"), ["carol", "dave"], true);
  assert.equal((await legacyHistory.profile("carol"))?.rating, undefined);
  assert.equal((await diceHistory.profile("carol"))!.rating!.games, 1);
});

test("match history, totals and rivalries are per game; a record without a gameId is the legacy game's", async () => {
  const f = await fixture();
  const whole = (ids: string[], winner: number, matchId: string) => ({
    matchId,
    length: 1,
    finishers: ids,
    winnerId: ids[winner],
    players: ids.map((id, slot) =>
      seat(id, slot, slot === winner ? 1 : 2, {
        beat: { [ids[1 - slot]!]: slot === winner ? 1 : 0 },
      }),
    ),
  });
  const arena = await f.room(undefined, 1);
  await f.play(LEGACY_GAME_ID, arena, whole(arena.ids, 0, "arena-1"), [
    "alice",
    "bob",
  ]);
  f.advance(1000);
  const table = await f.room("dice", 3);
  for (const matchId of ["dice-1", "dice-2"]) {
    f.advance(1000);
    await f.play("dice", table, whole(table.ids, 1, matchId), ["alice", "bob"]);
  }
  const legacyPage = await f.store.game(legacy).history("alice", undefined),
    dicePage = await f.store.game(dice).history("alice", undefined);
  assert.deepEqual(
    legacyPage.matches.map((m) => m.result.matchId),
    ["arena-1"],
  );
  assert.deepEqual(
    dicePage.matches.map((m) => m.result.matchId),
    ["dice-2", "dice-1"],
  );
  assert.deepEqual(legacyPage.profile!.tally, { matches: 1, points: 20 });
  assert.deepEqual(dicePage.profile!.tally, { matches: 2, points: 20 });
  assert.deepEqual(
    legacyPage.rivals.prey.map((r) => r.kills),
    [1],
  );
  assert.deepEqual(
    dicePage.rivals.nemeses.map((r) => r.deaths),
    [2],
  );
  assert.deepEqual(dicePage.rivals.prey, []);

  // Stored records: the legacy game's may predate gameId, any other game's must carry its own.
  const stored = (
    await f.database.matchesFor(LEGACY_GAME_ID, "alice", undefined, 20)
  )[0]!;
  const { gameId, ...legacyRecord } = stored;
  assert.equal(gameId, LEGACY_GAME_ID);
  assert.deepEqual(parseMatchRecord(platform, legacyRecord), stored);
  const diceRecord = (
    await f.database.matchesFor("dice", "alice", undefined, 20)
  )[0]!;
  assert.equal(parseMatchRecord(platform, diceRecord)!.gameId, "dice");
  assert.equal(
    parseMatchRecord(platform, { ...diceRecord, gameId: "chess" }),
    undefined,
  );
  assert.equal(
    parseMatchRecord(platform, { ...diceRecord, gameId: 7 }),
    undefined,
  );
});

test("a record cannot change games: the same record id reported to another game is refused", async () => {
  // One incarnation for every room, so a legacy room and a dice room hash the same result to the same record.
  const f = await fixture(true);
  const arena = await f.room(undefined, 1),
    table = await f.room("dice", 3);
  const result = (ids: string[]) => ({
    matchId: "same",
    length: 1,
    finishers: [ids[0]!],
    players: [seat(ids[0]!, 0, 1), seat("bot:1", 1, 2)],
  });
  const legacyHistory = f.store.game(LEGACY_GAME_ID),
    diceHistory = f.store.game("dice");
  // Same seat id in both rooms (same token), so the result bytes and the record id are identical.
  const solo = { ...arena, tokens: [arena.tokens[0]!] };
  await f.rooms.admit(table.code, arena.tokens[0]!, "gateway", "dice");
  await f.play(LEGACY_GAME_ID, solo, result(arena.ids), ["alice"]);
  await assert.rejects(
    diceHistory.submit(
      await diceHistory.admit(table.code, arena.tokens[0]!, "ip"),
      { result: result(arena.ids) },
      "alice",
    ),
    { status: 409, message: "Match belongs to another game" },
  );
  assert.equal(
    (await legacyHistory.history("alice", undefined)).matches.length,
    1,
  );
  assert.deepEqual((await diceHistory.history("alice", undefined)).matches, []);
});

test("a room of one game refuses another game's reports and joins", async () => {
  const f = await fixture();
  const arena = await f.room(undefined, 1);
  assert.equal((await f.rooms.get(arena.code)).gameId, LEGACY_GAME_ID);
  await assert.rejects(
    f.store.game("dice").admit(arena.code, arena.tokens[0]!, "ip"),
    { status: 404, message: "Room is for another game" },
  );
  await assert.rejects(f.rooms.admit(arena.code, token(7), "gateway", "dice"), {
    status: 404,
  });
  const table = await f.room("dice", 3);
  await assert.rejects(
    f.rooms.admit(table.code, token(8), "gateway"),
    { status: 404 },
    "an absent gameId is the legacy game, not a wildcard",
  );
  // A reporter admitted for one game cannot be handed to another's history.
  const reporter = await f.store
    .game("dice")
    .admit(table.code, table.tokens[0]!, "ip");
  await assert.rejects(
    f.store
      .game(LEGACY_GAME_ID)
      .submit(reporter, { result: round(table.ids, 0) }, undefined),
    { status: 400, message: "Report for another game" },
  );
  // A room stored before rooms carried a game is the legacy game's, whether a client names it or not.
  const stored = structuredClone(await f.rooms.get(arena.code));
  delete stored.gameId;
  await f.rooms.database.transact(arena.code, () => ({
    room: stored,
    result: undefined,
  }));
  assert.ok(
    await f.store
      .game(LEGACY_GAME_ID)
      .admit(arena.code, arena.tokens[1]!, "ip"),
  );
  await f.rooms.admit(arena.code, token(9), "gateway", LEGACY_GAME_ID);
  await assert.rejects(
    f.store.game("dice").admit(arena.code, arena.tokens[1]!, "ip"),
    { status: 404 },
  );
});

test("rate-limit budgets are per game; the legacy game keeps its keys", async () => {
  const f = await fixture();
  await f.store.game(LEGACY_GAME_ID).profile("alice");
  await f.store.game("dice").profile("alice");
  await f.store.game(LEGACY_GAME_ID).leaderboard("ip");
  await f.store.game("dice").leaderboard("ip");
  const legacyKeys = [digest("history:alice"), digest("leaderboard:ip")],
    diceKeys = [digest("dice:history:alice"), digest("dice:leaderboard:ip")];
  for (const key of [...legacyKeys, ...diceKeys])
    assert.ok(f.roomDatabase.keys.includes(key));
  // The username is the account's in every game, so its budget is shared.
  await f.store.game("dice").rename("alice", { username: "Ace" });
  assert.ok(f.roomDatabase.keys.includes(digest("rename:alice")));
});

test("solo rounds of different games never share a record or a rating scope", async () => {
  const f = await fixture();
  const solo = {
    matchId: "solo-1",
    round: 1,
    length: 1,
    finishers: ["0".repeat(24)],
    players: [seat("0".repeat(24), 0, 1), seat("bot:1", 1, 2)],
  };
  for (const gameId of [LEGACY_GAME_ID, "dice"]) {
    const history = f.store.game(gameId);
    const reporter = await history.admitSolo("alice", "ip");
    assert.equal(
      reporter.incarnation,
      gameId === LEGACY_GAME_ID ? "solo:alice" : "solo:dice:alice",
    );
    assert.equal(
      (await history.submitSolo(reporter, { result: solo }, "alice")).status,
      "confirmed",
    );
    await assert.rejects(
      history.submitSolo(
        { ...reporter, incarnation: "solo:mallory" },
        { result: solo },
        "alice",
      ),
      { status: 400 },
    );
  }
  assert.notEqual(
    matchRecordId("solo:alice", parseMatchResult(legacy, ACCOUNT, solo)!),
    matchRecordId("solo:dice:alice", parseMatchResult(dice, ACCOUNT, solo)!),
  );
  for (const gameId of [LEGACY_GAME_ID, "dice"])
    assert.equal(
      (await f.store.game(gameId).profile("alice"))!.rating!.games,
      1,
    );
});

test("the platform's own fields are checked whatever the game's parser accepts", () => {
  const ids = ["a".repeat(24), "b".repeat(24)];
  const good = round(ids, 0);
  assert.ok(parseMatchResult(dice, ACCOUNT, good));
  for (const [label, change] of Object.entries<Partial<Seat>>({
    "a bad player id": { playerId: "nope" },
    "a name outside the account rule": { name: "<script>" },
    "a negative slot": { slot: -1 },
    "more rounds than the result": { roundsPlayed: 2 },
    "a placement of zero": { matchPlacement: 0 },
    "a placement past the field": { matchPlacement: 3 },
    "a fractional early exit": { earlyExits: 0.5 },
    "an infinite score": { matchScoreUnits: Infinity },
  }))
    assert.equal(
      parseMatchResult(dice, ACCOUNT, {
        ...good,
        players: [{ ...good.players[0]!, ...change }, good.players[1]],
      }),
      undefined,
      label,
    );
  assert.equal(
    parseMatchResult(dice, ACCOUNT, {
      ...good,
      players: [{ ...good.players[0]!, points: -1 }, good.players[1]],
    }),
    undefined,
    "the game's field check",
  );
  assert.equal(
    parseMatchResult(dice, ACCOUNT, { ...good, finishers: ["bot:1"] }),
    undefined,
  );
  assert.throws(() =>
    calculateElo([{ id: "bot:1", rating: 1000, score: 1, wins: 1 }], (id) =>
      dice.isBot(id),
    ),
  );
});

test("storage keeps the account apart from each game's standing and fails closed on corrupt standings", () => {
  const user = {
    username: "Ace",
    name: "Player 1",
    avatarId: "cat",
    updatedAt: 5,
    tally: { matches: 3, points: 9 },
  };
  assert.deepEqual(parseProfile(platform, LEGACY_GAME_ID, user), user);
  // Another game reads the account from the user document and its standing from its own document only.
  assert.deepEqual(parseProfile(platform, "dice", user, undefined), {
    username: "Ace",
    name: "Player 1",
    avatarId: "cat",
    updatedAt: 5,
    tally: { matches: 0, points: 0 },
  });
  assert.equal(parseProfile(platform, "dice", undefined, undefined), undefined);
  assert.deepEqual(
    parseProfile(platform, "dice", undefined, {
      tally: { matches: 1, points: 2 },
    }),
    { updatedAt: 0, tally: { matches: 1, points: 2 } },
  );
  assert.throws(() =>
    parseProfile(platform, "dice", user, { tally: { matches: "x" } }),
  );
  assert.throws(() => parseProfile(platform, "dice", user, { rating: {} }));
  assert.deepEqual(
    parseProfile(platform, LEGACY_GAME_ID, { ...user, avatarId: "nope" })!
      .avatarId,
    undefined,
  );
  assert.deepEqual(
    splitProfile({ ...user, rank: 3 } as Parameters<typeof splitProfile>[0]),
    {
      account: {
        username: "Ace",
        name: "Player 1",
        avatarId: "cat",
        updatedAt: 5,
      },
      standing: { tally: { matches: 3, points: 9 } },
    },
  );
});

test("a record written by the platform re-parses to itself", async () => {
  const f = await fixture();
  const table = await f.room("dice", 3);
  await f.play("dice", table, round(table.ids, 0), ["alice", "bob"], true);
  const [record] = await f.database.matchesFor("dice", "alice", undefined, 20);
  // Round receipts never join the history page, so read the record through the transaction instead.
  assert.equal(record, undefined);
  const id = matchRecordId(
    (await f.rooms.get(table.code)).incarnation,
    parseMatchResult(dice, ACCOUNT, round(table.ids, 0))!,
  );
  const stored = await f.database.transactMatch("dice", id, (current) => ({
    result: current as MatchRecord,
  }));
  assert.equal(stored.gameId, "dice");
  assert.ok(stored.ratings);
  assert.deepEqual(parseMatchRecord(platform, structuredClone(stored)), stored);
});

/** Drives an HttpExtension with a minimal request (a readable body) and response. */
async function handle(
  http: HttpExtension,
  method: string,
  url: string,
  response: { status?: number; body?: string },
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<boolean> {
  const req = Object.assign(
    Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ),
    { method, url, headers },
  ) as unknown as Parameters<HttpExtension["handle"]>[0];
  const res = {
    writeHead(status: number) {
      response.status = status;
    },
    end(text: string) {
      response.body = text;
    },
  } as unknown as Parameters<HttpExtension["handle"]>[1];
  return http.handle(req, res, "ip");
}

test("a corrupt stored record fails closed, field by field", async () => {
  const f = await fixture();
  const table = await f.room("dice", 3);
  await f.play("dice", table, round(table.ids, 0), ["alice", "bob"], true);
  const id = matchRecordId(
    (await f.rooms.get(table.code)).incarnation,
    parseMatchResult(dice, ACCOUNT, round(table.ids, 0))!,
  );
  const stored = await f.database.transactMatch("dice", id, (current) => ({
    result: current as MatchRecord,
  }));
  const point = stored.ratings![table.ids[0]!]!;
  assert.ok(parseMatchRecord(platform, stored));
  for (const [label, change] of Object.entries<Record<string, unknown>>({
    "a null game": { gameId: null },
    "a negative creation time": { createdAt: -1 },
    "an infinite end": { endedAt: Infinity },
    "a string expiry": { expiresAt: "soon" },
    "a malformed rating scope": { ratingScope: "x" },
    "ratings that are a list": { ratings: [] },
    "a rating for a stranger": { ratings: { ["c".repeat(24)]: point } },
    "a rating that is not an object": { ratings: { [table.ids[0]!]: 5 } },
    "a rating from another match": {
      ratings: { [table.ids[0]!]: { ...point, match: "f".repeat(40) } },
    },
    "rivalry pairs that are a string": { rivalryPairs: "a:b" },
    "a malformed rivalry pair": { rivalryPairs: ["a:b"] },
    "an unknown status": { status: "void" },
    "a pending record with an end": { status: "pending" },
  }))
    assert.equal(
      parseMatchRecord(platform, { ...stored, ...change }),
      undefined,
      label,
    );
});

test("rank fields follow the rating: absent without one, unranked before a game, Elo rounded", () => {
  assert.deepEqual(rankFields({}), {});
  const rating = { value: 1015.6, peak: 1015.6, games: 0, points: [] };
  assert.deepEqual(rankFields({ rating }), { ranked: false, elo: 1016 });
  assert.deepEqual(rankFields({ rating: { ...rating, games: 2 } }), {
    ranked: true,
    elo: 1016,
  });
});

test("legacy history paging keeps the game's own records, skips unreadable ones and stops within its bound", async () => {
  const record = (gameId: string, endedAt: number) =>
    ({ gameId, endedAt }) as unknown as MatchRecord;
  // Newest first: a page of the legacy game's query holds every game's records.
  const all = Array.from({ length: 30 }, (_, i) => {
    const endedAt = 1000 - i;
    return {
      record:
        i === 3
          ? undefined
          : record(i % 3 === 0 ? LEGACY_GAME_ID : "dice", endedAt),
      endedAt,
    };
  });
  const cursors: (number | undefined)[] = [];
  const page = async (cursor: number | undefined) => {
    cursors.push(cursor);
    return all
      .filter((doc) => cursor === undefined || doc.endedAt < cursor)
      .slice(0, 4);
  };
  const found = await collectHistory(page, LEGACY_GAME_ID, undefined, 4);
  assert.deepEqual(
    found.map((m) => m.endedAt),
    [1000, 994, 991, 988],
    "four of the game's records, the unreadable one skipped",
  );
  assert.deepEqual(cursors, [undefined, 997, 993, 989]);
  // The bound: with one pass, a page crowded by other games comes back short.
  cursors.length = 0;
  assert.deepEqual(
    (await collectHistory(page, LEGACY_GAME_ID, undefined, 4, 1)).map(
      (m) => m.endedAt,
    ),
    [1000],
  );
  assert.deepEqual(cursors, [undefined]);
  // The query ran out: stop without another read.
  cursors.length = 0;
  assert.deepEqual(await collectHistory(page, LEGACY_GAME_ID, 973, 4), []);
  assert.deepEqual(cursors, [973]);
});
