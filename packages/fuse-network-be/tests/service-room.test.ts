import test from "node:test";
import assert from "node:assert/strict";
import {
  RoomStore,
  RoomError,
  peerId,
  parseRoomRecord,
  type RoomDatabase,
  type RoomRecord,
  type RoomStoreDependencies,
} from "../src/room-store.js";
import { RoomGateway, type GatewaySocket } from "../src/gateway.js";
import {
  parseRoutedMessage,
  type RoomBus,
  type RoutedMessage,
} from "../src/room-bus.js";

class Database implements RoomDatabase {
  rooms = new Map<string, RoomRecord>();
  listeners = new Map<string, Set<(room: RoomRecord | undefined) => void>>();
  queued: (() => void)[] = [];
  delay = false;
  retry = false;
  reads = 0;
  transactions = 0;
  private chain: Promise<void> = Promise.resolve();
  async read(code: string) {
    this.reads++;
    return structuredClone(this.rooms.get(code));
  }
  async transact<T>(
    code: string,
    operation: (current: RoomRecord | undefined) => {
      room?: RoomRecord;
      result: T;
    },
  ): Promise<T> {
    this.transactions++;
    const work = this.chain.then(() => {
      if (this.retry) operation(structuredClone(this.rooms.get(code)));
      const next = operation(structuredClone(this.rooms.get(code)));
      if (next.room) {
        this.rooms.set(code, structuredClone(next.room));
        for (const listener of this.listeners.get(code) ?? []) {
          const room = structuredClone(next.room);
          const notify = () => listener(room);
          if (this.delay) this.queued.push(notify);
          else notify();
        }
      }
      return next.result;
    });
    this.chain = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  watch(code: string, listener: (room: RoomRecord | undefined) => void) {
    const set = this.listeners.get(code) ?? new Set();
    set.add(listener);
    this.listeners.set(code, set);
    return () => {
      set.delete(listener);
    };
  }
  async allowance() {
    return true;
  }
  flush() {
    for (const notify of this.queued.splice(0)) notify();
  }
}
class Bus implements RoomBus {
  receive?: (message: RoutedMessage) => Promise<void>;
  failed?: (error: Error) => void;
  started = 0;
  stopped = 0;
  published: RoutedMessage[] = [];
  delayed = false;
  queued: RoutedMessage[] = [];
  /** While set, every publish waits for it: a bus slower than the socket feeding it. */
  gate?: Promise<void>;
  constructor(
    private network: Map<string, Bus>,
    readonly id: string,
  ) {
    network.set(id, this);
  }
  async start(
    receive: (message: RoutedMessage) => Promise<void>,
    failed: (error: Error) => void,
  ) {
    this.receive = receive;
    this.failed = failed;
    this.started++;
  }
  async publish(message: RoutedMessage) {
    this.published.push(structuredClone(message));
    if (this.gate) await this.gate;
    if (this.delayed) this.queued.push(message);
    else
      await this.network
        .get(message.destination)
        ?.receive?.(structuredClone(message));
  }
  async stop() {
    this.receive = undefined;
    this.stopped++;
  }
  async flush() {
    for (const message of this.queued.splice(0))
      await this.network
        .get(message.destination)
        ?.receive?.(structuredClone(message));
  }
}
class Socket implements GatewaySocket {
  bufferedAmount = 0;
  messages: Record<string, unknown>[] = [];
  closes: { code: number; reason: string }[] = [];
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  close(code: number, reason: string) {
    this.closes.push({ code, reason });
  }
  frames(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
}
const HOST = "a".repeat(64),
  GUEST = "b".repeat(64),
  CODE = "AB42";
function fixture(
  makeStore: (
    database: RoomDatabase,
    dependencies: RoomStoreDependencies,
  ) => RoomStore = (database, dependencies) =>
    new RoomStore(database, dependencies),
) {
  let now = 1000,
    n = 0;
  const database = new Database(),
    network = new Map<string, Bus>(),
    aBus = new Bus(network, "a"),
    bBus = new Bus(network, "b");
  const deps = { now: () => now, id: () => `id-${++n}`, error: () => {} };
  const store = makeStore(database, deps);
  const a = new RoomGateway("a", store, aBus, deps),
    b = new RoomGateway("b", store, bBus, deps);
  return {
    database,
    store,
    a,
    b,
    aBus,
    bBus,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
async function joined(f: ReturnType<typeof fixture>) {
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  const hostConnection = await f.a.connect(CODE, HOST, host),
    guestConnection = await f.b.connect(CODE, GUEST, guest);
  return { host, guest, hostConnection, guestConnection };
}
const signal = (to: string, target: string, sdp = "v=0") =>
  JSON.stringify({
    type: "signal",
    to,
    targetConnectionId: target,
    data: { description: { type: "offer", sdp } },
  });

test("service transaction retries keep one logical connection/grant and fenced replacement", async () => {
  const f = fixture();
  f.database.retry = true;
  await f.store.create(CODE, HOST);
  const first = await f.store.admit(CODE, HOST, "a"),
    second = await f.store.admit(CODE, HOST, "b");
  assert.equal(first.room.grant?.epoch, 1);
  assert.equal(second.room.grant?.epoch, 2);
  assert.equal(second.room.grant?.validFrom, first.room.grant!.expiresAt + 250);
  await f.store.leave(CODE, first.member);
  assert.equal(
    (await f.store.get(CODE)).members[first.member.id].connectionId,
    second.member.connectionId,
  );
  await assert.rejects(
    f.store.time(CODE, first.member, first.room.grant),
    /Reconnected/,
  );
});

test("service reserves creator slot and atomically bounds concurrent admission", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const attempts = await Promise.allSettled(
    Array.from({ length: 7 }, (_, i) =>
      f.store.admit(CODE, (i + 1).toString(16).repeat(64), "b"),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 5);
  const host = await f.store.admit(CODE, HOST, "a");
  assert.equal(Object.keys(host.room.members).length, 6);
  f.advance(30_001);
  const next = await f.store.admit(CODE, GUEST, "b");
  assert.equal(Object.keys(next.room.members).length, 1);
});

test("two gateways advertise actual remote members and route only signalling", async () => {
  const f = fixture(),
    { host, guest, hostConnection, guestConnection } = await joined(f);
  assert.equal(guest.frames("welcome")[0].hostId, peerId(HOST));
  assert.equal(host.frames("peer").at(-1)?.connectionId, guestConnection);
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  assert.equal(f.aBus.published.length, 1);
  assert.equal(guest.frames("signal").length, 1);
  assert.equal(guest.frames("signal")[0].connectionId, hostConnection);
  await f.a.receive(
    hostConnection,
    JSON.stringify({
      type: "relay",
      to: peerId(GUEST),
      data: { game: "must not enter pubsub" },
    }),
  );
  assert.equal(f.aBus.published.length, 1);
  assert.match(String(host.frames("error").at(-1)?.error), /WebRTC/);
  assert.equal(guest.frames("relay").length, 0);
  await f.a.receive(
    hostConnection,
    JSON.stringify({
      type: "signal",
      to: peerId(GUEST),
      data: { type: "world", bombs: [] },
    }),
  );
  assert.equal(f.aBus.published.length, 1);
});

test("signalling permits any current member pair and denies self, foreign room and replaced target scopes", async () => {
  const f = fixture(),
    { hostConnection, guestConnection, guest } = await joined(f);
  const extra = new Socket(),
    extraId = await f.a.connect(CODE, "c".repeat(64), extra);
  await f.b.receive(guestConnection, signal(peerId("c".repeat(64)), extraId));
  assert.equal(
    extra.frames("signal").length,
    1,
    "guest-to-guest signalling carries the mesh",
  );
  await f.b.receive(guestConnection, signal(peerId(GUEST), guestConnection));
  assert.equal(guest.frames("signal").length, 0, "no self signalling");
  await f.a.receive(hostConnection, signal(peerId(GUEST), "obsolete"));
  assert.equal(guest.frames("signal").length, 0);
  const packet: RoutedMessage = {
    id: "bad",
    code: "OTHERROOM0",
    incarnation: "wrong",
    destination: "b",
    from: {
      id: peerId(HOST),
      connectionId: hostConnection,
      gatewayId: "a",
      host: true,
      expiresAt: 9999,
    },
    to: {
      id: peerId(GUEST),
      connectionId: guestConnection,
      gatewayId: "b",
      host: false,
      expiresAt: 9999,
    },
    expiresAt: 9999,
    wire: {
      type: "signal",
      from: peerId(HOST),
      connectionId: hostConnection,
      data: {},
    },
  };
  await f.b.deliver(packet);
  assert.equal(guest.frames("signal").length, 0);
});

test("fast bus after delayed metadata emits new source membership before SDP", async () => {
  const f = fixture(),
    { host, guestConnection } = await joined(f);
  f.database.delay = true;
  const replacement = new Socket(),
    newGuest = await f.b.connect(CODE, GUEST, replacement);
  const before = host.messages.length;
  await f.b.receive(
    newGuest,
    signal(peerId(HOST), String(host.frames("welcome")[0].connectionId)),
  );
  const after = host.messages.slice(before);
  assert.equal(after[0].type, "peer");
  assert.equal(after[0].connectionId, newGuest);
  assert.equal(after[1].type, "signal");
  f.database.flush();
  assert.equal(host.frames("peer").at(-1)?.connectionId, newGuest);
  await f.b.disconnect(guestConnection);
  assert.equal(
    (await f.store.get(CODE)).members[peerId(GUEST)].connectionId,
    newGuest,
  );
});

test("expired and duplicate bus packets never repeat SDP; old replacement source is rejected", async () => {
  const f = fixture(),
    { hostConnection, guestConnection, guest } = await joined(f);
  f.aBus.delayed = true;
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  const packet = f.aBus.published[0];
  await f.b.deliver(packet);
  await f.b.deliver(packet);
  assert.equal(guest.frames("signal").length, 1);
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  f.advance(10_001);
  await f.aBus.flush();
  assert.equal(guest.frames("signal").length, 1);
  const newHost = new Socket();
  await f.a.connect(CODE, HOST, newHost);
  await f.b.deliver({ ...packet, id: "old-source", expiresAt: 100_000 });
  assert.equal(guest.frames("signal").length, 1);
});

test("time renewals preserve exact authority and stale close cannot revoke replacement", async () => {
  const f = fixture(),
    { host, hostConnection } = await joined(f);
  const grant = host.frames("welcome")[0].grant;
  f.advance(1000);
  await f.a.receive(
    hostConnection,
    JSON.stringify({ type: "time", id: 1, sentAt: 25, renew: grant }),
  );
  const response = host.frames("time")[0];
  assert.equal(response.sentAt, 25);
  assert.equal(response.serviceTime, 2000);
  assert.ok(response.grant);
  const next = new Socket();
  const nextId = await f.b.connect(CODE, HOST, next);
  assert.equal(host.closes.at(-1)?.code, 4001);
  await f.a.disconnect(hostConnection);
  assert.equal((await f.store.get(CODE)).grant?.holder, nextId);
});

test("idle teardown and immediate rejoin serialize a new subscription before admission", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const first = await f.a.connect(CODE, HOST, new Socket());
  const leave = f.a.disconnect(first),
    join = f.a.connect(CODE, HOST, new Socket());
  await leave;
  const next = await join;
  assert.notEqual(next, first);
  assert.equal(f.aBus.started, 2);
  assert.equal(f.aBus.stopped, 1);
  assert.equal(f.a.state, "ready");
  await f.a.stop();
  assert.equal(f.a.state, "idle");
  assert.equal(f.aBus.stopped, 2);
});

test("bus failure and slow receiver fail explicitly without keeping hidden relay queues", async () => {
  const f = fixture(),
    { host, guest, hostConnection, guestConnection } = await joined(f);
  guest.bufferedAmount = 300_000;
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  assert.equal(guest.closes.at(-1)?.code, 1013);
  f.aBus.failed?.(new Error("bus unavailable"));
  assert.equal(host.closes.at(-1)?.code, 1012);
  await f.a.disconnect(hostConnection);
  await f.b.disconnect(guestConnection);
  assert.equal(f.a.state, "idle");
});

test("runtime metadata and bus schemas reject corrupt scope and gameplay frames", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const room = await f.store.get(CODE);
  assert.ok(parseRoomRecord(room));
  for (const bad of [
    null,
    [],
    {},
    { ...room, version: 1 },
    { ...room, expiresAt: Infinity },
    { ...room, members: { bad: {} } },
  ])
    assert.equal(parseRoomRecord(bad), undefined);
  assert.equal(parseRoutedMessage({}), undefined);
  assert.equal(
    parseRoutedMessage({
      id: "i",
      code: CODE,
      incarnation: "inc",
      destination: "b",
      expiresAt: 99,
      from: {
        id: "a",
        connectionId: "ac",
        gatewayId: "a",
        host: true,
        expiresAt: 99,
      },
      to: {
        id: "b",
        connectionId: "bc",
        gatewayId: "b",
        host: false,
        expiresAt: 99,
      },
      wire: { type: "relay", from: "a", connectionId: "ac", data: {} },
    }),
    undefined,
  );
  await assert.rejects(
    f.store.admit(CODE, "bad", "a"),
    (error: unknown) => error instanceof RoomError && error.status === 401,
  );
});

test("v2 renewal accepts GrantIdentity without timestamps at the actual JSON boundary", async () => {
  const f = fixture(),
    { host, hostConnection } = await joined(f);
  const room = await f.store.get(CODE),
    grant = room.grant!;
  const identity = {
    incarnation: grant.incarnation,
    epoch: grant.epoch,
    holder: grant.holder,
    grantId: grant.grantId,
  };
  f.advance(3000);
  await f.a.receive(
    hostConnection,
    JSON.stringify({ type: "time", id: 1, sentAt: 50, renew: identity }),
  );
  const renewed = host.frames("time")[0].grant;
  assert.ok(renewed && typeof renewed === "object");
  assert.equal(
    (renewed as { expiresAt: number }).expiresAt,
    grant.expiresAt + 3000,
  );
});

test("failed bus is drained before a queued new connection can mark it ready", async () => {
  const f = fixture(),
    { hostConnection } = await joined(f);
  // Queue admission before failure enqueues its disconnect cleanup.
  const joining = f.a.connect(CODE, "d".repeat(64), new Socket());
  f.aBus.failed?.(new Error("receive stream failed"));
  const connection = await joining;
  assert.equal(f.aBus.started, 2);
  assert.ok(f.aBus.stopped >= 1);
  assert.equal(f.a.state, "ready");
  await f.a.disconnect(hostConnection);
  await f.a.disconnect(connection);
  await f.b.stop();
});

test("short-code transactional collisions preserve the live room and retry only bounded conflicts", async () => {
  const f = fixture();
  await f.store.create("AB42", HOST);
  const original = await f.store.get("AB42");
  let attempts = 0;
  assert.equal(
    await f.store.createAvailable(GUEST, () =>
      ++attempts === 1 ? "AB42" : "CD34",
    ),
    "CD34",
  );
  assert.equal(attempts, 2);
  assert.deepEqual(await f.store.get("AB42"), original);
  attempts = 0;
  await assert.rejects(
    f.store.createAvailable(GUEST, () => {
      attempts++;
      return "AB42";
    }),
    (error) => error instanceof RoomError && error.status === 503,
  );
  assert.equal(attempts, 12);
  assert.deepEqual(await f.store.get("AB42"), original);
});
test("guest keepalives extend room lifetime and exact final expiry rejects admission", async () => {
  const f = fixture();
  await f.store.create("AB42", HOST);
  await f.store.admit("AB42", HOST, "a");
  const guest = await f.store.admit("AB42", GUEST, "b");
  let deadline = guest.room.expiresAt;
  for (let i = 0; i < 6; i++) {
    f.advance(20_000);
    const renewed = await f.store.time("AB42", guest.member, undefined);
    assert.equal(renewed.expiresAt, deadline + 20_000);
    deadline = renewed.expiresAt;
  }
  f.advance(90_000);
  await assert.rejects(f.store.get("AB42"), /expired/);
  await assert.rejects(
    f.store.time("AB42", guest.member, undefined),
    /expired/,
  );
  await assert.rejects(f.store.admit("AB42", HOST, "a"), /expired/);
});
test("current host extends reconnect grace and replacement close cannot shorten it", async () => {
  const f = fixture();
  await f.store.create("AB42", HOST);
  const first = await f.store.admit("AB42", HOST, "a");
  f.advance(20_000);
  const renewed = await f.store.time("AB42", first.member, first.room.grant);
  assert.equal(renewed.expiresAt, 111_000);
  f.advance(5000);
  await f.store.leave("AB42", first.member);
  assert.equal((await f.store.get("AB42")).expiresAt, 116_000);
  f.advance(5000);
  const next = await f.store.admit("AB42", HOST, "b");
  assert.equal(next.room.expiresAt, 121_000);
  await f.store.leave("AB42", first.member);
  assert.equal((await f.store.get("AB42")).expiresAt, 121_000);
});
test("host end is authorized, immediate and cannot end a reused code with an old capability", async () => {
  const f = fixture();
  const { host, guest, hostConnection } = await joined(f);
  const original = await f.store.get(CODE),
    member = original.members[peerId(HOST)]!;
  await assert.rejects(
    f.store.end(CODE, GUEST),
    (error) => error instanceof RoomError && error.status === 403,
  );
  await f.store.end(CODE, HOST);
  await f.store.end(CODE, HOST);
  await assert.rejects(f.store.get(CODE), /expired/);
  assert.ok(host.closes.length);
  assert.ok(guest.closes.length);
  const newHost = "c".repeat(64);
  await f.store.create(CODE, newHost);
  const replacement = await f.store.admit(CODE, newHost, "a");
  assert.notEqual(replacement.room.incarnation, original.incarnation);
  await assert.rejects(
    f.store.end(CODE, HOST),
    (error) => error instanceof RoomError && error.status === 403,
  );
  await f.store.leave(CODE, member);
  assert.deepEqual(await f.store.get(CODE), replacement.room);
  assert.ok(hostConnection);
});
test("cached signalling refuses expired rooms before asynchronous TTL deletion", async () => {
  const f = fixture();
  const { guest, guestConnection, hostConnection } = await joined(f);
  for (let i = 0; i < 4; i++) {
    f.advance(20_000);
    await f.b.receive(
      guestConnection,
      JSON.stringify({ type: "time", id: i, sentAt: i }),
    );
  }
  f.advance(90_000);
  await f.b.receive(guestConnection, signal(peerId(HOST), hostConnection));
  assert.ok(guest.closes.length);
  assert.equal(f.bBus.published.length, 0);
});

test("gateway expiry timer closes silent sockets without depending on TTL deletion or traffic", async () => {
  const f = fixture();
  let now = 1000,
    cancelled = 0,
    callback: () => void = () => {};
  const store = new RoomStore(f.database, {
    now: () => now,
    id: () => crypto.randomUUID(),
  });
  await store.create("AB42", HOST);
  const gateway = new RoomGateway("timed", store, f.bBus, {
    now: () => now,
    id: () => crypto.randomUUID(),
    error: () => {},
    schedule: (fn, delay) => {
      assert.equal(delay, 90_000);
      callback = fn;
      return () => {
        cancelled++;
      };
    },
  });
  const socket = new Socket();
  await gateway.connect("AB42", HOST, socket);
  now = 91_000;
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.closes.at(-1)?.reason, "Room expired");
  await gateway.stop();
  assert.ok(cancelled > 0);
});

test("delayed old-incarnation heartbeat or read cannot roll back a reused room view", async () => {
  for (const mode of ["time", "get"] as const) {
    let release: () => void = () => {},
      ready: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let block = false;
    class DelayedStore extends RoomStore {
      private async barrier(kind: typeof mode) {
        if (block && kind === mode) {
          block = false;
          ready();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      }
      override async time(...args: Parameters<RoomStore["time"]>) {
        const result = await super.time(...args);
        await this.barrier("time");
        return result;
      }
      override async get(...args: Parameters<RoomStore["get"]>) {
        const result = await super.get(...args);
        await this.barrier("get");
        return result;
      }
    }
    const f = fixture((db, deps) => new DelayedStore(db, deps));
    const { hostConnection } = await joined(f);
    block = true;
    const pending = f.a.receive(
      hostConnection,
      mode === "time"
        ? JSON.stringify({ type: "time", id: "late", sentAt: 0 })
        : signal(peerId(GUEST), "force-authoritative-read"),
    );
    await waiting;
    await f.store.end(CODE, HOST);
    await f.store.create(CODE, "c".repeat(64));
    const replacement = new Socket();
    await f.a.connect(CODE, "c".repeat(64), replacement);
    release();
    await pending;
    assert.equal(replacement.closes.length, 0);
    assert.equal(replacement.frames("welcome").length, 1);
    await f.a.stop();
    await f.b.stop();
  }
});
test("delayed old admission cannot replace a newly observed room incarnation", async () => {
  let release: () => void = () => {},
    ready: () => void = () => {},
    block = false;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  class DelayedStore extends RoomStore {
    override async admit(...args: Parameters<RoomStore["admit"]>) {
      const result = await super.admit(...args);
      if (block) {
        block = false;
        ready();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return result;
    }
  }
  const f = fixture((db, deps) => new DelayedStore(db, deps));
  await joined(f);
  block = true;
  const old = new Socket();
  const pending = f.a.connect(CODE, HOST, old);
  await waiting;
  await f.store.end(CODE, HOST);
  await f.store.create(CODE, "c".repeat(64));
  const fresh = new Socket();
  await f.b.connect(CODE, "c".repeat(64), fresh);
  release();
  await assert.rejects(pending, /ended during admission/);
  assert.equal(fresh.closes.length, 0);
  assert.equal(old.frames("welcome").length, 0);
  await f.a.stop();
  await f.b.stop();
});
test("cancelled metadata watch callbacks cannot mutate a recreated room view", async () => {
  const f = fixture();
  const { hostConnection } = await joined(f);
  f.database.delay = true;
  const room = await f.store.get(CODE);
  await f.store.time(CODE, room.members[peerId(HOST)]!, room.grant);
  await f.store.end(CODE, HOST);
  await f.a.disconnect(hostConnection);
  await f.b.stop();
  await f.store.create(CODE, "c".repeat(64));
  const fresh = new Socket();
  await f.a.connect(CODE, "c".repeat(64), fresh);
  f.database.flush();
  assert.equal(fresh.closes.length, 0);
  await f.a.stop();
});
test("gateway answers no malformed clock request and keeps the connection", async () => {
  const f = fixture(),
    { host, hostConnection } = await joined(f);
  for (const raw of [
    "null",
    "[]",
    JSON.stringify({ type: "time", id: {}, sentAt: 1 }),
    JSON.stringify({ type: "time", id: 1, sentAt: -1 }),
    JSON.stringify({ type: "time", id: "x".repeat(65), sentAt: 1 }),
    JSON.stringify({ type: "time", id: 1 }),
  ])
    await f.a.receive(hostConnection, raw);
  assert.equal(host.frames("time").length, 0);
  assert.equal(host.closes.length, 0);
  await f.a.receive(
    hostConnection,
    JSON.stringify({ type: "time", id: 1, sentAt: 1 }),
  );
  assert.equal(host.frames("time").length, 1);
});
test("a full room readmits an existing member and still rejects a newcomer", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  await f.store.admit(CODE, HOST, "a");
  const guests = Array.from({ length: 5 }, (_, i) =>
    (i + 1).toString(16).repeat(64),
  );
  for (const token of guests) await f.store.admit(CODE, token, "b");
  assert.equal(Object.keys((await f.store.get(CODE)).members).length, 6);
  const rejoined = await f.store.admit(CODE, guests[0]!, "a");
  assert.equal(Object.keys(rejoined.room.members).length, 6);
  assert.equal(rejoined.member.gatewayId, "a");
  await assert.rejects(
    f.store.admit(CODE, "f".repeat(64), "b"),
    (error: unknown) => error instanceof RoomError,
  );
});
test("a guest cannot renew the host authority grant", async () => {
  const f = fixture(),
    { guest, guestConnection } = await joined(f);
  const before = (await f.store.get(CODE)).grant!;
  f.advance(3000);
  await f.b.receive(
    guestConnection,
    JSON.stringify({
      type: "time",
      id: 1,
      sentAt: 1,
      renew: {
        incarnation: before.incarnation,
        epoch: before.epoch,
        holder: before.holder,
        grantId: before.grantId,
      },
    }),
  );
  assert.equal(guest.frames("time").length, 1);
  assert.deepEqual((await f.store.get(CODE)).grant, before);
});
test("simultaneous host admissions serialize into fenced authority epochs", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const [first, second] = (
    await Promise.all([
      f.store.admit(CODE, HOST, "a"),
      f.store.admit(CODE, HOST, "b"),
    ])
  ).sort((x, y) => x.room.grant!.epoch - y.room.grant!.epoch);
  assert.deepEqual(
    [first!.room.grant!.epoch, second!.room.grant!.epoch],
    [1, 2],
  );
  assert.equal(
    second!.room.grant!.validFrom,
    first!.room.grant!.expiresAt + 250,
  );
  assert.equal(
    (await f.store.get(CODE)).grant?.holder,
    second!.member.connectionId,
  );
});
test("direct new admission rotates an active old watch before its delayed callbacks arrive", async () => {
  const f = fixture();
  await joined(f);
  f.database.delay = true;
  const room = await f.store.get(CODE);
  await f.store.time(CODE, room.members[peerId(HOST)]!, room.grant);
  await f.store.end(CODE, HOST);
  await f.store.create(CODE, "c".repeat(64));
  const fresh = new Socket();
  await f.a.connect(CODE, "c".repeat(64), fresh);
  f.database.flush();
  assert.equal(fresh.closes.length, 0);
  assert.equal(fresh.frames("welcome").length, 1);
  await f.a.stop();
  await f.b.stop();
});

test("bus dedupe overflow drops only that room's frames; local and other-room signalling survive", async () => {
  const f = fixture(),
    { hostConnection, guestConnection, guest } = await joined(f);
  f.aBus.delayed = true;
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  const packet = f.aBus.published[0]!;
  for (let i = 0; i < 4200; i++)
    await f.b.deliver({ ...packet, id: `flood-${i}` });
  assert.equal(guest.frames("signal").length, 512);
  assert.equal(guest.closes.length, 0);
  assert.equal(f.b.state, "ready");
  // A same-process sender needs no retry window, even when this room's bus window is full.
  const local = new Socket(),
    localToken = "c".repeat(64);
  const localConnection = await f.b.connect(CODE, localToken, local);
  await f.b.receive(localConnection, signal(peerId(GUEST), guestConnection));
  assert.equal(guest.frames("signal").length, 513);
  await f.store.create("CD34", HOST);
  const otherHost = new Socket(),
    otherGuest = new Socket();
  const otherHostConnection = await f.a.connect("CD34", HOST, otherHost);
  const otherGuestConnection = await f.b.connect("CD34", GUEST, otherGuest);
  f.aBus.delayed = false;
  await f.a.receive(
    otherHostConnection,
    signal(peerId(GUEST), otherGuestConnection),
  );
  assert.equal(otherGuest.frames("signal").length, 1);
  await f.b.deliver({ ...packet, id: "flood-0" });
  assert.equal(
    guest.frames("signal").length,
    513,
    "accepted duplicate remains suppressed at capacity",
  );
  f.advance(10_001);
  await f.b.deliver({ ...packet, id: "fresh", expiresAt: 21_001 });
  assert.equal(
    guest.frames("signal").length,
    514,
    "expired dedupe slots become available",
  );
  await f.a.stop();
  await f.b.stop();
});

// A full room is the creator, five guests: whoever rejoins negotiates five links at once. Members alternate gateways
// so every burst crosses the bus as well as the local path.
const TOKENS = [HOST, GUEST, ..."cdef"].map((c) => c[0]!.repeat(64));
async function fullRoom(f: ReturnType<typeof fixture>, code = CODE) {
  await f.store.create(code, HOST);
  const members = [];
  for (const [index, token] of TOKENS.entries()) {
    const socket = new Socket(),
      gateway = index % 2 ? f.b : f.a;
    members.push({
      token,
      id: peerId(token),
      socket,
      gateway,
      connection: await gateway.connect(code, token, socket),
    });
  }
  return members;
}
type RoomMember = Awaited<ReturnType<typeof fullRoom>>[number];
const candidate = (to: RoomMember, n: number) =>
  JSON.stringify({
    type: "signal",
    to: to.id,
    targetConnectionId: to.connection,
    data: {
      candidate: {
        candidate: `candidate:${n} 1 udp 2122260223 192.0.2.${n % 250} 5000${n % 10} typ host`,
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "frag",
      },
    },
  });
/** One negotiation of one link as the browser sends it: the description, then `candidates` trickled candidates. */
const negotiation = (to: RoomMember, candidates: number, sdp = "v=0") => [
  signal(to.id, to.connection, sdp),
  ...Array.from({ length: candidates }, (_, n) => candidate(to, n)),
];
/** Every frame in one turn, as `ws` hands over frames that arrived in one read; nothing is awaited in between. */
const burst = (from: RoomMember, frames: string[]) =>
  Promise.all(frames.map((raw) => from.gateway.receive(from.connection, raw)));
const signalsFrom = (to: RoomMember, from: RoomMember) =>
  to.socket.frames("signal").filter((m) => m.connectionId === from.connection)
    .length;
const notices = (member: RoomMember) => member.socket.frames("notice");
/** Time passes as it does for live pages: every member's two-second `time` heartbeat keeps its seat current. */
async function pass(
  f: ReturnType<typeof fixture>,
  room: RoomMember[],
  milliseconds: number,
) {
  for (let left = milliseconds; left > 0; left -= 2000) {
    f.advance(Math.min(2000, left));
    for (const member of room)
      await member.gateway.receive(
        member.connection,
        JSON.stringify({ type: "time", id: 1, sentAt: 1 }),
      );
  }
}

test("a rider reloading into a five-rider room sends 36 signal frames in 30 ms and is not closed", async () => {
  // The measured failure: four links, a description and eight candidates each, 30 ms after the welcome.
  const f = fixture(),
    room = await fullRoom(f),
    peers = room.slice(0, 4),
    left = room[5]!;
  await left.gateway.disconnect(left.connection);
  const rider = room[4]!,
    socket = new Socket();
  rider.socket = socket;
  rider.connection = await rider.gateway.connect(CODE, rider.token, socket);
  const frames = peers.flatMap((peer) => negotiation(peer, 8));
  assert.equal(frames.length, 36);
  for (const raw of frames) {
    await rider.gateway.receive(rider.connection, raw);
    f.advance(1);
  }
  for (const peer of peers) assert.equal(signalsFrom(peer, rider), 9);
  assert.deepEqual(socket.closes, []);
  assert.deepEqual(notices(rider), []);
  await f.a.stop();
  await f.b.stop();
});

test("an honest rejoin into a full room negotiates, restarts and renegotiates every link with nothing dropped", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    rider = room[3]!,
    peers = room.filter((member) => member !== rider);
  const socket = new Socket();
  rider.socket = socket;
  rider.connection = await rider.gateway.connect(CODE, rider.token, socket);
  // Every link at once on a rich network: a description, the 64 candidates a peer will hold, two end markers.
  await burst(
    rider,
    peers.flatMap((peer) => negotiation(peer, 66)),
  );
  for (const peer of peers) assert.equal(signalsFrom(peer, rider), 67);
  // The restart policy allows one ICE restart per link every eight seconds; each gathers afresh.
  for (let restart = 1; restart <= 4; restart++) {
    await pass(f, room, 8000);
    await burst(
      rider,
      peers.flatMap((peer) => negotiation(peer, 66)),
    );
    for (const peer of peers)
      assert.equal(signalsFrom(peer, rider), 67 * (restart + 1));
  }
  // A media renegotiation on every link a second later: an offer out and an answer back.
  await pass(f, room, 1000);
  await burst(
    rider,
    peers.flatMap((peer) => negotiation(peer, 0)),
  );
  for (const peer of peers) {
    await burst(peer, negotiation(rider, 0));
    assert.equal(signalsFrom(peer, rider), 67 * 5 + 1);
    assert.deepEqual(peer.socket.closes, []);
  }
  assert.equal(signalsFrom(rider, peers[0]!), 1);
  assert.deepEqual(socket.closes, []);
  assert.deepEqual(notices(rider), []);
  await f.a.stop();
  await f.b.stop();
});

