import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import {
  CONNECTION_TTL_MS,
  LAPSE_MARGIN_MS,
  RESUME_GRACE_MS,
  RoomError,
  RoomStore,
  parseRoomRecord,
  peerId,
} from "../src/room-store.js";
import { RoomGateway, type GatewaySocket } from "../src/gateway.js";
import type { RoomBus, RoutedMessage } from "../src/room-bus.js";
import { createDevRoomService } from "../src/dev.js";
import { readAuthFrame } from "../src/socket-auth.js";
import { LEASE_MS, authFrame } from "fuse-network-protocol";

// A room socket is cut by the platform every hour and whenever an instance stops. These pin what keeps that from
// costing the room anything: the seat is held, the page comes back as the connection it was, and no peer is told.

const HOST = "a".repeat(64),
  GUEST = "b".repeat(64),
  THIRD = "c".repeat(64),
  CODE = "AB42";

/** Routes a publish to whichever gateway on the same network it names. */
class Bus implements RoomBus {
  private receive?: (message: RoutedMessage) => Promise<void>;
  constructor(
    private network: Map<string, Bus>,
    id: string,
  ) {
    network.set(id, this);
  }
  async start(receive: (message: RoutedMessage) => Promise<void>) {
    this.receive = receive;
  }
  async publish(message: RoutedMessage) {
    await this.network
      .get(message.destination)
      ?.receive?.(structuredClone(message));
  }
  async stop() {
    this.receive = undefined;
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
    return this.messages.filter((message) => message.type === type);
  }
  get welcome() {
    return this.frames("welcome").at(-1)!;
  }
}
interface Timer {
  callback: () => void;
  at: number;
  cancelled: boolean;
}
/** Two instances over one database and one clock; `advance` fires the timers that came due, as real time would. */
function fixture() {
  let now = 1000,
    n = 0;
  const database = new MemoryRoomDatabase(),
    network = new Map<string, Bus>(),
    timers: Timer[] = [],
    errors: string[] = [];
  const store = new RoomStore(database, {
    now: () => now,
    id: () => `id-${++n}`,
  });
  const gateway = (id: string) =>
    new RoomGateway(id, store, new Bus(network, id), {
      now: () => now,
      id: () => `id-${++n}`,
      error: (kind) => errors.push(kind),
      schedule: (callback, delayMs) => {
        const timer = { callback, at: now + delayMs, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });
  const settle = async () => {
    for (let turn = 0; turn < 8; turn++)
      await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    database,
    store,
    a: gateway("a"),
    b: gateway("b"),
    errors,
    settle,
    get now() {
      return now;
    },
    /** Moves the clock in one-second steps, firing whatever came due and letting its work finish. */
    advance: async (ms: number) => {
      for (const end = now + ms; now < end;) {
        now = Math.min(end, now + 1000);
        for (const timer of timers.splice(0))
          if (timer.cancelled) continue;
          else if (timer.at <= now) timer.callback();
          else timers.push(timer);
        await settle();
      }
    },
  };
}
const signal = (to: string, target: string, sdp = "v=0") =>
  JSON.stringify({
    type: "signal",
    to,
    targetConnectionId: target,
    data: { description: { type: "offer", sdp } },
  });
const seat = async (f: ReturnType<typeof fixture>, token: string) =>
  (await f.store.get(CODE)).members[peerId(token)];

test("a resumed admission keeps the connection id and its lease, and counts the new socket", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const first = await f.store.admit(CODE, GUEST, "a");
  assert.equal(first.resumed, false);
  await f.advance(5000);
  const again = await f.store.admit(
    CODE,
    GUEST,
    "b",
    undefined,
    first.member.connectionId,
  );
  assert.equal(again.resumed, true);
  assert.equal(again.member.connectionId, first.member.connectionId);
  assert.equal(again.member.gatewayId, "b");
  assert.equal(again.member.resumes, 1);
  assert.equal(again.member.expiresAt, f.now + CONNECTION_TTL_MS);
  assert.deepEqual(await seat(f, GUEST), again.member);
  // The stored shape passes the storage boundary, and a malformed count does not.
  const stored = await f.store.get(CODE);
  assert.deepEqual(parseRoomRecord(JSON.parse(JSON.stringify(stored))), stored);
  for (const resumes of [-1, 0.5, "1", null]) {
    const corrupt = JSON.parse(JSON.stringify(stored));
    corrupt.members[peerId(GUEST)].resumes = resumes;
    assert.equal(parseRoomRecord(corrupt), undefined, String(resumes));
  }
});

test("a resume that names no held seat is an ordinary admission under a new connection id", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const first = await f.store.admit(CODE, GUEST, "a");
  // Another connection's id, or a guess.
  const wrong = await f.store.admit(CODE, GUEST, "a", undefined, "id-999");
  assert.equal(wrong.resumed, false);
  assert.notEqual(wrong.member.connectionId, first.member.connectionId);
  assert.equal(wrong.member.resumes, undefined);
  // The seat was freed: the page said goodbye, or was replaced.
  await f.store.leave(CODE, wrong.member);
  const left = await f.store.admit(
    CODE,
    GUEST,
    "a",
    undefined,
    wrong.member.connectionId,
  );
  assert.equal(left.resumed, false);
  // The lease lapsed while the page was away.
  await f.advance(CONNECTION_TTL_MS);
  await f.store.admit(CODE, HOST, "a");
  const lapsed = await f.store.admit(
    CODE,
    GUEST,
    "a",
    undefined,
    left.member.connectionId,
  );
  assert.equal(lapsed.resumed, false);
  assert.notEqual(lapsed.member.connectionId, left.member.connectionId);
});

