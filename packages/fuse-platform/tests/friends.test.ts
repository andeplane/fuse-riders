import test from "node:test";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import {
  MemoryRoomDatabase,
  RoomError,
  RoomStore,
  peerId,
  type HttpExtension,
} from "fuse-network-be";
import {
  FriendsStore,
  HistoryStore,
  INVITE_TTL_MS,
  LAST_SEEN_ROUNDING_MS,
  LEGACY_GAME_ID,
  MAX_FRIENDS,
  MAX_PENDING,
  MAX_STATUS_INPUT,
  MAX_STATUS_LENGTH,
  MemoryFriendsDatabase,
  MemoryHistoryDatabase,
  ONLINE_WINDOW_MS,
  PRESENCE_REFRESH_MS,
  Platform,
  composeHttp,
  createFriendsHttp,
  createHistoryHttp,
  createPlatformHttp,
  cleanStatus,
  edgeId,
  lastSeenOf,
  publicIdOf,
  storedPresence,
  type AccountRules,
  type FriendsView,
  type GameRegistration,
  type PlayerResult,
} from "../src/index.js";

/**
 * Friends on the platform: requests and acceptance, presence and the online window, invites into a room, and the
 * public ids that let a listed player be added. One fake game; nothing here knows a real one.
 */
const ACCOUNT: AccountRules = {
  validName: (value): value is string =>
    typeof value === "string" && /^[A-Za-z0-9 ]{1,18}$/.test(value),
  validAvatar: (value): value is string => value === "robot" || value === "cat",
  nameRule: "A username is 1 to 18 characters",
  fallbackName: "Player",
};
const game: GameRegistration = {
  id: LEGACY_GAME_ID,
  isBot: (id) => id.startsWith("bot:"),
  parseStats: (raw) => raw as PlayerResult,
  emptyTotals: () => ({}),
  credit: () => ({}),
  addTotals: () => {},
  parseTotals: () => ({}),
};
const platform = new Platform(ACCOUNT, [game]);
const token = (n: number) => n.toString(16).padStart(64, "0");
const member = (n: number) => peerId(token(n));

/** Counts room reads, so a proven room claim can be shown to cost nothing until it changes. */
class CountingRoomDatabase extends MemoryRoomDatabase {
  reads = 0;
  override read(code: string) {
    this.reads++;
    return super.read(code);
  }
}
/** Counts presence writes, so the heartbeat rule can be checked. */
class CountingFriendsDatabase extends MemoryFriendsDatabase {
  writes = 0;
  override setPresence(
    record: Parameters<MemoryFriendsDatabase["setPresence"]>[0],
  ) {
    this.writes++;
    return super.setPresence(record);
  }
}

function fixture() {
  let now = 1_800_000_000_000;
  const roomDatabase = new CountingRoomDatabase();
  let incarnations = 0;
  const rooms = new RoomStore(roomDatabase, {
    now: () => now,
    id: () => `incarnation-${incarnations++}`,
    gameIds: platform.gameIds,
  });
  const history = new MemoryHistoryDatabase(platform, () => now);
  const database = new CountingFriendsDatabase();
  const store = new FriendsStore(platform, history, database, rooms, () => now);
  const http = composeHttp(
    createHistoryHttp(
      new HistoryStore(platform, history, rooms, () => now),
      async (value) => (value.startsWith("id:") ? value.slice(3) : undefined),
    ),
    createFriendsHttp(store, async (value) =>
      value.startsWith("id:") ? value.slice(3) : undefined,
    ),
  );
  /** A room whose creator holds `token(first)`, joined by `token(first + 1)`. */
  const room = async (first: number) => {
    const code = await rooms.createAvailable(token(first));
    await rooms.admit(code, token(first), "gateway");
    await rooms.admit(code, token(first + 1), "gateway");
    return code;
  };
  return {
    rooms,
    history,
    database,
    store,
    http,
    room,
    roomReads: () => roomDatabase.reads,
    tick: (ms: number) => {
      now += ms;
    },
    now: () => now,
    sync: (uid: string, body: unknown = {}) => store.sync(uid, body),
  };
}

/** Drives an HttpExtension with a minimal request (a readable body) and response. */
async function handle(
  http: HttpExtension,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ handled: boolean; status?: number; json?: unknown }> {
  const response: { status?: number; body?: string } = {};
  const req = Object.assign(
    Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ),
    { method, url, headers },
  ) as unknown as Parameters<HttpExtension["handle"]>[0];
  const res = {
    writeHead(status: number) {
      response.status = status;
    },
    end(text: string) {
      response.body = text;
    },
  } as unknown as Parameters<HttpExtension["handle"]>[1];
  let handled: boolean;
  try {
    handled = await http.handle(req, res, "ip");
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    return {
      handled: true,
      status: error.status,
      json: { error: error.message },
    };
  }
  return {
    handled,
    ...(response.status === undefined ? {} : { status: response.status }),
    ...(response.body === undefined ? {} : { json: JSON.parse(response.body) }),
  };
}

const names = (cards: readonly { name: string }[]) => cards.map((c) => c.name);

test("a public id is stable, opaque and not the account", () => {
  assert.equal(publicIdOf("alice"), publicIdOf("alice"));
  assert.notEqual(publicIdOf("alice"), publicIdOf("bob"));
  assert.match(publicIdOf("alice"), /^[0-9a-f]{20}$/);
  assert.ok(!publicIdOf("alice").includes("alice"));
  assert.equal(edgeId("bob", "alice"), edgeId("alice", "bob"));
});

