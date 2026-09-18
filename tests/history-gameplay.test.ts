import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTick,
  createRoomState,
  type StreamEntries,
} from "../src/shared/apply-tick.js";
import { BotController } from "../src/shared/bot-controller.js";
import {
  ACTION,
  JOIN,
  LEAVE,
  PRESENCE,
  type Entry,
} from "../src/shared/input-log.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { toSnapshot } from "../src/shared/game.js";
import { decodeGameState, encodeGameState } from "../src/online/checkpoint.js";
import {
  buildMatchReport,
  sendMatchReport,
} from "../src/online/match-report.js";
import {
  HistoryStore,
  MAX_MATCH_PARTICIPANTS,
  matchRecordId,
  parseMatchResult,
  parseTotals,
} from "../src/service/history.js";
import { MemoryRoomDatabase } from "fuse-network-be";
import { MemoryHistoryDatabase } from "../src/service/memory-history.js";
import { RoomStore, peerId } from "fuse-network-be";

async function fixture(riders = 2, length = 1) {
  const tokens = Array.from({ length: riders + 1 }, (_, i) =>
    (i + 1).toString(16).padStart(64, "0"),
  );
  const ids = tokens.map(peerId),
    creator = ids[0]!;
  const rooms = new RoomStore(new MemoryRoomDatabase(), {
    now: () => 1_000,
    id: () => "incarnation",
  });
  const code = await rooms.createAvailable(tokens[0]!);
  for (const token of tokens) await rooms.admit(code, token, "gateway");
  const history = new HistoryStore(
    new MemoryHistoryDatabase(),
    rooms,
    () => 1_000,
  );
  const state = createRoomState("gameplay-history", {
    ...defaultRoomSettings(),
    length,
    weights: {},
  });
  const bots = new BotController();
  let seq = 0;
  function tick(entries: Entry[] = []) {
    const streams = new Map<string, StreamEntries>([
      [creator, { generation: 1, entries }],
    ]);
    applyTick(state, creator, streams, bots);
  }
  type EntryBody<T> = T extends [number, number, ...infer Body] ? Body : never;
  const entry = (body: EntryBody<Entry>): Entry =>
    [++seq, state.game.tick + 1, ...body] as Entry;
  const manage = (body: Parameters<typeof entry>[0]) => tick([entry(body)]);
  tick(
    ids
      .slice(0, riders)
      .map((id, slot) => entry([JOIN, id, `Rider ${slot}`, slot, "fox", 1])),
  );
  manage([ACTION, "start", state.game.matchId]);
  function until(phase: "roundOver" | "matchOver") {
    for (let i = 0; i < 20_000 && state.game.phase !== phase; i++) tick();
    assert.equal(state.game.phase, phase);
  }
  const report = () => {
    const value = buildMatchReport(
      { ...toSnapshot(state.game), matchId: state.game.matchId },
      creator,
    );
    assert.ok(value);
    return value;
  };
  async function submit(index: number, body = report()) {
    return history.submit(
      await history.admit(code, tokens[index]!, `address-${index}`),
      body,
      `account-${index}`,
    );
  }
  return { state, ids, manage, until, report, submit, history };
}

test("a complete moving online match is accepted and credits fractional distances once", async () => {
  const f = await fixture();
  f.until("matchOver");
  const report = f.report(),
    distance = report.result.players.find(
      (p) => p.playerId === f.ids[0],
    )!.distanceUnits;
  assert.ok(
    distance > 0 && !Number.isInteger(distance),
    "exercise actual motion, not empty stats",
  );
  assert.equal((await f.submit(0)).status, "pending");
  assert.equal((await f.submit(1)).status, "confirmed");
  await f.submit(0);
  const page = await f.history.history("account-0", undefined);
  assert.equal(page.matches.length, 1);
  assert.equal(page.profile!.totals.distanceUnits, distance);
  assert.equal(
    parseTotals(page.profile!.totals).distanceUnits,
    distance,
    "Firestore profile parser keeps fractions",
  );
  assert.equal(page.profile!.totals.matches, 1);
  for (const value of [-1, Infinity, NaN, 100_000_001]) {
    const invalid = structuredClone(report.result);
    invalid.players[0]!.distanceUnits = value;
    assert.equal(parseMatchResult(invalid), undefined);
  }
  assert.equal(
    parseTotals({ distanceUnits: Infinity, matches: 1.5 }).distanceUnits,
    0,
  );
  assert.equal(parseTotals({ matches: 1.5 }).matches, 0);
  assert.equal(parseTotals(null).matches, 0);
});