test("a held seat keeps its connection for the grace and no longer; an older socket of it can change nothing", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const first = await f.store.admit(CODE, GUEST, "a");
  await f.store.detach(CODE, first.member);
  assert.equal((await seat(f, GUEST))!.expiresAt, f.now + RESUME_GRACE_MS);
  const revision = (await f.store.get(CODE)).revision;
  // Holding it again does not extend it.
  await f.advance(4000);
  await f.store.detach(CODE, first.member);
  assert.equal((await f.store.get(CODE)).revision, revision);
  const resumed = await f.store.admit(
    CODE,
    GUEST,
    "b",
    undefined,
    first.member.connectionId,
  );
  // The socket the page resumed from is still closing on the first instance. Its heartbeat is refused as retryable,
  // never as "reconnected elsewhere" (409), which a page takes as final; its close neither holds nor frees the seat.
  await assert.rejects(
    f.store.time(CODE, first.member, undefined),
    (error) => error instanceof RoomError && error.status === 410,
  );
  await f.store.detach(CODE, first.member);
  await f.store.leave(CODE, first.member);
  assert.deepEqual(await seat(f, GUEST), resumed.member);
  await f.store.time(CODE, resumed.member, undefined);
});

test("a creator that resumes goes on holding its grant; one that ran out is reserved again", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const first = await f.store.admit(CODE, HOST, "a"),
    grant = first.room.grant!;
  await f.advance(3000);
  const resumed = await f.store.admit(
    CODE,
    HOST,
    "b",
    undefined,
    first.member.connectionId,
  );
  assert.deepEqual(
    { ...resumed.room.grant!, expiresAt: 0 },
    { ...grant, expiresAt: 0 },
    "the same grant: epoch, holder and identity",
  );
  assert.equal(resumed.room.grant!.expiresAt, f.now + LEASE_MS);
  await f.advance(LEASE_MS + 1000);
  const late = await f.store.admit(
    CODE,
    HOST,
    "a",
    undefined,
    first.member.connectionId,
  );
  assert.equal(late.resumed, true);
  assert.equal(late.room.grant!.epoch, grant.epoch + 1);
  assert.equal(late.room.grant!.holder, first.member.connectionId);
  assert.equal(late.room.grant!.validFrom, f.now);
});

