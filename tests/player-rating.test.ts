import test from "node:test";
import assert from "node:assert/strict";
import { calculateElo } from "../src/shared/elo.js";
import { parseRating, newRating } from "../src/shared/rating.js";
import {
  beginMatchParticipant,
  snapshotMatchStats,
  type MatchStatsState,
} from "../src/shared/match-stats.js";
import { emptyCombat, parseCombat } from "../src/shared/combat-stats.js";
import {
  careerFor,
  emptyBuckets,
  emptyCareer,
  gameGroup,
  mergeCareer,
  parseBuckets,
} from "../src/shared/career-stats.js";
import {
  HistoryStore,
  parseMatchRecord,
  parseMatchResult,
  parseProfile,
  type MatchResult,
} from "../src/service/history.js";
import { MemoryHistoryDatabase } from "../src/service/memory-history.js";
import { MemoryRoomDatabase, RoomStore, peerId, digest } from "fuse-network-be";

function result(ids: string[], matchId = "match-1"): MatchResult {
  const map: MatchStatsState = new Map();
  ids.forEach((id, slot) =>
    beginMatchParticipant(map, {
      id,
      slot,
      name: `Rider ${slot + 1}`,
      color: "#123456",
    }),
  );
  const players = snapshotMatchStats(map).map((p, i) => ({
    ...p,
    roundsPlayed: 1,
    roundWins: i === 0 ? 1 : 0,
    matchScoreUnits: (ids.length - i) * 60,
    matchPlacement: i + 1,
    survivalTicks: 100,
    longestSurvivalTicks: 40,
    distanceUnits: 123.5,
  }));
  return {
    matchId,
    length: 1,
    round: 1,
    players,
    finishers: ids.filter((id) => !id.startsWith("bot:")).sort(),
  };
}
async function fixture(count = 2) {
  let now = 1_800_000_000_000;
  const database = new MemoryHistoryDatabase(() => now),
    rooms = new RoomStore(new MemoryRoomDatabase(), {
      now: () => now,
      id: () => "room-id",
    });
  const history = new HistoryStore(database, rooms, () => now),
    tokens = Array.from({ length: count }, (_, i) =>
      (i + 1).toString(16).padStart(64, "0"),
    );
  const code = await rooms.createAvailable(tokens[0]!);
  for (const token of tokens) await rooms.admit(code, token, "gateway");
  let request = 0;
  return {
    database,
    history,
    ids: tokens.map(peerId),
    advance: () => {
      now += 1000;
    },
    report: async (
      i: number,
      match: MatchResult,
      uid: string | null = `user${i}`,
    ) =>
      history.submit(
        await history.admit(
          code,
          tokens[i]!,
          `request-${request++}`,
          match.round !== undefined,
        ),
        { result: match },
        uid ?? undefined,
      ),
  };
}

test("Elo uses simultaneous, normalized multiplayer comparisons including ties", () => {
  assert.deepEqual([...calculateElo([])], []);
  assert.equal(
    calculateElo([{ id: "a", rating: 1000, score: 1, wins: 1 }]).get("a"),
    1000,
  );
  for (const size of [2, 5, 8]) {
    const field = Array.from({ length: size }, (_, i) => ({
      id: String(i),
      rating: 1000,
      score: size - i,
      wins: 0,
    }));
    const rating = calculateElo(field);
    assert.equal(rating.get("0"), 1016);
    assert.equal(rating.get(String(size - 1)), 984);
    assert.ok(
      Math.abs([...rating.values()].reduce((a, b) => a + b, 0) - size * 1000) <
        1e-8,
    );
    assert.deepEqual(calculateElo([...field].reverse()), rating);
  }
  assert.deepEqual(
    [
      ...calculateElo([
        { id: "a", rating: 1000, score: 10, wins: 1 },
        { id: "b", rating: 1000, score: 10, wins: 1 },
      ]).values(),
    ],
    [1000, 1000],
  );
  assert.equal(
    calculateElo([
      { id: "a", rating: 1000, score: 10, wins: 2 },
      { id: "b", rating: 1000, score: 10, wins: 1 },
    ]).get("a"),
    1016,
  );
  assert.ok(
    calculateElo([
      { id: "a", rating: 800, score: 1, wins: 1 },
      { id: "b", rating: 1200, score: 0, wins: 0 },
    ]).get("a")! > 816,
  );
  for (const field of [
    [{ id: "bot:1", rating: 1000, score: 1, wins: 1 }],
    [{ id: "a", rating: NaN, score: 1, wins: 1 }],
    [
      { id: "a", rating: 1000, score: 1, wins: 1 },
      { id: "a", rating: 1000, score: 1, wins: 1 },
    ],
  ])
    assert.throws(() => calculateElo(field));
});

