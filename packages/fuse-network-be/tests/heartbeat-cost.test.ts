import test from "node:test";
import assert from "node:assert/strict";
import { LEASE_MS } from "fuse-network-protocol";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import {
  RoomStore,
  RoomError,
  CONNECTION_TTL_MS,
  ROOM_TTL_MS,
  LEASE_RENEW_BELOW_MS,
  GRANT_RENEW_BELOW_MS,
  ROOM_RENEW_BELOW_MS,
  peerId,
  renewalDue,
  type Member,
  type RoomDatabase,
  type RoomRecord,
} from "../src/room-store.js";
import { RoomGateway, type GatewaySocket } from "../src/gateway.js";
import type { RoomBus } from "../src/room-bus.js";

/**
 * docs/design/heartbeat-write-cost.md. Every test drives the public store/gateway API over the real in-memory
 * database behind a wrapper that counts what Firestore would bill and can hold back one watcher's notifications.
 */
class CountingDatabase implements RoomDatabase {
  transactions = 0;
  commits = 0;
  reads = 0;
  notifications = 0;
  /** Watchers registered while `holding` is set queue their notifications until `release`. */
  holding = false;
  private held: (() => void)[] = [];
  constructor(readonly memory = new MemoryRoomDatabase()) {}
  read(code: string) {
    this.reads++;
    return this.memory.read(code);
  }
  transact<T>(
    code: string,
    operation: (current: RoomRecord | undefined) => {
      room?: RoomRecord;
      result: T;
    },
  ): Promise<T> {
    this.transactions++;
    return this.memory.transact(code, (current) => {
      const next = operation(current);
      if (next.room) this.commits++;
      return next;
    });
  }
  watch(
    code: string,
    listener: (room: RoomRecord | undefined) => void,
    failed: (error: Error) => void,
  ) {
    const lagging = this.holding;
    return this.memory.watch(
      code,
      (room) => {
        this.notifications++;
        if (lagging) this.held.push(() => listener(room));
        else listener(room);
      },
      failed,
    );
  }
  release() {
    for (const notify of this.held.splice(0)) notify();
  }
  allowance(key: string, now: number, limit: number, consume?: boolean) {
    return this.memory.allowance(key, now, limit, consume);
  }
  reset() {
    this.transactions = this.commits = this.reads = this.notifications = 0;
  }
}
/** Heartbeats never cross instances, so the bus only has to start and stop. */
class QuietBus implements RoomBus {
  async start() {}
  async publish() {}
  async stop() {}
}
class Socket implements GatewaySocket {
  bufferedAmount = 0;
  messages: Record<string, unknown>[] = [];
  closes: number[] = [];
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  close(code: number) {
    this.closes.push(code);
  }
  times() {
    return this.messages.filter((m) => m.type === "time");
  }
}
const CODE = "AB42",
  token = (i: number) => (i + 10).toString(16).repeat(64),
  HOST = token(0),
  GUEST = token(1);

