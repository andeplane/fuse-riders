import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import {
  AUTH_FRAME_MAX_BYTES,
  CLOSE_ROOM_ENDED,
  LEGACY_GAME_ID,
  authFrame,
  validGameId,
} from "fuse-network-protocol";
import { createDevRoomService } from "../src/dev.js";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import {
  RoomStore,
  parseRoomRecord,
  peerId,
  roomGameId,
  roomGameIds,
} from "../src/room-store.js";
import { readAuthFrame } from "../src/socket-auth.js";

const token = (n: number) => n.toString(16).padStart(64, "0");

test("a game id is short, lowercase and dash-separated, and fits the auth frame", () => {
  for (const id of ["fuse-riders", "dice", "a", "pig-2", "x".repeat(32)])
    assert.ok(validGameId(id), id);
  for (const id of ["", "Dice", "-dice", "dice game", "x".repeat(33), 7, null])
    assert.equal(validGameId(id), false, String(id));
  assert.ok(
    Buffer.byteLength(authFrame(token(1), "x".repeat(32))) <
      AUTH_FRAME_MAX_BYTES,
  );
  assert.deepEqual(readAuthFrame(authFrame(token(1)), false), {
    token: token(1),
  });
  assert.deepEqual(readAuthFrame(authFrame(token(1), "dice"), false), {
    token: token(1),
    gameId: "dice",
  });
  assert.equal(
    readAuthFrame(
      JSON.stringify({ type: "auth", token: token(1), gameId: "Dice!" }),
      false,
    ),
    undefined,
    "a malformed game is a malformed frame",
  );
  assert.equal(
    readAuthFrame(
      JSON.stringify({ type: "auth", token: token(1), gameId: 7 }),
      false,
    ),
    undefined,
  );
});

test("a room serves the game it was created for; an absent gameId is the legacy game", async () => {
  let ids = 0;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: () => 1_000,
    id: () => `id-${ids++}`,
    gameIds: [LEGACY_GAME_ID, "dice"],
  });
  assert.throws(() => roomGameIds([]), RangeError);
  assert.throws(() => roomGameIds(["Dice"]), RangeError);
  assert.deepEqual(
    [
      ...new RoomStore(new MemoryRoomDatabase(), { now: () => 0, id: () => "" })
        .gameIds,
    ],
    [LEGACY_GAME_ID],
  );
  await assert.rejects(store.createAvailable(token(1), undefined, "chess"), {
    status: 400,
    message: "Unknown game",
  });
  const legacy = await store.createAvailable(token(1)),
    dice = await store.createAvailable(token(2), undefined, "dice");
  assert.equal((await store.get(legacy)).gameId, LEGACY_GAME_ID);
  assert.equal((await store.get(dice)).gameId, "dice");
  await store.admit(legacy, token(3), "gateway");
  await store.admit(legacy, token(4), "gateway", LEGACY_GAME_ID);
  await store.admit(dice, token(5), "gateway", "dice");
  for (const [code, gameId] of [
    [legacy, "dice"],
    [dice, undefined],
    [dice, LEGACY_GAME_ID],
    [dice, "chess"],
  ] as const)
    await assert.rejects(store.admit(code, token(6), "gateway", gameId), {
      status: 404,
      message: "Room is for another game",
    });
  assert.equal((await store.get(dice)).members[peerId(token(6))], undefined);

  // A room stored before rooms carried a game is the legacy game's.
  const stored = structuredClone(await store.get(legacy));
  delete stored.gameId;
  assert.equal(roomGameId(stored), LEGACY_GAME_ID);
  assert.ok(parseRoomRecord(stored));
  assert.ok(parseRoomRecord({ ...stored, gameId: "dice" }));
  assert.equal(parseRoomRecord({ ...stored, gameId: "Dice!" }), undefined);
  assert.equal(parseRoomRecord({ ...stored, gameId: 7 }), undefined);
  await store.database.transact(legacy, () => ({
    room: stored,
    result: undefined,
  }));
  await store.admit(legacy, token(7), "gateway");
  // The rollout case: a new client names the legacy game for a room stored before rooms carried one.
  await store.admit(legacy, token(9), "gateway", LEGACY_GAME_ID);
  await assert.rejects(store.admit(legacy, token(8), "gateway", "dice"), {
    status: 404,
  });
});

test("over the wire: creation names a hosted game, and a socket for another game is closed as a missing room", async () => {
  const service = createDevRoomService({ gameIds: [LEGACY_GAME_ID, "dice"] });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`;
  const create = async (query = "") => {
    const response = await fetch(`${origin}/api/rooms${query}`, {
      method: "POST",
      headers: { origin },
    });
    return {
      status: response.status,
      body: (await response.json()) as { code: string; token: string },
    };
  };
  const open = (code: string, value: string, gameId?: string) =>
    new Promise<{ welcomed: boolean; code?: number; reason?: string }>(
      (resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/api/rooms/${code}/ws`,
          { origin },
        );
        socket.once("open", () => socket.send(authFrame(value, gameId)));
        socket.once("message", () => {
          socket.close();
          resolve({ welcomed: true });
        });
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
  try {
    assert.equal((await create("?gameId=chess")).status, 400);
    assert.equal((await create("?gameId=NOT%20A%20GAME")).status, 400);
    const dice = await create("?gameId=dice"),
      legacy = await create();
    assert.equal(dice.status, 201);
    assert.equal(legacy.status, 201);
    assert.deepEqual(await open(dice.body.code, dice.body.token, "dice"), {
      welcomed: true,
    });
    // A page from before games sends no gameId: it may only join the legacy game's rooms.
    assert.deepEqual(await open(legacy.body.code, token(9)), {
      welcomed: true,
    });
    assert.deepEqual(await open(dice.body.code, token(10)), {
      welcomed: false,
      code: CLOSE_ROOM_ENDED,
      reason: "Room is for another game",
    });
    assert.deepEqual(await open(legacy.body.code, token(11), "dice"), {
      welcomed: false,
      code: CLOSE_ROOM_ENDED,
      reason: "Room is for another game",
    });
  } finally {
    await service.close();
  }
});