test("a request becomes a friendship when the other side asks too, and either side can end it", async () => {
  const f = fixture();
  const alice = await f.sync("alice", { name: "Alice" }),
    bob = await f.sync("bob", { name: "Bob", avatarId: "cat" });
  assert.deepEqual(alice.friends, []);
  assert.equal(alice.me.name, "Alice");
  assert.deepEqual(await f.store.add("alice", { publicId: bob.me.publicId }), {
    status: "pending",
  });
  // Asking twice is the same request.
  assert.deepEqual(await f.store.add("alice", { publicId: bob.me.publicId }), {
    status: "pending",
  });
  assert.deepEqual(names((await f.sync("alice")).outgoing), ["Bob"]);
  const seen = await f.sync("bob");
  assert.deepEqual(names(seen.incoming), ["Alice"]);
  assert.deepEqual(seen.outgoing, []);
  assert.deepEqual(await f.store.add("bob", { publicId: alice.me.publicId }), {
    status: "accepted",
  });
  const friends = (await f.sync("alice")).friends;
  assert.deepEqual(friends, [
    { publicId: bob.me.publicId, name: "Bob", avatarId: "cat", online: true },
  ]);
  assert.deepEqual(
    (await f.sync("bob")).friends.map((x) => x.name),
    ["Alice"],
  );
  // Accepted stays accepted.
  assert.deepEqual(await f.store.add("alice", { publicId: bob.me.publicId }), {
    status: "accepted",
  });
  assert.deepEqual(await f.store.remove("bob", alice.me.publicId), {
    removed: true,
  });
  assert.deepEqual(await f.store.remove("bob", alice.me.publicId), {
    removed: false,
  });
  assert.deepEqual((await f.sync("alice")).friends, []);
  assert.deepEqual((await f.sync("bob")).incoming, []);
});

test("declining and withdrawing both clear a request", async () => {
  const f = fixture();
  const alice = await f.sync("alice"),
    bob = await f.sync("bob");
  await f.store.add("alice", { publicId: bob.me.publicId });
  await f.store.remove("bob", alice.me.publicId);
  assert.deepEqual((await f.sync("alice")).outgoing, []);
  await f.store.add("alice", { publicId: bob.me.publicId });
  await f.store.remove("alice", bob.me.publicId);
  assert.deepEqual((await f.sync("bob")).incoming, []);
});

test("a request needs a real player who is not the caller", async () => {
  const f = fixture();
  const alice = await f.sync("alice");
  await assert.rejects(
    f.store.add("alice", { publicId: alice.me.publicId }),
    /That is you/,
  );
  await assert.rejects(
    f.store.add("alice", { publicId: publicIdOf("nobody") }),
    /Player not found/,
  );
  await assert.rejects(f.store.add("alice", { publicId: "x" }), /Invalid/);
  await assert.rejects(f.store.add("alice", { publicId: 1 }), /Invalid/);
  await assert.rejects(
    f.store.add("alice", { publicId: alice.me.publicId, extra: 1 }),
    /Invalid/,
  );
  await assert.rejects(f.store.remove("alice", "nope"), /Invalid/);
});

test("the friend list is bounded on both sides", async () => {
  const f = fixture();
  const hub = await f.sync("hub");
  for (let i = 0; i < MAX_FRIENDS; i++) {
    const other = `u${i}`;
    await f.sync(other);
    await f.database.transactEdge(edgeId("hub", other), () => ({
      edge: {
        id: edgeId("hub", other),
        uids: "hub" < other ? ["hub", other] : [other, "hub"],
        requestedBy: other,
        status: "accepted",
        at: 0,
      },
      result: undefined,
    }));
  }
  const late = await f.sync("late");
  await assert.rejects(
    f.store.add("late", { publicId: hub.me.publicId }),
    /full/,
  );
  await assert.rejects(
    f.store.add("hub", { publicId: late.me.publicId }),
    /full/,
  );
});

test("pending requests are bounded in both directions", async () => {
  const f = fixture();
  const target = await f.sync("target");
  for (let i = 0; i < MAX_PENDING; i++) {
    await f.sync(`asker${i}`);
    await f.store.add(`asker${i}`, { publicId: target.me.publicId });
  }
  const late = await f.sync("late");
  await assert.rejects(
    f.store.add("late", { publicId: target.me.publicId }),
    /Too many pending requests/,
  );
  // The target can still answer, and asking again for an existing request is fine.
  await f.store.add("target", { publicId: publicIdOf("asker0") });
  await f.store.add("asker1", { publicId: target.me.publicId });
  // A sender is held to the same number of open requests (over more than one hour's request budget).
  for (let i = 0; i < MAX_PENDING; i++) {
    if (i % 25 === 0) f.tick(3_600_000);
    await f.sync(`asked${i}`);
    await f.store.add("late", { publicId: publicIdOf(`asked${i}`) });
  }
  await f.store.add("late", { publicId: publicIdOf("asked0") });
  await f.sync("one-more");
  await assert.rejects(
    f.store.add("late", { publicId: publicIdOf("one-more") }),
    /Too many pending requests/,
  );
  void late;
});