/** Instances share one database; instance `i` reads the shared clock plus `skews[i]`. */
function fixture(skews: number[] = [0]) {
  let now = 1000,
    serial = 0;
  const database = new CountingDatabase(),
    id = () => `id-${++serial}`;
  const instances = skews.map((skew, i) => {
    const deps = { now: () => now + skew, id, error: () => {} },
      store = new RoomStore(database, deps);
    return {
      store,
      gateway: new RoomGateway(`g${i}`, store, new QuietBus(), deps),
    };
  });
  return {
    database,
    instances,
    store: instances[0]!.store,
    gateway: instances[0]!.gateway,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    stop: () => Promise.all(instances.map((i) => i.gateway.stop())),
  };
}
type Fixture = ReturnType<typeof fixture>;
interface Seat {
  socket: Socket;
  connection: string;
  gateway: RoomGateway;
  host: boolean;
  probes: number;
}
async function seat(
  f: Fixture,
  who: string,
  instance = 0,
  socket = new Socket(),
): Promise<Seat> {
  const gateway = f.instances[instance]!.gateway;
  return {
    socket,
    gateway,
    connection: await gateway.connect(CODE, who, socket),
    host: who === HOST,
    probes: 0,
  };
}
/** What the browser sends: the creator names the newest grant it was given. */
async function heartbeat(s: Seat): Promise<void> {
  const grant = [...s.socket.messages]
    .reverse()
    .find((m) => m.grant !== undefined)?.grant;
  await s.gateway.receive(
    s.connection,
    JSON.stringify({
      type: "time",
      id: ++s.probes,
      sentAt: s.probes,
      ...(s.host && grant ? { renew: grant } : {}),
    }),
  );
}
/** The stored room, read past the counters. */
const stored = async (f: Fixture) => (await f.database.memory.read(CODE))!;
async function assertAllLive(f: Fixture, seats: Seat[], fastest = 0) {
  const room = await stored(f),
    now = f.now() + fastest;
  assert.ok(room.expiresAt > now, "room deadline lapsed");
  assert.equal(Object.keys(room.members).length, seats.length);
  for (const member of Object.values(room.members))
    assert.ok(member.expiresAt > now, `lease lapsed at ${f.now()}`);
  for (const s of seats) assert.deepEqual(s.socket.closes, []);
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
async function room(f: Fixture, guests: number, instanceOf = (_: number) => 0) {
  await f.store.create(CODE, HOST);
  const seats = [await seat(f, HOST, instanceOf(0))];
  for (let i = 1; i <= guests; i++)
    seats.push(await seat(f, token(i), instanceOf(i)));
  f.database.reset();
  return seats;
}

test("a six-member room-hour of 2 s heartbeats commits 2,400 writes instead of 10,800 and reads nothing", async () => {
  const f = fixture(),
    seats = await room(f, 5);
  let heartbeats = 0;
  for (let t = 2000; t <= 3_600_000; t += 2000) {
    f.advance(2000);
    for (const s of seats) {
      await heartbeat(s);
      heartbeats++;
    }
    await assertAllLive(f, seats);
    const grant = (await stored(f)).grant!;
    assert.ok(grant.expiresAt > f.now(), "creator grant lapsed");
  }
  assert.equal(heartbeats, 10_800);
  // Creator: the 10 s grant is at half after 6 s -> 3600/6. Guest: the 30 s lease is at two thirds after 10 s -> 3600/10.
  assert.equal(f.database.commits, 600 + 5 * 360);
  assert.equal(f.database.transactions, f.database.commits);
  assert.equal(f.database.notifications, f.database.commits);
  assert.equal(f.database.reads, 0);
  for (const s of seats) assert.equal(s.socket.times().length, 1800);
  await f.stop();
});

test("a skipped heartbeat is answered exactly like a written one", async () => {
  const f = fixture(),
    [host] = await room(f, 0);
  const answers: {
    commits: number;
    frame: Record<string, unknown>;
    grant: unknown;
  }[] = [];
  for (let i = 0; i < 4; i++) {
    f.advance(2000);
    const before = f.database.commits;
    await heartbeat(host!);
    answers.push({
      commits: f.database.commits - before,
      frame: host!.socket.times().at(-1)!,
      grant: (await stored(f)).grant,
    });
  }
  assert.deepEqual(
    answers.map((a) => a.commits),
    [0, 0, 1, 0],
  );
  for (const [i, { frame, grant }] of answers.entries()) {
    assert.deepEqual(Object.keys(frame), [
      "type",
      "id",
      "sentAt",
      "serviceTime",
      "grant",
    ]);
    assert.equal(frame.id, i + 1);
    assert.equal(frame.serviceTime, 1000 + 2000 * (i + 1));
    assert.deepEqual(frame.grant, grant);
  }
  await f.stop();
});

test("leases survive a hidden tab throttled from 1 Hz down to 0.2 Hz", async () => {
  const f = fixture(),
    seats = await room(f, 2);
  for (const [cadence, beats] of [
    [1000, 120],
    [3000, 100],
    [5000, 240],
  ] as const)
    for (let i = 0; i < beats; i++) {
      f.advance(cadence);
      for (const s of seats) await heartbeat(s);
      await assertAllLive(f, seats);
      assert.ok((await stored(f)).grant!.expiresAt > f.now());
    }
  // 5 s apart the grant is at half on every heartbeat, so the creator writes each time; a guest every second one.
  assert.ok(f.database.commits < 3 * (120 + 100 + 240));
  await f.stop();
});

/**
 * A lease is renewed with 20 s left, so the last heartbeat that was skipped left more than 20 s: at 2 s apart, 22 s.
 * The heartbeats due 2..20 s later can all go missing and the one after them (2 s left) still renews.
 */
const MISSES_BEFORE_A_LAPSE = 10;

test("whatever heartbeats go missing, a seat closes only after ten in a row, closes retryable, and is re-admitted", async () => {
  let lapses = 0;
  for (const [loss, seeds] of [
    [0.3, 50],
    [0.6, 10],
  ] as const) {
    let lapsesAtThisLoss = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const f = fixture(),
        seats = await room(f, 5),
        random = mulberry32(seed),
        missed = seats.map(() => 0);
      /** Any seat may be closed by any step: its own heartbeat, or another member's admission pruning it. */
      const settle = async () => {
        for (const [i, s] of seats.entries()) {
          if (s.socket.closes.length === 0) continue;
          assert.deepEqual(s.socket.closes, [4000], `seed ${seed}`);
          assert.ok(
            missed[i]! >= MISSES_BEFORE_A_LAPSE,
            `seed ${seed}: closed after only ${missed[i]} missed heartbeats`,
          );
          lapsesAtThisLoss++;
          missed[i] = 0;
          seats[i] = await seat(f, token(i));
          const welcome = seats[i]!.socket.messages[0]!;
          assert.equal(welcome.type, "welcome");
          assert.equal(
            (await stored(f)).members[peerId(token(i))]!.connectionId,
            welcome.connectionId,
          );
        }
      };
      for (let t = 2000; t <= 3_600_000; t += 2000) {
        f.advance(2000);
        for (const [i, s] of seats.entries()) {
          if (random() < loss) {
            missed[i]!++;
            continue;
          }
          await heartbeat(s);
          await settle();
          missed[i] = 0;
        }
      }
      await f.stop();
    }
    // 250 guest-hours at 30%: a lapse needs ten misses in a row at the wrong moment. At 60% it is routine, which is
    // what shows the invariant above was exercised rather than vacuous.
    if (loss === 0.3) assert.ok(lapsesAtThisLoss <= 5, `${lapsesAtThisLoss}`);
    else assert.ok(lapsesAtThisLoss > 50, `${lapsesAtThisLoss}`);
    lapses += lapsesAtThisLoss;
  }
  assert.ok(lapses > 0);
});

