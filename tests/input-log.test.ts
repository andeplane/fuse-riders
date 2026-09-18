import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  AVATAR,
  BOT,
  CANCEL,
  JOIN,
  LEAVE,
  PRESENCE,
  PRESS,
  RELEASE,
  SETTINGS,
  SPECTATOR,
  STEER,
  foldPlayerEntries,
  isEntry,
  isManagementKind,
  neutralControls,
  type Entry,
} from "../src/engine/input-log.js";
import { BotController } from "../src/engine/bot-controller.js";
import {
  MAX_SPECTATORS,
  RULES,
  actingCreator,
  applyTick,
  canonicalRoomState,
  createRoomState,
  freeSlot,
  hashRoomState,
  hashText,
  memberConnected,
  permitted,
  successionOrder,
  type RoomState,
  type StreamEntries,
} from "../src/engine/apply-tick.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  COUNTDOWN_TICKS,
  ROUND_OVER_TICKS,
  eliminatePlayer,
} from "../src/engine/game.js";

const settings = defaultRoomSettings();
const entry = (seq: number, tick: number, ...body: unknown[]): Entry =>
  [seq, tick, ...body] as Entry;
const streams = (
  ...items: [id: string, entries: Entry[], generation?: number][]
): Map<string, StreamEntries> =>
  new Map(
    items.map(([id, entries, generation]) => [
      id,
      { generation: generation ?? 1, entries },
    ]),
  );
function room(): {
  state: RoomState;
  bots: BotController;
  tick: (streams?: Map<string, StreamEntries>) => ReturnType<typeof applyTick>;
  seq: Record<string, number>;
  at: (id: string, ...body: unknown[]) => Entry;
} {
  const state = createRoomState("room", settings),
    bots = new BotController(),
    seq: Record<string, number> = {};
  return {
    state,
    bots,
    seq,
    tick: (input = new Map()) => applyTick(state, "creator", input, bots),
    at: (id, ...body) =>
      entry((seq[id] = (seq[id] ?? 0) + 1), state.game.tick + 1, ...body),
  };
}
function playing() {
  const r = room();
  r.tick(
    streams([
      "creator",
      [
        r.at("creator", JOIN, "creator", "Creator", 0, "fox", 1),
        r.at("creator", JOIN, "guest", "Guest", 1, "cat", 1),
      ],
    ]),
  );
  r.tick(streams(["creator", [r.at("creator", ACTION, "start", "match-1")]]));
  for (let i = 0; i < COUNTDOWN_TICKS; i++) r.tick();
  assert.equal(r.state.game.phase, "playing");
  return r;
}

test("entry validation accepts every kind and rejects malformed shapes, bounds and unknown kinds", () => {
  const valid: Entry[] = [
    entry(1, 1, STEER, 3),
    entry(3, 2, PRESS, 1),
    entry(4, 2, RELEASE, 1),
    entry(6, 3, CANCEL, 2),
    entry(7, 3, AVATAR, "fox"),
    entry(8, 4, JOIN, "abc", "Name", 4, "robot", 0),
    entry(9, 4, LEAVE, "abc"),
    entry(10, 4, PRESENCE, "abc", false, 3),
    entry(11, 4, SETTINGS, settings),
    entry(12, 4, ACTION, "lobby", "m"),
    entry(13, 4, BOT, "add", "bot:1", "AI Ada", 2),
    entry(14, 4, BOT, "remove", "bot:1"),
    entry(15, 4, SPECTATOR, "join", "abc", "Watcher", 7),
    entry(16, 4, SPECTATOR, "leave", "abc"),
  ];
  for (const item of valid)
    assert.equal(isEntry(item), true, JSON.stringify(item));
  const invalid = [
    [0, 1, STEER, 0],
    [1, 0, STEER, 0],
    [1, 1, STEER, 4],
    [1, 1, STEER],
    [1, 1, 1, 0, 65535], // kind 1 carried Target Bomb aim and is retired
    [1, 1, PRESS, 0],
    [1, 1, RELEASE, 1, 5],
    [1, 1, RELEASE, 1, 10, 20], // the retired release-with-aim form
    [1, 1, AVATAR, "nope"],
    [1, 1, JOIN, "", "Name", 0, "fox", 1],
    [1, 1, JOIN, "abc", "   ", 0, "fox", 1],
    [1, 1, JOIN, "abc", "Name", 5, "fox", 1],
    [1, 1, PRESENCE, "abc", "yes", 1],
    [1, 1, SETTINGS, { ...settings, length: 0 }],
    [1, 1, ACTION, "pause", "m"],
    [1, 1, BOT, "add", "bot:1", "AI", 9],
    [1, 1, BOT, "remove"],
    [1, 1, SPECTATOR, "join", "abc", "Watcher"],
    [1, 1, SPECTATOR, "join", "abc", "   ", 1],
    [1, 1, SPECTATOR, "join", "", "Watcher", 1],
    [1, 1, SPECTATOR, "join", "abc", "Watcher", -1],
    [1, 1, SPECTATOR, "watch", "abc"],
    [1, 1, SPECTATOR, "leave"],
    [1, 1, 17, "join", "abc"],
    [1, 1, 99, 1],
    [1.5, 1, STEER, 0],
    [-0, 1, STEER, 0],
    "nope",
    null,
    [1, 1, STEER, 0, 0, 0, 0, 0, 0],
  ];
  for (const item of invalid)
    assert.equal(isEntry(item), false, JSON.stringify(item));
  assert.equal(isManagementKind(JOIN), true);
  assert.equal(isManagementKind(SPECTATOR), true);
  assert.equal(isManagementKind(SPECTATOR + 1), false);
  assert.equal(isManagementKind(STEER), false);
});