test("human Elo settles exactly once, graph and public rank agree, AI positions cannot award points", async () => {
  const f = await fixture();
  const match = result([f.ids[0]!, "bot:1", f.ids[1]!]);
  await f.report(0, match);
  assert.equal((await f.history.profile("user0"))?.rating, undefined);
  await f.report(1, match);
  const first = (await f.history.profile("user0"))!;
  assert.equal(first.rating!.value, 1016);
  assert.equal(first.rank, 1);
  assert.equal((await f.history.profile("user1"))!.rating!.value, 984);
  assert.equal(first.career, undefined);
  assert.equal(first.totals.matches, 0);
  assert.equal(first.rating!.points[0]!.after, first.rating!.value);
  await Promise.all([f.report(0, match), f.report(1, match)]);
  assert.deepEqual((await f.history.profile("user0"))!.rating, first.rating);
  const board = await f.history.leaderboard("board-ip", "user0");
  assert.deepEqual(
    board.map((p) => [p.rank, p.elo, p.you]),
    [
      [1, 1016, true],
      [2, 984, undefined],
    ],
  );
  assert.equal(JSON.stringify(board).includes("user0"), false);
  const history = await f.history.history("user0", undefined);
  assert.equal(history.matches.length, 0);
  const onlyAI = result([f.ids[0]!, "bot:1"], "ai-game");
  await f.report(0, onlyAI);
  assert.equal((await f.history.profile("user0"))!.rating!.games, 1);
  assert.equal((await f.history.profile("user0"))!.career, undefined);
  await f.history.rename("user0", { username: "New name" });
  assert.equal((await f.history.leaderboard("board-ip"))[0]!.name, "New name");
  assert.equal((await f.history.profile("user0"))!.rating!.value, 1016);
});

test("late identity completes rating and rivals once; guests, departures and partial matches stay unrated", async () => {
  const f = await fixture();
  const match = result(f.ids);
  match.players[0]!.combat!.victims[f.ids[1]!] = 2;
  await f.report(0, match);
  await f.report(1, match, null);
  assert.equal((await f.history.profile("user0"))?.rating, undefined);
  assert.deepEqual(await f.database.rivals("user0"), { nemeses: [], prey: [] });
  f.advance();
  await f.report(1, match);
  assert.equal((await f.history.profile("user0"))!.rating!.value, 1016);
  assert.equal(
    (await f.history.profile("user0"))!.rating!.points[0]!.at,
    1_800_000_001_000,
  );
  const rivals = await f.database.rivals("user0");
  assert.equal(rivals.prey.length, 0);
  assert.equal((await f.history.profile("user1"))!.name, "Rider 2");
  await f.report(0, match);
  assert.equal((await f.database.rivals("user0")).prey.length, 0);
  const variants = ["departure", "partial"] as const;
  for (const mode of variants) {
    const g = await fixture(),
      m = result(g.ids);
    if (mode === "departure") m.finishers = [g.ids[0]!];
    else m.players[1]!.roundsPlayed = 0;
    await g.report(0, m);
    await g.report(1, m);
    assert.equal((await g.history.profile("user0"))?.rating, undefined);
  }
});

