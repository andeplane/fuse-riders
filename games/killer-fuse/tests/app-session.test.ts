import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_OPEN,
  keepFlags,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  type Store,
} from "../src/app/session.js";

function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}
/** A `Storage` over a map, with switches that make it throw. */
function storage(faults: { read: boolean; write: boolean }): Storage & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    getItem(key) {
      if (faults.read) throw new Error("quota");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (faults.write) throw new Error("quota");
      data.set(key, value);
    },
    removeItem(key) {
      if (faults.write) throw new Error("quota");
      data.delete(key);
    },
  };
}
const valid = (code: string) => /^[A-Z0-9]{4,10}$/.test(code);

test("the page's query decides landing, solo, creator, joiner or shared screen", () => {
  const store = memoryStore(),
    names = keys("killer-fuse");
  let n = 0;
  const secret = () => `secret-${++n}`;
  const session = (search: string) =>
    sessionFor(search, store, "killer-fuse", valid, secret);
  assert.deepEqual(session(""), { kind: "landing" });
  assert.deepEqual(session("?mute"), { kind: "landing" });
  assert.deepEqual(session("?solo=1&mute"), { kind: "solo" });
  assert.deepEqual(session("?room=no!"), { kind: "invalid", code: "NO!" });
  store.setItem(names.host("AB42"), "host-token");
  assert.deepEqual(session("?room=ab42"), {
    kind: "room",
    code: "AB42",
    role: "host",
    token: "host-token",
  });
  const joiner = session("?room=CD12");
  assert.deepEqual(joiner, {
    kind: "room",
    code: "CD12",
    role: "joiner",
    token: "secret-1",
  });
  assert.deepEqual(
    session("?room=CD12"),
    joiner,
    "a refresh is the same member",
  );
  assert.deepEqual(session("?room=AB42&display=1"), {
    kind: "room",
    code: "AB42",
    role: "display",
    token: "secret-2",
  });
  assert.notDeepEqual(
    session("?room=AB42&display=1"),
    session("?room=AB42&display=1"),
    "the shared screen takes a fresh token every load",
  );
  assert.equal(names.name, "killer-fuse-player-name");
  assert.equal(names.shared, "killer-fuse-shared-screen");
  assert.equal(names.peer("CD12"), "killer-fuse-peer-CD12");
});

test("storage that throws falls back to memory for the page's life", () => {
  const refused = safeStore(() => {
    throw new Error("SecurityError");
  });
  assert.equal(refused.getItem("a"), null);
  refused.setItem("a", "1");
  assert.equal(refused.getItem("a"), "1");
  refused.removeItem("a");
  assert.equal(refused.getItem("a"), null);

  const faults = { read: false, write: false };
  const backing = storage(faults);
  const working = safeStore(() => backing);
  working.setItem("k", "v");
  assert.equal(backing.data.get("k"), "v");
  assert.equal(working.getItem("k"), "v");
  working.removeItem("k");
  assert.equal(backing.data.has("k"), false);

  faults.write = true;
  working.setItem("x", "1");
  assert.equal(backing.data.has("x"), false);
  faults.read = true;
  assert.equal(
    working.getItem("x"),
    "1",
    "a failing read falls back to memory",
  );
  working.removeItem("x");
  assert.equal(working.getItem("x"), null);
});

test("a service that does not host the game yet says so in the page's words", () => {
  assert.equal(roomFailure("Unknown game"), NOT_OPEN);
  assert.equal(
    roomFailure("Room is for another game"),
    "That code is a room of another game",
  );
  assert.equal(roomFailure("Room not found"), "Room not found");
});

test("a muted page keeps the flag on the links it follows itself", () => {
  const muted = new URLSearchParams("?mute");
  assert.equal(keepFlags(muted, "/killer-fuse/"), "/killer-fuse/?mute");
  assert.equal(
    keepFlags(muted, "/killer-fuse/?solo=1"),
    "/killer-fuse/?solo=1&mute",
    "a path that already asks something gets the flag appended, not a second ?",
  );
  assert.equal(
    keepFlags(muted, "/killer-fuse/?room=ABCD&display=1"),
    "/killer-fuse/?room=ABCD&display=1&mute",
  );
});

test("a page nobody muted adds nothing to its links", () => {
  const plain = new URLSearchParams("?solo=1");
  assert.equal(keepFlags(plain, "/killer-fuse/"), "/killer-fuse/");
  assert.equal(
    keepFlags(plain, "/killer-fuse/?solo=1"),
    "/killer-fuse/?solo=1",
  );
});