test("the gesture fold mirrors the LAN bomb buffer: press, replacement, matching release, cancel, mismatch", () => {
  const held = neutralControls();
  assert.deepEqual(foldPlayerEntries(held, [entry(1, 1, STEER, 1)]), {
    left: true,
    right: false,
    bomb: false,
  });
  assert.deepEqual(foldPlayerEntries(held, [entry(3, 2, PRESS, 1)]), {
    left: true,
    right: false,
    bomb: true,
    bombCommands: [{ action: "press" }],
  });
  assert.deepEqual(
    foldPlayerEntries(held, [entry(4, 3, PRESS, 2)]).bombCommands,
    [{ action: "cancel" }, { action: "press" }],
  );
  assert.deepEqual(
    foldPlayerEntries(held, [entry(5, 4, RELEASE, 1)]).bombCommands,
    undefined,
    "a stale gesture id is a no-op",
  );
  assert.deepEqual(foldPlayerEntries(held, [entry(6, 5, RELEASE, 2)]), {
    left: true,
    right: false,
    bomb: false,
    bombCommands: [{ action: "release" }],
  });
  assert.deepEqual(
    foldPlayerEntries(held, [entry(7, 6, PRESS, 2)]).bombCommands,
    undefined,
    "gesture ids must increase",
  );
  assert.deepEqual(
    foldPlayerEntries(held, [
      entry(8, 7, PRESS, 3),
      entry(9, 7, CANCEL, 3),
      entry(10, 7, STEER, 0),
    ]),
    {
      left: false,
      right: false,
      bomb: false,
      bombCommands: [{ action: "press" }, { action: "cancel" }],
    },
  );
  assert.deepEqual(
    foldPlayerEntries(held, [
      entry(11, 8, CANCEL, 3),
      entry(12, 8, AVATAR, "fox"),
    ]),
    { left: false, right: false, bomb: false },
  );
});

test("a rematch drops the riders lost during the finished match and restarts with the rest", () => {
  const r = playing();
  r.tick(
    streams([
      "creator",
      [r.at("creator", BOT, "add", "bot:1", "AI Hopper", 2)],
    ]),
  );
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "guest", false, 1)]]));
  assert.equal(
    r.state.game.players.get("guest")!.connected,
    false,
    "a mid-match loss keeps the seat",
  );
  r.tick(streams(["creator", [r.at("creator", ACTION, "rematch", "match-3")]]));
  assert.equal(
    r.state.game.phase,
    "playing",
    "a rematch during play is a no-op",
  );
  r.state.game.phase = "matchOver";
  r.state.game.phaseEndsAtTick = r.state.game.tick;
  r.tick(streams(["creator", [r.at("creator", ACTION, "rematch", "match-3")]]));
  assert.deepEqual(
    [...r.state.game.players.keys()],
    ["creator", "bot:1"],
    "the lost rider is gone, the AI rider stays",
  );
  assert.equal(r.state.game.matchId, "match-3");
  assert.equal(r.state.game.phase, "countdown");
});

