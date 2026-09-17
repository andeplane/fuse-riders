import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { connect, type AddressInfo } from "node:net";
import { WebSocket } from "ws";
import {
  AUTH_FRAME_MAX_BYTES,
  CLOSE_ROOM_FULL,
  CLOSE_UNAUTHENTICATED,
  authFrame,
} from "fuse-network-protocol";
import { createRoomServer } from "../src/http.js";
import { RoomGateway } from "../src/gateway.js";
import { LocalRoomBus, MemoryRoomDatabase } from "../src/memory-database.js";
import { RoomStore, digest } from "../src/room-store.js";
import {
  AUTH_DEADLINE_MS,
  REFUSED_CLOSE_GRACE_MS,
  authToken,
} from "../src/socket-auth.js";

const ORIGIN = "https://game.example";
const ADDRESS = "203.0.113.7";
const ADMISSION_KEY = digest(`admission:${ADDRESS}`);

/** Counts what the admission gate charges to this address, and lets a test wait for the next charge. */
class CountingDatabase extends MemoryRoomDatabase {
  charged = 0;
  private waiting: Array<() => void> = [];
  nextCharge(): Promise<void> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  override async allowance(
    key: string,
    now: number,
    limit: number,
    consume = true,
  ): Promise<boolean> {
    const allowed = await super.allowance(key, now, limit, consume);
    if (consume && key === ADMISSION_KEY) {
      this.charged++;
      for (const resolve of this.waiting.splice(0)) resolve();
    }
    return allowed;
  }
}
interface Scheduled {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
  /** Resolves when the service cancels this entry. */
  whenCancelled: Promise<void>;
}
interface Peer {
  socket: WebSocket;
  frames: Array<Record<string, unknown>>;
  opened: Promise<void>;
  /** Resolves with the next frame the service sends. */
  frame(): Promise<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: string }>;
}