test("a rider who left, joined late or played as a guest is left out instead of voiding the match", async () => {
  const variants = ["departure", "partial", "guest"] as const;
  for (const mode of variants) {
    const f = await fixture(3),
      match = result(f.ids);
    if (mode === "departure") match.finishers = [f.ids[0]!, f.ids[1]!].sort();
    if (mode === "partial") match.players[2]!.roundsPlayed = 0;
    await f.report(0, match);
    await f.report(1, match);
    // Only a rider who stayed is waited for: they may be about to report signed in.
    assert.equal(
      (await f.history.profile("user0"))?.rating?.games,
      mode === "guest" ? undefined : 1,
      mode,
    );
    if (mode !== "departure")
      await f.report(2, match, mode === "guest" ? null : "user2");
    assert.equal((await f.history.profile("user0"))!.rating!.value, 1016, mode);
    assert.equal((await f.history.profile("user1"))!.rating!.value, 984, mode);
    const third = await f.history.profile("user2");
    assert.equal(third?.rating, undefined, mode);
    assert.equal(third?.totals.matches, undefined);
  }
  const f = await fixture(3),
    match = result(f.ids);
  await f.report(0, match);
  await f.report(1, match);
  assert.equal((await f.history.profile("user0"))?.rating, undefined);
  await f.report(2, match);
  assert.deepEqual(
    await Promise.all(
      [0, 1, 2].map(
        async (i) => (await f.history.profile(`user${i}`))!.rating!.value,
      ),
    ),
    [1016, 1000, 984],
  );
});

test("conflicting reports for the same match cannot rate twice; concurrent matches read fresh ratings", async () => {
  const f = await fixture(),
    match = result(f.ids);
  await Promise.all([f.report(0, match), f.report(1, match)]);
  const variant = structuredClone(match);
  variant.players[1]!.matchScoreUnits = 999;
  await f.report(0, variant);
  await f.report(1, variant);
  assert.equal((await f.history.profile("user0"))!.rating!.games, 1);
  f.advance();
  const next = result(f.ids, "match-2"),
    next2 = result(f.ids, "match-3");
  await Promise.all([
    f.report(0, next),
    f.report(1, next),
    f.report(0, next2),
    f.report(1, next2),
  ]);
  const rating = (await f.history.profile("user0"))!.rating!;
  assert.equal(rating.games, 3);
  assert.ok(rating.value < 1048 && rating.value > 1040);
  assert.equal(rating.points[1]!.before, rating.points[0]!.after);
  assert.equal(rating.points[2]!.before, rating.points[1]!.after);
});

test("career filters and combat attribution retain fractional distance and do not invent old detail", () => {
  const m = result(["a", "b", "bot:1"]),
    p = m.players[0]!;
  Object.assign(p.combat!.victims, { b: 2, "bot:1": 3 });
  Object.assign(p.combat!.killers, { b: 1, "bot:1": 2 });
  p.combat!.versus.human.kills.trail = 2;
  p.combat!.versus.ai.kills.bomb = 3;
  p.combat!.uses.bomb = 5;
  p.combat!.kills.bomb = 3;
  p.combat!.roundPlaces[0] = 2;
  const stats = careerFor(p, m.players),
    total = mergeCareer(emptyCareer(), stats);
  assert.equal(total.distance, 123.5);
  assert.equal(total.humanKills, 2);
  assert.equal(total.aiKills, 3);
  assert.equal(total.humanDeaths, 1);
  assert.equal(total.aiDeaths, 2);
  assert.equal(total.combat.versus.ai.kills.bomb, 3);
  assert.equal(total.combat.uses.bomb, 5);
  assert.equal(gameGroup(m.players), "mixed");
  assert.equal(gameGroup(m.players.slice(0, 2)), "human");
  assert.equal(gameGroup([p]), "practice");
  delete p.combat;
  assert.equal(careerFor(p, m.players).detailMatches, 0);
  const buckets = emptyBuckets();
  buckets.mixed = stats;
  assert.deepEqual(parseBuckets(buckets), buckets);
  assert.equal(parseBuckets({}), undefined);
  assert.equal(parseBuckets(null), undefined);
  assert.equal(
    parseBuckets({
      ...buckets,
      human: { ...buckets.human, distance: Infinity },
    }),
    undefined,
  );
  assert.equal(
    parseBuckets({ ...buckets, human: { ...buckets.human, placements: [-1] } }),
    undefined,
  );
});