test("management entries join, seat, start, change settings, add and remove bots, leave and return to the lobby", () => {
  const r = playing();
  assert.deepEqual([...r.state.game.players.keys()], ["creator", "guest"]);
  assert.equal(r.state.game.players.get("guest")!.avatarId, "cat");
  r.tick(
    streams([
      "creator",
      [r.at("creator", SETTINGS, { ...settings, length: 1, match: "rounds" })],
    ]),
  );
  assert.equal(r.state.settings.length, 1);
  assert.equal(
    r.state.game.settings!.length,
    5,
    "format stays fixed during a match",
  );
  r.tick(
    streams([
      "creator",
      [r.at("creator", BOT, "add", "bot:1", "AI Hopper", 2)],
    ]),
  );
  assert.equal(r.state.game.players.get("bot:1")!.connected, true);
  assert.equal(r.state.bots.has("bot:1"), true);
  assert.equal(freeSlot(r.state.game), 3);
  r.tick(streams(["creator", [r.at("creator", BOT, "remove", "bot:1")]]));
  assert.equal(
    r.state.game.players.has("bot:1"),
    true,
    "bots leave only between rounds",
  );
  r.tick(streams(["creator", [r.at("creator", LEAVE, "guest")]]));
  assert.equal(
    r.state.game.players.get("guest")!.connected,
    false,
    "mid-round leave keeps the seat",
  );
  r.tick(streams(["creator", [r.at("creator", ACTION, "lobby", "match-2")]]));
  assert.equal(r.state.game.phase, "lobby");
  assert.equal(r.state.game.matchId, "match-2");
  assert.ok(
    r.state.game.tick > COUNTDOWN_TICKS,
    "ticks stay monotonic across lobby resets",
  );
  assert.deepEqual(
    [...r.state.game.players.keys()],
    ["creator", "bot:1"],
    "disconnected riders are dropped by the lobby reset",
  );
  r.tick(
    streams([
      "creator",
      [
        r.at("creator", BOT, "remove", "bot:1"),
        r.at("creator", ACTION, "start", "match-3"),
      ],
    ]),
  );
  assert.equal(r.state.game.players.has("bot:1"), false);
  assert.equal(
    r.state.game.phase,
    "lobby",
    "a start without two riders is ignored, not thrown",
  );
  r.tick(
    streams([
      "creator",
      [
        r.at("creator", JOIN, "guest", "Guest", 1, "cat", 2),
        r.at("creator", ACTION, "start", "match-3"),
      ],
    ]),
  );
  assert.equal(r.state.game.phase, "countdown");
  assert.equal(r.state.game.settings!.length, 1);
});

test("player entries steer and fire only for connected seats of the current generation; avatar entries apply anywhere", () => {
  const r = playing();
  const guest = r.state.game.players.get("guest")!;
  const before = guest.angle;
  r.tick(streams(["guest", [r.at("guest", STEER, 1)]]));
  assert.notEqual(guest.angle, before);
  const turned = guest.angle;
  r.tick();
  assert.notEqual(
    guest.angle,
    turned,
    "held steering persists without entries",
  );
  r.tick(streams(["guest", [r.at("guest", PRESS, 1)]]));
  assert.equal(guest.bombChargeStartedTick, r.state.game.tick);
  r.tick(streams(["guest", [r.at("guest", RELEASE, 1)]]));
  assert.equal(guest.bombChargeStartedTick, undefined);
  assert.equal(r.state.game.bombs.size, 1);
  r.tick(
    streams(
      ["guest", [r.at("guest", AVATAR, "robot")]],
      ["stranger", [entry(1, r.state.game.tick + 1, STEER, 3)]],
    ),
  );
  assert.equal(guest.avatarId, "robot");
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "guest", false, 1)]]));
  assert.equal(guest.connected, false);
  const heading = guest.angle;
  r.tick();
  r.tick();
  assert.equal(
    guest.angle,
    heading,
    "a disconnected rider holds a neutral heading",
  );
  r.tick(
    streams(
      ["creator", [r.at("creator", PRESENCE, "guest", true, 2)]],
      ["guest", [r.at("guest", STEER, 2)]],
    ),
  );
  const resumed = guest.angle;
  r.tick(streams(["guest", [r.at("guest", STEER, 2)], 1]));
  assert.equal(
    guest.angle,
    resumed,
    "entries from an old generation are ignored",
  );
  r.tick(streams(["guest", [r.at("guest", STEER, 2)], 2]));
  assert.notEqual(guest.angle, resumed);
});

