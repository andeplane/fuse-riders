import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  endRoom,
  fetchIceServers,
  memberToken,
  openRoomSocket,
  roomSocketUrl,
  type RoomSocket,
} from "../src/room-api.js";
import {
  DEFAULT_ICE_SERVERS,
  IceConfig,
  IceRefusedError,
} from "../src/ice-config.js";

const apiUrl = (path: string) => `https://rooms.test${path}`;
type Call = { url: string; init?: RequestInit };
const fetcher =
  (calls: Call[], response: Response): typeof fetch =>
  async (input, init) => {
    calls.push({ url: String(input), init });
    return response;
  };

test("createRoom posts to the room service and returns validated credentials", async () => {
  const calls: Call[] = [];
  assert.deepEqual(
    await createRoom(
      apiUrl,
      fetcher(
        calls,
        Response.json({ code: "AB42", token: "t", extra: 1 }, { status: 201 }),
      ),
    ),
    { code: "AB42", token: "t" },
  );
  assert.deepEqual(
    calls.map((call) => [call.url, call.init?.method]),
    [["https://rooms.test/api/rooms", "POST"]],
  );
  await assert.rejects(
    createRoom(
      apiUrl,
      fetcher(
        [],
        Response.json(
          { error: "Room creation limit; try later" },
          { status: 429 },
        ),
      ),
    ),
    /Room creation limit/,
  );
  await assert.rejects(
    createRoom(apiUrl, fetcher([], new Response("oops", { status: 503 }))),
    /Could not create room/,
  );
  await assert.rejects(
    createRoom(apiUrl, fetcher([], Response.json({ code: 7 }))),
    /Could not create room/,
  );
});
test("endRoom authenticates with the creator token and keeps the caller's abort signal", async () => {
  const calls: Call[] = [],
    signal = new AbortController().signal;
  await endRoom(
    apiUrl,
    "AB42",
    "secret",
    { signal, keepalive: true },
    fetcher(calls, Response.json({ ok: true })),
  );
  assert.equal(calls[0]!.url, "https://rooms.test/api/rooms/AB42/end");
  assert.deepEqual(
    [
      calls[0]!.init?.method,
      calls[0]!.init?.signal,
      calls[0]!.init?.keepalive,
      new Headers(calls[0]!.init?.headers).get("authorization"),
    ],
    ["POST", signal, true, "Bearer secret"],
  );
  await assert.rejects(
    endRoom(
      apiUrl,
      "AB42",
      "nope",
      {},
      fetcher(
        [],
        Response.json(
          { error: "Only the host can end this room" },
          { status: 403 },
        ),
      ),
    ),
    /Only the host/,
  );
});
test("memberToken is a fresh 64-hex identity the room service accepts", () => {
  const a = memberToken(),
    b = memberToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
});

