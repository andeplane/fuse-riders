import test from "node:test";
import assert from "node:assert/strict";
import type { StreamEntries } from "fuse-netcode";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import {
  neuralGame,
  parseSettings,
  settingsMap,
  type NeuralEntry,
  type NeuralRoom,
  type NeuralSettings,
} from "../src/online/game.js";
import { BUNDLED_MAP_IDS, bundledMap } from "../src/online/maps.js";

const versus = (mapId = "close-quarters"): NeuralSettings => ({
  mapId,
  slot: 0,
  mode: "versus",
  engine: { powerups: true, aiStrategy: "pressure" },
});
const join = (
  seq: number,
  tick: number,
  id: string,
  slot: number,
): NeuralEntry => [seq, tick, 10, id, id, slot, "brain", 1];
const bot = (
  seq: number,
  tick: number,
  id: string,
  slot: number,
): NeuralEntry => [seq, tick, 15, "add", id, `Bot ${slot + 1}`, slot];
const start = (seq: number, tick: number): NeuralEntry => [
  seq,
  tick,
  14,
  "start",
  "versus-match",
];
function fold(
  entries: Record<string, NeuralEntry[]>,
  settings = versus(),
  extra = 0,
): NeuralRoom {
  const room = neuralGame.createRoom("lobby-match", settings);
  const ticker = neuralGame.createTicker();
  const end =
    Math.max(
      ...Object.values(entries)
        .flat()
        .map((entry) => entry[1]),
    ) + extra;
  for (let tick = 1; tick <= end; tick++) {
    const streams = new Map<string, StreamEntries<NeuralEntry>>();
    for (const [id, log] of Object.entries(entries))
      streams.set(id, {
        generation: 1,
        entries: log.filter((entry) => entry[1] === tick),
      });
    ticker(room, "host", streams);
  }
  return room;
}

test("versus rooms name a bundled map, so their settings fit one packet", () => {
  const settings = parseSettings(versus())!;
  assert.equal(settings.mapId, "close-quarters");
  assert.equal(settings.map, undefined);
  assert.ok(JSON.stringify(settings).length < MAX_PACKET_BYTES / 4);
  assert.equal(parseSettings({ ...versus(), mapId: "atlantis" }), undefined);
  const withMap = {
    ...versus(),
    mapId: undefined,
    map: bundledMap("close-quarters"),
  };
  assert.equal(parseSettings(withMap), undefined, "versus must name its map");
  assert.equal(
    parseSettings({ ...versus(), map: bundledMap("close-quarters") }),
    undefined,
    "never both a map and a map id",
  );
  for (const id of BUNDLED_MAP_IDS)
    assert.equal(settingsMap({ ...versus(), mapId: id }).id, id);
});

test("two players start a versus match on the map's spawns", () => {
  // The room manager logs every member's join.
  const room = fold({
    host: [join(1, 1, "host", 0), join(2, 2, "friend", 2), start(3, 3)],
  });
  assert.equal(room.stage, "running");
  const spawns = settingsMap(room.settings)
    .spawns.map((s) => s.slot)
    .sort();
  assert.deepEqual(
    room.world.players.map((p) => [p.id, p.slot]).sort(),
    [
      ["friend", spawns[1]],
      ["host", spawns[0]],
    ].sort(),
    "seats take spawns in seat order even when the room skipped a slot",
  );
  assert.equal(room.world.settings.powerups, true);
});

test("a lone player, or more players than spawns, stays in the lobby", () => {
  assert.equal(
    fold({ host: [join(1, 1, "host", 0), start(2, 2)] }).stage,
    "lobby",
  );
  const crowded = fold({
    host: [
      join(1, 1, "host", 0),
      join(2, 2, "a", 1),
      join(3, 3, "b", 2),
      start(4, 4),
    ],
  });
  assert.equal(crowded.stage, "lobby", "close quarters has two spawns");
  const four = fold(
    {
      host: [
        join(1, 1, "host", 0),
        join(2, 2, "a", 1),
        join(3, 3, "b", 2),
        start(4, 4),
      ],
    },
    versus("sandbox-12"),
  );
  assert.equal(four.stage, "running", "a four-spawn map seats three");
});

test("a room bot plays its network through the AI and survives checkpoints", () => {
  const room = fold(
    { host: [join(1, 1, "host", 0), bot(2, 2, "bot-1", 1), start(3, 3)] },
    versus(),
    400,
  );
  assert.equal(room.stage, "running");
  const botPlayer = room.world.players.find((p) => p.id === "bot-1")!;
  assert.ok(
    botPlayer.statistics.built > 0 || botPlayer.queue.length > 0,
    "the bot expands on its own",
  );
  const restored = neuralGame.checkpoint.decode(
    neuralGame.checkpoint.encode(room),
    room.tick,
  );
  assert.ok(restored);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
  const raw = JSON.parse(neuralGame.checkpoint.encode(room)[0] as string) as {
    seats: { id: string }[];
  };
  raw.seats = raw.seats.filter((seat) => seat.id !== "bot-1");
  assert.equal(
    neuralGame.checkpoint.decode([JSON.stringify(raw)], room.tick),
    undefined,
    "every network needs a seat",
  );
});

test("bot ids and names stay unique and valid roster ids", () => {
  const room = fold({
    host: [join(1, 1, "host", 0), bot(2, 2, "bot-1", 1)],
  });
  const id = neuralGame.seating.botId(room, new Set(["bot-2"]));
  assert.equal(id, "bot-3");
  assert.match(id, /^[-a-zA-Z0-9_]{1,64}$/);
  assert.equal(neuralGame.seating.botName(1), "Bot 2");
});
