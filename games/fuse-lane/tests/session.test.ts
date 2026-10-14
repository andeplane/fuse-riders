import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "../src/app/session.js";

/** A `Storage` over a map; `broken` names the methods that throw (a full or locked store). */
class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  constructor(readonly broken: ReadonlySet<string> = new Set()) {}
  private check(method: string): void {
    if (this.broken.has(method)) throw new Error(`${method} refused`);
  }
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    this.check("getItem");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.check("setItem");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.check("removeItem");
    this.map.delete(key);
  }
}

test("storage keys are per game", () => {
  const names = keys("fuse-lane");
  assert.equal(names.name, "fuse-lane-player-name");
  assert.equal(names.shared, "fuse-lane-shared-screen");
  assert.equal(names.host("ABCD"), "fuse-lane-room-ABCD");
  assert.equal(names.peer("ABCD"), "fuse-lane-peer-ABCD");
  assert.notEqual(keys("dice").name, names.name);
});

test("the query picks the page: the landing page, a solo game, a bad code, or a room as its creator, a joiner or the shared screen", () => {
  const storage = new MemoryStorage(),
    store = safeStore(() => storage);
  let made = 0;
  const secret = () => `secret-${++made}`;
  const valid = (code: string) => /^[A-Z]{4}$/.test(code);
  const session = (search: string) =>
    sessionFor(search, store, "fuse-lane", valid, secret);
  assert.deepEqual(session(""), { kind: "landing" });
  assert.deepEqual(session("?solo=1&room=ABCD"), { kind: "solo" });
  assert.deepEqual(session("?solo=0"), { kind: "landing" });
  assert.deepEqual(session("?room=ab1"), { kind: "invalid", code: "AB1" });

  // A joiner keeps one token per room, so a refresh is the same member.
  const joiner = session("?room=%20abcd%20");
  assert.deepEqual(joiner, {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "secret-1",
  });
  assert.equal(storage.map.get("fuse-lane-peer-ABCD"), "secret-1");
  assert.deepEqual(session("?room=ABCD"), joiner);
  // The shared screen holds no seat: a fresh token every load.
  assert.deepEqual(session("?room=ABCD&display"), {
    kind: "room",
    code: "ABCD",
    role: "display",
    token: "secret-2",
  });
  assert.deepEqual(session("?room=ABCD&display"), {
    kind: "room",
    code: "ABCD",
    role: "display",
    token: "secret-3",
  });
  // CREATE ROOM stored the creator's token.
  store.setItem("fuse-lane-room-WXYZ", "creator");
  assert.deepEqual(session("?room=wxyz"), {
    kind: "room",
    code: "WXYZ",
    role: "host",
    token: "creator",
  });
});

test("storage that never throws: a refused or broken store falls back to memory for this page", () => {
  const refused = safeStore(() => {
    throw new Error("SecurityError");
  });
  assert.equal(refused.getItem("a"), null);
  refused.setItem("a", "1");
  assert.equal(refused.getItem("a"), "1");
  refused.removeItem("a");
  assert.equal(refused.getItem("a"), null);

  // A store that opens but cannot even be read is not used at all.
  const locked = new MemoryStorage(new Set(["getItem"]));
  const viaLocked = safeStore(() => locked);
  viaLocked.setItem("a", "1");
  assert.equal(locked.map.size, 0);
  assert.equal(viaLocked.getItem("a"), "1");

  // A full store: what it cannot write is kept in memory, what it can is written through.
  const full = new MemoryStorage(new Set(["setItem", "removeItem"]));
  full.map.set("kept", "yes");
  const viaFull = safeStore(() => full);
  assert.equal(viaFull.getItem("kept"), "yes");
  viaFull.setItem("a", "1");
  assert.equal(full.map.has("a"), false);
  viaFull.removeItem("kept");
  assert.equal(full.map.get("kept"), "yes", "the store refused the removal");

  const working = new MemoryStorage();
  const viaWorking = safeStore(() => working);
  viaWorking.setItem("a", "1");
  assert.equal(working.map.get("a"), "1");
  viaWorking.removeItem("a");
  assert.equal(working.map.has("a"), false);
});

test("room service refusals in the page's words", () => {
  assert.equal(roomFailure("Unknown game: fuse-lane"), NOT_OPEN);
  assert.equal(
    roomFailure("That room belongs to another game"),
    "That code is a room of another game",
  );
  assert.equal(roomFailure("Room is full"), "Room is full");
});
