import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
  actingCreator,
  applyManagementTick,
  disconnects,
  isManagementEntry,
  permitted,
  successionOrder,
  type LogEntry,
  type Seat,
  type StreamEntries,
} from "../src/index.js";
import { counterGame, type CounterRoom } from "./fixtures/counter-game.js";

const payloads = {
  name: (value: unknown) => typeof value === "string" && value.length > 0,
  avatar: (value: unknown) => value === "fox",
  settings: (value: unknown) => typeof value === "object" && value !== null,
  capacity: 4,
};
const seat = (id: string, connected = true, bot = false): Seat => ({
  id,
  name: id,
  slot: 0,
  connected,
  bot,
});

test("management entries have one shape for every game; payloads are the game's", () => {
  const valid: unknown[] = [
    [1, 1, JOIN, "a", "A", 3, "fox", 1],
    [1, 1, LEAVE, "a"],
    [1, 1, PRESENCE, "a", false, 2],
    [1, 1, SETTINGS, { target: 5 }],
    [1, 1, ACTION, "rematch", "m2"],
    [1, 1, BOT, "add", "bot:1", "AI", 0],
    [1, 1, BOT, "remove", "bot:1"],
  ];
  for (const entry of valid)
    assert.equal(
      isManagementEntry(entry, payloads),
      true,
      JSON.stringify(entry),
    );
  const invalid: unknown[] = [
    "join",
    [0, 1, LEAVE, "a"],
    [1, 0, LEAVE, "a"],
    [1, 1, JOIN, "a", "A", 4, "fox", 1],
    [1, 1, JOIN, "a", "A", 0, "cat", 1],
    [1, 1, JOIN, "a b", "A", 0, "fox", 1],
    [1, 1, JOIN, "a", "", 0, "fox", 1],
    [1, 1, LEAVE, "a", "extra"],
    [1, 1, PRESENCE, "a", "no", 2],
    [1, 1, SETTINGS, null],
    [1, 1, ACTION, "pause", "m2"],
    [1, 1, ACTION, "start", ""],
    [1, 1, ACTION, "start", "x".repeat(65)],
    [1, 1, BOT, "add", "bot:1", "AI", 4],
    [1, 1, BOT, "remove"],
    [1, 1, BOT, "rename", "bot:1"],
    [1, 1, 0, 1],
    [1, 1, 16, "a"],
    [1, 1, JOIN, "a", "A", 0, "fox", 1, "extra"],
  ];
  for (const entry of invalid)
    assert.equal(
      isManagementEntry(entry, payloads),
      false,
      JSON.stringify(entry),
    );
  assert.equal(disconnects([1, 1, PRESENCE, "a", false, 1]), "a");
  assert.equal(disconnects([1, 1, PRESENCE, "a", true, 1]), undefined);
  assert.equal(disconnects([1, 1, LEAVE, "b"]), "b");
  assert.equal(disconnects([1, 1, JOIN, "a", "A", 0, "fox", 1]), undefined);
});

test("succession: the creator, then the connected humans by id; the delegate manages only while the creator is absent", () => {
  const seats = [
    seat("creator"),
    seat("zed"),
    seat("bot:1", true, true),
    seat("amy"),
    seat("gone", false),
  ];
  assert.deepEqual(successionOrder(seats, "creator"), [
    "creator",
    "amy",
    "zed",
  ]);
  assert.equal(actingCreator(seats, "creator"), undefined);
  const away = seats.map((each) =>
    each.id === "creator" ? { ...each, connected: false } : each,
  );
  assert.equal(actingCreator(away, "creator"), "amy");
  const settings: LogEntry = [1, 1, SETTINGS, {}];
  assert.equal(permitted(seats, "creator", "creator", settings), true);
  assert.equal(permitted(seats, "creator", "amy", settings), false);
  assert.equal(permitted(away, "creator", "amy", settings), true);
  assert.equal(permitted(away, "creator", "zed", settings), false);
  assert.equal(permitted(away, "creator", "gone", settings), false);
  // Anyone ranked behind may log the absence of those ahead of it, so a creator and delegate that drop together are both marked.
  assert.equal(
    permitted(seats, "creator", "zed", [1, 1, PRESENCE, "amy", false, 1]),
    true,
  );
  assert.equal(
    permitted(seats, "creator", "amy", [1, 1, PRESENCE, "zed", false, 1]),
    false,
  );
  assert.equal(
    permitted(seats, "creator", "zed", [1, 1, PRESENCE, "amy", true, 1]),
    false,
  );
});