test("silence after a skipped heartbeat: nine missed heartbeats keep the seat, a lapsed seat closes retryable and rejoins", async () => {
  const f = fixture(),
    [host, guest] = await room(f, 1);
  // 8 s after admission the guest's heartbeat is still skipped (22 s of lease left): the worst moment to go quiet.
  for (let i = 0; i < 4; i++) {
    f.advance(2000);
    await heartbeat(host!);
    await heartbeat(guest!);
  }
  assert.equal(
    (await stored(f)).members[peerId(GUEST)]!.expiresAt,
    1000 + CONNECTION_TTL_MS,
  );
  // Heartbeats at 10..26 s never arrive; the one at 28 s finds 2 s of lease left and renews it.
  for (let i = 0; i < MISSES_BEFORE_A_LAPSE; i++) {
    f.advance(2000);
    await heartbeat(host!);
  }
  await heartbeat(guest!);
  assert.deepEqual(guest!.socket.closes, []);
  assert.equal(
    (await stored(f)).members[peerId(GUEST)]!.expiresAt,
    f.now() + CONNECTION_TTL_MS,
  );
  // Silence for a whole lease lapses it: the device is told to reconnect, not that it was replaced.
  for (let t = 0; t < CONNECTION_TTL_MS; t += 2000) {
    f.advance(2000);
    await heartbeat(host!);
  }
  await heartbeat(guest!);
  assert.deepEqual(guest!.socket.closes, [4000]);
  assert.deepEqual(host!.socket.closes, []);
  const back = await seat(f, GUEST);
  assert.deepEqual(back.socket.closes, []);
  assert.equal(
    (await stored(f)).members[peerId(GUEST)]!.connectionId,
    back.connection,
  );
  await f.stop();
});