test("management entries from a non-creator are ignored unless the creator is disconnected and the sender is the lowest connected rider", () => {
  const r = playing();
  r.tick(streams(["guest", [r.at("guest", ACTION, "lobby", "hijack")]]));
  assert.equal(r.state.game.phase, "playing");
  assert.equal(actingCreator(r.state, "creator"), undefined);
  r.tick(
    streams(
      ["creator", [r.at("creator", JOIN, "zed", "Zed", 2, "fox", 1)]],
      ["zed", [r.at("zed", PRESENCE, "creator", false, 1)]],
    ),
  );
  assert.equal(
    r.state.game.players.get("creator")!.connected,
    true,
    "only the lowest rider may mark the creator absent",
  );
  r.tick(
    streams([
      "guest",
      [
        r.at("guest", PRESENCE, "creator", false, 1),
        r.at("guest", SETTINGS, { ...settings, length: 9 }),
      ],
    ]),
  );
  assert.equal(r.state.game.players.get("creator")!.connected, false);
  assert.equal(
    r.state.settings.length,
    9,
    "delegation starts within the same tick",
  );
  assert.equal(actingCreator(r.state, "creator"), "guest");
  r.tick(streams(["zed", [r.at("zed", ACTION, "lobby", "zed")]]));
  assert.equal(
    r.state.game.phase,
    "playing",
    "only the lowest connected rider acts",
  );
  r.tick(
    streams(["guest", [r.at("guest", SETTINGS, { ...settings, length: 5 })]]),
  );
  assert.equal(
    r.state.settings.length,
    5,
    "the acting creator manages the room",
  );
  r.tick(
    streams(
      ["creator", [r.at("creator", PRESENCE, "creator", true, 2)]],
      ["guest", [r.at("guest", SETTINGS, { ...settings, length: 7 })]],
    ),
  );
  assert.equal(
    r.state.settings.length,
    5,
    "the creator returning revokes delegation in the same tick",
  );
  r.tick(
    streams(["creator", [r.at("creator", PRESENCE, "creator", false, 2)]]),
  );
  r.tick(streams(["guest", [r.at("guest", ACTION, "lobby", "delegated")]]));
  assert.equal(r.state.game.phase, "lobby");
  assert.equal(r.state.game.matchId, "delegated");
  assert.equal(
    r.state.game.players.has("creator"),
    false,
    "a lobby reset drops the absent creator; it rejoins through its own join entry",
  );
  r.tick(
    streams([
      "creator",
      [r.at("creator", JOIN, "creator", "Creator", 0, "fox", 3)],
    ]),
  );
  assert.equal(actingCreator(r.state, "creator"), undefined);
});

test("round progression prunes disconnected riders, applies pending powerup weights and needs two connected riders", () => {
  const r = playing();
  r.tick(
    streams([
      "creator",
      [
        r.at("creator", JOIN, "third", "Third", 2, "fox", 1),
        r.at("creator", SETTINGS, {
          ...settings,
          weights: { shell: 1 },
          length: 9,
        }),
      ],
    ]),
  );
  assert.equal(r.state.game.players.get("third")!.alive, false);
  eliminatePlayer(r.state.game, "guest");
  r.tick();
  assert.equal(r.state.game.phase, "roundOver");
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "guest", false, 1)]]));
  for (let i = 0; i < ROUND_OVER_TICKS; i++) r.tick();
  assert.equal(r.state.game.phase, "countdown");
  assert.equal(r.state.game.round, 2);
  assert.equal(r.state.game.players.has("guest"), false);
  assert.deepEqual(r.state.game.settings!.weights, { shell: 1 });
  assert.equal(r.state.game.settings!.length, 5);
  eliminatePlayer(r.state.game, "third");
  for (let i = 0; i < COUNTDOWN_TICKS; i++) r.tick();
  eliminatePlayer(r.state.game, "third");
  r.tick();
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "third", false, 1)]]));
  for (let i = 0; i < ROUND_OVER_TICKS + 2; i++) r.tick();
  assert.equal(
    r.state.game.phase,
    "roundOver",
    "one connected rider cannot start the next round",
  );
  assert.equal(r.state.game.players.size, 1);
  assert.equal(
    r.state.game.players.get("creator")!.bombChargeStartedTick,
    undefined,
  );
});