test("applyManagementTick seats, frees, reclaims, restarts and rematches a room on the package's rules", () => {
  const room = counterGame.createRoom("m1", { target: 10 });
  let seq = 0;
  const tick = (
    at: number,
    entries: Record<string, unknown[][]>,
    replica: CounterRoom = room,
  ) => {
    const streams = new Map<string, StreamEntries>();
    for (const [id, bodies] of Object.entries(entries))
      streams.set(id, {
        generation: 1,
        entries: bodies.map((body) => [++seq, at, ...body] as LogEntry),
      });
    applyManagementTick(replica, at, "a", streams, {
      stage: (each) => each.stage,
      maxWatchers: 1,
      parseSettings: counterGame.seating.parseSettings,
      botAvatar: "die",
      start: (each, matchId) => {
        each.stage = "running";
        each.matchId = matchId;
      },
      rematch: (each, matchId) => {
        each.matchId = matchId;
        each.stage = "running";
      },
      lobby: (each, matchId) => {
        each.matchId = matchId;
        each.stage = "lobby";
      },
    });
  };
  tick(1, {
    a: [
      [JOIN, "a", "A", 0, "fox", 1],
      [JOIN, "b", "B", 1, "fox", 1],
      [JOIN, "c", "C", 1, "fox", 1],
      [BOT, "add", "bot:1", "AI", 2],
    ],
    b: [[JOIN, "x", "X", 3, "fox", 1]],
  });
  assert.deepEqual(
    [...room.seats.keys()],
    ["a", "b", "bot:1"],
    "a taken slot and a non-manager's join are no-ops",
  );
  assert.equal(
    room.seats.get("bot:1")!.avatarId,
    "die",
    "the game's bot avatar",
  );
  tick(2, {
    a: [
      [JOIN, "b", "B", 1, "fox", 2],
      [SETTINGS, { target: 99 }],
      [SETTINGS, { target: -1 }],
    ],
  });
  assert.equal(
    room.seats.get("b")!.generation,
    2,
    "a rejoin switches the seat's stream generation",
  );
  assert.deepEqual(room.settings, { target: 99 });
  tick(3, {
    a: [
      [ACTION, "rematch", "m2"],
      [ACTION, "start", "m1b"],
    ],
  });
  assert.equal(
    room.stage,
    "running",
    "rematch waits for a match to be over; start runs from the lobby",
  );
  assert.equal(room.matchId, "m1b", "start takes the logged match id");
  tick(4, {
    a: [
      [LEAVE, "b"],
      [BOT, "remove", "bot:1"],
      [ACTION, "start", "m1"],
    ],
  });
  assert.equal(
    room.seats.get("b")!.connected,
    false,
    "mid-match a departure holds the seat",
  );
  assert.ok(room.seats.has("bot:1"), "a bot stays while seats are held");
  tick(5, {
    a: [
      [PRESENCE, "bot:1", false, 1],
      [PRESENCE, "b", true, 3],
    ],
  });
  assert.equal(
    room.seats.get("bot:1")!.connected,
    true,
    "a bot has no presence",
  );
  assert.equal(room.seats.get("b")!.generation, 3);
  room.stage = "over";
  tick(6, {
    a: [
      [PRESENCE, "b", false, 3],
      [ACTION, "rematch", "m2"],
    ],
  });
  assert.equal(room.matchId, "m2");
  assert.deepEqual(
    [...room.seats.keys()],
    ["a", "bot:1"],
    "a rematch drops absent seats",
  );
  tick(7, {
    a: [
      [BOT, "remove", "bot:2"],
      [ACTION, "lobby", "m3"],
    ],
  });
  tick(8, {
    a: [
      [BOT, "remove", "bot:1"],
      [LEAVE, "a"],
      [LEAVE, "nobody"],
    ],
  });
  assert.equal(room.stage, "lobby");
  assert.equal(room.matchId, "m3");
  assert.deepEqual(
    [...room.seats.keys()],
    [],
    "in the lobby a departure frees the seat",
  );
});