async function fixture(
  options: { legacyQueryToken?: boolean; maxGuests?: number } = {},
) {
  let now = 1_000_000;
  const { maxGuests, ...httpOptions } = options;
  const database = new CountingDatabase(),
    store = new RoomStore(database, {
      now: () => now,
      id: randomUUID,
      maxGuests,
    }),
    scheduled: Scheduled[] = [],
    logs: Array<Record<string, unknown>> = [];
  const gateway = new RoomGateway("test", store, new LocalRoomBus(), {
    now: () => now,
    id: randomUUID,
    error: () => {},
    // Room expiry is not under test; nothing here may start a real timer.
    schedule: () => () => {},
  });
  const server = createRoomServer({
    store,
    gateway,
    now: () => now,
    allowOrigin: (origin) => origin === ORIGIN,
    clientAddress: () => ADDRESS,
    schedule: (callback, delayMs) => {
      let cancel = () => {};
      const entry: Scheduled = {
        callback,
        delayMs,
        cancelled: false,
        whenCancelled: new Promise((resolve) => {
          cancel = resolve;
        }),
      };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
        cancel();
      };
    },
    log: (entry) => logs.push(entry),
    ...httpOptions,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const tokens: string[] = [];
  const create = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    assert.equal(response.status, 201);
    const room = (await response.json()) as { code: string; token: string };
    tokens.push(room.token);
    return room;
  };
  const peers: Peer[] = [];
  const open = (code: string, query = ""): Peer => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/rooms/${code}/ws${query}`,
      { origin: ORIGIN },
    );
    const frames: Array<Record<string, unknown>> = [],
      waiting: Array<{
        resolve: (frame: Record<string, unknown>) => void;
        reject: (error: Error) => void;
      }> = [];
    let taken = 0,
      ended: number | undefined;
    socket.on("message", (raw) => {
      frames.push(JSON.parse(raw.toString()));
      while (waiting.length && taken < frames.length)
        waiting.shift()!.resolve(frames[taken++]!);
    });
    // A frame that never comes fails the test instead of hanging it.
    socket.on("close", (code) => {
      ended = code;
      for (const waiter of waiting.splice(0))
        waiter.reject(new Error(`Socket closed (${code}) before a frame`));
    });
    const peer: Peer = {
      socket,
      frames,
      opened: new Promise((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("unexpected-response", (_req, response) => {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
        });
        socket.once("error", reject);
      }),
      frame: () =>
        new Promise((resolve, reject) => {
          if (taken < frames.length) resolve(frames[taken++]!);
          else if (ended !== undefined)
            reject(new Error(`Socket closed (${ended}) before a frame`));
          else waiting.push({ resolve, reject });
        }),
      closed: new Promise((resolve) =>
        socket.once("close", (code, reason) =>
          resolve({ code, reason: reason.toString() }),
        ),
      ),
    };
    socket.on("error", () => {});
    peers.push(peer);
    return peer;
  };
  return {
    port,
    database,
    gateway,
    scheduled,
    /** The authentication deadlines, in the order their sockets upgraded. */
    deadlines: () =>
      scheduled.filter((entry) => entry.delayMs === AUTH_DEADLINE_MS),
    /** The cut-offs of refused sockets, in the order they were refused. */
    cutOffs: () =>
      scheduled.filter((entry) => entry.delayMs === REFUSED_CLOSE_GRACE_MS),
    logs,
    create,
    open,
    advance: (ms: number) => {
      now += ms;
    },
    close: async () => {
      // No test may leave a credential in the operational log.
      for (const token of tokens)
        assert.equal(JSON.stringify(logs).includes(token), false);
      for (const peer of peers) peer.socket.terminate();
      await gateway.stop();
      server.terminateSockets();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("authToken reads one small, well-formed auth frame and nothing else", () => {
  const token = "ab".repeat(32);
  assert.equal(authToken(authFrame(token), false), token);
  const refused: Array<[string, string, boolean]> = [
    ["binary", authFrame(token), true],
    ["not JSON", "hello", false],
    ["empty", "", false],
    ["null", "null", false],
    ["array", JSON.stringify([authFrame(token)]), false],
    ["bare token", JSON.stringify(token), false],
    ["another frame", JSON.stringify({ type: "time", token }), false],
    ["no token", JSON.stringify({ type: "auth" }), false],
    ["numeric token", JSON.stringify({ type: "auth", token: 7 }), false],
    ["short token", authFrame("ab".repeat(31)), false],
    ["uppercase token", authFrame("AB".repeat(32)), false],
    [
      "oversized",
      JSON.stringify({
        type: "auth",
        token,
        padding: "x".repeat(AUTH_FRAME_MAX_BYTES),
      }),
      false,
    ],
  ];
  for (const [name, raw, binary] of refused)
    assert.equal(authToken(raw, binary), undefined, name);
  assert.ok(
    Buffer.byteLength(authFrame(token)) < AUTH_FRAME_MAX_BYTES,
    "the real frame fits the cap",
  );
});

test("a room socket authenticates with its first frame, and the deadline is cancelled", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const peer = f.open(code);
    await peer.opened;
    assert.equal(f.scheduled.length, 1);
    assert.equal(f.scheduled[0]!.delayMs, AUTH_DEADLINE_MS);
    assert.equal(
      f.gateway.connections,
      0,
      "not a member until it authenticates",
    );
    peer.socket.send(authFrame(token));
    const welcome = await peer.frame();
    assert.equal(welcome.type, "welcome");
    assert.equal(f.scheduled[0]!.cancelled, true);
    // A deadline that fires anyway (a scheduler race) must not touch an authenticated socket.
    f.scheduled[0]!.callback();
    peer.socket.send(JSON.stringify({ type: "time", id: 1, sentAt: 5 }));
    assert.equal((await peer.frame()).type, "time");
    assert.equal(f.database.charged, 0);
    assert.equal(f.gateway.connections, 1);
    // Authentication changes nothing after it: the socket is still text-only.
    peer.socket.send(Buffer.from("binary"));
    assert.equal((await peer.closed).code, 1003);
    // Only refused sockets are ever cut off: an admitted socket's close handshake runs to its end.
    assert.equal(f.cutOffs().length, 0);
  } finally {
    await f.close();
  }
});

test("a token in the query string does not authenticate a socket", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    // A page built before the change: token in the URL, then the first heartbeat, never an auth frame.
    const old = f.open(code, `?token=${token}`);
    await old.opened;
    old.socket.send(JSON.stringify({ type: "time", id: 1, sentAt: 5 }));
    assert.deepEqual(await old.closed, {
      code: CLOSE_UNAUTHENTICATED,
      reason: "Authentication required",
    });
    assert.deepEqual(old.frames, []);
    // The same page staying silent instead meets the deadline.
    const silent = f.open(code, `?token=${token}`);
    await silent.opened;
    f.deadlines().at(-1)!.callback();
    assert.equal((await silent.closed).code, CLOSE_UNAUTHENTICATED);
    assert.equal(f.database.charged, 2);
    assert.equal(f.gateway.connections, 0);
    assert.deepEqual(
      f.logs.filter((entry) => entry.kind === "deprecated-query-token"),
      [],
    );
  } finally {
    await f.close();
  }
});

test("garbage, oversized, binary and wrong first frames are refused and charged to the failure budget", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const attempts: Array<[string, string | Buffer]> = [
      ["garbage", "not json"],
      ["malformed token", authFrame("z".repeat(64))],
      ["wrong frame", JSON.stringify({ type: "signal", to: "x", data: {} })],
      [
        "oversized",
        JSON.stringify({ type: "auth", token, padding: "x".repeat(300) }),
      ],
      ["binary", Buffer.from(authFrame(token))],
    ];
    for (const [name, first] of attempts) {
      const before = f.database.charged,
        peer = f.open(code);
      await peer.opened;
      peer.socket.send(first);
      assert.equal((await peer.closed).code, CLOSE_UNAUTHENTICATED, name);
      assert.deepEqual(peer.frames, [], name);
      assert.equal(f.database.charged, before + 1, name);
      assert.equal(f.deadlines().at(-1)!.cancelled, true, name);
    }
    // Past the socket's own 32 kB payload limit ws drops the connection itself; that is charged as well.
    const before = f.database.charged,
      huge = f.open(code);
    await huge.opened;
    const charged = f.database.nextCharge();
    huge.socket.send("x".repeat(40_000));
    await Promise.all([huge.closed, charged]);
    assert.deepEqual(huge.frames, []);
    assert.equal(f.database.charged, before + 1);
    assert.equal(f.gateway.connections, 0);
    // A well-formed token the room has never seen is an ordinary guest; one for a missing room is charged as before.
    const missing = f.open("ZZ99");
    await missing.opened;
    missing.socket.send(authFrame("a".repeat(64)));
    assert.equal((await missing.closed).code, 4004);
    assert.equal(f.database.charged, attempts.length + 2);
  } finally {
    await f.close();
  }
});

test("frames before authentication are never processed and close the socket", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const peer = f.open(code);
    await peer.opened;
    // A valid auth frame arriving second does not rescue the socket.
    peer.socket.send(JSON.stringify({ type: "time", id: 1, sentAt: 5 }));
    peer.socket.send(authFrame(token));
    peer.socket.send(JSON.stringify({ type: "time", id: 2, sentAt: 6 }));
    assert.equal((await peer.closed).code, CLOSE_UNAUTHENTICATED);
    assert.deepEqual(peer.frames, [], "no welcome and no time reply");
    assert.equal(f.gateway.connections, 0);
    assert.equal(f.database.charged, 1);
  } finally {
    await f.close();
  }
});

test("a silent socket is closed by the injected deadline; authenticating late does not help", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const peer = f.open(code);
    await peer.opened;
    assert.equal(f.scheduled[0]!.delayMs, AUTH_DEADLINE_MS);
    f.scheduled[0]!.callback();
    peer.socket.send(authFrame(token));
    assert.deepEqual(await peer.closed, {
      code: CLOSE_UNAUTHENTICATED,
      reason: "Authentication timed out",
    });
    assert.deepEqual(peer.frames, []);
    assert.equal(f.database.charged, 1);
    assert.equal(f.gateway.connections, 0);
  } finally {
    await f.close();
  }
});

test("a socket that leaves before authenticating frees its slot and is not charged", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    // Every slot this address has: a slot that is not freed leaves no room for the socket below.
    const held = [f.open(code), f.open(code), f.open(code), f.open(code)];
    await Promise.all(held.map((peer) => peer.opened));
    await assert.rejects(f.open(code).opened, /HTTP 429/);
    const logged = f.logs.length;
    for (const peer of held) peer.socket.close();
    // The service drops the deadline as it frees the slot.
    await Promise.all(f.deadlines().map((entry) => entry.whenCancelled));
    assert.equal(f.database.charged, 0, "an honest page may leave early");
    assert.equal(f.logs.length, logged, "and leaving is not a failure");
    assert.equal(f.cutOffs().length, 0);
    const next = [f.open(code), f.open(code), f.open(code), f.open(code)];
    await Promise.all(next.map((peer) => peer.opened));
    next[0]!.socket.send(authFrame(token));
    assert.equal((await next[0]!.frame()).type, "welcome");
  } finally {
    await f.close();
  }
});

test("slots held to the deadline and then authenticated are free: only the concurrent bound limits them", async () => {
  // Pins what the failure budget does NOT bound (docs/online/TOKEN-TRANSPORT.md): any well-formed token is admitted
  // to a live room, so a slot can be held for the whole deadline at no charge, indefinitely.
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const tokens = [token, "b".repeat(64), "c".repeat(64), "d".repeat(64)];
    for (let round = 0; round < 32; round++) {
      const held = tokens.map(() => f.open(code));
      await Promise.all(held.map((peer) => peer.opened));
      await assert.rejects(
        f.open(code).opened,
        /HTTP 429/,
        "a fifth concurrent socket is refused before the upgrade",
      );
      // "Just before the deadline": it has not fired, and authenticating cancels it.
      const deadlines = f.deadlines().slice(-held.length);
      assert.deepEqual(
        deadlines.map((entry) => entry.cancelled),
        [false, false, false, false],
      );
      held.forEach((peer, slot) => peer.socket.send(authFrame(tokens[slot]!)));
      for (const peer of held)
        assert.equal((await peer.frame()).type, "welcome");
      assert.deepEqual(
        deadlines.map((entry) => entry.cancelled),
        [true, true, true, true],
      );
    }
    assert.equal(f.database.charged, 0, "128 held slots, nothing charged");
    await f.open(code).opened;
  } finally {
    await f.close();
  }
});

test("a full room is not an admission failure: its own close code, no charge, however often it is tried", async () => {
  const f = await fixture({ maxGuests: 1 });
  try {
    const { code, token } = await f.create();
    const creator = f.open(code);
    await creator.opened;
    creator.socket.send(authFrame(token));
    assert.equal((await creator.frame()).type, "welcome");
    const guest = f.open(code);
    await guest.opened;
    guest.socket.send(authFrame("b".repeat(64)));
    assert.equal((await guest.frame()).type, "welcome");
    for (let attempt = 0; attempt < 31; attempt++) {
      const late = f.open(code);
      await late.opened;
      late.socket.send(authFrame("c".repeat(64)));
      assert.deepEqual(await late.closed, {
        code: CLOSE_ROOM_FULL,
        reason: "Room full",
      });
    }
    assert.equal(f.database.charged, 0);
    // A wrong code is still a guess, and still charged.
    const missing = f.open("ZZ99");
    await missing.opened;
    missing.socket.send(authFrame("c".repeat(64)));
    assert.equal((await missing.closed).code, 4004);
    assert.equal(f.database.charged, 1);
  } finally {
    await f.close();
  }
});

test("a refused socket that never answers the close frame is cut off; one that answers is left alone", async () => {
  const f = await fixture();
  try {
    const { code } = await f.create();
    // A well-behaved client completes the close handshake, and its cut-off is cancelled.
    const polite = f.open(code);
    await polite.opened;
    polite.socket.send("{}");
    assert.equal((await polite.closed).code, CLOSE_UNAUTHENTICATED);
    assert.equal(f.cutOffs().length, 1);
    await f.cutOffs()[0]!.whenCancelled;

    // A raw client upgrades and then ignores everything, including the close frame.
    const raw = connect(f.port, "127.0.0.1");
    let received = Buffer.alloc(0),
      ended = false;
    const waiting: Array<() => void> = [];
    raw.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      for (const resolve of waiting.splice(0)) resolve();
    });
    const gone = new Promise<void>((resolve) =>
      raw.on("close", () => {
        ended = true;
        resolve();
      }),
    );
    raw.on("error", () => {});
    const until = async (done: () => boolean) => {
      while (!done())
        await new Promise<void>((resolve) => waiting.push(resolve));
    };
    raw.write(
      `GET /api/rooms/${code}/ws HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nOrigin: ${ORIGIN}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n` +
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`,
    );
    await until(() => received.includes("\r\n\r\n"));
    assert.match(received.toString(), /^HTTP\/1\.1 101 /);
    const head = received.length;
    f.deadlines().at(-1)!.callback();
    // The close frame (opcode 0x8) with the refusal code arrives, and the socket is still open after it.
    await until(() => received.length >= head + 4);
    assert.equal(received[head], 0x88);
    assert.equal(received.readUInt16BE(head + 2), CLOSE_UNAUTHENTICATED);
    const cutOff = f.cutOffs().at(-1)!;
    assert.equal(f.cutOffs().length, 2);
    assert.equal(cutOff.cancelled, false);
    assert.equal(ended, false, "ws alone would hold this socket for 30 s");
    cutOff.callback();
    await gone;
  } finally {
    await f.close();
  }
});