test("a full-room burst queued behind a slow bus is delivered, not dropped or closed", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    rider = room[1]!,
    remote = room.filter((member) => member.gateway !== rider.gateway);
  let release = () => {};
  f.bBus.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = burst(
    rider,
    remote.flatMap((peer) => negotiation(peer, 66)),
  );
  release();
  await sent;
  for (const peer of remote) assert.equal(signalsFrom(peer, rider), 67);
  assert.deepEqual(rider.socket.closes, []);
  assert.deepEqual(notices(rider), []);
  await f.a.stop();
  await f.b.stop();
});

test("flooding one link is throttled to its refill, leaves the sender's other links alone and is announced once a second", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    [host, victim, bystander] = room as [RoomMember, RoomMember, RoomMember];
  const published = f.aBus.published.length;
  for (let second = 0; second < 5; second++) {
    await burst(
      host,
      Array.from({ length: 100 }, (_, n) => candidate(victim, n)),
    );
    // Relayed frames are bounded by one negotiation plus the refill, however many were sent.
    assert.ok(
      signalsFrom(victim, host) <= 80 + 10 * second,
      "relay bounded by the burst and the refill",
    );
    assert.equal(notices(host).length, second + 1, "one notice a second");
    f.advance(1000);
  }
  assert.ok(signalsFrom(victim, host) >= 80, "the burst itself is relayed");
  assert.equal(f.aBus.published.length - published, signalsFrom(victim, host));
  // Each notice counts what was dropped since the one before: 89 in the rest of that second, and the frame that raised it.
  const notice = notices(host)[2]!;
  assert.equal(notice.notice, "signal-throttled");
  assert.equal(notice.dropped, 90);
  assert.deepEqual(host.socket.closes, [], "throttled, not closed");
  // The flooded link's bucket is its own: the same sender still negotiates with everyone else.
  await burst(host, negotiation(bystander, 66));
  assert.equal(signalsFrom(bystander, host), 67);
  assert.equal(f.a.state, "ready");
  assert.equal(f.b.state, "ready");
  await f.a.stop();
  await f.b.stop();
});