test("watchers rank after the seated humans, keep a creator's crown, and hold no seat", () => {
  const watcher = (id: string, connected = true): Seat => ({
    ...seat(id, connected),
    slot: -1,
    watcher: true,
  });
  const seats = [seat("zed"), watcher("amy"), seat("bob"), watcher("creator")];
  assert.deepEqual(successionOrder(seats, "creator"), [
    "creator",
    "bob",
    "zed",
    "amy",
  ]);
  assert.equal(
    actingCreator(seats, "creator"),
    undefined,
    "a creator watching is present",
  );
  assert.equal(
    actingCreator([seat("zed", false), watcher("amy")], "creator"),
    "amy",
    "a room whose players dropped is run by whoever is left watching",
  );
  assert.equal(
    isManagementEntry([1, 1, SPECTATOR, "join", "w", "W", 2], payloads),
    true,
  );
  assert.equal(
    isManagementEntry([1, 1, SPECTATOR, "leave", "w"], payloads),
    true,
  );
  assert.equal(
    isManagementEntry([1, 1, SPECTATOR, "join", "w", "", 2], payloads),
    false,
  );
  assert.equal(
    isManagementEntry([1, 1, SPECTATOR, "watch", "w"], payloads),
    false,
  );

  const room = counterGame.createRoom("m1", { target: 10 });
  const hooks = {
    stage: (each: CounterRoom) => each.stage,
    maxWatchers: 1,
    parseSettings: counterGame.seating.parseSettings,
    start: (each: CounterRoom) => {
      each.stage = "running";
    },
    rematch: () => {},
    lobby: (each: CounterRoom) => {
      each.stage = "lobby";
    },
  };
  let seq = 0;
  const tick = (at: number, bodies: unknown[][]) =>
    applyManagementTick(
      room,
      at,
      "a",
      new Map([
        [
          "a",
          {
            generation: 1,
            entries: bodies.map((body) => [++seq, at, ...body] as LogEntry),
          },
        ],
      ]),
      hooks,
    );
  tick(1, [
    [JOIN, "a", "A", 0, "fox", 1],
    [SPECTATOR, "join", "w", "W", 3],
    [SPECTATOR, "join", "x", "X", 3],
    [SPECTATOR, "join", "a", "A", 1],
    [JOIN, "w", "W", 1, "fox", 3],
    [BOT, "add", "w", "AI", 2],
  ]);
  assert.deepEqual(
    [...room.seats.values()].map((each) => [
      each.id,
      each.slot,
      !!each.watcher,
    ]),
    [
      ["a", 0, false],
      ["w", -1, true],
    ],
    "one list, capped; a member is a player or a watcher, never both",
  );
  tick(2, [
    [JOIN, "b", "B", 1, "fox", 1],
    [ACTION, "start", "m1"],
  ]);
  tick(3, [
    [PRESENCE, "w", false, 3],
    [LEAVE, "b"],
  ]);
  assert.equal(room.seats.get("w")!.connected, false);
  assert.equal(
    room.seats.get("b")!.connected,
    false,
    "a running match holds a seat",
  );
  tick(4, [[SPECTATOR, "join", "w", "W", 4]]);
  assert.equal(
    room.seats.get("w")!.connected,
    true,
    "a rejoining watcher is present again",
  );
  assert.equal(room.seats.get("w")!.generation, 4);
  tick(5, [
    [PRESENCE, "w", false, 4],
    [ACTION, "lobby", "m2"],
  ]);
  assert.equal(
    room.seats.has("w"),
    false,
    "a return to the lobby drops absent watchers",
  );
  tick(6, [
    [SPECTATOR, "join", "v", "V", 1],
    [SPECTATOR, "leave", "a"],
    [LEAVE, "v"],
  ]);
  assert.equal(
    room.seats.has("v"),
    false,
    "a watcher's departure frees its place in every stage",
  );
  assert.equal(
    room.seats.has("a"),
    true,
    "SPECTATOR leave does not unseat a player",
  );
});