test("a dropped socket's page resumes on another instance and no peer is told it was gone", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  const hostConnection = await f.a.connect(CODE, HOST, host),
    guestConnection = await f.b.connect(CODE, GUEST, guest);
  await f.settle();
  const heard = host.messages.length;
  // The platform cut the guest's socket: no close frame, so the seat is held.
  await f.b.disconnect(guestConnection, { socket: guest, hold: true });
  await f.settle();
  assert.equal(host.messages.length, heard, "the host hears nothing");
  assert.equal(f.b.connections, 0);
  // The page is back a second and a half later, on the other instance.
  await f.advance(1500);
  const back = new Socket();
  assert.equal(
    await f.a.connect(CODE, GUEST, back, undefined, guestConnection),
    guestConnection,
  );
  await f.settle();
  assert.equal(back.welcome.resumed, true);
  assert.equal(back.welcome.connectionId, guestConnection);
  assert.deepEqual(back.welcome.peers, [
    { id: peerId(HOST), connectionId: hostConnection },
  ]);
  assert.deepEqual(host.frames("peer").slice(1), []);
  assert.equal(host.messages.length, heard, "the host still hears nothing");
  // Signalling reaches the resumed page where it now is, and the page's reaches the host.
  await f.a.receive(hostConnection, signal(peerId(GUEST), guestConnection));
  await f.a.receive(guestConnection, signal(peerId(HOST), hostConnection));
  assert.equal(back.frames("signal").length, 1);
  assert.equal(host.frames("signal").length, 1);
  assert.deepEqual(guest.closes, []);
  assert.deepEqual(f.errors, []);
});

test("a page from before resumption reconnects as it always did: a new connection the room hears of", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  await f.a.connect(CODE, HOST, host);
  const guestConnection = await f.a.connect(CODE, GUEST, guest);
  await f.a.disconnect(guestConnection, { socket: guest, hold: true });
  const back = new Socket(),
    next = await f.a.connect(CODE, GUEST, back);
  await f.settle();
  assert.notEqual(next, guestConnection);
  assert.equal(back.welcome.resumed, false);
  assert.deepEqual(host.frames("peer").at(-1), {
    type: "peer",
    id: peerId(GUEST),
    connectionId: next,
    online: true,
  });
});

test("a socket that said goodbye frees its seat at once", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  await f.a.connect(CODE, HOST, host);
  const guestConnection = await f.b.connect(CODE, GUEST, guest);
  await f.b.disconnect(guestConnection, { socket: guest });
  await f.settle();
  assert.deepEqual(host.frames("peer").at(-1), {
    type: "peer",
    id: peerId(GUEST),
    connectionId: guestConnection,
    online: false,
  });
  const back = new Socket();
  assert.notEqual(
    await f.b.connect(CODE, GUEST, back, undefined, guestConnection),
    guestConnection,
  );
  assert.equal(back.welcome.resumed, false);
});

test("a page that resumes before its old socket has closed takes the connection over on the same instance", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  const hostConnection = await f.a.connect(CODE, HOST, host),
    guestConnection = await f.a.connect(CODE, GUEST, guest);
  const back = new Socket();
  await f.a.connect(CODE, GUEST, back, undefined, guestConnection);
  await f.settle();
  assert.deepEqual(guest.closes, [
    { code: 4000, reason: "Resumed on another socket" },
  ]);
  assert.equal(f.a.connections, 2);
  // The old socket's last frames and its close are the past: neither is heard, and neither ends the connection.
  await f.a.receive(
    guestConnection,
    signal(peerId(HOST), hostConnection),
    guest,
  );
  assert.equal(host.frames("signal").length, 0);
  await f.a.disconnect(guestConnection, { socket: guest, hold: true });
  await f.a.disconnect(guestConnection, { socket: guest });
  await f.settle();
  assert.equal(f.a.connections, 2);
  assert.equal((await seat(f, GUEST))!.resumes, 1);
  await f.a.receive(
    guestConnection,
    signal(peerId(HOST), hostConnection),
    back,
  );
  assert.equal(host.frames("signal").length, 1);
  assert.deepEqual(host.frames("peer").slice(1), []);
});

