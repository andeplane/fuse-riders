import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { ACTION, JOIN } from "fuse-netcode";
import { CLOSE_ROOM_ENDED, authFrame, peerId } from "fuse-network-be";
import {
  HOLD,
  TARGET,
  createRoom,
  diceGame,
  matchResult,
  roundResult,
} from "dice";
import { diceRegistration, parseDiceStats } from "dice/platform";
import { createDevRoomService } from "../src/service/dev.js";
import { extraGameIds, platform, platformFor } from "../src/service/history.js";
import { GAME_ID } from "../src/shared/game-id.js";
import { fold, runTo } from "../games/dice/tests/fixtures/dice.js";

const token = () => randomBytes(32).toString("hex");

/** A dice match between two seats named by their room peer ids, played through the real rules: `a` wins it 2–0. */
function playedMatch(a: string, b: string) {
  const room = createRoom("m0", { turnTicks: 40, display: false });
  fold(room, {
    a: [
      [JOIN, a, "Ada", 0, "fox", 1],
      [JOIN, b, "Bo", 1, "cat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  for (let round = 1; room.stage !== "over"; round++) {
    if (room.turn !== a) fold(room, { [room.turn]: [[HOLD, room.turnNo]] });
    room.scores[a] = TARGET;
    fold(room, { [a]: [[HOLD, room.turnNo]] });
    if (room.stage === "between") runTo(room, room.resumeAt);
  }
  return room;
}

test("the service hosts dice rooms beside Fuse Riders, and a room refuses the other game's pages", async () => {
  assert.deepEqual(platform.gameIds, [GAME_ID, diceGame.id]);
  assert.equal(diceRegistration.id, diceGame.id);
  const service = createDevRoomService({
    identity: async (value) =>
      value.startsWith("id:") ? value.slice(3) : undefined,
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      headers: { origin, ...init.headers },
    });
  const sockets: WebSocket[] = [];
  const open = (code: string, value: string, gameId?: string) =>
    new Promise<{ welcomed: boolean; code?: number; reason?: string }>(
      (resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/api/rooms/${code}/ws`,
          { origin },
        );
        sockets.push(socket);
        socket.once("open", () => socket.send(authFrame(value, gameId)));
        socket.once("message", () => resolve({ welcomed: true }));
        socket.once("close", (closeCode, reason) =>
          resolve({
            welcomed: false,
            code: closeCode,
            reason: reason.toString(),
          }),
        );
        socket.once("error", reject);
      },
    );
  const create = async (gameId: string) =>
    (await (
      await call(`/api/rooms?gameId=${gameId}`, { method: "POST" })
    ).json()) as { code: string; token: string };
  try {
    const dice = await create("dice"),
      riders = await create(GAME_ID);
    assert.deepEqual(await open(dice.code, dice.token, "dice"), {
      welcomed: true,
    });
    assert.deepEqual(await open(riders.code, riders.token, GAME_ID), {
      welcomed: true,
    });
    const refused = {
      welcomed: false,
      code: CLOSE_ROOM_ENDED,
      reason: "Room is for another game",
    };
    assert.deepEqual(await open(dice.code, token(), GAME_ID), refused);
    assert.deepEqual(await open(dice.code, token()), refused);
    assert.deepEqual(await open(riders.code, token(), "dice"), refused);

    // Two signed-in players finish a rated dice round and the match.
    const guest = token();
    assert.deepEqual(await open(dice.code, guest, "dice"), { welcomed: true });
    const a = peerId(dice.token),
      b = peerId(guest),
      room = playedMatch(a, b);
    const report = (
      path: string,
      value: string,
      identity: string,
      result: unknown,
    ) =>
      call(`/api/games/dice/rooms/${dice.code}/${path}`, {
        method: "POST",
        body: JSON.stringify({ result }),
        headers: {
          authorization: `Bearer ${value}`,
          "x-fuse-identity": identity,
        },
      });
    const receipt = roundResult(room, 1)!;
    assert.equal(
      (await report("round-results", dice.token, "id:alice", receipt)).status,
      200,
    );
    assert.equal(
      (await report("round-results", guest, "id:bob", receipt)).status,
      200,
    );
    // The same round on a Fuse Riders route is refused: the room is the dice game's.
    assert.equal(
      (
        await call(`/api/rooms/${dice.code}/round-results`, {
          method: "POST",
          body: JSON.stringify({ result: receipt }),
          headers: { authorization: `Bearer ${dice.token}` },
        })
      ).status,
      404,
    );
    const whole = matchResult(room)!;
    assert.deepEqual(
      await (await report("results", dice.token, "id:alice", whole)).json(),
      { status: "pending", attestations: 1, needed: 2, linked: true },
    );
    assert.equal(
      (
        (await (await report("results", guest, "id:bob", whole)).json()) as {
          status: string;
        }
      ).status,
      "confirmed",
    );

    const profile = async (path: string, who: string) =>
      (
        (await (
          await call(path, { headers: { authorization: `Bearer id:${who}` } })
        ).json()) as {
          profile: {
            rating?: { value: number };
            totals?: Record<string, number>;
          } | null;
        }
      ).profile;
    const alice = await profile("/api/games/dice/me", "alice"),
      bob = await profile("/api/games/dice/me", "bob");
    assert.ok(alice!.rating!.value > 1000, "the round winner gains dice Elo");
    assert.ok(bob!.rating!.value < 1000);
    assert.equal(alice!.totals!.matches, 1);
    assert.equal(alice!.totals!.wins, 1);
    assert.equal(alice!.totals!.roundWins, 2);
    assert.equal(bob!.totals!.wins, 0);
    // The account is shared, but Fuse Riders' rating never moved.
    const riders1 = await profile("/api/me", "alice");
    assert.ok(
      riders1?.rating === undefined || riders1.rating.value === 1000,
      JSON.stringify(riders1),
    );
    const board = (await (
      await call("/api/games/dice/leaderboard")
    ).json()) as { players: unknown[] };
    assert.equal(board.players.length, 2);
    assert.deepEqual(
      await (await call("/api/leaderboard")).json(),
      { players: [] },
      "Fuse Riders' leaderboard has nobody",
    );
  } finally {
    for (const socket of sockets) socket.close();
    await service.close();
  }
});

test("the dice registration's boundary refuses what the rules could not produce", () => {
  const room = playedMatch("a".repeat(24), "b".repeat(24));
  const [player] = matchResult(room)!.players;
  const rounds = room.history.length;
  assert.deepEqual(parseDiceStats(player, rounds), player);
  // Rebuilt in one key order whatever order it arrived in.
  const reversed = Object.fromEntries(Object.entries(player!).reverse());
  assert.deepEqual(
    Object.keys(parseDiceStats(reversed, rounds)!),
    Object.keys(player!),
  );
  const refused: Record<string, unknown>[] = [
    { ...player, extra: 1 },
    { ...player, playerId: "not-a-peer" },
    { ...player, name: " padded " },
    { ...player, slot: 5 },
    { ...player, roundWins: rounds + 1 },
    { ...player, matchPlacement: 0 },
    { ...player, earlyExits: 2 },
    { ...player, busts: player!.rolls + 1 },
    { ...player, bestTurn: 10_001 },
    { ...player, rolls: 1.5 },
  ];
  for (const raw of refused)
    assert.equal(parseDiceStats(raw, rounds), undefined, JSON.stringify(raw));
  assert.equal(parseDiceStats(null, rounds), undefined);
  const { playerId: _id, ...missing } = player!;
  assert.equal(parseDiceStats(missing, rounds), undefined);

  // Totals add up, keep the best turn, and a malformed stored total fails the read.
  const totals = diceRegistration.emptyTotals();
  diceRegistration.addTotals(totals, diceRegistration.credit(player!, []));
  diceRegistration.addTotals(
    totals,
    diceRegistration.credit(
      { ...player!, bestTurn: player!.bestTurn + 3, matchPlacement: 2 },
      [],
    ),
  );
  assert.equal(totals.totals.matches, 2);
  assert.equal(totals.totals.wins, 1);
  assert.equal(
    totals.totals.bestTurn,
    player!.bestTurn + 3,
    "the best turn is kept, not summed",
  );
  assert.deepEqual(diceRegistration.parseTotals({}), {
    totals: diceRegistration.emptyTotals().totals,
  });
  assert.deepEqual(diceRegistration.parseTotals({ totals: totals.totals }), {
    totals: totals.totals,
  });
  assert.equal(diceRegistration.parseTotals({ totals: 5 }), undefined);
  assert.equal(
    diceRegistration.parseTotals({ totals: { ...totals.totals, wins: -1 } }),
    undefined,
  );
  assert.equal(diceRegistration.isBot("bot:1"), true);
  assert.equal(diceRegistration.isBot("a".repeat(24)), false);
});

test("Cloud Run serves Fuse Riders alone until EXTRA_GAME_IDS names the dice game", async () => {
  assert.deepEqual(extraGameIds(undefined), []);
  assert.deepEqual(extraGameIds(""), []);
  assert.deepEqual(extraGameIds(" dice , dice"), ["dice"]);
  assert.throws(() => extraGameIds("chess"), /not an extra game/);
  assert.throws(() => extraGameIds(GAME_ID), /not an extra game/);
  assert.deepEqual(platformFor(extraGameIds(undefined)).gameIds, [GAME_ID]);
  assert.deepEqual(platformFor(extraGameIds("dice")).gameIds, [
    GAME_ID,
    "dice",
  ]);
  for (const [extra, status] of [
    [undefined, 400],
    ["dice", 201],
  ] as const) {
    const service = createDevRoomService({
      platform: platformFor(extraGameIds(extra)),
    });
    await new Promise<void>((resolve) =>
      service.server.listen(0, "127.0.0.1", resolve),
    );
    const origin = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
    try {
      const created = await fetch(`${origin}/api/rooms?gameId=dice`, {
        method: "POST",
        headers: { origin },
      });
      assert.equal(created.status, status, `EXTRA_GAME_IDS=${extra}`);
      const board = await fetch(`${origin}/api/games/dice/leaderboard`, {
        headers: { origin },
      });
      assert.equal(board.status, extra ? 200 : 404);
      assert.equal(
        (
          await fetch(`${origin}/api/rooms`, {
            method: "POST",
            headers: { origin },
          })
        ).status,
        201,
        "Fuse Riders is always served",
      );
    } finally {
      await service.close();
    }
  }
});