/** A socket that records what it is sent and opens when the test says so. */
class FakeSocket implements RoomSocket {
  sent: string[] = [];
  private listeners: Array<{ listener: () => void; once: boolean }> = [];
  constructor(readonly url: string) {}
  addEventListener(
    _type: "open",
    listener: () => void,
    options?: { once?: boolean },
  ): void {
    this.listeners.push({ listener, once: options?.once === true });
  }
  send(data: string): void {
    this.sent.push(data);
  }
  open(): void {
    const current = this.listeners;
    this.listeners = current.filter((entry) => !entry.once);
    for (const entry of current) entry.listener();
  }
}
test("the ICE list is fetched with a bearer header and a token-free URL", async () => {
  const calls: Call[] = [],
    token = memberToken(),
    signal = new AbortController().signal;
  assert.deepEqual(
    await fetchIceServers(
      apiUrl,
      "AB42",
      token,
      signal,
      fetcher(calls, Response.json({ iceServers: [] })),
    ),
    { iceServers: [] },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://rooms.test/api/rooms/AB42/ice");
  assert.equal(calls[0]!.init?.signal, signal);
  assert.equal(
    new Headers(calls[0]!.init?.headers).get("authorization"),
    `Bearer ${token}`,
  );
});
test("an ICE request the service refuses is a refusal, not an empty list", async () => {
  for (const status of [401, 403, 429, 503]) {
    const ice = new IceConfig();
    await ice.load((signal) =>
      fetchIceServers(
        apiUrl,
        "AB42",
        memberToken(),
        signal,
        fetcher([], Response.json({ error: "Invalid identity" }, { status })),
      ),
    );
    assert.equal(ice.source, `default (service refused: status ${status})`);
    assert.deepEqual(ice.servers, [...DEFAULT_ICE_SERVERS]);
  }
  // The other two ways to end up on the default list keep their own names.
  const invalid = new IceConfig();
  await invalid.load((signal) =>
    fetchIceServers(
      apiUrl,
      "AB42",
      memberToken(),
      signal,
      fetcher([], Response.json({ iceServers: [] })),
    ),
  );
  assert.equal(invalid.source, "default (service list invalid)");
  const unreachable = new IceConfig();
  await unreachable.load(() => Promise.reject(new TypeError("fetch failed")));
  assert.equal(unreachable.source, "default (ice fetch failed)");
  await assert.rejects(
    fetchIceServers(
      apiUrl,
      "AB42",
      memberToken(),
      new AbortController().signal,
      fetcher([], Response.json({}, { status: 401 })),
    ),
    (error) => error instanceof IceRefusedError && error.status === 401,
  );
});
test("a room is created and joined for one game, named in the query and the auth frame", async () => {
  const calls: Call[] = [];
  await createRoom(
    apiUrl,
    fetcher(
      calls,
      Response.json({ code: "AB42", token: "t" }, { status: 201 }),
    ),
    "dice",
  );
  assert.deepEqual(
    calls.map((call) => [call.url, call.init?.method, call.init?.body]),
    [["https://rooms.test/api/rooms?gameId=dice", "POST", undefined]],
    "a simple request: no body, so no CORS preflight",
  );
  const token = memberToken();
  const socket = openRoomSocket(
    apiUrl,
    "AB42",
    token,
    (url) => new FakeSocket(url),
    "dice",
  );
  assert.equal(new URL(socket.url).search, "");
  socket.open();
  assert.deepEqual(socket.sent, [
    JSON.stringify({ type: "auth", token, gameId: "dice" }),
  ]);
});
test("the room socket authenticates with its first frame, never its URL", () => {
  const token = memberToken(),
    created: FakeSocket[] = [];
  const socket = openRoomSocket(apiUrl, "AB42", token, (url) => {
    const fake = new FakeSocket(url);
    created.push(fake);
    return fake;
  });
  assert.equal(created.length, 1);
  assert.equal(socket, created[0]);
  assert.equal(socket.url, "wss://rooms.test/api/rooms/AB42/ws");
  assert.equal(new URL(socket.url).search, "");
  assert.deepEqual(socket.sent, [], "nothing is sent before the socket opens");
  socket.open();
  assert.deepEqual(socket.sent, [JSON.stringify({ type: "auth", token })]);
  socket.open();
  assert.equal(socket.sent.length, 1, "one auth frame per socket");
  assert.equal(
    roomSocketUrl((path) => `http://localhost:8787${path}`, "AB42"),
    "ws://localhost:8787/api/rooms/AB42/ws",
  );
});
test("no URL the room client produces carries a token", async () => {
  const token = memberToken(),
    calls: Call[] = [],
    urls: string[] = [];
  await endRoom(
    apiUrl,
    "AB42",
    token,
    {},
    fetcher(calls, Response.json({ ok: true })),
  );
  await fetchIceServers(
    apiUrl,
    "AB42",
    token,
    new AbortController().signal,
    fetcher(calls, Response.json({})),
  );
  openRoomSocket(apiUrl, "AB42", token, (url) => {
    urls.push(url);
    return new FakeSocket(url);
  });
  urls.push(...calls.map((call) => call.url));
  assert.equal(urls.length, 3);
  for (const url of urls) {
    assert.equal(url.includes(token), false, url);
    assert.equal(new URL(url).search, "", url);
    assert.equal(new URL(url).hash, "", url);
  }
});