test("bots are simulated on every replica and the same log always folds to the same hash", () => {
  const build = () => {
    const r = room();
    r.tick(
      streams([
        "creator",
        [
          r.at("creator", JOIN, "creator", "Creator", 0, "fox", 1),
          r.at("creator", BOT, "add", "bot:1", "AI Turing", 1),
          r.at("creator", BOT, "add", "bot:2", "AI Hopper", 2),
        ],
      ]),
    );
    r.tick(streams(["creator", [r.at("creator", ACTION, "start", "m")]]));
    for (let i = 0; i < 400; i++) r.tick();
    return r.state;
  };
  const a = build(),
    b = build();
  assert.equal(hashRoomState(a), hashRoomState(b));
  assert.equal(canonicalRoomState(a), canonicalRoomState(b));
  assert.ok(
    [...a.game.matchStats.values()].some((stats) => stats.distanceUnits > 0),
    "bots moved",
  );
  assert.match(hashText("x"), /^[0-9a-f]{16}$/);
  assert.notEqual(hashText("a"), hashText("b"));
  assert.equal(RULES, "fuse-p2p-42");
  const reordered = createRoomState("room", settings);
  reordered.game.players = new Map([...a.game.players].reverse());
  reordered.game.tick = a.game.tick;
  assert.notEqual(hashRoomState(reordered), hashRoomState(a));
  const shuffled = structuredClone(a);
  shuffled.game.players = new Map([...a.game.players].reverse());
  assert.equal(
    hashRoomState(shuffled),
    hashRoomState(a),
    "map order never matters",
  );
});

test("succession: a rider may record the absence of anyone ahead of it, and manages once everyone ahead is absent", () => {
  const r = playing();
  r.tick(
    streams([
      "creator",
      [r.at("creator", JOIN, "third", "Third", 2, "fox", 3)],
    ]),
  );
  assert.deepEqual(successionOrder(r.state, "creator"), [
    "creator",
    "guest",
    "third",
  ]);
  const entry = (id: string, ...body: unknown[]) => r.at(id, ...body);
  assert.equal(
    permitted(r.state, "creator", "third", entry("third", SETTINGS, settings)),
    false,
    "a rider behind the delegate manages nothing while the creator is here",
  );
  assert.equal(
    permitted(
      r.state,
      "creator",
      "guest",
      entry("guest", PRESENCE, "third", false, 3),
    ),
    false,
    "nobody marks absent a rider behind them",
  );
  r.tick(streams(["third", [entry("third", PRESENCE, "creator", false, 1)]]));
  assert.equal(
    r.state.game.players.get("creator")!.connected,
    false,
    "the third rider may mark the creator absent",
  );
  r.tick(
    streams(["third", [entry("third", SETTINGS, { ...settings, length: 9 })]]),
  );
  assert.equal(
    r.state.settings.length,
    5,
    "the guest is the delegate, so the third rider still manages nothing",
  );
  r.tick(streams(["third", [entry("third", PRESENCE, "guest", false, 2)]]));
  assert.equal(
    r.state.game.players.get("guest")!.connected,
    false,
    "and may mark the delegate absent too",
  );
  assert.equal(actingCreator(r.state, "creator"), "third");
  r.tick(
    streams(["third", [entry("third", SETTINGS, { ...settings, length: 9 })]]),
  );
  assert.equal(r.state.settings.length, 9, "now it manages");
  r.tick(streams(["guest", [entry("guest", PRESENCE, "third", false, 3)]]));
  assert.equal(
    r.state.game.players.get("third")!.connected,
    true,
    "an absent rider manages nothing",
  );
});