test("presence: online inside the window, in a room while it last said so, written only when it changes", async () => {
  const f = fixture();
  const alice = await f.sync("alice"),
    bob = await f.sync("bob", { name: "Bob" });
  await f.store.add("alice", { publicId: bob.me.publicId });
  await f.store.add("bob", { publicId: alice.me.publicId });
  const written = async (work: () => Promise<unknown>) => {
    const before = f.database.writes;
    await work();
    return f.database.writes - before;
  };
  // An idle poll inside the refresh period writes nothing.
  assert.equal(await written(() => f.sync("bob", { name: "Bob" })), 0);
  f.tick(PRESENCE_REFRESH_MS);
  assert.equal(await written(() => f.sync("bob", { name: "Bob" })), 1);
  // A room change writes at once.
  const code = await f.room(1);
  assert.equal(
    await written(() =>
      f.sync("bob", { name: "Bob", room: { code, memberId: member(2) } }),
    ),
    1,
  );
  assert.deepEqual((await f.sync("alice")).friends[0], {
    publicId: bob.me.publicId,
    name: "Bob",
    online: true,
    room: { code, gameId: LEGACY_GAME_ID },
  });
  // A name change writes too, and a rename wins over the name the player showed up with.
  assert.equal(
    await written(() =>
      f.sync("bob", { name: "Bobby", room: { code, memberId: member(2) } }),
    ),
    1,
  );
  assert.equal((await f.sync("alice")).friends[0]!.name, "Bobby");
  await f.history.setUsername("bob", "Robert", f.now());
  assert.equal((await f.sync("alice")).friends[0]!.name, "Robert");
  // Past the window the friend is offline and its room is not shown.
  f.tick(ONLINE_WINDOW_MS);
  assert.deepEqual((await f.sync("alice")).friends[0], {
    publicId: bob.me.publicId,
    name: "Robert",
    online: false,
    lastSeen: lastSeenOf(f.now() - ONLINE_WINDOW_MS),
  });
  // Online friends list first.
  const carol = await f.sync("carol", { name: "Carol" });
  await f.store.add("alice", { publicId: carol.me.publicId });
  await f.store.add("carol", { publicId: alice.me.publicId });
  assert.deepEqual(names((await f.sync("alice")).friends), ["Carol", "Robert"]);
});

test("a presence claim is validated", async () => {
  const f = fixture();
  for (const body of [
    null,
    [],
    { name: "" },
    { name: "<b>" },
    { avatarId: "dog" },
    { room: {} },
    { room: { code: "bad", memberId: member(1) } },
    { room: { code: "AB12", memberId: "short" } },
    { room: { code: "AB12", memberId: member(1), gameId: "chess" } },
    { room: { code: "AB12", memberId: member(1), extra: 1 } },
    { extra: 1 },
    { passive: "yes" },
    { passive: 1 },
    { passive: null },
    { away: "true" },
    { away: 0 },
    { away: null },
    { status: 7 },
    { status: null },
    { status: ["brb"] },
    { status: { text: "brb" } },
    { status: "x".repeat(MAX_STATUS_LENGTH + 1) },
    { status: "x".repeat(MAX_STATUS_INPUT + 1) },
    // A passive page has no room of its own to claim.
    { passive: true, room: { code: "AB12", memberId: member(1) } },
  ])
    await assert.rejects(f.sync("alice", body), /Invalid presence/);
});

/** Two accounts that are friends; `friend()` is how alice sees bob right now. */
async function pair() {
  const f = fixture();
  const alice = await f.sync("alice"),
    bob = await f.sync("bob", { name: "Bob" });
  await f.store.add("alice", { publicId: bob.me.publicId });
  await f.store.add("bob", { publicId: alice.me.publicId });
  const written = async (work: () => Promise<unknown>) => {
    const before = f.database.writes;
    await work();
    return f.database.writes - before;
  };
  return {
    ...f,
    bob: bob.me.publicId,
    written,
    friend: async () => (await f.sync("alice")).friends[0]!,
  };
}

test("a refused presence leaves what was stored untouched", async () => {
  const f = await pair();
  await f.sync("bob", { status: "brb", away: false });
  const before = await f.database.presence("bob"),
    writes = f.database.writes;
  for (const body of [
    { status: 7 },
    { status: "ok", away: "no" },
    { status: "ok", passive: "no" },
    { status: "x".repeat(MAX_STATUS_LENGTH + 1) },
    { name: "Robert", status: "ok", unknown: true },
  ])
    await assert.rejects(f.sync("bob", body), /Invalid presence/);
  assert.equal(f.database.writes, writes);
  assert.deepEqual(await f.database.presence("bob"), before);
  assert.equal((await f.friend()).status, "brb");
});

test("an old-shaped body and an old-shaped record still work, and say nothing new", async () => {
  const f = await pair();
  const code = await f.room(1);
  // What every client before this change sends: a name, a head, a room.
  const view = await f.sync("bob", {
    name: "Bob",
    avatarId: "cat",
    room: { code, memberId: member(2) },
  });
  assert.deepEqual(Object.keys(view).sort(), [
    "friends",
    "incoming",
    "invites",
    "me",
    "outgoing",
    "roomPlayers",
  ]);
  assert.deepEqual(await f.friend(), {
    publicId: f.bob,
    name: "Bob",
    avatarId: "cat",
    online: true,
    room: { code, gameId: LEGACY_GAME_ID },
  });
  assert.deepEqual(Object.keys((await f.database.presence("bob"))!).sort(), [
    "at",
    "avatarId",
    "name",
    "publicId",
    "room",
    "uid",
  ]);
  // A record stored before the fields existed reads as not away, with no status.
  const old = { uid: "carol", publicId: publicIdOf("carol"), at: f.now() };
  assert.deepEqual(storedPresence(old), old);
});