test("naming unknown targets mints no allowance and no unbounded database reads", async () => {
  const f = fixture(),
    { host, hostConnection, guestConnection, guest } = await joined(f),
    reads = f.database.reads;
  for (let n = 0; n < 300; n++)
    await f.a.receive(hostConnection, signal(`stranger-${n}`, "unknown"));
  for (const name of ["__proto__", "constructor", "toString"])
    await f.a.receive(hostConnection, signal(name, "unknown"));
  assert.ok(f.database.reads - reads <= 16, "one shared bucket of lookups");
  assert.equal(guest.frames("signal").length, 0);
  assert.deepEqual(host.closes, []);
  // Strangers spent the strangers' bucket only.
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  assert.equal(guest.frames("signal").length, 1);
  await f.a.stop();
  await f.b.stop();
});

test("a sustained flood ends only that connection, and the member reconnects without a fresh burst", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    [host, victim] = room as [RoomMember, RoomMember];
  await f.store.create("CD34", HOST);
  const otherHost = new Socket(),
    otherGuest = new Socket();
  const otherHostConnection = await f.a.connect("CD34", HOST, otherHost),
    otherGuestConnection = await f.b.connect("CD34", GUEST, otherGuest);
  // Refused frames are tolerated for a while: ten times the refill for five seconds is throttled, not closed.
  for (let second = 0; second < 5; second++) {
    await burst(
      host,
      Array.from({ length: 100 }, (_, n) => candidate(victim, n)),
    );
    f.advance(1000);
  }
  assert.deepEqual(host.socket.closes, []);
  let seconds = 5;
  for (; seconds < 30 && !host.socket.closes.length; seconds++) {
    await burst(
      host,
      Array.from({ length: 100 }, (_, n) => candidate(victim, n)),
    );
    f.advance(1000);
  }
  assert.deepEqual(host.socket.closes, [
    { code: 1008, reason: "Signalling flood" },
  ]);
  assert.ok(
    signalsFrom(victim, host) <= 80 + 10 * seconds,
    "relay bounded by the burst and the refill until the close",
  );
  const relayed = signalsFrom(victim, host);
  await burst(host, negotiation(victim, 8));
  assert.equal(signalsFrom(victim, host), relayed, "a closed flood is over");
  assert.equal(host.socket.closes.length, 1);
  for (const member of room.slice(1))
    assert.deepEqual(member.socket.closes, []);
  // The room next door never noticed.
  await f.a.receive(
    otherHostConnection,
    signal(peerId(GUEST), otherGuestConnection),
  );
  assert.equal(otherGuest.frames("signal").length, 1);
  assert.deepEqual(otherHost.closes, []);
  // The page reconnects 1.5 s later. It may link again, but a reconnect is not a way to buy another burst.
  f.advance(1500);
  const again = new Socket();
  host.socket = again;
  host.connection = await f.a.connect(CODE, HOST, again);
  await burst(
    host,
    Array.from({ length: 100 }, (_, n) => candidate(victim, n)),
  );
  assert.equal(signalsFrom(victim, host), 10);
  assert.deepEqual(again.closes, []);
  // The flag lapses; an honest reload a minute later negotiates in full.
  await pass(f, room, 60_000);
  const later = new Socket();
  host.socket = later;
  host.connection = await f.a.connect(CODE, HOST, later);
  await burst(host, negotiation(victim, 66));
  assert.equal(signalsFrom(victim, host), 67);
  await f.a.stop();
  await f.b.stop();
});