test("a lobby reset keeps only the folds and bots of riders it still seats, so the state stays snapshot-clean", () => {
  const r = playing();
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "guest", false, 1)]]));
  r.tick(streams(["creator", [r.at("creator", ACTION, "lobby", "match-2")]]));
  assert.deepEqual([...r.state.game.players.keys()], ["creator"]);
  assert.deepEqual(
    [...r.state.folds.keys()],
    ["creator"],
    "no fold outlives its seat",
  );
});

test("the watching list is folded: joins are capped and idempotent, presence reaches it, and a leave frees the place", () => {
  const r = playing();
  const watchers = ["w1", "w2", "w3", "w4", "w5", "w6"];
  r.tick(
    streams([
      "creator",
      watchers.map((id, index) =>
        r.at("creator", SPECTATOR, "join", id, `Watcher ${index + 1}`, 10),
      ),
    ]),
  );
  assert.deepEqual(
    [...r.state.spectators.keys()],
    watchers.slice(0, MAX_SPECTATORS),
    "the sixth watcher is refused by the fold, on every replica alike",
  );
  assert.equal(r.state.spectators.get("w1")!.name, "Watcher 1");
  assert.equal(r.state.game.players.size, 2, "no watcher took a seat");
  r.tick(
    streams([
      "creator",
      [r.at("creator", SPECTATOR, "join", "w1", "Renamed", 11)],
    ]),
  );
  assert.deepEqual(
    [
      r.state.spectators.get("w1")!.name,
      r.state.spectators.get("w1")!.generation,
    ],
    ["Watcher 1", 11],
    "a second join from a listed watcher is its reconnection, not a rename",
  );
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "w2", false, 12)]]));
  assert.equal(r.state.spectators.get("w2")!.connected, false);
  assert.equal(memberConnected(r.state, "w2"), false);
  assert.equal(memberConnected(r.state, "w1"), true);
  r.tick(streams(["creator", [r.at("creator", LEAVE, "w3")]]));
  assert.equal(
    r.state.spectators.has("w3"),
    false,
    "a watcher holds no seat, so leaving frees its place mid-match too",
  );
  r.tick(streams(["creator", [r.at("creator", SPECTATOR, "leave", "w4")]]));
  assert.equal(r.state.spectators.has("w4"), false);
  r.tick(
    streams([
      "creator",
      [r.at("creator", JOIN, "w1", "Watcher 1", 2, "cat", 11)],
    ]),
  );
  assert.equal(
    r.state.game.players.has("w1"),
    false,
    "a member is a rider or a watcher, never both",
  );
  // A bot id can only reach the watching list from a modified peer, but a state holding both would fold everywhere and
  // then fail every snapshot decode, which nothing in the room could recover from.
  r.tick(
    streams([
      "creator",
      [
        r.at("creator", SPECTATOR, "join", "bot:9", "Impostor", 13),
        r.at("creator", BOT, "add", "bot:9", "AI Ada", 2),
      ],
    ]),
  );
  assert.equal(
    r.state.game.players.has("bot:9"),
    false,
    "and an AI seat is refused for a listed watcher too",
  );
});

test("a start and a return to the lobby drop the watchers that are gone, as they free the seats that are", () => {
  const r = playing();
  r.tick(
    streams([
      "creator",
      [
        r.at("creator", SPECTATOR, "join", "w1", "Here", 10),
        r.at("creator", SPECTATOR, "join", "w2", "Gone", 11),
      ],
    ]),
  );
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "w2", false, 11)]]));
  r.tick(streams(["creator", [r.at("creator", ACTION, "lobby", "match-2")]]));
  assert.deepEqual([...r.state.spectators.keys()], ["w1"]);
  r.tick(
    streams([
      "creator",
      [r.at("creator", SPECTATOR, "join", "w3", "Also gone", 12)],
    ]),
  );
  r.tick(streams(["creator", [r.at("creator", PRESENCE, "w3", false, 12)]]));
  r.tick(streams(["creator", [r.at("creator", ACTION, "start", "match-3")]]));
  assert.deepEqual([...r.state.spectators.keys()], ["w1"]);
});