test("a page that resumes on another instance retires the socket the first instance still holds", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  await f.a.connect(CODE, HOST, host);
  const guestConnection = await f.b.connect(CODE, GUEST, guest);
  await f.settle();
  const back = new Socket();
  await f.a.connect(CODE, GUEST, back, undefined, guestConnection);
  await f.settle();
  assert.deepEqual(guest.closes, [
    { code: 4000, reason: "Resumed on another socket" },
  ]);
  assert.equal(f.b.connections, 0);
  // The retired socket's close arrives late and must not free the seat the page now holds elsewhere.
  await f.b.disconnect(guestConnection, { socket: guest });
  await f.settle();
  assert.equal((await seat(f, GUEST))!.gatewayId, "a");
  assert.deepEqual(host.frames("peer").slice(1), []);
  assert.deepEqual(back.closes, []);
});

test("a held seat whose page never returns lapses, and the room is told then", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket();
  const hostConnection = await f.a.connect(CODE, HOST, host),
    guestConnection = await f.b.connect(CODE, GUEST, guest);
  await f.settle();
  await f.b.disconnect(guestConnection, { socket: guest, hold: true });
  const heartbeat = async () => {
    await f.a.receive(
      hostConnection,
      JSON.stringify({ type: "time", id: f.now, sentAt: f.now }),
    );
  };
  const offline = () =>
    host.frames("peer").filter((frame) => frame.online === false);
  for (let elapsed = 0; elapsed < RESUME_GRACE_MS; elapsed += 1000) {
    assert.deepEqual(offline(), [], `still held after ${elapsed} ms`);
    await f.advance(1000);
    await heartbeat();
  }
  await f.advance(LAPSE_MARGIN_MS);
  assert.deepEqual(offline(), [
    {
      type: "peer",
      id: peerId(GUEST),
      connectionId: guestConnection,
      online: false,
    },
  ]);
  assert.equal(await seat(f, GUEST), undefined);
  // The host's own seat was never at risk, and the room goes on.
  for (let second = 0; second < 40; second++) {
    await f.advance(1000);
    await heartbeat();
  }
  assert.deepEqual(host.closes, []);
  assert.deepEqual(f.errors, []);
});

test("a seat whose instance died without a word is pruned by an instance still serving the room", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket();
  const hostConnection = await f.a.connect(CODE, HOST, host);
  // The other instance was killed: its member is in the record and nothing will ever speak for it.
  const ghost = await f.store.admit(CODE, GUEST, "dead");
  await f.settle();
  for (let second = 0; second <= CONNECTION_TTL_MS / 1000; second++) {
    await f.advance(1000);
    await f.a.receive(
      hostConnection,
      JSON.stringify({ type: "time", id: f.now, sentAt: f.now }),
    );
  }
  assert.deepEqual(host.frames("peer").at(-1), {
    type: "peer",
    id: peerId(GUEST),
    connectionId: ghost.member.connectionId,
    online: false,
  });
  assert.deepEqual(host.closes, []);
});

test("a stopping instance holds its seats: the pages resume elsewhere and their peers never notice", async () => {
  const f = fixture();
  await f.store.create(CODE, HOST);
  const host = new Socket(),
    guest = new Socket(),
    third = new Socket();
  const hostConnection = await f.a.connect(CODE, HOST, host),
    guestConnection = await f.b.connect(CODE, GUEST, guest),
    thirdConnection = await f.b.connect(CODE, THIRD, third);
  await f.settle();
  const heard = host.messages.length;
  await f.b.stop();
  await f.settle();
  assert.deepEqual(
    [guest.closes, third.closes],
    [
      [{ code: 1001, reason: "Service restarting" }],
      [{ code: 1001, reason: "Service restarting" }],
    ],
  );
  assert.equal(host.messages.length, heard);
  await f.advance(1500);
  const guestBack = new Socket(),
    thirdBack = new Socket();
  await f.a.connect(CODE, GUEST, guestBack, undefined, guestConnection);
  await f.a.connect(CODE, THIRD, thirdBack, undefined, thirdConnection);
  await f.settle();
  assert.equal(host.messages.length, heard, "the host heard nothing at all");
  for (const [socket, own, other, otherConnection] of [
    [guestBack, guestConnection, THIRD, thirdConnection],
    [thirdBack, thirdConnection, GUEST, guestConnection],
  ] as const) {
    assert.equal(socket.welcome.resumed, true);
    assert.equal(socket.welcome.connectionId, own);
    assert.deepEqual(
      new Set(
        (socket.welcome.peers as { connectionId: string }[]).map(
          (peer) => peer.connectionId,
        ),
      ),
      new Set([hostConnection, otherConnection]),
      `${peerId(other)} is still listed under its connection`,
    );
    // Nothing since the welcome: the other page's resume changed nothing this one acts on.
    assert.deepEqual(socket.frames("peer"), []);
  }
});

