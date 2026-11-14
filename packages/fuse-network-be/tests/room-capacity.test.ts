import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryRoomDatabase,
  RoomError,
  RoomStore,
  parseRoomRecord,
  roomGuestLimits,
} from "../src/index.js";

const token = (n: number) => n.toString(16).padStart(64, "0");
async function fill(store: RoomStore, guests: number): Promise<string> {
  const code = await store.createAvailable(token(1));
  for (let n = 0; n < guests; n++)
    await store.admit(code, token(10 + n), "gateway");
  return code;
}
test("capacity is configurable and always keeps the creator a seat", async () => {
  let ids = 0;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: () => 1000,
    id: () => `id-${++ids}`,
    maxGuests: 2,
    fullMessage: "Table is full",
  });
  const code = await fill(store, 2);
  await assert.rejects(
    store.admit(code, token(99), "gateway"),
    (error: unknown) =>
      error instanceof RoomError &&
      error.status === 429 &&
      error.message === "Table is full",
  );
  assert.equal(
    (await store.admit(code, token(1), "gateway")).member.host,
    true,
  );
});
test("default capacity is the creator plus five with neutral wording", async () => {
  let ids = 0;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: () => 1000,
    id: () => `id-${++ids}`,
  });
  const code = await fill(store, 5);
  await assert.rejects(
    store.admit(code, token(99), "gateway"),
    (error: unknown) =>
      error instanceof RoomError && error.message === "Room full",
  );
});

test("configured rooms round-trip through stored metadata validation and retain a capacity bound", async () => {
  for (const maxGuests of [0, 2, 5, 6, 10]) {
    let ids = 0;
    const store = new RoomStore(new MemoryRoomDatabase(), {
      now: () => 1000,
      id: () => `id-${++ids}`,
      maxGuests,
    });
    const code = await fill(store, maxGuests);
    const { room } = await store.admit(code, token(1), "gateway");
    assert.equal(Object.keys(room.members).length, maxGuests + 1);
    assert.deepEqual(
      parseRoomRecord(JSON.parse(JSON.stringify(room)), maxGuests),
      room,
    );
    if (maxGuests > 0)
      assert.equal(
        parseRoomRecord(room, maxGuests - 1),
        undefined,
        "a smaller configured bound rejects the record",
      );
    if (maxGuests > 5)
      assert.equal(
        parseRoomRecord(room),
        undefined,
        "the default bound stays unchanged",
      );
    await assert.rejects(
      store.admit(code, token(99), "gateway"),
      (error) => error instanceof RoomError && error.status === 429,
    );
    assert.deepEqual(
      parseRoomRecord(
        await store.time(code, room.members[room.hostId]!, room.grant),
        maxGuests,
      ),
      await store.get(code),
    );
  }
});
test("invalid capacity configuration fails before accepting members or parsing metadata", () => {
  for (const maxGuests of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () =>
        new RoomStore(new MemoryRoomDatabase(), {
          now: () => 1000,
          id: () => "id",
          maxGuests,
        }),
      RangeError,
    );
    assert.throws(() => parseRoomRecord({}, maxGuests), RangeError);
  }
});

test("each game's rooms have their own size, a game without one the default, and the refusal says the same to all", async () => {
  let ids = 0;
  const limits = { maxGuests: 3, gameMaxGuests: { lane: 6, duel: 1 } },
    store = new RoomStore(new MemoryRoomDatabase(), {
      now: () => 1000,
      id: () => `id-${++ids}`,
      gameIds: ["lane", "duel", "plain"],
      ...limits,
    }),
    bound = roomGuestLimits(limits.maxGuests, limits.gameMaxGuests);
  for (const [gameId, guests] of [
    ["lane", 6],
    ["duel", 1],
    ["plain", 3],
  ] as const) {
    const code = await store.createAvailable(token(1), undefined, gameId);
    for (let n = 0; n < guests; n++)
      await store.admit(code, token(10 + n), "gateway", gameId);
    await assert.rejects(
      store.admit(code, token(99), "gateway", gameId),
      (error: unknown) =>
        error instanceof RoomError &&
        error.status === 429 &&
        error.message === "Room full",
      `${gameId} admits ${guests} guests`,
    );
    // The creator's seat is kept whatever the game's size, and the stored room passes its own game's bound only.
    const { room } = await store.admit(code, token(1), "gateway", gameId);
    assert.equal(Object.keys(room.members).length, guests + 1);
    assert.deepEqual(parseRoomRecord(structuredClone(room), bound), room);
    assert.equal(
      parseRoomRecord(structuredClone(room), (id) => bound(id) - 1),
      undefined,
    );
  }
});
test("invalid per-game capacity fails at configuration", () => {
  assert.throws(() => roomGuestLimits(5, { lane: -1 }), RangeError);
  assert.throws(() => roomGuestLimits(5, { lane: 1.5 }), RangeError);
  assert.throws(() => roomGuestLimits(5, { "Not A Game": 5 }), RangeError);
  assert.equal(roomGuestLimits(undefined, { lane: 9 })("lane"), 9);
  assert.equal(roomGuestLimits()("anything"), 5);
});