test("unauthenticated sockets are bounded per address by the admission gate", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const held = [f.open(code), f.open(code), f.open(code), f.open(code)];
    await Promise.all(held.map((peer) => peer.opened));
    await assert.rejects(f.open(code).opened, /HTTP 429/);
    assert.equal(f.database.charged, 0, "a refused upgrade is not a failure");
    // Authenticating releases the slot: the bound is on sockets that have not authenticated yet.
    held[0]!.socket.send(authFrame(token));
    assert.equal((await held[0]!.frame()).type, "welcome");
    const fifth = f.open(code);
    await fifth.opened;
    // So does the deadline.
    for (const entry of f.deadlines()) if (!entry.cancelled) entry.callback();
    for (const peer of [...held.slice(1), fifth])
      assert.equal((await peer.closed).code, CLOSE_UNAUTHENTICATED);
    await f.open(code).opened;
  } finally {
    await f.close();
  }
});

test("bad first frames exhaust the hourly failure budget and are then refused before the upgrade", async () => {
  const f = await fixture();
  try {
    const { code } = await f.create();
    for (let attempt = 0; attempt < 30; attempt++) {
      const peer = f.open(code);
      await peer.opened;
      peer.socket.send("{}");
      assert.equal((await peer.closed).code, CLOSE_UNAUTHENTICATED);
    }
    await assert.rejects(f.open(code).opened, /HTTP 429/);
    // The budget is per hour, as for every other admission failure.
    f.advance(3_600_000);
    const later = await f.create(),
      peer = f.open(later.code);
    await peer.opened;
    peer.socket.send(authFrame(later.token));
    assert.equal((await peer.frame()).type, "welcome");
  } finally {
    await f.close();
  }
});