test("a seat pruned after its lease lapsed closes retryable, never as a replaced tab", async () => {
  const f = fixture(),
    [host, guest] = await room(f, 1);
  for (let t = 0; t < CONNECTION_TTL_MS; t += 2000) {
    f.advance(2000);
    await heartbeat(host!);
  }
  const late = await seat(f, token(2));
  assert.deepEqual(guest!.socket.closes, [4000]);
  assert.deepEqual(host!.socket.closes, []);
  assert.deepEqual(late.socket.closes, []);
  await f.stop();
});

test("the store refuses a replaced connection, a lapsed lease and an ended room on the very next heartbeat", async () => {
  const f = fixture(),
    { store } = f;
  await store.create(CODE, HOST);
  const first = await store.admit(CODE, GUEST, "g0");
  f.advance(2000);
  f.database.reset();
  assert.equal(
    (await store.time(CODE, first.member, undefined)).revision,
    first.room.revision,
    "nothing due: a read-only transaction",
  );
  assert.deepEqual(
    [f.database.transactions, f.database.commits],
    [1, 0],
    "without a watched copy the store still checks the stored room",
  );
  const second = await store.admit(CODE, GUEST, "g0");
  await assert.rejects(
    store.time(CODE, first.member, undefined),
    (error) => error instanceof RoomError && error.status === 409,
  );
  f.advance(CONNECTION_TTL_MS);
  await assert.rejects(
    store.time(CODE, second.member, undefined),
    (error) => error instanceof RoomError && error.status === 410,
  );
  // A seat that is gone (pruned, or already departed) is a lapse to retry, never a replacement.
  await store.leave(CODE, second.member);
  await assert.rejects(
    store.time(CODE, second.member, undefined),
    (error) => error instanceof RoomError && error.status === 410,
  );
  const third = await store.admit(CODE, GUEST, "g0");
  await store.end(CODE, HOST);
  await assert.rejects(
    store.time(CODE, third.member, undefined),
    (error) => error instanceof RoomError && error.status === 404,
  );
});

test("a stale watched copy is answered without a write and refused by the next due heartbeat", async () => {
  const f = fixture(),
    { store } = f;
  await store.create(CODE, HOST);
  const old = await store.admit(CODE, GUEST, "g0"),
    stale = old.room;
  f.advance(2000);
  const replacement = await store.admit(CODE, GUEST, "g1"),
    after = await stored(f);
  f.database.reset();
  assert.equal(await store.time(CODE, old.member, undefined, stale), stale);
  assert.deepEqual([f.database.transactions, f.database.commits], [0, 0]);
  assert.deepEqual(await stored(f), after, "the replacement is untouched");
  f.advance(CONNECTION_TTL_MS / 2);
  await assert.rejects(
    store.time(CODE, old.member, undefined, stale),
    (error) => error instanceof RoomError && error.status === 409,
  );
  assert.equal(
    (await stored(f)).members[old.member.id]!.connectionId,
    replacement.member.connectionId,
  );
  // A copy of another room, or one that already shows the seat gone, is never trusted.
  await assert.rejects(
    store.time(CODE, old.member, undefined, { ...stale, code: "ZZ99" }),
    (error) => error instanceof RoomError && error.status === 409,
  );
});

test("an ended room closes heartbeating members 4004 at once while their writes are being skipped", async () => {
  const f = fixture([0, 40]),
    seats = await room(f, 3, (i) => i % 2);
  f.advance(2000);
  for (const s of seats) await heartbeat(s);
  assert.equal(f.database.commits, 0, "every heartbeat was skipped");
  await f.instances[1]!.store.end(CODE, HOST);
  // Each departure that follows is another change to the room, so a socket may be told more than once.
  for (const s of seats) {
    assert.ok(s.socket.closes.length > 0);
    assert.ok(s.socket.closes.every((code) => code === 4004));
  }
  const answered = seats.map((s) => s.socket.times().length);
  f.advance(2000);
  for (const s of seats) await heartbeat(s);
  assert.deepEqual(
    seats.map((s) => s.socket.times().length),
    answered,
    "an ended room answers no heartbeat",
  );
  await f.stop();
});