test("replacement riders retain distinct history with repeated slots and more than five participants", async () => {
  const f = await fixture(5, 2);
  f.until("roundOver");
  f.manage([LEAVE, f.ids[1]!]);
  f.manage([JOIN, f.ids[5]!, "Replacement", 1, "cat", 1]);
  f.until("matchOver");
  const report = f.report(),
    parsed = parseMatchResult(report.result);
  assert.ok(parsed);
  assert.equal(parsed.players.length, 6);
  assert.equal(parsed.players.filter((p) => p.slot === 1).length, 2);
  const reordered = parseMatchResult({
    ...report.result,
    players: [...report.result.players].reverse(),
    finishers: [...report.result.finishers].reverse(),
  });
  assert.ok(reordered);
  assert.equal(matchRecordId("room", parsed), matchRecordId("room", reordered));
  assert.equal((await f.submit(0)).status, "pending");
  assert.equal(
    (await f.submit(1)).status,
    "pending",
    "a departed rider cannot provide a deciding vote",
  );
  assert.equal((await f.submit(2)).status, "pending");
  assert.equal((await f.submit(3)).status, "confirmed");
  assert.equal(
    (await f.history.history("account-0", undefined)).matches[0]!.result.players
      .length,
    6,
  );
});

test("online leave and presence determine finishers, frozen across recap changes and checkpoints", async () => {
  for (const departure of [LEAVE, PRESENCE] as const) {
    const f = await fixture();
    f.manage(
      departure === LEAVE
        ? [LEAVE, f.ids[1]!]
        : [PRESENCE, f.ids[1]!, false, 1],
    );
    f.until("matchOver");
    assert.equal(
      f.report().result.players.find((p) => p.playerId === f.ids[1])!
        .earlyExits,
      0,
    );
    assert.deepEqual(f.report().result.finishers, [f.ids[0]]);
    assert.equal((await f.submit(0)).status, "confirmed");
    const before = f.report().result;
    f.manage([LEAVE, f.ids[1]!]);
    f.manage([JOIN, f.ids[2]!, "Late arrival", 1, "cat", 1]);
    const restored = decodeGameState(encodeGameState(f.state.game));
    assert.ok(restored);
    assert.deepEqual(
      buildMatchReport(
        { ...toSnapshot(restored), matchId: restored.matchId },
        f.ids[0]!,
      )!.result,
      before,
    );
    for (const finishers of [
      [f.ids[0], f.ids[0]],
      [f.ids[2]],
      Array(6).fill(f.ids[0]),
    ]) {
      const corrupt = JSON.parse(encodeGameState(restored));
      corrupt.matchFinishers = finishers;
      assert.equal(decodeGameState(JSON.stringify(corrupt)), undefined);
    }
    f.manage([ACTION, "lobby", "next-match"]);
    assert.deepEqual(f.state.game.matchFinishers, []);
  }
  const returned = await fixture();
  returned.manage([PRESENCE, returned.ids[1]!, false, 1]);
  returned.manage([PRESENCE, returned.ids[1]!, true, 2]);
  returned.until("matchOver");
  assert.equal(returned.report().result.finishers.length, 2);
  assert.equal((await returned.submit(0)).status, "pending");
  assert.equal((await returned.submit(1)).status, "confirmed");
  returned.manage([ACTION, "rematch", "next-match"]);
  assert.deepEqual(returned.state.game.matchFinishers, []);
});

test("historical rosters and finisher lists are bounded, and large valid reports avoid the keepalive body cap", async () => {
  const f = await fixture();
  f.until("matchOver");
  const report = f.report();
  report.result.players = Array.from(
    { length: MAX_MATCH_PARTICIPANTS },
    (_, i) => ({
      ...report.result.players[0]!,
      playerId: i.toString(16).padStart(24, "0"),
      slot: i % 5,
      matchPlacement: i + 1,
    }),
  );
  report.result.finishers = [report.result.players[0]!.playerId];
  delete report.result.winnerId;
  assert.ok(parseMatchResult(report.result));
  for (const finishers of [
    undefined,
    ["outsider"],
    ["bot:1"],
    [report.result.finishers[0], report.result.finishers[0]],
    report.result.players.slice(0, 6).map((p) => p.playerId),
  ]) {
    assert.equal(parseMatchResult({ ...report.result, finishers }), undefined);
  }
  assert.equal(
    parseMatchResult({
      ...report.result,
      players: [
        ...report.result.players,
        { ...report.result.players[0], playerId: "f".repeat(24) },
      ],
    }),
    undefined,
  );
  assert.ok(
    new TextEncoder().encode(JSON.stringify(report)).byteLength > 65_536,
  );
  let sent = false;
  await sendMatchReport("https://example.test/results", report, {
    roomToken: "token",
    identityToken: async () => undefined,
    fetch: async (_url, init) => {
      assert.equal(init!.keepalive, false);
      sent = true;
      return new Response('{"status":"pending"}');
    },
  });
  assert.equal(sent, true);
});