test("a frame storm beyond any negotiation is dropped unparsed and closed as a flood", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    [host, victim] = room as [RoomMember, RoomMember];
  await burst(
    host,
    Array.from({ length: 2000 }, (_, n) => candidate(victim, n)),
  );
  assert.ok(signalsFrom(victim, host) <= 80, "one burst at most is relayed");
  assert.deepEqual(host.socket.closes, [
    { code: 1008, reason: "Signalling flood" },
  ]);
  assert.deepEqual(victim.socket.closes, []);
  assert.equal(f.a.state, "ready");
  await f.a.stop();
  await f.b.stop();
});

// About what Chromium offers for one audio and one data section.
const RICH_SDP = "v=0\r\n" + "a=rtpmap:111 opus/48000/2\r\n".repeat(120);

test("a whole rich-network room renegotiating at once crosses two gateways with nothing dropped", async () => {
  // Every member rebuilds all five links together (a gateway restart): 27 frames a link, 243 into each gateway.
  const f = fixture(),
    room = await fullRoom(f);
  assert.ok(RICH_SDP.length > 3000, "a realistic description size");
  await Promise.all(
    room.map((member) =>
      burst(
        member,
        room
          .filter((peer) => peer !== member)
          .flatMap((peer) => negotiation(peer, 26, RICH_SDP)),
      ),
    ),
  );
  for (const member of room) {
    for (const peer of room)
      if (peer !== member) assert.equal(signalsFrom(peer, member), 27);
    assert.deepEqual(member.socket.closes, []);
    assert.deepEqual(notices(member), []);
  }
  assert.equal(f.aBus.published.length, 243);
  assert.equal(f.bBus.published.length, 243);
  await f.a.stop();
  await f.b.stop();
});