test("a status line is tidied, bounded, shown to friends while online, kept until changed and cleared by an empty one", async () => {
  const f = await pair();
  assert.equal(
    cleanStatus("  looking\tfor \n a   volley match  "),
    "looking for a volley match",
  );
  // Bidi overrides, zero-width and control characters go; markup is kept as the text it is.
  assert.equal(cleanStatus("a\u202eb\u200bc\u0000d\u{e000}e\ud800f"), "abcdef");
  assert.equal(cleanStatus("<b>brb</b>"), "<b>brb</b>");
  // Counted in characters, not UTF-16 units; tidying happens before the bound.
  assert.equal(
    cleanStatus("🎮".repeat(MAX_STATUS_LENGTH)),
    "🎮".repeat(MAX_STATUS_LENGTH),
  );
  assert.equal(cleanStatus("🎮".repeat(MAX_STATUS_LENGTH + 1)), undefined);
  assert.equal(
    cleanStatus(` ${"x".repeat(MAX_STATUS_LENGTH)} `),
    "x".repeat(MAX_STATUS_LENGTH),
  );
  assert.equal(cleanStatus("x".repeat(MAX_STATUS_INPUT + 1)), undefined);
  assert.equal(cleanStatus(" \n "), "");
  assert.equal(cleanStatus(undefined), undefined);

  assert.equal(
    await f.written(() => f.sync("bob", { status: " brb\n\u200b " })),
    1,
  );
  assert.equal((await f.database.presence("bob"))!.status, "brb");
  assert.equal((await f.friend()).status, "brb");
  // A poll that says nothing keeps it and writes nothing: an old client's body, and a passive one.
  assert.equal(await f.written(() => f.sync("bob", { name: "Bob" })), 0);
  assert.equal(await f.written(() => f.sync("bob", { passive: true })), 0);
  assert.equal((await f.friend()).status, "brb");
  // Offline, the status is not shown; it is back with the friend.
  f.tick(ONLINE_WINDOW_MS);
  assert.equal((await f.friend()).status, undefined);
  await f.sync("bob");
  assert.equal((await f.friend()).status, "brb");
  // Empty, or nothing but characters that are dropped, clears it.
  assert.equal(await f.written(() => f.sync("bob", { status: "\u200b " })), 1);
  assert.equal((await f.friend()).status, undefined);
  assert.equal("status" in (await f.database.presence("bob"))!, false);
});

test("away: coming back is recorded at once, going away rides the periodic rewrite, and an active page that does not say is not away", async () => {
  const f = await pair();
  // Going away inside the refresh period costs no write of its own and is not shown yet.
  assert.equal(await f.written(() => f.sync("bob", { away: true })), 0);
  assert.equal((await f.friend()).away, undefined);
  f.tick(PRESENCE_REFRESH_MS);
  assert.equal(await f.written(() => f.sync("bob", { away: true })), 1);
  assert.deepEqual(await f.friend(), {
    publicId: f.bob,
    name: "Bob",
    online: true,
    away: true,
  });
  // Still away, still nothing to write.
  assert.equal(await f.written(() => f.sync("bob", { away: true })), 0);
  // Coming back is one write, at once.
  assert.equal(await f.written(() => f.sync("bob", { away: false })), 1);
  assert.equal((await f.friend()).away, undefined);
  assert.equal("away" in (await f.database.presence("bob"))!, false);
  // An old client's body (no `away`) on an active page clears an away left behind by a page that closed.
  f.tick(PRESENCE_REFRESH_MS);
  await f.sync("bob", { away: true });
  assert.equal((await f.friend()).away, true);
  await f.sync("bob", { name: "Bob" });
  assert.equal((await f.friend()).away, undefined);
  // A first sync that is away is away from the start.
  const carol = await f.sync("carol", { name: "Carol", away: true });
  await f.store.add("alice", { publicId: carol.me.publicId });
  await f.store.add("carol", { publicId: (await f.sync("alice")).me.publicId });
  assert.equal(
    (await f.sync("alice")).friends.find((x) => x.name === "Carol")!.away,
    true,
  );
});

test("a passive page alone (the desktop, no game open) keeps the account online and may say it is away", async () => {
  const f = await pair();
  f.tick(ONLINE_WINDOW_MS);
  assert.equal((await f.friend()).online, false);
  const view = await f.sync("bob", { passive: true, away: true });
  assert.deepEqual(view.roomPlayers, []);
  assert.deepEqual(await f.friend(), {
    publicId: f.bob,
    name: "Bob",
    online: true,
    away: true,
  });
  // A passive poll that does not say keeps what is stored; `passive: false` is an ordinary active poll.
  await f.sync("bob", { passive: true });
  assert.equal((await f.friend()).away, true);
  await f.sync("bob", { passive: false });
  assert.equal((await f.friend()).away, undefined);
  // The write budget is the active one: once per refresh period when nothing changes.
  let writes = 0;
  for (let i = 0; i < 9; i++) {
    f.tick(20_000);
    writes += await f.written(() =>
      f.sync("bob", { passive: true, away: false }),
    );
  }
  assert.equal(writes, 3);
});

