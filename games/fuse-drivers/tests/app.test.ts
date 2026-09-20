import test from "node:test";
import assert from "node:assert/strict";
import { fuseDriversView } from "../src/game/index.js";
import { presentTable, type Viewer } from "../src/app/presenter.js";
import { dueReports } from "../src/app/reports.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  type Store,
} from "../src/app/session.js";
import { fold, runTo, started } from "./fixtures/fuseDrivers.js";
import { defined } from "./fixtures/defined.js";

/** A Store backed by a Map, so the session tests never touch real storage. */
function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}
const valid = (code: string) => /^[A-Z0-9]{4,10}$/.test(code);

const viewer = (extra: Partial<Viewer> = {}): Viewer => ({
  me: "a",
  host: true,
  solo: false,
  display: false,
  shared: false,
  ...extra,
});

test("the lobby waits for a second driver and only the host may start", () => {
  const room = started();
  room.stage = "lobby";
  const model = presentTable(fuseDriversView(room), viewer());
  assert.equal(model.screen, "lobby");
  assert.ok(model.lobby.showStart);
  assert.ok(model.lobby.canStart, "two are seated");
  assert.deepEqual(
    model.lobby.members.map((member) => member.name),
    ["Ada (you)", "Bo"],
  );
  const guest = presentTable(fuseDriversView(room), viewer({ host: false }));
  assert.ok(!guest.lobby.showStart);
});

test("the race model carries the lap, the place and every driver", () => {
  const room = started();
  runTo(room, room.tick + 40);
  const model = presentTable(fuseDriversView(room), viewer());
  assert.equal(model.screen, "race");
  const race = defined(model.race, "race");
  assert.equal(race.laps, 4);
  assert.equal(race.drivers.length, 2);
  assert.ok(race.drivers.every((driver) => driver.truck >= 0));
  assert.ok(race.place >= 1, "this device is racing, so it has a place");
});

test("the screen reads the view, so a corrected race shows the correction", () => {
  const room = started();
  runTo(room, room.tick + 20);
  const before = defined(
    presentTable(fuseDriversView(room), viewer()).race,
    "race",
  ).drivers[0];
  const race = defined(room.race, "race");
  // A rollback re-folds to a different outcome; no event is emitted again, only the view changes.
  room.race = {
    ...race,
    trucks: race.trucks.map((truck) => ({ ...truck, kills: 3 })),
  };
  const after = defined(
    presentTable(fuseDriversView(room), viewer()).race,
    "race",
  ).drivers[0];
  assert.notDeepEqual(after, before);
  assert.equal(defined(after).kills, 3);
});

test("a finished race shows the winner and offers the host another", () => {
  const room = started();
  const race = defined(room.race, "race");
  room.race = {
    ...race,
    phase: "finished",
    trucks: race.trucks.map((truck) => ({ ...truck, finishedTick: race.tick })),
  };
  fold(room);
  const model = presentTable(fuseDriversView(room), viewer());
  assert.equal(model.screen, "results");
  const results = defined(model.results, "results");
  assert.equal(results.rows.length, 2);
  assert.ok(results.host);
  const guest = presentTable(fuseDriversView(room), viewer({ host: false }));
  assert.equal(
    defined(guest.results, "results").waiting,
    "Waiting for the host",
  );
});

test("a shared screen shows the race and is never asked for a name", () => {
  const room = started();
  const model = presentTable(
    fuseDriversView(room),
    viewer({ me: "", display: true, host: false }),
  );
  assert.ok(!model.askName);
});

test("a device owes its report once the race is confirmed, and owes it once", () => {
  const room = started();
  const race = defined(room.race, "race");
  room.race = {
    ...race,
    phase: "finished",
    trucks: race.trucks.map((truck) => ({ ...truck, finishedTick: race.tick })),
  };
  fold(room);
  const sent = new Set<string>();
  assert.deepEqual(
    dueReports(room, "a", room.tick - 1, sent),
    [],
    "not while a rollback could still change it",
  );
  const due = dueReports(room, "a", room.tick, sent);
  assert.deepEqual(
    due.map((report) => report.path),
    ["round-results", "results"],
  );
  for (const report of due) sent.add(report.key);
  assert.deepEqual(dueReports(room, "a", room.tick, sent), []);
  assert.deepEqual(
    dueReports(room, "bot:1", room.tick, new Set()),
    [],
    "a bot owes nothing",
  );
  assert.deepEqual(
    dueReports(room, "zz", room.tick, new Set()),
    [],
    "a device that did not race owes nothing",
  );
});

test("the page's query decides landing, solo, creator, joiner or shared screen", () => {
  const store = memoryStore(),
    names = keys("fuse-drivers");
  let n = 0;
  const secret = () => `secret-${++n}`;
  const session = (search: string) =>
    sessionFor(search, store, "fuse-drivers", valid, secret);
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
  assert.equal(keys("fuse-drivers").name, "fuse-drivers-player-name");
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

  const backing = memoryStore();
  const working = safeStore(() => backing as unknown as Storage);
  working.setItem("k", "v");
  assert.equal(backing.data.get("k"), "v");
  assert.equal(working.getItem("k"), "v");
  working.removeItem("k");
  assert.equal(backing.data.has("k"), false);

  let fail = false;
  const flaky = safeStore(
    () =>
      ({
        getItem: (key: string) => {
          if (fail) throw new Error("quota");
          return key === "probe" ? null : "stored";
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("quota");
        },
      }) as unknown as Storage,
  );
  flaky.setItem("x", "1");
  assert.equal(flaky.getItem("x"), "stored");
  fail = true;
  assert.equal(flaky.getItem("x"), "1", "a failing read falls back to memory");
  flaky.removeItem("x");
  assert.equal(flaky.getItem("x"), null);
});

test("a service that does not host the game yet says so in the page's words", () => {
  assert.equal(roomFailure("Unknown game"), NOT_OPEN);
  assert.equal(
    roomFailure("Room is for another game"),
    "That code is a room of another game",
  );
  assert.equal(roomFailure("Room not found"), "Room not found");
});

// ---- runtime ----
