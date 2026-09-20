import test from "node:test";
import assert from "node:assert/strict";
import {
  beginMatchParticipant,
  snapshotMatchStats,
  type MatchStatsState,
} from "../src/engine/match-stats.js";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  eliminatePlayer,
  setPlayerConnected,
  startNextRound,
  toView,
  SLOT_COLORS,
} from "../src/engine/game.js";
import {
  buildMatchReport,
  buildRoundReport,
  sendMatchReport,
  type FinishedMatch,
} from "../src/online/match-report.js";
import { parseMatchResult } from "../src/platform.js";
import { classicSettings } from "./fixtures/classic-settings.js";

const RIDER = "a".repeat(24),
  OTHER = "b".repeat(24);
function finished(): FinishedMatch {
  const stats: MatchStatsState = new Map();
  [RIDER, OTHER, "bot:1"].forEach((id, slot) =>
    beginMatchParticipant(stats, {
      id,
      name: `Rider ${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    }),
  );
  return {
    matchId: "m1",
    matchLength: 5,
    matchFinishers: [RIDER, OTHER, "bot:1"],
    matchWinnerId: RIDER,
    matchStats: snapshotMatchStats(stats),
    players: [
      { id: RIDER, avatarId: "cat" },
      { id: OTHER, avatarId: "fox" },
    ],
  };
}

test("the stats the simulation produces are exactly the stats the room service accepts", () => {
  // The service refuses unknown fields. A stat added to MatchPlayerStats without being added to its parser would
  // silently cost every player their history, so this fails instead.
  const report = buildMatchReport(finished(), RIDER)!;
  const parsed = parseMatchResult(JSON.parse(JSON.stringify(report.result)));
  assert.ok(parsed, "the service refused a real result");
  assert.deepEqual(
    new Set(Object.keys(parsed.players[0]!)),
    new Set(Object.keys(report.result.players[0]!)),
  );
  assert.equal(report.avatarId, "cat");
});

test("only a rider of the match reports it", () => {
  assert.equal(
    buildMatchReport(finished(), "c".repeat(24)),
    undefined,
    "a TV or a latecomer",
  );
  assert.equal(buildMatchReport(finished(), "bot:1"), undefined);
  const draw = buildMatchReport(
    { ...finished(), matchWinnerId: undefined },
    OTHER,
  )!;
  assert.equal("winnerId" in draw.result, false);
  assert.equal(draw.avatarId, "fox");
});

test("credentials travel as headers, and a guest sends none", async () => {
  const seen: { url: string; init: RequestInit }[] = [],
    report = buildMatchReport(finished(), RIDER)!;
  const reply = (status: number, body: unknown) =>
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init! });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  assert.equal(
    await sendMatchReport(
      "https://api.example/api/rooms/AB42/results",
      report,
      {
        fetch: reply(200, { status: "confirmed", linked: true }),
        roomToken: "room-token",
        identityToken: async () => "id-token",
      },
    ),
    "confirmed",
  );
  const headers = seen[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer room-token");
  assert.equal(headers["X-Fuse-Identity"], "id-token");
  assert.equal(
    seen[0]!.url.includes("token"),
    false,
    "no credential in the URL",
  );
  assert.equal(
    String(seen[0]!.init.body).includes("token"),
    false,
    "no credential in the body",
  );
  assert.equal(
    await sendMatchReport("u", report, {
      fetch: reply(200, { status: "pending", linked: false }),
      roomToken: "t",
      identityToken: async () => undefined,
    }),
    "pending",
  );
  assert.equal(
    "X-Fuse-Identity" in (seen[1]!.init.headers as Record<string, string>),
    false,
  );
  assert.equal(seen.length, 2, "a guest whose report went in is done");
});

test("a lost race or a dropped connection is retried; a refusal is final; nothing ever throws", async () => {
  const report = buildMatchReport(finished(), RIDER)!,
    waits: number[] = [];
  const script = (
    ...steps: (number | "offline" | { status: string; linked: boolean })[]
  ) => {
    let calls = 0;
    const run = (async () => {
      const step = steps[Math.min(calls++, steps.length - 1)]!;
      if (step === "offline") throw new Error("offline");
      return typeof step === "number"
        ? new Response("{}", { status: step })
        : new Response(JSON.stringify(step));
    }) as typeof fetch;
    return {
      transport: (identity?: string) => ({
        fetch: run,
        roomToken: "t",
        identityToken: async () => identity,
        wait: async (ms: number) => {
          waits.push(ms);
        },
        random: () => 0,
      }),
      calls: () => calls,
    };
  };
  const contended = script(503, "offline", {
    status: "confirmed",
    linked: false,
  });
  assert.equal(
    await sendMatchReport("u", report, contended.transport()),
    "confirmed",
  );
  assert.equal(contended.calls(), 3);
  assert.deepEqual(waits, [1000, 2000], "backs off between attempts");
  const refused = script(404);
  assert.equal(
    await sendMatchReport("u", report, refused.transport()),
    "failed",
  );
  assert.equal(
    refused.calls(),
    1,
    "a report the service refuses is not sent again",
  );
  // A rider whose room socket dropped is refused until it reconnects a moment later.
  const reconnecting = script(403, { status: "confirmed", linked: false });
  assert.equal(
    await sendMatchReport("u", report, reconnecting.transport()),
    "confirmed",
  );
  assert.equal(reconnecting.calls(), 2);
  const limited = script(429);
  assert.equal(
    await sendMatchReport("u", report, limited.transport()),
    "failed",
  );
  assert.equal(limited.calls(), 3);
  // Signed in, but the service could not verify it just then: the report counted, and is resent to link the account.
  const unlinked = script(
    { status: "confirmed", linked: false },
    { status: "confirmed", linked: true },
  );
  assert.equal(
    await sendMatchReport("u", report, unlinked.transport("id-token")),
    "confirmed",
  );
  assert.equal(unlinked.calls(), 2);
  const never = script({ status: "pending", linked: false });
  assert.equal(
    await sendMatchReport("u", report, never.transport("id-token")),
    "pending",
    "an account over its limit still reported",
  );
  assert.equal(never.calls(), 3);
  const broken = script({ status: "pending", linked: false });
  assert.equal(
    await sendMatchReport("u", report, {
      ...broken.transport(),
      identityToken: async () => {
        throw new Error("sdk");
      },
    }),
    "pending",
    "a failed sign-in lookup still reports",
  );
  assert.equal(broken.calls(), 3, "and is resent to link the account");
});

test("round reports use frozen confirmed standings, survive the next round and exclude spectators", () => {
  const game = createGame("round-rating", classicSettings());
  for (const [slot, id] of [RIDER, OTHER].entries())
    addPlayer(game, {
      id,
      name: `Rider ${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
      connected: true,
    });
  startMatch(game);
  for (let i = 0; i < 60; i++) step(game, new Map());
  eliminatePlayer(game, OTHER);
  step(game, new Map());
  const decided = toView(game).decidedRound!;
  assert.ok(decided.rating);
  assert.equal(buildRoundReport(decided, RIDER, decided.tick - 1), undefined);
  assert.equal(buildRoundReport(decided, "spectator", decided.tick), undefined);
  const report = buildRoundReport(decided, RIDER, decided.tick)!;
  assert.ok(parseMatchResult(report.result));
  assert.equal(report.result.round, 1);
  assert.equal(report.result.length, 1);
  assert.equal(
    report.result.players.find((p) => p.playerId === RIDER)!.roundsPlayed,
    1,
  );
  setPlayerConnected(game, OTHER, false);
  assert.deepEqual(
    buildRoundReport(toView(game).decidedRound, RIDER, game.tick),
    report,
    "a departure after the decision cannot rewrite it",
  );
  setPlayerConnected(game, OTHER, true);
  // Use the public next-round transition at its scheduled tick.
  while (game.tick < game.phaseEndsAtTick!) step(game, new Map());
  if (game.phase === "roundOver") startNextRound(game);
  assert.deepEqual(
    buildRoundReport(toView(game).decidedRound, RIDER, game.tick),
    report,
  );
  decided.rating!.finishers.length = 0;
  assert.deepEqual(
    buildRoundReport(toView(game).decidedRound, RIDER, game.tick),
    report,
    "snapshots cannot mutate the frozen simulation result",
  );
});
test("round token lookup failure retries without submitting a guest vote", async () => {
  const report = buildMatchReport(finished(), RIDER)!;
  report.result.round = 1;
  let attempts = 0;
  const headers: Headers[] = [];
  assert.equal(
    await sendMatchReport("u", report, {
      roomToken: "room",
      wait: async () => {},
      random: () => 0,
      identityToken: async () => {
        if (++attempts === 1) throw new Error("temporary");
        return "signed-in";
      },
      fetch: async (_url, init) => {
        headers.push(new Headers(init?.headers));
        return Response.json({ status: "confirmed", linked: true });
      },
    }),
    "confirmed",
  );
  assert.equal(attempts, 2);
  assert.equal(headers.length, 1);
  assert.equal(headers[0]!.get("X-Fuse-Identity"), "signed-in");
});

test("solo round reporting normalizes the local seat consistently for the authenticated endpoint", () => {
  const decision = {
    matchId: "solo-game",
    round: 2,
    tick: 500,
    shots: [],
    rating: {
      finishers: ["solo"],
      standings: [
        {
          playerId: "solo",
          name: "Rider",
          slot: 0,
          color: "#123456",
          place: 2,
          scoreUnits: 0,
        },
        {
          playerId: "bot:1",
          name: "Bot",
          slot: 1,
          color: "#654321",
          place: 1,
          scoreUnits: 120,
        },
      ],
    },
  };
  const report = buildRoundReport(decision, "solo", 500)!;
  assert.deepEqual(report.result.finishers, ["0".repeat(24)]);
  assert.equal(report.result.players[0]!.playerId, "0".repeat(24));
  assert.ok(parseMatchResult(report.result));
  assert.equal(
    decision.rating.standings[0]!.playerId,
    "solo",
    "normalization never mutates simulation state",
  );
});