test("storage rejects corrupt combat/rating data before it can change the ladder", () => {
  const good = emptyCombat();
  assert.deepEqual(parseCombat(good), good);
  for (const bad of [
    null,
    {},
    { ...good, extra: 1 },
    { ...good, kills: {} },
    { ...good, victims: { a: -1 } },
    { ...good, killers: { a: Infinity } },
    { ...good, versus: {} },
    { ...good, versus: { human: {}, ai: {} } },
    { ...good, roundPlaces: [-1, 0, 0, 0, 0] },
  ])
    assert.equal(parseCombat(bad), undefined);
  assert.deepEqual(parseRating(newRating()), newRating());
  for (const bad of [
    null,
    {},
    { ...newRating(), value: Infinity },
    { ...newRating(), points: [{}] },
    {
      ...newRating(),
      points: [{ match: "a".repeat(40), at: 1, before: 1000, after: 1016 }],
    },
  ])
    assert.equal(parseRating(bad), undefined);
  assert.equal(parseProfile(undefined), undefined);
  assert.throws(() => parseProfile({ rating: {} }));
  assert.throws(() => parseProfile({ career: {} }));
});

test("rating graphs retain the latest 100 points without resetting current Elo or old receipts", async () => {
  const database = new MemoryHistoryDatabase(() => 5000);
  const ids = ["a".repeat(24), "b".repeat(24)];
  for (let i = 1; i <= 105; i++) {
    const id = i.toString(16).padStart(40, "0"),
      match = result(ids, `retention-${i}`);
    await database.transactMatch(id, () => ({
      match: {
        version: 1,
        id,
        ratingScope: id,
        roomCode: "AB42",
        status: "confirmed",
        result: match,
        attesters: ids,
        uidByPlayer: { [ids[0]!]: "a", [ids[1]!]: "b" },
        avatars: {},
        participantUids: ["a", "b"],
        createdAt: i,
        endedAt: i,
      },
      result: undefined,
    }));
  }
  const rating = (await database.profile("a"))!.rating!;
  assert.equal(rating.games, 105);
  assert.equal(rating.points.length, 100);
  assert.equal(rating.points[0]!.match, "6".padStart(40, "0"));
  assert.equal(rating.points.at(-1)!.after, rating.value);
  assert.deepEqual(parseRating(rating), rating);
  assert.equal(
    (await database.matchesFor("a", 2, 20))[0]!.ratings![ids[0]!]!.after,
    1016,
  );
});

test("equal public Elo shares a rank; an unranked account never enters the ladder", async () => {
  const f = await fixture(),
    match = result(f.ids);
  match.players.forEach((p) => {
    p.matchScoreUnits = 60;
    p.roundWins = 1;
    p.matchPlacement = 1;
  });
  await f.report(0, match);
  await f.report(1, match);
  await f.history.rename("unranked", { username: "No games" });
  const board = await f.history.leaderboard("public");
  assert.deepEqual(
    board.map((p) => [p.rank, p.elo]),
    [
      [1, 1000],
      [1, 1000],
    ],
  );
  assert.equal((await f.history.profile("user1"))!.rank, 1);
});

test("combat JSON ordering is canonical across reporters, including target maps", () => {
  const combat = emptyCombat();
  combat.victims.b = 1;
  combat.victims.a = 2;
  const reversed = (value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reversed(v)]),
        )
      : value;
  assert.equal(
    JSON.stringify(parseCombat(reversed(combat))),
    JSON.stringify(parseCombat(combat)),
  );
});