test("watchers rank last in the succession order, and a watching creator keeps the crown", () => {
  const r = playing();
  r.tick(
    streams([
      "creator",
      [r.at("creator", SPECTATOR, "join", "watcher", "Watcher", 9)],
    ]),
  );
  assert.deepEqual(successionOrder(r.state, "creator"), [
    "creator",
    "guest",
    "watcher",
  ]);
  assert.equal(
    actingCreator(r.state, "creator"),
    undefined,
    "a seated creator manages alone",
  );
  r.tick(
    streams(["creator", [r.at("creator", PRESENCE, "creator", false, 1)]]),
  );
  assert.equal(actingCreator(r.state, "creator"), "guest");
  r.tick(streams(["guest", [r.at("guest", PRESENCE, "guest", false, 2)]]));
  assert.equal(
    actingCreator(r.state, "creator"),
    "watcher",
    "with every seat absent the watching member runs the room",
  );
  assert.equal(
    permitted(
      r.state,
      "creator",
      "watcher",
      r.at("watcher", SETTINGS, { ...settings, length: 9 }),
    ),
    true,
  );
});

test("a watcher manages nothing while anyone ahead of it is here, and may only say who is absent", () => {
  const r = playing();
  r.tick(
    streams([
      "creator",
      [r.at("creator", SPECTATOR, "join", "watcher", "Watcher", 9)],
    ]),
  );
  for (const body of [
    [SETTINGS, { ...settings, length: 9 }],
    [ACTION, "lobby", "match-9"],
    [SPECTATOR, "join", "other", "Other", 10],
    [JOIN, "other", "Other", 3, "fox", 10],
  ])
    assert.equal(
      permitted(r.state, "creator", "watcher", r.at("watcher", ...body)),
      false,
      `a watcher writes no management entry of kind ${String(body[0])} while the room has a manager`,
    );
  r.tick(
    streams([
      "watcher",
      [
        r.at("watcher", SETTINGS, { ...settings, length: 9 }),
        r.at("watcher", SPECTATOR, "join", "other", "Other", 10),
      ],
    ]),
  );
  assert.equal(r.state.settings.length, 5, "and the fold drops them");
  assert.equal(r.state.spectators.size, 1);
  // Presence forgery (ADR 047, #258 N7, open): a ranked member may say anyone ahead of it is absent, and spectators
  // rank, so a watcher reaches the same open gap the last rider always could. Pinned so the surface is visible.
  assert.equal(
    permitted(
      r.state,
      "creator",
      "watcher",
      r.at("watcher", PRESENCE, "creator", false, 1),
    ),
    true,
    "KNOWN GAP: a watcher may claim the creator is absent",
  );
  assert.equal(
    permitted(
      r.state,
      "creator",
      "watcher",
      r.at("watcher", PRESENCE, "creator", true, 1),
    ),
    false,
    "but never that someone ahead of it is back",
  );
  // A creator that never took a seat but watches from the list is present: nobody stands in for it.
  const w = room();
  w.tick(
    streams([
      "creator",
      [
        w.at("creator", SPECTATOR, "join", "creator", "Host", 1),
        w.at("creator", JOIN, "guest", "Guest", 0, "fox", 2),
      ],
    ]),
  );
  assert.deepEqual(successionOrder(w.state, "creator"), ["creator", "guest"]);
  assert.equal(
    actingCreator(w.state, "creator"),
    undefined,
    "a creator watching the room is not an absent creator",
  );
});

test("the watching list hashes by member id, never by the order the joins arrived in", () => {
  const build = (ids: string[]) => {
    const r = room();
    r.tick(
      streams([
        "creator",
        [
          r.at("creator", JOIN, "creator", "Creator", 0, "fox", 1),
          ...ids.map((id) =>
            r.at("creator", SPECTATOR, "join", id, id.toUpperCase(), 3),
          ),
        ],
      ]),
    );
    return r.state;
  };
  const forwards = build(["wa", "wb", "wc"]),
    backwards = build(["wc", "wb", "wa"]);
  assert.equal(hashRoomState(forwards), hashRoomState(backwards));
  assert.equal(canonicalRoomState(forwards), canonicalRoomState(backwards));
  const alone = build([]);
  assert.notEqual(
    hashRoomState(alone),
    hashRoomState(forwards),
    "who is watching is part of the state every replica agrees on",
  );
});