test("the same storm at the 64-candidate ceiling loses trailing cross-gateway frames, never a socket or a local frame", async () => {
  const f = fixture(),
    room = await fullRoom(f);
  await Promise.all(
    room.map((member) =>
      burst(
        member,
        room
          .filter((peer) => peer !== member)
          .flatMap((peer) => negotiation(peer, 66, RICH_SDP)),
      ),
    ),
  );
  for (const member of room) {
    assert.deepEqual(member.socket.closes, []);
    for (const peer of room)
      if (peer !== member && peer.gateway === member.gateway)
        assert.equal(signalsFrom(peer, member), 67, "local links are whole");
  }
  // 603 frames were bound for each gateway; the receiving window holds 512 ids, and the sender now stops there.
  for (const bus of [f.aBus, f.bBus]) {
    assert.ok(bus.published.length <= 512, "no publish the receiver drops");
    assert.ok(bus.published.length >= 480, "all but the trailing candidates");
  }
  const delivered = room.reduce(
    (n, to) =>
      n +
      room.reduce(
        (m, from) =>
          m + (from.gateway !== to.gateway ? signalsFrom(to, from) : 0),
        0,
      ),
    0,
  );
  assert.equal(
    delivered,
    f.aBus.published.length + f.bBus.published.length,
    "every paid publish is delivered",
  );
  await f.a.stop();
  await f.b.stop();
});