test("rounds settle separately before game completion; final game credits career once without more Elo", async () => {
  const f = await fixture(3);
  const first = result(f.ids.slice(0, 2));
  await f.report(1, first);
  await f.report(0, first);
  assert.equal((await f.history.profile("user0"))!.rating!.games, 1);
  // The next round includes a newcomer, and its score reverses the first round.
  const second = result(f.ids);
  second.round = 2;
  second.players[0]!.matchScoreUnits = 0;
  await f.report(2, second);
  await f.report(0, second);
  await f.report(1, second);
  assert.equal((await f.history.profile("user0"))!.rating!.games, 2);
  assert.equal((await f.history.profile("user2"))!.rating!.games, 1);
  const before = (await f.history.profile("user0"))!.rating;
  const fullGame = result(f.ids);
  delete fullGame.round;
  fullGame.length = 2;
  fullGame.players[0]!.roundsPlayed = fullGame.players[1]!.roundsPlayed = 2;
  fullGame.players[0]!.combat!.victims[f.ids[1]!] = 2;
  for (const i of [0, 1, 2, 0]) await f.report(i, fullGame);
  assert.deepEqual((await f.history.profile("user0"))!.rating, before);
  assert.equal((await f.history.profile("user0"))!.totals.matches, 1);
  assert.equal((await f.history.history("user0", undefined)).matches.length, 1);
  assert.equal((await f.database.rivals("user0")).prey[0]!.kills, 2);
  for (const i of [0, 1]) await f.report(i, first);
  assert.deepEqual((await f.history.profile("user0"))!.rating, before);
});
test("round numbers and round roster bounds reject malformed reports", async () => {
  const f = await fixture();
  for (const round of [0, -1, 1.5, 1000001, "1", null]) {
    await assert.rejects(() =>
      f.history.submit(
        { code: "AB12", rider: f.ids[0]!, incarnation: "r" },
        { result: { ...result(f.ids), round } },
        "user0",
      ),
    );
  }
});

test("a guest winning the round does not change the signed-in humans' pairwise Elo", async () => {
  const f = await fixture(3);
  const round = result([f.ids[2]!, f.ids[0]!, f.ids[1]!]);
  await f.report(2, round, null);
  await f.report(1, round);
  await f.report(0, round);
  assert.equal((await f.history.profile("user0"))!.rating!.value, 1016);
  assert.equal((await f.history.profile("user1"))!.rating!.value, 984);
  assert.equal(await f.history.profile("user2"), undefined);
});
test("round parser enforces its roster and single-round bounds at report and storage boundaries", () => {
  const tooMany = result(
    Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(24)),
  );
  tooMany.players.forEach((p, i) => {
    p.slot = i % 5;
  });
  tooMany.finishers = tooMany.finishers.slice(0, 5);
  assert.equal(parseMatchResult(tooMany), undefined);
  assert.equal(
    parseMatchResult({
      ...result(["a".repeat(24), "b".repeat(24)]),
      length: 2,
    }),
    undefined,
  );
});

test("account round quota exhaustion cannot register a guest vote and can recover", async () => {
  class LimitedDatabase extends MemoryRoomDatabase {
    limited = true;
    override async allowance(
      key: string,
      now: number,
      limit: number,
    ): Promise<boolean> {
      if (this.limited && key === digest("round-link:user2")) return false;
      return super.allowance(key, now, limit);
    }
  }
  const db = new LimitedDatabase();
  const rooms = new RoomStore(db, { now: () => 1000, id: () => "quota-room" });
  const history = new HistoryStore(
    new MemoryHistoryDatabase(() => 1000),
    rooms,
    () => 1000,
  );
  const tokens = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const code = await rooms.createAvailable(tokens[0]!);
  for (const token of tokens) await rooms.admit(code, token, "gateway");
  const round = result(tokens.map(peerId));
  const report = async (i: number) =>
    history.submit(
      await history.admit(code, tokens[i]!, `ip-${i}`, true),
      { result: round },
      `user${i}`,
    );
  await report(0);
  await report(1);
  await assert.rejects(report(2), { status: 429 });
  assert.equal((await history.profile("user0"))?.rating, undefined);
  db.limited = false;
  await report(2);
  assert.equal((await history.profile("user0"))!.rating!.value, 1016);
  assert.equal((await history.profile("user1"))!.rating!.value, 1000);
  assert.equal((await history.profile("user2"))!.rating!.value, 984);
});
