import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import {
  RoomStore,
  RoomError,
  ROOM_TTL_MS,
  CONNECTION_TTL_MS,
} from "../src/room-store.js";

const HOST = "a".repeat(64),
  GUEST = "b".repeat(64),
  OTHER = "c".repeat(64),
  CODE = "AB42";
function fixture(maxGuests?: number) {
  let now = 1000,
    serial = 0;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now: () => now,
    id: () => `id-${++serial}`,
    ...(maxGuests === undefined ? {} : { maxGuests }),
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

/** Two service instances share one database; the fast instance's clock runs SKEW_MS ahead of the slow one's. */
const SKEW_MS = 40;
function skewedFixture() {
  let now = 1000,
    serial = 0;
  const database = new MemoryRoomDatabase(),
    id = () => `id-${++serial}`;
  return {
    fast: new RoomStore(database, { now: () => now + SKEW_MS, id }),
    slow: new RoomStore(database, { now: () => now, id }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}
async function endedUnderSkew(
  late: (
    slow: RoomStore,
    guest: Awaited<ReturnType<RoomStore["admit"]>>["member"],
  ) => Promise<void>,
) {
  const f = skewedFixture();
  await f.slow.create(CODE, HOST);
  const guest = await f.slow.admit(CODE, GUEST, "slow");
  f.advance(2000);
  await f.fast.end(CODE, HOST);
  f.advance(10);
  await late(f.slow, guest.member);
  for (const store of [f.slow, f.fast])
    await assert.rejects(store.get(CODE), /expired/);
  f.advance(60_000);
  for (const store of [f.slow, f.fast]) {
    await assert.rejects(store.get(CODE), /expired/);
    await assert.rejects(store.admit(CODE, GUEST, "again"), /expired/);
  }
  await f.slow.create(CODE, OTHER);
  assert.equal((await f.fast.get(CODE)).hostId.length, 24);
}

test("creator end is absolute: a heartbeat on an instance whose clock runs behind cannot revive the room", async () => {
  await endedUnderSkew(async (slow, member) => {
    await assert.rejects(slow.time(CODE, member, undefined), /expired/);
  });
});

test("creator end is absolute: a leave on an instance whose clock runs behind cannot revive the room", async () => {
  await endedUnderSkew((slow, member) => slow.leave(CODE, member));
});

test("an ended room's code is reusable at once on an instance whose clock runs behind", async () => {
  const f = skewedFixture();
  await f.slow.create(CODE, HOST);
  const first = await f.slow.get(CODE);
  await f.fast.end(CODE, HOST);
  f.advance(10);
  await f.slow.create(CODE, OTHER);
  const second = await f.slow.get(CODE);
  assert.notEqual(second.incarnation, first.incarnation);
  assert.notEqual(second.hostId, first.hostId);
});

test("a member whose lease already expired leaves without restarting the room grace", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = await f.store.admit(CODE, HOST, "one"),
    guest = await f.store.admit(CODE, GUEST, "one");
  f.advance(20_000);
  const renewed = await f.store.time(CODE, host.member, undefined);
  f.advance(CONNECTION_TTL_MS - 20_000);
  await f.store.leave(CODE, guest.member);
  const after = await f.store.get(CODE);
  assert.equal(after.members[guest.member.id], undefined);
  assert.equal(
    after.expiresAt,
    renewed.expiresAt,
    "lapsed member's late socket close does not extend the deadline",
  );
  f.advance(1000);
  await f.store.leave(CODE, host.member);
  assert.equal(
    (await f.store.get(CODE)).expiresAt,
    renewed.expiresAt + CONNECTION_TTL_MS - 20_000 + 1000,
    "a member whose lease is live still starts the grace",
  );
});

test("a full-room admission rejection leaves the room deadline unchanged", async () => {
  const f = fixture(1);
  await f.store.create(CODE, HOST);
  const seated = await f.store.admit(CODE, GUEST, "one");
  f.advance(5000);
  await assert.rejects(
    f.store.admit(CODE, OTHER, "one"),
    (error: unknown) => error instanceof RoomError && error.status === 429,
  );
  const after = await f.store.get(CODE);
  assert.equal(after.expiresAt, seated.room.expiresAt);
  assert.equal(after.revision, seated.room.revision);
  assert.deepEqual(Object.keys(after.members), [seated.member.id]);
});