test("the desktop and a game on one account: passive polls keep the game's room claim, and neither overwrites the other", async () => {
  const f = await pair();
  const code = await f.room(1);
  const game = { name: "Bob", room: { code, memberId: member(2) } },
    desktop = { passive: true, away: true, status: "in a match" };
  await f.sync("bob", game);
  const playing = {
    publicId: f.bob,
    name: "Bob",
    online: true,
    status: "in a match",
    room: { code, gameId: LEGACY_GAME_ID },
  };
  // The desktop's first poll sets the status (one write); after that the two alternate for three minutes at the
  // cost of the periodic rewrite alone (one a minute, as for a single page), the room never leaves the record, and
  // the idle desktop does not make a player in a room look away.
  assert.equal(await f.written(() => f.sync("bob", desktop)), 1);
  const reads = f.roomReads();
  let writes = 0;
  for (let i = 0; i < 18; i++) {
    f.tick(10_000);
    // The game's own room heartbeat keeps its seat alive, as it does in play.
    await f.rooms.admit(code, token(2), "gateway");
    let view: FriendsView | undefined;
    writes += await f.written(async () => {
      view = await f.sync("bob", i % 2 ? game : desktop);
    });
    // The room's members are for the page in the room; the passive poll does not query them.
    assert.equal(view!.roomPlayers.length, i % 2 ? 1 : 0);
    assert.deepEqual(await f.friend(), playing);
    assert.deepEqual((await f.database.presence("bob"))!.room, {
      code,
      memberId: member(2),
      gameId: LEGACY_GAME_ID,
      incarnation: "incarnation-0",
    });
  }
  assert.equal(writes, 3);
  // One proof per rewrite, whichever page's poll it falls to.
  assert.equal(f.roomReads() - reads, 3);
  // The game page leaves (its unload sync names no room): the room goes at once, and the desktop is heard on away.
  await f.sync("bob", { name: "Bob" });
  assert.equal((await f.friend()).room, undefined);
  f.tick(PRESENCE_REFRESH_MS);
  await f.sync("bob", desktop);
  assert.deepEqual(await f.friend(), {
    publicId: f.bob,
    name: "Bob",
    online: true,
    away: true,
    status: "in a match",
  });
});

test("a passive poll cannot keep a dead room alive: the carried claim is re-proven on the rewrite and dropped, not refused", async () => {
  const f = await pair();
  const code = await f.room(1);
  await f.sync("bob", { room: { code, memberId: member(2) } });
  // The game's tab closes without a word; the desktop keeps polling. Inside the refresh period the claim stands.
  f.tick(20_000);
  await f.sync("bob", { passive: true });
  assert.deepEqual((await f.friend()).room, { code, gameId: LEGACY_GAME_ID });
  // The room ends and its code is reissued to other people: the next rewrite finds another incarnation.
  // The same device even holds a seat in the new room, but the stored claim was for the old one.
  await f.rooms.end(code, token(1));
  await f.rooms.create(code, token(5));
  await f.rooms.admit(code, token(5), "gateway");
  await f.rooms.admit(code, token(2), "gateway");
  f.tick(PRESENCE_REFRESH_MS);
  const view = await f.sync("bob", { passive: true });
  assert.deepEqual(view.roomPlayers, []);
  assert.equal((await f.friend()).room, undefined);
  assert.equal("room" in (await f.database.presence("bob"))!, false);
  // A passive page never had a room to be refused for, whatever is stored.
  await f.sync("carol", { passive: true });
  assert.equal("room" in (await f.database.presence("carol"))!, false);
});

test("an offline friend shows when it was last seen, to the hour and no finer", async () => {
  const f = await pair();
  assert.equal(
    lastSeenOf(3 * LAST_SEEN_ROUNDING_MS + 1),
    3 * LAST_SEEN_ROUNDING_MS,
  );
  assert.equal(
    lastSeenOf(4 * LAST_SEEN_ROUNDING_MS - 1),
    3 * LAST_SEEN_ROUNDING_MS,
  );
  assert.equal(
    lastSeenOf(4 * LAST_SEEN_ROUNDING_MS),
    4 * LAST_SEEN_ROUNDING_MS,
  );
  // A sync at no round time.
  f.tick(PRESENCE_REFRESH_MS + 1_234_567);
  await f.sync("bob");
  // Online: no lastSeen at all.
  assert.equal("lastSeen" in (await f.friend()), false);
  const at = (await f.database.presence("bob"))!.at;
  f.tick(ONLINE_WINDOW_MS);
  const offline = await f.friend();
  assert.deepEqual(offline, {
    publicId: f.bob,
    name: "Bob",
    online: false,
    lastSeen: lastSeenOf(at),
  });
  assert.equal(offline.lastSeen! % LAST_SEEN_ROUNDING_MS, 0);
  assert.ok(
    offline.lastSeen! <= at && at - offline.lastSeen! < LAST_SEEN_ROUNDING_MS,
  );
  // Two syncs in the same hour are indistinguishable once offline.
  f.tick(1000);
  await f.sync("bob", { status: "brb", away: true });
  f.tick(ONLINE_WINDOW_MS);
  assert.deepEqual(await f.friend(), offline);
});

