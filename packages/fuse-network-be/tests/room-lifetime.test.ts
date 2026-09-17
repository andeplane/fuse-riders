import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import {
  RoomStore,
  ROOM_TTL_MS,
  CONNECTION_TTL_MS,
} from "../src/room-store.js";

const HOST = "a".repeat(64),
  GUEST = "b".repeat(64),
  CODE = "AB42";
function fixture() {
  let now = 1000,
    serial = 0;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: () => now,
    id: () => `id-${++serial}`,
  });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("last guest departure starts reconnect grace and returning guest extends it without taking creator authority", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const first = await f.store.admit(CODE, GUEST, "one");
  f.advance(10_000);
  await f.store.leave(CODE, first.member);
  const empty = await f.store.get(CODE);
  assert.deepEqual(empty.members, {});
  assert.equal(empty.expiresAt, first.room.expiresAt + 10_000);
  f.advance(ROOM_TTL_MS - 1);
  const returned = await f.store.admit(CODE, GUEST, "two");
  assert.equal(returned.room.incarnation, first.room.incarnation);
  assert.equal(returned.room.hostId, first.room.hostId);
  assert.equal(returned.member.host, false);
  assert.equal(returned.room.grant, undefined);
  assert.ok(returned.room.expiresAt > empty.expiresAt);
  await f.store.leave(CODE, first.member);
  assert.deepEqual(
    await f.store.get(CODE),
    returned.room,
    "replaced member departure cannot remove or extend current membership",
  );
  await assert.rejects(
    f.store.time(CODE, first.member, undefined),
    /Reconnected/,
  );
});

test("expired connections cannot keep rooms alive and empty rooms expire at the exact deadline", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const guest = await f.store.admit(CODE, GUEST, "one");
  f.advance(CONNECTION_TTL_MS);
  await assert.rejects(
    f.store.time(CODE, guest.member, undefined),
    /Connection lease expired/,
  );
  assert.equal((await f.store.get(CODE)).expiresAt, guest.room.expiresAt);
  f.advance(ROOM_TTL_MS - CONNECTION_TTL_MS);
  await assert.rejects(f.store.admit(CODE, GUEST, "two"), /expired/);
  await f.store.leave(CODE, guest.member);
  await assert.rejects(
    f.store.get(CODE),
    /expired/,
    "late departure cannot resurrect expired room",
  );
});

test("creator end wins over guest renewal and late departure, while guest cannot end room", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const guest = await f.store.admit(CODE, GUEST, "one");
  await assert.rejects(f.store.end(CODE, GUEST), /Only the host/);
  await f.store.time(CODE, guest.member, undefined);
  await f.store.end(CODE, HOST);
  await assert.rejects(f.store.time(CODE, guest.member, undefined), /expired/);
  await f.store.leave(CODE, guest.member);
  await assert.rejects(f.store.admit(CODE, HOST, "two"), /expired/);
});