test("a room that runs out its deadline closes the next heartbeat 4004 without a transaction", async () => {
  const f = fixture(),
    [host] = await room(f, 0);
  f.advance(ROOM_TTL_MS);
  await heartbeat(host!);
  assert.deepEqual(host!.socket.closes, [4004]);
  assert.equal(host!.socket.times().length, 0);
  await f.stop();
  assert.equal(f.database.transactions, 1, "only the departure transacts");
});

test("with its watch stalled an instance still learns of an end and of a replacement within one renewal period", async () => {
  for (const event of ["end", "replace"] as const) {
    const f = fixture([0, 40]);
    await f.store.create(CODE, HOST);
    const host = await seat(f, HOST, 1);
    f.database.holding = true;
    const guest = await seat(f, GUEST, 0);
    f.database.holding = false;
    f.advance(2000);
    await heartbeat(guest);
    if (event === "end") await f.instances[1]!.store.end(CODE, HOST);
    else await seat(f, GUEST, 1);
    const changed = await stored(f),
      since = f.now();
    while (guest.socket.closes.length === 0) {
      f.advance(2000);
      await heartbeat(guest);
      assert.ok(f.now() - since <= CONNECTION_TTL_MS - LEASE_RENEW_BELOW_MS);
    }
    assert.deepEqual(guest.socket.closes, [event === "end" ? 4004 : 4001]);
    await f.instances[0]!.gateway.stop();
    const final = await stored(f);
    assert.equal(final.expiresAt, changed.expiresAt);
    if (event === "replace")
      assert.deepEqual(
        final.members,
        changed.members,
        "the stale connection's heartbeats and departure changed nothing",
      );
    assert.deepEqual(host.socket.closes, event === "end" ? [4004] : []);
    await f.stop();
  }
});

test("instances 40 ms apart neither double-write nor let a lease lapse", async () => {
  const f = fixture([0, 40]),
    seats = await room(f, 5, (i) => i % 2);
  for (let t = 2000; t <= 600_000; t += 2000) {
    f.advance(2000);
    for (const s of seats) await heartbeat(s);
    await assertAllLive(f, seats, 40);
    assert.ok((await stored(f)).grant!.expiresAt > f.now() + 40);
  }
  // Each member is renewed by the one instance that seats it, on that instance's clock: the same count as one clock.
  assert.equal(f.database.commits, 100 + 5 * 60);
  assert.equal(f.database.transactions, f.database.commits);
  assert.equal(f.database.reads, 0);
  await f.stop();
});

test("a lagging copy that shows a renewal due does not repeat a write the stored room already has", async () => {
  const f = fixture(),
    { store } = f;
  await store.create(CODE, HOST);
  const guest = await store.admit(CODE, GUEST, "g0");
  f.advance(10_000);
  const renewed = await store.time(CODE, guest.member, undefined, guest.room);
  assert.equal(renewed.revision, guest.room.revision + 1);
  f.advance(2000);
  f.database.reset();
  // The admission-time copy shows 18 s of lease left; the stored room has 28 s.
  const current = await store.time(CODE, guest.member, undefined, guest.room);
  assert.deepEqual([f.database.transactions, f.database.commits], [1, 0]);
  assert.deepEqual(current, renewed);
});

test("the creator's grant is renewed before it lapses and a duplicate creator tab is still fenced", async () => {
  const f = fixture([0, 40]);
  await f.store.create(CODE, HOST);
  const first = await seat(f, HOST, 0);
  const granted = (await stored(f)).grant!;
  let smallest = Infinity;
  for (let t = 2000; t <= 120_000; t += 2000) {
    f.advance(2000);
    smallest = Math.min(smallest, (await stored(f)).grant!.expiresAt - f.now());
    await heartbeat(first);
  }
  assert.equal(smallest, LEASE_MS - 6000);
  const renewed = (await stored(f)).grant!;
  assert.equal(renewed.epoch, granted.epoch);
  assert.equal(renewed.holder, first.connection);
  // A second creator tab, admitted by the other instance: the first is closed as replaced, its renewals are refused,
  // and the new grant starts only after the old one can no longer be valid anywhere.
  const second = await seat(f, HOST, 1);
  assert.deepEqual(first.socket.closes, [4001]);
  const fenced = (await stored(f)).grant!;
  assert.equal(fenced.epoch, renewed.epoch + 1);
  assert.equal(fenced.holder, second.connection);
  assert.equal(fenced.validFrom, renewed.expiresAt + 250);
  const stale: Member = {
    id: peerId(HOST),
    connectionId: first.connection,
    gatewayId: "g0",
    host: true,
    expiresAt: f.now() + CONNECTION_TTL_MS,
  };
  await assert.rejects(
    f.store.time(CODE, stale, renewed),
    (error) => error instanceof RoomError && error.status === 409,
  );
  // The waiting tab cannot renew a grant that is not valid yet, so it does not write for it either.
  f.advance(2000);
  f.database.reset();
  await heartbeat(second);
  assert.equal(f.database.commits, 0);
  assert.deepEqual(second.socket.times().at(-1)!.grant, fenced);
  for (let t = 0; t < 60_000; t += 2000) {
    f.advance(2000);
    await heartbeat(second);
    const grant = (await stored(f)).grant!;
    assert.equal(grant.epoch, fenced.epoch);
    assert.ok(grant.expiresAt > f.now() + 40);
  }
  assert.deepEqual(second.socket.closes, []);
  await f.stop();
});