test("the Firestore reader and the in-memory database agree on every presence record the store writes", async () => {
  const f = await pair();
  const same = async () => {
    const record = (await f.database.presence("bob"))!;
    // What Firestore hands back for the document `setPresence` wrote: plain data, no undefined fields.
    assert.deepEqual(
      storedPresence(JSON.parse(JSON.stringify(record))),
      record,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
  };
  await same();
  await f.sync("bob", { status: "brb", avatarId: "cat" });
  await same();
  f.tick(PRESENCE_REFRESH_MS);
  await f.sync("bob", { passive: true, away: true });
  await same();
  const code = await f.room(1);
  await f.sync("bob", { room: { code, memberId: member(2) } });
  await same();
  await f.sync("bob", { status: "" });
  await same();
  // A stored `away: false` (never written, but harmless) reads as absent; anything of another type is refused.
  const base = { uid: "bob", publicId: f.bob, at: f.now() };
  assert.deepEqual(storedPresence({ ...base, away: false, status: "" }), base);
  assert.equal(storedPresence(undefined), undefined);
  for (const bad of [
    { ...base, away: "yes" },
    { ...base, status: 7 },
    { ...base, name: 7 },
    { ...base, avatarId: 7 },
    { ...base, at: 1.5 },
    { ...base, publicId: "nope" },
    { ...base, uid: "" },
    { ...base, room: "AB12" },
    { ...base, room: { code, memberId: member(2), gameId: LEGACY_GAME_ID } },
  ])
    assert.throws(() => storedPresence(bad), /Stored presence is incompatible/);
});

test("the new fields are validated at the HTTP boundary: a wrong type is a 400 and old bodies are a 200", async () => {
  const f = await pair();
  const post = (body: unknown) =>
    handle(
      f.http,
      "POST",
      "/api/friends/sync",
      { authorization: "Bearer id:bob" },
      body,
    );
  assert.equal((await post({ name: "Bob" })).status, 200);
  assert.equal((await post({})).status, 200);
  const ok = await post({ passive: true, away: false, status: "  hi  there " });
  assert.equal(ok.status, 200);
  assert.equal((await f.friend()).status, "hi there");
  for (const body of [
    { away: "yes" },
    { passive: "yes" },
    { status: 12 },
    { status: "x".repeat(MAX_STATUS_LENGTH + 1) },
    { passive: true, room: { code: "AB12", memberId: member(1) } },
  ])
    assert.deepEqual(await post(body), {
      handled: true,
      status: 400,
      json: { error: "Invalid presence" },
    });
  assert.equal((await f.friend()).status, "hi there");
});

test("a room claim is proven by a live seat in that room, once per change", async () => {
  const f = fixture();
  const code = await f.room(1);
  // Not a room, not a member of one, a seat that is not in this room.
  await assert.rejects(
    f.sync("alice", { room: { code: "ZZ99", memberId: member(1) } }),
    /Join the room first/,
  );
  await assert.rejects(
    f.sync("alice", { room: { code, memberId: member(9) } }),
    /Join the room first/,
  );
  const other = await f.room(3);
  await assert.rejects(
    f.sync("alice", { room: { code, memberId: member(3) } }),
    /Join the room first/,
  );
  await f.sync("alice", { room: { code, memberId: member(1) } });
  // The same claim again reads no room; a changed one is proven again.
  const reads = f.roomReads();
  await f.sync("alice", { room: { code, memberId: member(1) } });
  assert.equal(f.roomReads(), reads);
  await f.sync("alice", { room: { code: other, memberId: member(3) } });
  assert.equal(f.roomReads(), reads + 1);
  // A seat id is only known inside its room, so naming a live one is the proof; the room's own members are trusted
  // with each other's, as they are with the shared log.
});

test("a reissued room code is another room: a stale claim sees nobody there and is refused once re-proven", async () => {
  const f = fixture();
  const code = await f.room(1);
  await f.sync("alice", { name: "Alice", room: { code, memberId: member(1) } });
  // The room ends and its code is handed to a new room with other members.
  await f.rooms.end(code, token(1));
  await f.rooms.create(code, token(5));
  await f.rooms.admit(code, token(5), "gateway");
  await f.rooms.admit(code, token(6), "gateway");
  await f.sync("bob", { name: "Bob", room: { code, memberId: member(5) } });
  // Alice's device still claims its old seat: inside the refresh window nothing is re-read, and it sees only itself.
  f.tick(1000);
  assert.deepEqual(
    (
      await f.sync("alice", { room: { code, memberId: member(1) } })
    ).roomPlayers.map((p) => p.name),
    ["Alice"],
  );
  assert.deepEqual(
    (
      await f.sync("bob", { room: { code, memberId: member(5) } })
    ).roomPlayers.map((p) => p.name),
    ["Bob"],
  );
  // Once the record is due a rewrite the claim is proven again, and Alice holds no seat in the room the code names now.
  f.tick(PRESENCE_REFRESH_MS);
  await assert.rejects(
    f.sync("alice", { room: { code, memberId: member(1) } }),
    /Join the room first/,
  );
  // Without the room the poll is fine, and Alice is no longer in any room.
  const view = await f.sync("alice");
  assert.deepEqual(view.roomPlayers, []);
});

test("the room's signed-in members are listed with their relation to the caller", async () => {
  const f = fixture();
  const code = await f.room(1);
  const alice = await f.sync("alice", {
      name: "Alice",
      room: { code, memberId: member(1) },
    }),
    bob = await f.sync("bob", {
      name: "Bob",
      room: { code, memberId: member(2) },
    });
  const elsewhere = await f.room(3);
  await f.sync("carol", {
    name: "Carol",
    room: { code: elsewhere, memberId: member(3) },
  });
  await f.store.add("alice", { publicId: bob.me.publicId });
  const view = await f.sync("alice", {
    name: "Alice",
    room: { code, memberId: member(1) },
  });
  assert.deepEqual(view.roomPlayers.map((p) => [p.name, p.relation]).sort(), [
    ["Alice", "you"],
    ["Bob", "outgoing"],
  ]);
  assert.equal(
    view.roomPlayers.find((p) => p.name === "Bob")!.memberId,
    member(2),
  );
  assert.equal(
    (
      await f.sync("bob", { name: "Bob", room: { code, memberId: member(2) } })
    ).roomPlayers.find((p) => p.name === "Alice")!.relation,
    "incoming",
  );
  // A member whose presence went stale is no longer listed; without a room nothing is.
  const bobPresence = (await f.database.presence("bob"))!;
  await f.database.setPresence({
    ...bobPresence,
    at: bobPresence.at - ONLINE_WINDOW_MS,
  });
  assert.deepEqual(
    (
      await f.sync("alice", { room: { code, memberId: member(1) } })
    ).roomPlayers.map((p) => p.name),
    ["Alice"],
  );
  assert.deepEqual((await f.sync("alice")).roomPlayers, []);
  void alice;
});

test("invites reach accepted friends only, from a live member, and expire", async () => {
  const f = fixture();
  const alice = await f.sync("alice", { name: "Alice" }),
    bob = await f.sync("bob"),
    carol = await f.sync("carol");
  await f.store.add("alice", { publicId: bob.me.publicId });
  await f.store.add("bob", { publicId: alice.me.publicId });
  await f.store.add("alice", { publicId: carol.me.publicId });
  const code = await f.room(1);
  // Not a member.
  await assert.rejects(
    f.store.invite(code, token(9), "alice", { to: [bob.me.publicId] }),
    /Join the room first/,
  );
  await assert.rejects(
    f.store.invite("bad", token(1), "alice", { to: [] }),
    /Invalid identity/,
  );
  await assert.rejects(
    f.store.invite(code, token(1), "alice", { to: "x" }),
    /Invalid invite/,
  );
  await assert.rejects(
    f.store.invite(code, token(1), "alice", { to: ["x"] }),
    /Invalid invite/,
  );
  // Carol has not accepted, and a stranger is skipped, not refused.
  assert.deepEqual(
    await f.store.invite(code, token(1), "alice", {
      to: [
        bob.me.publicId,
        carol.me.publicId,
        publicIdOf("nobody"),
        bob.me.publicId,
      ],
    }),
    { sent: 1 },
  );
  assert.deepEqual((await f.sync("carol")).invites, []);
  const invites = (await f.sync("bob")).invites;
  assert.equal(invites.length, 1);
  assert.deepEqual(invites[0], {
    id: invites[0]!.id,
    from: { publicId: alice.me.publicId, name: "Alice" },
    code,
    gameId: LEGACY_GAME_ID,
    at: f.now(),
  });
  // Inviting again refreshes the one invite rather than adding another.
  f.tick(1000);
  await f.store.invite(code, token(1), "alice", { to: [bob.me.publicId] });
  const again = (await f.sync("bob")).invites;
  assert.equal(again.length, 1);
  assert.equal(again[0]!.id, invites[0]!.id);
  assert.equal(again[0]!.at, f.now());
  // Only the addressee can dismiss; dismissing twice is fine.
  await f.store.dismissInvite("carol", invites[0]!.id);
  assert.equal((await f.sync("bob")).invites.length, 1);
  await f.store.dismissInvite("bob", invites[0]!.id);
  await f.store.dismissInvite("bob", invites[0]!.id);
  assert.deepEqual((await f.sync("bob")).invites, []);
  await assert.rejects(f.store.dismissInvite("bob", "nope"), /Invalid invite/);
  // An invite from someone no longer a friend still names its sender; an expired one is gone.
  await f.store.invite(code, token(1), "alice", { to: [bob.me.publicId] });
  await f.store.remove("bob", alice.me.publicId);
  assert.equal((await f.sync("bob")).invites[0]!.from.name, "Alice");
  f.tick(INVITE_TTL_MS);
  assert.deepEqual((await f.sync("bob")).invites, []);
});

test("every friends route needs a sign-in and the room invite is proven by the room token", async () => {
  const f = fixture();
  const signedIn = (uid: string) => ({ authorization: `Bearer id:${uid}` });
  assert.deepEqual(await handle(f.http, "POST", "/api/friends/sync"), {
    handled: true,
    status: 401,
    json: { error: "Sign in first" },
  });
  const alice = (
    await handle(f.http, "POST", "/api/friends/sync", signedIn("alice"), {
      name: "Alice",
    })
  ).json as FriendsView;
  const bob = (
    await handle(f.http, "POST", "/api/friends/sync", signedIn("bob"), {})
  ).json as FriendsView;
  assert.deepEqual(
    await handle(f.http, "POST", "/api/friends", signedIn("alice"), {
      publicId: bob.me.publicId,
    }),
    { handled: true, status: 200, json: { status: "pending" } },
  );
  assert.deepEqual(
    await handle(f.http, "POST", "/api/friends", signedIn("bob"), {
      publicId: alice.me.publicId,
    }),
    { handled: true, status: 200, json: { status: "accepted" } },
  );
  const code = await f.room(1);
  assert.deepEqual(
    await handle(f.http, "POST", `/api/rooms/${code}/invites`, {
      authorization: `Bearer ${token(1)}`,
    }),
    { handled: true, status: 401, json: { error: "Sign in first" } },
  );
  assert.deepEqual(
    await handle(
      f.http,
      "POST",
      `/api/rooms/${code}/invites`,
      { authorization: `Bearer ${token(1)}`, "x-fuse-identity": "id:alice" },
      { to: [bob.me.publicId] },
    ),
    { handled: true, status: 200, json: { sent: 1 } },
  );
  const invites = (
    (await handle(f.http, "POST", "/api/friends/sync", signedIn("bob"), {}))
      .json as FriendsView
  ).invites;
  assert.equal(invites.length, 1);
  assert.deepEqual(
    await handle(
      f.http,
      "DELETE",
      `/api/friends/invites/${invites[0]!.id}`,
      signedIn("bob"),
    ),
    { handled: true, status: 200, json: { dismissed: true } },
  );
  assert.deepEqual(
    await handle(
      f.http,
      "DELETE",
      `/api/friends/${alice.me.publicId}`,
      signedIn("bob"),
    ),
    { handled: true, status: 200, json: { removed: true } },
  );
  // Wrong methods and unrelated paths fall through; a game-scoped path is not a friends route.
  assert.equal(
    (await handle(f.http, "GET", "/api/friends/sync", signedIn("a"))).handled,
    false,
  );
  assert.equal(
    (await handle(f.http, "GET", `/api/rooms/${code}/invites`)).handled,
    false,
  );
  assert.equal(
    (await handle(f.http, "GET", "/api/games/dice/friends/sync")).handled,
    false,
  );
  assert.equal(
    (await handle(f.http, "GET", "/api/friends/other")).handled,
    false,
  );
  assert.deepEqual(f.http.methods, ["PUT", "DELETE"]);
  assert.deepEqual(f.http.headers, ["X-Fuse-Identity"]);
});

test("createPlatformHttp serves history and friends behind one extension", async () => {
  const f = fixture();
  const http = createPlatformHttp({
    history: new HistoryStore(platform, f.history, f.rooms, f.now),
    friends: f.store,
    identity: async (value) => (value === "ok" ? "alice" : undefined),
  });
  const me = await handle(http, "GET", "/api/me", {
    authorization: "Bearer ok",
  });
  assert.deepEqual(me, { handled: true, status: 200, json: { profile: null } });
  const sync = await handle(
    http,
    "POST",
    "/api/friends/sync",
    { authorization: "Bearer ok" },
    {},
  );
  assert.equal(sync.status, 200);
  assert.equal((sync.json as FriendsView).me.publicId, publicIdOf("alice"));
});

test("listed players carry their public id, so a leaderboard row can be added", async () => {
  const f = fixture();
  const rooms = f.rooms,
    history = new HistoryStore(platform, f.history, rooms, f.now).game(
      LEGACY_GAME_ID,
    );
  const code = await f.room(1);
  // A rated round: ratings settle per round once every finisher has reported, and the leaderboard ranks ratings.
  const seat = (id: string, slot: number, placement: number) => ({
    playerId: id,
    name: slot === 0 ? "Alice" : "Bob",
    slot,
    roundsPlayed: 1,
    roundWins: placement === 1 ? 1 : 0,
    matchScoreUnits: 10 - placement,
    matchPlacement: placement,
    earlyExits: 0,
  });
  const result = {
    matchId: "m1",
    round: 1,
    length: 1,
    finishers: [member(1), member(2)],
    winnerId: member(1),
    players: [seat(member(1), 0, 1), seat(member(2), 1, 2)],
  };
  for (const [i, uid] of ["alice", "bob"].entries())
    await history.submit(
      await history.admit(code, token(i + 1), "ip", true),
      { result },
      uid,
    );
  const whole = { ...result, round: undefined };
  for (const [i, uid] of ["alice", "bob"].entries())
    await history.submit(
      await history.admit(code, token(i + 1), "ip"),
      { result: whole },
      uid,
    );
  const rows = await history.leaderboard("ip");
  assert.deepEqual(
    rows.map((row) => [row.name, row.publicId]),
    [
      ["Alice", publicIdOf("alice")],
      ["Bob", publicIdOf("bob")],
    ],
  );
  const feed = await history.feed("ip", "alice", undefined);
  assert.deepEqual(feed.matches[0]!.accounts, {
    [member(1)]: publicIdOf("alice"),
    [member(2)]: publicIdOf("bob"),
  });
  assert.deepEqual(
    (await history.history("bob", undefined)).matches[0]!.accounts,
    {
      [member(1)]: publicIdOf("alice"),
      [member(2)]: publicIdOf("bob"),
    },
  );
});

test("every friends call is rate limited per account, each route on its own budget", async () => {
  const f = fixture();
  const bob = await f.sync("bob");
  for (let i = 0; i < 30; i++)
    await f.store
      .add("alice", { publicId: bob.me.publicId })
      .catch(() => undefined);
  await assert.rejects(
    f.store.add("alice", { publicId: bob.me.publicId }),
    /Too many requests/,
  );
  // Alice's request budget is spent; her polls are not, and Bob's requests are not.
  await f.sync("alice");
  await f.store.add("bob", { publicId: publicIdOf("alice") });
  for (let i = 0; i < 400; i++) await f.sync("carol");
  await assert.rejects(f.sync("carol"), /Too many requests/);
  await f.sync("bob");
  const code = await f.room(1);
  for (let i = 0; i < 60; i++)
    await f.store.invite(code, token(1), "bob", { to: [] });
  await assert.rejects(
    f.store.invite(code, token(1), "bob", { to: [] }),
    /Too many requests/,
  );
});
