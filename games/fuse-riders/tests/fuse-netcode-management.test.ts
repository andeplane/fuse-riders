import test from "node:test";
import assert from "node:assert/strict";
import * as net from "fuse-netcode";
import {
  actingCreator,
  createRoomState,
  permitted,
  successionOrder,
} from "../src/engine/apply-tick.js";
import {
  addPlayer,
  setPlayerConnected,
  SLOT_COLORS,
} from "../src/engine/game.js";
import * as log from "../src/engine/input-log.js";
import { loggedRiderName } from "../src/engine/rider-name.js";
import {
  defaultRoomSettings,
  parseRoomSettings,
} from "../src/engine/room-settings.js";
import { isAvatarId } from "../src/shared/avatars.js";
import { fuseGame } from "../src/online/fuse-game.js";

/**
 * Fuse Riders' engine applies management entries with its own reducer (it cannot import the package), and the runtime
 * logs and reads them with the package's. Both must be the same wire format and the same permission rule, or a room
 * would fold a log its creator never meant.
 */
const payloads: net.ManagementPayloads = {
  name: loggedRiderName,
  avatar: isAvatarId,
  settings: (value) => parseRoomSettings(value) !== undefined,
  capacity: fuseGame.seating.capacity,
};

function xorshift(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

test("the package's management kinds are the engine's", () => {
  for (const kind of [
    "JOIN",
    "LEAVE",
    "PRESENCE",
    "SETTINGS",
    "ACTION",
    "BOT",
    "SPECTATOR",
  ] as const)
    assert.equal(net[kind], log[kind], kind);
  for (let kind = 0; kind < 20; kind++)
    assert.equal(net.isManagementKind(kind), log.isManagementKind(kind));
});

test("the package's management parser accepts exactly the entries Fuse Riders' isEntry accepts", () => {
  const seeds: unknown[][] = [
    [1, 2, log.JOIN, "guest", "Rider", 4, "fox", 7],
    [1, 2, log.LEAVE, "guest"],
    [1, 2, log.PRESENCE, "guest", false, 7],
    [1, 2, log.SETTINGS, defaultRoomSettings()],
    [1, 2, log.ACTION, "rematch", "match-2"],
    [1, 2, log.BOT, "add", "bot:1", "AI Ada", 2],
    [1, 2, log.BOT, "remove", "bot:1"],
    [1, 2, log.SPECTATOR, "join", "watcher", "Watcher", 3],
    [1, 2, log.SPECTATOR, "leave", "watcher"],
  ];
  const pool: unknown[] = [
    0,
    1,
    4,
    5,
    -1,
    0.5,
    2 ** 32,
    "",
    " ",
    "guest",
    "a b",
    "x".repeat(65),
    `Rider${String.fromCharCode(7)}`,
    "fox",
    "cat",
    "nope",
    "add",
    "remove",
    "start",
    "lobby",
    "pause",
    "join",
    "leave",
    true,
    false,
    null,
    [],
    {},
    { ...defaultRoomSettings(), mode: "nope" },
  ];
  const next = xorshift(47);
  let accepted = 0,
    checked = 0;
  for (const seed of seeds) {
    assert.equal(log.isEntry(seed), true, JSON.stringify(seed));
    for (let round = 0; round < 400; round++) {
      const entry = structuredClone(seed);
      const edits = 1 + (next() % 2);
      for (let edit = 0; edit < edits; edit++) {
        const at = next() % (entry.length + 1);
        if (at === entry.length && next() % 2)
          entry.push(pool[next() % pool.length]);
        else if (at === entry.length) entry.pop();
        else entry[at] = pool[next() % pool.length];
      }
      if (!net.isManagementKind(entry[2])) continue;
      checked++;
      const fuse = log.isEntry(entry),
        generic = net.isManagementEntry(entry, payloads);
      if (fuse) accepted++;
      assert.equal(generic, fuse, JSON.stringify(entry));
    }
  }
  assert.ok(
    checked > 1000 && accepted > 50,
    `${checked} checked, ${accepted} valid`,
  );
});

test("succession and permission over fuseGame.members agree with the engine's reducer", () => {
  const next = xorshift(11);
  const ids = ["creator", "amy", "bob", "zed", "bot:1"],
    watchers = ["creator", "ann", "wes"];
  for (let round = 0; round < 300; round++) {
    const state = createRoomState("m", defaultRoomSettings());
    ids.forEach((id, slot) => {
      if (next() % 4 === 0) return;
      addPlayer(state.game, {
        id,
        name: id,
        slot,
        color: SLOT_COLORS[slot]!,
        connected: true,
      });
      if (id.startsWith("bot:")) state.bots.add(id);
      else if (next() % 3 === 0) setPlayerConnected(state.game, id, false);
    });
    // Watchers, the creator among them when it holds no seat: a member is a rider or a watcher, never both.
    for (const id of watchers)
      if (!state.game.players.has(id) && next() % 2 === 0)
        state.spectators.set(id, {
          name: id,
          connected: next() % 3 !== 0,
          generation: 1,
        });
    const seats = fuseGame.members(state);
    assert.deepEqual(
      net.successionOrder(seats, "creator"),
      successionOrder(state, "creator"),
    );
    assert.equal(
      net.actingCreator(seats, "creator"),
      actingCreator(state, "creator"),
    );
    for (const manager of [...ids, ...watchers, "stranger"])
      for (const entry of [
        [1, 1, log.SETTINGS, defaultRoomSettings()],
        ...[...ids, ...watchers].map((target) => [
          1,
          1,
          log.PRESENCE,
          target,
          false,
          1,
        ]),
        ...[...ids, ...watchers].map((target) => [
          1,
          1,
          log.PRESENCE,
          target,
          true,
          1,
        ]),
      ] as log.Entry[])
        assert.equal(
          net.permitted(seats, "creator", manager, entry),
          permitted(state, "creator", manager, entry),
          `${manager} ${JSON.stringify(entry)}`,
        );
  }
});