test("reconnecting, even under a new token each time, buys no publishes beyond the room's allowance", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    peers = room.filter((_, index) => index !== 2);
  let churner = room[2]!;
  const published = f.aBus.published.length;
  for (let cycle = 0; cycle < 10; cycle++) {
    await churner.gateway.disconnect(churner.connection);
    const token = cycle.toString(16).repeat(64),
      socket = new Socket();
    churner = {
      token,
      id: peerId(token),
      socket,
      gateway: f.a,
      connection: await f.a.connect(CODE, token, socket),
    };
    await burst(
      churner,
      peers.flatMap((peer) =>
        Array.from({ length: 80 }, (_, n) => candidate(peer, n)),
      ),
    );
    assert.deepEqual(socket.closes, [], "each connection is within its own");
    await pass(f, [...peers, churner], 1000);
  }
  // Unbounded, ten cycles publish 10 × 3 remote peers × 80 = 2400 frames. The room has 512 and 51.2 a second.
  const paid = f.aBus.published.length - published;
  assert.ok(paid <= 512 + 52 * 10, `published ${paid}`);
  assert.ok(paid >= 512, `published ${paid}`);
  await f.a.stop();
  await f.b.stop();
});

test("frames addressed to a member's replaced connection share the strangers' bucket: reads bounded, other links untouched", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    [host, victim, bystander] = room as [RoomMember, RoomMember, RoomMember];
  const reads = f.database.reads;
  for (let second = 0; second < 5; second++) {
    await burst(
      host,
      Array.from({ length: 90 }, () => signal(victim.id, "replaced")),
    );
    await pass(f, room, 1000);
  }
  const spent = f.database.reads - reads;
  assert.ok(spent <= 16 + 5, `database reads ${spent}`);
  assert.equal(signalsFrom(victim, host), 0, "a stale frame is never relayed");
  assert.deepEqual(host.socket.closes, []);
  // The victim's own bucket was never charged, and neither was anyone else's.
  await burst(host, [
    ...negotiation(victim, 66),
    ...negotiation(bystander, 66),
  ]);
  assert.equal(signalsFrom(victim, host), 67);
  assert.equal(signalsFrom(bystander, host), 67);
  await f.a.stop();
  await f.b.stop();
});