test("ICE and ending a room take the token from Authorization only, behind an exact-origin preflight", async () => {
  const f = await fixture();
  try {
    const { code, token } = await f.create();
    const base = `http://127.0.0.1:${f.port}/api/rooms/${code}`;
    const peer = f.open(code);
    await peer.opened;
    peer.socket.send(authFrame(token));
    await peer.frame();
    const preflight = await fetch(`${base}/ice`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    assert.equal(preflight.headers.get("Vary"), "Origin");
    assert.match(
      preflight.headers.get("Access-Control-Allow-Headers") ?? "",
      /(^|, )Authorization(,|$)/,
    );
    assert.match(
      preflight.headers.get("Access-Control-Allow-Methods") ?? "",
      /(^|, )GET(,|$)/,
    );
    assert.equal(
      (
        await fetch(`${base}/ice`, {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.example",
            "Access-Control-Request-Headers": "authorization",
          },
        })
      ).status,
      403,
    );
    const ice = await fetch(`${base}/ice`, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
    });
    assert.equal(ice.status, 200);
    assert.equal(ice.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    for (const [name, url, headers] of [
      ["query token", `${base}/ice?token=${token}`, {}],
      ["no credential", `${base}/ice`, {}],
      ["malformed", `${base}/ice`, { Authorization: "Bearer nope" }],
    ] as const)
      assert.equal(
        (await fetch(url, { headers: { Origin: ORIGIN, ...headers } })).status,
        401,
        name,
      );
    // The host capability is the only thing that ends a room, and only as a bearer header.
    for (const [name, url, headers, status] of [
      ["query token", `${base}/end?token=${token}`, {}, 401],
      [
        "guest",
        `${base}/end`,
        { Authorization: `Bearer ${"c".repeat(64)}` },
        403,
      ],
    ] as const)
      assert.equal(
        (
          await fetch(url, {
            method: "POST",
            headers: { Origin: ORIGIN, ...headers },
          })
        ).status,
        status,
        name,
      );
    assert.equal(f.gateway.connections, 1, "the room is still open");
    assert.equal(
      (
        await fetch(`${base}/end`, {
          method: "POST",
          headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
        })
      ).status,
      200,
    );
    assert.equal((await peer.closed).code, 4004);
  } finally {
    await f.close();
  }
});