test("renewalDue: the lease at two thirds, the room deadline and a renewable grant at half, nothing else", () => {
  const member: Member = {
      id: peerId(HOST),
      connectionId: "c1",
      gatewayId: "g0",
      host: true,
      expiresAt: 0,
    },
    grant = {
      incarnation: "i",
      epoch: 1,
      holder: "c1",
      grantId: "grant",
      validFrom: 0,
      expiresAt: 100_000 + LEASE_MS,
    },
    at = (lease: number, deadline: number, granted = grant): RoomRecord => ({
      version: 2,
      code: CODE,
      incarnation: "i",
      hostHash: "0".repeat(64),
      hostId: member.id,
      revision: 1,
      expiresAt: 100_000 + deadline,
      members: { [member.id]: { ...member, expiresAt: 100_000 + lease } },
      grant: granted,
    });
  const due = (room: RoomRecord, now = 100_000, renew = true) =>
    renewalDue(room, member, renew ? grant : undefined, now);
  assert.equal(due(at(CONNECTION_TTL_MS, ROOM_TTL_MS)), false);
  assert.deepEqual(
    [LEASE_RENEW_BELOW_MS, GRANT_RENEW_BELOW_MS, ROOM_RENEW_BELOW_MS],
    [20_000, 5000, 45_000],
  );
  assert.equal(due(at(LEASE_RENEW_BELOW_MS + 1, ROOM_TTL_MS)), false);
  assert.equal(due(at(LEASE_RENEW_BELOW_MS, ROOM_TTL_MS)), true);
  assert.equal(due(at(CONNECTION_TTL_MS, ROOM_RENEW_BELOW_MS + 1)), false);
  assert.equal(due(at(CONNECTION_TTL_MS, ROOM_RENEW_BELOW_MS)), true);
  const room = at(CONNECTION_TTL_MS, ROOM_TTL_MS);
  assert.equal(due(room, 100_000 + LEASE_MS - GRANT_RENEW_BELOW_MS - 1), false);
  assert.equal(due(room, 100_000 + LEASE_MS - GRANT_RENEW_BELOW_MS), true);
  assert.equal(
    due(room, 100_000 + LEASE_MS - GRANT_RENEW_BELOW_MS, false),
    false,
  );
  assert.equal(
    renewalDue(
      room,
      { ...member, host: false },
      grant,
      100_000 + LEASE_MS - GRANT_RENEW_BELOW_MS,
    ),
    false,
    "a guest never writes for the creator's grant",
  );
  const waiting = { ...grant, validFrom: 200_000, expiresAt: 210_000 };
  assert.equal(
    renewalDue(
      at(CONNECTION_TTL_MS, ROOM_TTL_MS, waiting),
      member,
      waiting,
      100_000,
    ),
    false,
  );
  assert.equal(
    renewalDue(
      at(CONNECTION_TTL_MS, ROOM_TTL_MS),
      member,
      { ...grant, epoch: 2 },
      100_000 + LEASE_MS - GRANT_RENEW_BELOW_MS,
    ),
    false,
    "a grant this claimant cannot renew is no reason to write",
  );
});