test("the heartbeat is answered for as long as it runs; a storm of time frames costs a handful of transactions", async () => {
  const f = fixture(),
    { host, hostConnection } = await joined(f),
    time = JSON.stringify({ type: "time", id: 1, sentAt: 1 });
  for (let beat = 0; beat < 60; beat++) {
    f.advance(2000);
    await f.a.receive(hostConnection, time);
  }
  assert.equal(host.frames("time").length, 60);
  assert.deepEqual(host.frames("notice"), []);
  const transactions = f.database.transactions;
  await Promise.all(
    Array.from({ length: 300 }, () => f.a.receive(hostConnection, time)),
  );
  const spent = f.database.transactions - transactions;
  assert.ok(spent <= 8, `transactions ${spent}`);
  assert.deepEqual(host.closes, []);
  await f.a.stop();
  await f.b.stop();
});

test("the creator has the same byte allowance as anyone: large descriptions stop at 256 kB a second", async () => {
  const f = fixture(),
    room = await fullRoom(f),
    [host, , local] = room as [RoomMember, RoomMember, RoomMember];
  await burst(
    host,
    Array.from({ length: 40 }, () =>
      signal(local.id, local.connection, "v".repeat(30_000)),
    ),
  );
  assert.equal(signalsFrom(local, host), 8, "8 × 30 kB fit in 256 kB");
  assert.deepEqual(host.socket.closes, []);
  await f.a.stop();
  await f.b.stop();
});