test("the first frame carries the connection to resume, within the frame's bound and refused when malformed", () => {
  const token = "f".repeat(64),
    id = "0b2f6c0e-3d0a-4c58-9a6e-0d2b7c1e4a55";
  assert.deepEqual(readAuthFrame(authFrame(token, "fuse-riders", id), false), {
    token,
    gameId: "fuse-riders",
    resume: id,
  });
  assert.deepEqual(readAuthFrame(authFrame(token), false), { token });
  // An id too long for the frame's bound is not offered: the page then reconnects as a new connection.
  assert.deepEqual(
    readAuthFrame(authFrame(token, undefined, "x".repeat(65)), false),
    {
      token,
    },
  );
  for (const resume of ["", "x".repeat(65), 7, null, ["a"]])
    assert.equal(
      readAuthFrame(JSON.stringify({ type: "auth", token, resume }), false),
      undefined,
      JSON.stringify(resume),
    );
});

test("over real sockets: a socket that just stops is resumed, one that closes is a departure", async () => {
  const service = createDevRoomService({ log: () => {} });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`;
  const open = (code: string, token: string, resume?: string) => {
    const socket = new WebSocket(
        `ws://127.0.0.1:${port}/api/rooms/${code}/ws`,
        {
          origin,
        },
      ),
      frames: Record<string, unknown>[] = [],
      waiting: ((frame: Record<string, unknown>) => void)[] = [];
    socket.on("open", () => socket.send(authFrame(token, undefined, resume)));
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      frames.push(frame);
      for (const resolve of waiting.splice(0)) resolve(frame);
    });
    socket.on("error", () => {});
    return {
      socket,
      frames,
      /** The next frame of `type`, already received or still to come. */
      next: async (type: string, from = 0) => {
        for (;;) {
          const found = frames.slice(from).find((frame) => frame.type === type);
          if (found) return found;
          await new Promise<Record<string, unknown>>((resolve) =>
            waiting.push(resolve),
          );
        }
      },
    };
  };
  try {
    const created = (await (
      await fetch(`${origin}/api/rooms`, {
        method: "POST",
        headers: { Origin: origin },
      })
    ).json()) as { code: string; token: string };
    const host = open(created.code, created.token);
    await host.next("welcome");
    const guest = open(created.code, GUEST),
      welcome = await guest.next("welcome");
    await host.next("peer");
    const heard = host.frames.length;
    // The network took the socket: no close frame reaches the service.
    guest.socket.terminate();
    while (service.gateway.connections > 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const back = open(created.code, GUEST, welcome.connectionId as string),
      again = await back.next("welcome");
    assert.equal(again.resumed, true);
    assert.equal(again.connectionId, welcome.connectionId);
    assert.equal(host.frames.length, heard, "the host was told nothing");
    // The page leaves on purpose: the browser sends a close frame, and the room hears of it at once.
    back.socket.close();
    assert.deepEqual(await host.next("peer", heard), {
      type: "peer",
      id: peerId(GUEST),
      connectionId: welcome.connectionId,
      online: false,
    });
  } finally {
    await service.close();
  }
});