// LEGACY-QUERY-TOKEN: DEPRECATED rollout window — delete with `legacyQueryToken`, and the fixture option with it.
test("the rollout window admits the old query form, says so at most once a minute, and never logs the token", async () => {
  const f = await fixture({ legacyQueryToken: true });
  try {
    const { code, token } = await f.create();
    const guest = "d".repeat(64);
    const old = f.open(code, `?token=${token}`);
    assert.equal((await old.frame()).type, "welcome");
    assert.equal(f.scheduled.length, 0, "no auth frame is expected of it");
    const second = f.open(code, `?token=${guest}`);
    assert.equal((await second.frame()).type, "welcome");
    assert.deepEqual(f.logs, [
      { kind: "deprecated-query-token", severity: "WARNING", uses: 1 },
    ]);
    f.advance(60_000);
    second.socket.close();
    await second.closed;
    assert.equal(
      (await f.open(code, `?token=${guest}`).frame()).type,
      "welcome",
    );
    assert.deepEqual(f.logs.at(-1), {
      kind: "deprecated-query-token",
      severity: "WARNING",
      uses: 2,
    });
    assert.equal(JSON.stringify(f.logs).includes(guest), false);
    await assert.rejects(f.open(code, "?token=nope").opened, /HTTP 403/);
    // A current page is unaffected by the window.
    const current = f.open(code);
    await current.opened;
    current.socket.send(authFrame("e".repeat(64)));
    assert.equal((await current.frame()).type, "welcome");
    assert.equal(f.database.charged, 0);
  } finally {
    await f.close();
  }
});