test("limiter state is bounded by the room, not by everyone who ever passed through it", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const socket = new Socket(),
    connection = await f.a.connect(CODE, HOST, socket);
  for (let visitor = 0; visitor < 20; visitor++) {
    const token = (visitor + 16).toString(16).repeat(32),
      guest = new Socket(),
      guestConnection = await f.b.connect(CODE, token, guest);
    await f.a.receive(connection, signal(peerId(token), guestConnection));
    assert.equal(guest.frames("signal").length, 1);
    await f.b.disconnect(guestConnection);
    f.advance(100);
  }
  // One bucket for the last visitor (pruned when the next is made), one publish bucket for the room's other gateway.
  assert.ok(f.a.limiterEntries <= 3, `entries ${f.a.limiterEntries}`);
  await f.a.stop();
  await f.b.stop();
});

test(
  "slow admission and departure serialize only their own room",
  { timeout: 2000 },
  async () => {
    let releaseAdmission = () => {},
      releaseDeparture = () => {},
      startedAdmission = () => {},
      startedDeparture = () => {};
    const admissionStarted = new Promise<void>((resolve) => {
      startedAdmission = resolve;
    });
    const departureStarted = new Promise<void>((resolve) => {
      startedDeparture = resolve;
    });
    const admissionWait = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    const departureWait = new Promise<void>((resolve) => {
      releaseDeparture = resolve;
    });
    let blockAdmission = true,
      blockDeparture = true;
    class SlowStore extends RoomStore {
      override async admit(code: string, token: string, gatewayId: string) {
        if (code === CODE && blockAdmission) {
          startedAdmission();
          await admissionWait;
        }
        return super.admit(code, token, gatewayId);
      }
      override async leave(
        code: string,
        member: Parameters<RoomStore["leave"]>[1],
      ) {
        if (code === CODE && blockDeparture) {
          startedDeparture();
          await departureWait;
        }
        return super.leave(code, member);
      }
    }
    const f = fixture((database, deps) => new SlowStore(database, deps));
    await f.store.create(CODE, HOST);
    await f.store.create("CD34", HOST);
    const slow = f.a.connect(CODE, HOST, new Socket());
    await admissionStarted;
    const other = await f.a.connect("CD34", HOST, new Socket());
    assert.equal(f.a.connections, 1);
    releaseAdmission();
    const first = await slow;
    blockAdmission = false;
    const leaving = f.a.disconnect(first);
    await departureStarted;
    await f.a.disconnect(other);
    assert.equal(f.a.state, "ready", "pending work keeps the shared bus alive");
    const next = await f.a.connect("CD34", GUEST, new Socket());
    releaseDeparture();
    await leaving;
    blockDeparture = false;
    assert.equal(f.a.connections, 1);
    await f.a.disconnect(next);
    assert.equal(f.a.state, "idle");
  },
);

test("a bus restart fences an admission already waiting on its database result", async () => {
  let release = () => {},
    started = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lateToken = "d".repeat(64);
  class DelayedStore extends RoomStore {
    override async admit(code: string, token: string, gatewayId: string) {
      const result = await super.admit(code, token, gatewayId);
      if (token === lateToken) {
        started();
        await held;
      }
      return result;
    }
  }
  const f = fixture((db, deps) => new DelayedStore(db, deps));
  await joined(f);
  const late = new Socket(),
    joining = f.a.connect(CODE, lateToken, late);
  await waiting;
  f.aBus.failed?.(new Error("restart"));
  await f.store.create("CD34", HOST);
  const healthy = new Socket();
  await f.a.connect("CD34", HOST, healthy);
  release();
  await assert.rejects(joining, /relay restarting/);
  assert.equal(late.frames("welcome").length, 0);
  assert.equal((await f.store.get(CODE)).members[peerId(lateToken)], undefined);
  assert.equal(healthy.closes.length, 0);
  assert.equal(f.a.state, "ready");
  await f.a.stop();
  await f.b.stop();
});

test("shutdown awaits admitted room work and rejects new joins", async () => {
  let release = () => {},
    started = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  class DelayedStore extends RoomStore {
    override async admit(code: string, token: string, gatewayId: string) {
      started();
      await held;
      return super.admit(code, token, gatewayId);
    }
  }
  const f = fixture((db, deps) => new DelayedStore(db, deps));
  await f.store.create(CODE, HOST);
  const socket = new Socket(),
    joining = f.a.connect(CODE, HOST, socket);
  await waiting;
  const stopping = f.a.stop();
  await assert.rejects(
    f.a.connect(CODE, GUEST, new Socket()),
    /Service restarting/,
  );
  release();
  await joining;
  await stopping;
  assert.equal(f.a.connections, 0);
  assert.equal(f.a.state, "idle");
  assert.equal(socket.closes.at(-1)?.code, 1001);
});
