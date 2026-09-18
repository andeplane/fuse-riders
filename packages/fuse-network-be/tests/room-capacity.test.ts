import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryRoomDatabase,
  RoomError,
  RoomStore,
  parseRoomRecord,
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
