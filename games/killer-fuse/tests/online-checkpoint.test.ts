import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  MAX_SNAPSHOT_BYTES,
  PRESENCE,
  SPECTATOR,
  packMessage,
  unpackMessage,
} from "fuse-netcode";
import {
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
  MAPS,
  MAP_IDS,
  MAX_PLAYERS,
  botInput,
  createRound,
  navEdgeCount,
  stepRound,
  type MapDef,
} from "../src/engine/index.js";
import {
  BETWEEN_TICKS,
  countdownTicks,
  DEFAULT_SETTINGS,
  OUTRO_TICKS,
  PLAY,
  PRESS,
  SEAT,
  createRoom,
  hash,
  killerFuseGame as game,
  mapFor,
  roundSeed,
  type Room,
} from "../src/online/game.js";
import { MAX_LOOSE, decodeWorld, encodeWorld } from "../src/online/world.js";
import { fold, join, type Bodies } from "./fixtures/room.js";

const { encode, decode } = game.checkpoint;
/** The fields as a peer reads them: through MessagePack and its limits (−0 arrives as 0). */
const wire = (room: Room) =>
  unpackMessage(packMessage(encode(room))) as unknown[];
const restore = (room: Room) => decode(wire(room), room.tick);

/** The two players' next tick, from the room alone: a turn every so often, a press every 7 ticks. */
function script(room: Room): Bodies {
  if (room.stage !== "running") return {};
  const t = room.tick + 1,
    scope = [room.matchId, room.round];
  const bits = [INPUT_LEFT, INPUT_RIGHT | INPUT_HELD, 0, INPUT_RIGHT];
  const player = (period: number, phase: number) => [
    ...((t + phase) % period ? [] : [[PLAY, ...scope, bits[t % 4]]]),
    ...((t + phase) % 7 ? [] : [[PRESS, ...scope, t, t % 3]]),
  ];
  return { a: player(45, 0), b: player(70, 11) };
}

/**
 * A set to two wins of three people, three hard bots and a watcher, where `c` steps away mid-game and `a` asks for
 * `b`'s seat in the pause; the room is kept at each point a checkpoint must carry, ending in the next set's lobby.
 */
function record(): Map<string, Room> {
  const room = createRoom("m0", { ...DEFAULT_SETTINGS, botLevel: "hard" });
  const at = new Map<string, Room>();
  const keep = (name: string, when: boolean) => {
    if (when && !at.has(name)) at.set(name, structuredClone(room));
  };
  // prettier-ignore
  fold(room, { a: [join("a", "Ada", 0), join("b", "Bo", 1), join("c", "Cy", 4), [SPECTATOR, "join", "w", "Wren", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  while (room.stage !== "over" && room.tick < 20_000) {
    const asking = room.stage === "between" && room.tick === room.resumeAt - 50;
    fold(
      room,
      room.tick === 200
        ? { a: [[PRESENCE, "c", false, 1]] }
        : asking
          ? { a: [[SEAT, 1]] }
          : script(room),
    );
    keep("countdown", room.tick === room.startAt - 20);
    keep("play", room.tick === room.startAt + 240);
    keep("victory", room.stage === "running" && room.endAt > 0);
    keep("between", room.stage === "between" && "a" in room.asks);
  }
  keep("over", true);
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  keep("lobby", room.stage === "lobby");
  return at;
}
const rooms = record();
const stage = (name: string): Room => structuredClone(rooms.get(name)!);

test("the checkpoint carries a room whole at every stage, and the restored room plays on bit for bit", () => {
  // prettier-ignore
  assert.deepEqual([...rooms.keys()].sort(), ["between", "countdown", "lobby", "over", "play", "victory"]);
  const over = rooms.get("over")!;
  assert.equal(over.seats.get("w")?.watcher, true);
  assert.equal(over.seats.get("c")?.connected, false);
  assert.ok(over.winner >= 0 && over.results.length >= 2);
  assert.ok(Object.keys(rooms.get("play")!.held).length > 0);
  assert.deepEqual(rooms.get("between")!.asks, { a: 1 });
  for (const [name, kept] of rooms) {
    const room = structuredClone(kept),
      restored = restore(room);
    assert.ok(restored, name);
    assert.equal(hash(restored), hash(room), name);
    assert.deepEqual(wire(restored), wire(room), name);
    // Events are a step's output, not state: neither the tick's nor the round's last step's are sent.
    const world = room.world && { ...room.world, events: [] };
    assert.deepEqual(restored, { ...room, world, events: [] }, name);
    for (let i = 0; i < 130; i++) {
      const bodies = script(room);
      fold(room, bodies);
      fold(restored, bodies);
    }
    assert.equal(hash(restored), hash(room), `${name}, 130 ticks on`);
  }
  assert.equal(game.checkpoint.leading, 5);
});

test("a room in play stays far below the snapshot cap", (t) => {
  const room = stage("play");
  const berry = { x: 1, y: 2, vx: 3, vy: -4, resting: false, wait: 5, by: 3 };
  while (room.world!.loose.length < MAX_LOOSE)
    room.world!.loose.push({ ...berry });
  const bytes = packMessage(encode(room)).byteLength;
  t.diagnostic(`${bytes} B with ${MAX_LOOSE} loose berries`);
  assert.ok(bytes < MAX_SNAPSHOT_BYTES / 4, `${bytes} bytes`);
  assert.ok(restore(room));
  room.world!.loose.push({ ...berry });
  assert.equal(
    restore(room),
    undefined,
    "more loose berries than a round holds",
  );
});

type Fields = unknown[];
type Tree = Record<number | string, unknown>;
/** The value at `path` in the fields, to change in place. */
const at = (fields: Fields, ...path: (number | string)[]): Tree =>
  path.reduce<unknown>((value, key) => (value as Tree)[key], fields) as Tree;
const MATCH = 0,
  ROUND = 1,
  STAGE = 2,
  SETTINGS = 3,
  PLAY_SETTINGS = 4,
  SEATS = 5,
  RESULTS = 6,
  START = 7,
  HELD = 8,
  ASKS = 9,
  ROSTER = 10,
  STATS = 11,
  WORLD = 12;
/** Whether the room of `name`, its fields changed by `change`, is refused. */
function refused(
  name: string,
  change: (fields: Fields, room: Room) => void,
  tick?: number,
): boolean {
  const room = stage(name),
    fields = wire(room);
  change(fields, room);
  return decode(fields, tick ?? room.tick) === undefined;
}
const cases: [string, string, (fields: Fields, room: Room) => void][] = [
  ["a missing field", "play", (f) => f.pop()],
  ["an extra field", "play", (f) => f.push(0)],
  ["an empty match id", "play", (f) => (f[MATCH] = "")],
  ["a fractional round", "play", (f) => (f[ROUND] = 1.5)],
  ["an unknown stage", "play", (f) => (f[STAGE] = "paused")],
  ["bad settings", "play", (f) => (at(f, SETTINGS).wins = 9)],
  ["bad set settings", "play", (f) => (at(f, PLAY_SETTINGS).map = 7)],
  ["a round past the set", "play", (f) => (f[ROUND] = 4)],
  ["a negative start", "play", (f) => (f[START] = -1)],
  ["seats that are no list", "play", (f) => (f[SEATS] = {})],
  ["a sparse seat list", "play", (f) => (f[SEATS] = [, ...(f[SEATS] as [])])],
  [
    "more results than games",
    "play",
    (f, r) =>
      (f[RESULTS] = [wire(stage("over"))[RESULTS], r].flat(1).slice(0, 2)),
  ],
  ["held that are no pairs", "play", (f) => (f[HELD] = [["a"]])],
  ["held of a bad key", "play", (f) => (f[HELD] = [["toString", 1]])],
  [
    "held named twice",
    "play",
    (f) =>
      (f[HELD] = [
        ["a", 1],
        ["a", 2],
      ]),
  ],
  ["held of no bits", "play", (f) => (f[HELD] = [["a", 0]])],
  ["held past the bits", "play", (f) => (f[HELD] = [["a", 16]])],
  ["asks that are no list", "play", (f) => (f[ASKS] = 0)],
  ["a roster that is no list", "play", (f) => (f[ROSTER] = null)],
  ["stats that are no list", "play", (f) => (f[STATS] = "x")],
  // seats
  ["a seat that is no record", "play", (f) => (at(f, SEATS)[0] = [])],
  ["a seat with a stray key", "play", (f) => (at(f, SEATS, 0).extra = 1)],
  ["a seat with a bad id", "play", (f) => (at(f, SEATS, 0).id = "valueOf")],
  ["a seat with a bad name", "play", (f) => (at(f, SEATS, 0).name = " x")],
  ["a seat without presence", "play", (f) => (at(f, SEATS, 0).connected = 1)],
  ["a bot seat", "play", (f) => (at(f, SEATS, 0).bot = true)],
  [
    "a seat that watches falsely",
    "play",
    (f) => (at(f, SEATS, 0).watcher = false),
  ],
  ["a seat away falsely", "play", (f) => (at(f, SEATS, 0).away = false)],
  ["a seat away and connected", "play", (f) => (at(f, SEATS, 0).away = true)],
  ["a seat past the slots", "play", (f) => (at(f, SEATS, 0).slot = 6)],
  ["a watcher in a slot", "play", (f) => (at(f, SEATS, 3).slot = 5)],
  [
    "a watcher with an avatar",
    "play",
    (f) => (at(f, SEATS, 3).avatarId = "bee"),
  ],
  [
    "a seat with another avatar",
    "play",
    (f) => (at(f, SEATS, 0).avatarId = "wasp"),
  ],
  [
    "a seat without a generation",
    "play",
    (f) => delete at(f, SEATS, 0).generation,
  ],
  ["a member seated twice", "play", (f) => (at(f, SEATS, 1).id = "a")],
  ["a slot held twice", "play", (f) => (at(f, SEATS, 1).slot = 0)],
  // prettier-ignore
  ["too many watchers", "play", (f) => { for (let i = 0; i < 6; i++) (f[SEATS] as unknown[]).push({ ...at(f, SEATS, 3), id: `w${i}` }); }],
  // results
  [
    "a result of the wrong length",
    "over",
    (f) => (at(f, RESULTS, 0) as unknown as unknown[]).pop(),
  ],
  ["a result of another round", "over", (f) => (at(f, RESULTS, 0)[0] = 2)],
  [
    "a result on another map",
    "over",
    (f) => (at(f, RESULTS, 0)[1] = ((at(f, RESULTS, 0)[1] as number) % 3) + 1),
  ],
  ["a result on no map", "over", (f) => (at(f, RESULTS, 0)[1] = 9)],
  ["a result for no team", "over", (f) => (at(f, RESULTS, 0)[2] = 2)],
  [
    "a result of an unknown kind",
    "over",
    (f) => (at(f, RESULTS, 0)[3] = "luck"),
  ],
  ["a result of fractional steps", "over", (f) => (at(f, RESULTS, 0)[4] = 0.5)],
  ["a result at no tick", "over", (f) => (at(f, RESULTS, 0)[5] = -1)],
  ["a result after now", "over", (f, r) => (at(f, RESULTS, 0)[5] = r.tick + 1)],
  [
    "results out of order",
    "over",
    (f) => (at(f, RESULTS, 0)[5] = at(f, RESULTS, 1)[5]),
  ],
  [
    "a short crew",
    "over",
    (f) => (at(f, RESULTS, 0, 6) as unknown as unknown[]).pop(),
  ],
  ["a crew of a bad id", "over", (f) => (at(f, RESULTS, 0, 6)[5] = "bad id")],
  ["a crew member twice", "over", (f) => (at(f, RESULTS, 0, 6)[5] = "a")],
  ["a present list that is none", "over", (f) => (at(f, RESULTS, 0)[7] = "a")],
  [
    "someone present who did not sit",
    "over",
    (f) => (at(f, RESULTS, 0)[7] = ["z"]),
  ],
  ["present out of order", "over", (f) => (at(f, RESULTS, 0)[7] = ["b", "a"])],
  ["present twice", "over", (f) => (at(f, RESULTS, 0)[7] = ["a", "a"])],
  // roster and stats
  ["a roster of a stranger", "over", (f) => (at(f, ROSTER, 0)[0] = "z")],
  [
    "a roster entry that is no pair",
    "over",
    (f) => (at(f, ROSTER, 0)[1] = ["Ada"]),
  ],
  ["a roster with a bad name", "over", (f) => (at(f, ROSTER, 0, 1)[0] = "")],
  ["a roster past the slots", "over", (f) => (at(f, ROSTER, 0, 1)[1] = 6)],
  ["a roster missing a member", "over", (f) => (f[ROSTER] as unknown[]).pop()],
  ["stats of the wrong length", "over", (f) => (at(f, STATS, 0)[1] = [1, 1])],
  ["stats past the bound", "over", (f) => (at(f, STATS, 0, 1)[2] = 100_001)],
  ["more games than were played", "over", (f) => (at(f, STATS, 0, 1)[0] = 9)],
  [
    "more wins than games",
    "over",
    (f) => {
      const stats = at(f, STATS, 0, 1);
      stats[1] = (stats[0] as number) + 1;
    },
  ],
  [
    "a crew member without stats",
    "over",
    (f) => (f[STATS] as unknown[]).shift(),
  ],
  [
    "a crew member with no game",
    "over",
    (f) => (at(f, STATS, 0)[1] = [0, 0, 0, 0, 0]),
  ],
  // asks
  ["a wish during a game", "play", (f) => (f[ASKS] = [["a", 1]])],
  ["a stranger's wish", "between", (f) => (at(f, ASKS, 0)[0] = "z")],
  ["a watcher's wish", "between", (f) => (at(f, ASKS, 0)[0] = "w")],
  ["a wish past the slots", "between", (f) => (at(f, ASKS, 0)[1] = 6)],
  ["a wish for a free slot", "between", (f) => (at(f, ASKS, 0)[1] = 2)],
  ["a wish for one's own slot", "between", (f) => (at(f, ASKS, 0)[1] = 0)],
  // the lobby
  ["a lobby in a round", "lobby", (f) => (f[ROUND] = 1)],
  ["a lobby with a start", "lobby", (f) => (f[START] = 5)],
  [
    "a lobby with a world",
    "lobby",
    (f) => (f[WORLD] = wire(stage("play"))[WORLD]),
  ],
  ["a lobby with held bits", "lobby", (f) => (f[HELD] = [["a", 1]])],
  [
    "a lobby with a result",
    "lobby",
    (f) => (f[RESULTS] = wire(stage("over"))[RESULTS]),
  ],
  // the game against the stage
  ["a game without a round", "play", (f) => (f[ROUND] = 0)],
  ["a game without a world", "play", (f) => (f[WORLD] = null)],
  ["a game of another set", "play", (f) => (f[MATCH] = "m9")],
  [
    "a game at another level",
    "play",
    (f) => (at(f, PLAY_SETTINGS).botLevel = "easy"),
  ],
  [
    "a game with a result too many",
    "play",
    (f) => (f[RESULTS] = [(wire(stage("over"))[RESULTS] as unknown[])[0]]),
  ],
  [
    "a game a step behind",
    "play",
    (f) => (at(f, WORLD).step = (at(f, WORLD).step as number) - 1),
  ],
  [
    "a game that started late",
    "play",
    (f) => (f[START] = (f[START] as number) + 1),
  ],
  [
    "a countdown longer than one",
    "countdown",
    (f, r) => (f[START] = r.tick + countdownTicks(r.round) + 1),
  ],
  ["a countdown with steps", "countdown", (f) => (at(f, WORLD).step = 3)],
  [
    "a victory before its step",
    "victory",
    (f) => (f[START] = (f[START] as number) + 1),
  ],
  [
    "a victory past its screen",
    "victory",
    (f) => (f[START] = (f[START] as number) - OUTRO_TICKS),
  ],
  ["a victory without a step", "victory", (f) => (at(f, WORLD).step = 0)],
  ["a pause without a winner", "between", (f) => (at(f, WORLD).winner = null)],
  ["a pause after no step", "between", (f) => (at(f, WORLD).step = 0)],
  ["a pause without its result", "between", (f) => (f[RESULTS] = [])],
  [
    "a pause after another team's win",
    "between",
    (f) =>
      (at(f, WORLD, "winner").team =
        1 - (at(f, WORLD, "winner").team as number)),
  ],
  [
    "a pause after another kind of win",
    "between",
    (f) => (at(f, RESULTS, 0)[3] = "snail"),
  ],
  ["a pause after other steps", "between", (f) => (at(f, RESULTS, 0)[4] = 3)],
  [
    "a pause recorded at another tick",
    "between",
    (f) => (at(f, RESULTS, 0)[5] = (at(f, RESULTS, 0)[5] as number) - 1),
  ],
  ["a pause in a won set", "between", (f) => (at(f, PLAY_SETTINGS).wins = 1)],
  ["an end of an open set", "over", (f) => (at(f, PLAY_SETTINGS).wins = 3)],
  ["a set played past its end", "over", (f) => (at(f, PLAY_SETTINGS).wins = 1)],
];

test("a checkpoint that is not a room this game could be in is refused, whole", () => {
  for (const [name, at, change] of cases) assert.ok(refused(at, change), name);
  assert.ok(
    refused("play", () => {}, -1),
    "a negative tick",
  );
  assert.ok(
    refused("play", () => {}, 1.5),
    "a fractional tick",
  );
  const between = rooms.get("between")!;
  assert.ok(
    refused("between", () => {}, between.resumeAt),
    "a pause that has run out",
  );
  assert.ok(!refused("between", () => {}, between.resumeAt - 1));
  assert.ok(!refused("play", () => {}), "and the room as it is, is taken");
});

const expected = (room: Room) => ({
  seed: roundSeed(room.matchId, room.round),
  mapId: mapFor(room.play, room.matchId, room.round),
  botLevel: room.play.botLevel,
});
type World = Record<string, unknown> & {
  units: Tree[];
  bots: Tree[];
  gates: Tree[];
  loose: Tree[];
  snail: Tree;
  piles: number[];
  eggs: number[];
};
const worldCases: [string, (world: World) => void][] = [
  ["a missing key", (w) => delete w.rng],
  ["an extra key", (w) => (w.extra = 1)],
  ["events sent along", (w) => (w.events = [])],
  ["a fractional number", (w) => (w.units[0]!.x = 0.5)],
  ["a number that is none", (w) => (w.units[0]!.x = "1")],
  ["a flag that is none", (w) => (w.units[0]!.dead = 0)],
  ["a missing unit", (w) => w.units.pop()],
  ["a sparse unit list", (w) => delete w.units[5]],
  ["a unit that is a list", (w) => (w.units[0] = [] as unknown as Tree)],
  ["a unit with a stray key", (w) => (w.units[0]!.extra = 1)],
  ["loose berries that are no list", (w) => (w.loose = {} as never)],
  ["a loose berry out of shape", (w) => w.loose.push({ x: 1 })],
  ["a winner that is no record", (w) => (w.winner = 1)],
  [
    "a winner with a stray key",
    (w) => (w.winner = { team: 0, kind: "snail", x: 1 }),
  ],
  ["a winner of no team", (w) => (w.winner = { team: 2, kind: "snail" })],
  ["a winner of no kind", (w) => (w.winner = { team: 0, kind: "luck" })],
  ["other rules", (w) => (w.rules = "killer-fuse-0")],
  ["another seed", (w) => (w.seed = 1)],
  ["another map", (w) => (w.mapId = ((w.mapId as number) % 3) + 1)],
  ["another level", (w) => (w.botLevel = "easy")],
  ["another team level", (w) => ((w.teamLevels as string[])[1] = "easy")],
  ["a random state past 32 bits", (w) => (w.rng = 2 ** 32)],
  ["a negative step", (w) => (w.step = -1)],
  ["a negative drought", (w) => (w.dry = -1)],
  ["a unit in another slot", (w) => (w.units[0]!.slot = 1)],
  ["a unit on the other team", (w) => (w.units[0]!.team = 1)],
  ["a unit of no kind", (w) => (w.units[2]!.kind = "drone")],
  ["a Queen in a Worker's slot", (w) => (w.units[2]!.kind = "queen")],
  ["a Worker in a Queen's slot", (w) => (w.units[0]!.kind = "worker")],
  ["a unit facing nowhere", (w) => (w.units[0]!.facing = 0)],
  ["a unit on no platform", (w) => (w.units[0]!.ground = 999)],
  ["a unit in no gate", (w) => (w.units[0]!.gate = 99)],
  ["a negative coyote time", (w) => (w.units[0]!.coyote = -1)],
  ["a negative gate progress", (w) => (w.units[0]!.gateProgress = -1)],
  ["a negative invulnerability", (w) => (w.units[0]!.invuln = -1)],
  ["a negative respawn", (w) => (w.units[0]!.respawn = -1)],
  ["a negative mount wait", (w) => (w.units[0]!.mountWait = -1)],
  ["a pile past its size", (w) => (w.piles[0] = 999)],
  [
    "a berry waiting backwards",
    (w) =>
      w.loose.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        resting: true,
        wait: -1,
        by: 0,
      }),
  ],
  [
    "a berry kicked by nobody",
    (w) =>
      w.loose.push({ x: 0, y: 0, vx: 0, vy: 0, resting: true, wait: 0, by: 6 }),
  ],
  ["a gate of no team", (w) => (w.gates[0]!.owner = 2)],
  ["a gate used by no slot", (w) => (w.gates[0]!.user = 6)],
  ["a snail ridden by no slot", (w) => (w.snail.rider = 6)],
  ["a snail eating no slot", (w) => (w.snail.victim = -2)],
  ["a snail eating backwards", (w) => (w.snail.eat = -1)],
  ["a snail facing nowhere", (w) => (w.snail.facing = 2)],
  ["more eggs than a Queen has", (w) => (w.eggs[0] = 4)],
  ["a bot with no goal", (w) => (w.bots[0]!.goal = "dance")],
  ["a bot thinking backwards", (w) => (w.bots[0]!.think = -1)],
  ["a bot behind its edge", (w) => (w.bots[0]!.edgeStep = -1)],
  ["a bot flapping backwards", (w) => (w.bots[0]!.flapWait = -1)],
  ["a bot idling backwards", (w) => (w.bots[0]!.idle = -1)],
  ["a bot after no target", (w) => (w.bots[0]!.target = -2)],
  ["a bot at no node", (w) => (w.bots[0]!.node = -2)],
  ["a bot on no edge", (w) => (w.bots[0]!.edge = -2)],
];

/**
 * A bot's `target`, `node` and `edge` index lists the map owns, so each has a top as well as a bottom. An index
 * above it is refused here, where the round is rejected whole and the room keeps the state it had, rather than in
 * a later fold: `state.units[mind.target]!` is a throw, and a checkpoint from a peer must not be able to cause one.
 */
const indexCases: [
  string,
  (world: World, map: MapDef, edges: number) => void,
][] = [
  [
    "a bot fleeing a slot that is no unit",
    (w) => {
      w.bots[0]!.goal = "flee";
      w.bots[0]!.target = MAX_PLAYERS;
    },
  ],
  [
    "a bot fleeing nobody: `flee` reads its target's unit on the next fold",
    (w) => {
      w.bots[0]!.goal = "flee";
      w.bots[0]!.target = -1;
    },
  ],
  [
    "a bot stalling nobody",
    (w) => {
      w.bots[2]!.goal = "stall";
      w.bots[2]!.target = -1;
    },
  ],
  [
    "a bot hunting nobody",
    (w) => {
      w.bots[1]!.goal = "hunt";
      w.bots[1]!.target = -1;
    },
  ],
  [
    "a bot evading nobody",
    (w) => {
      w.bots[3]!.goal = "evade";
      w.bots[3]!.target = -1;
    },
  ],
  [
    "a bot gathering from a pile the map has not",
    (w, map) => {
      w.bots[0]!.goal = "gather";
      w.bots[0]!.target = map.piles.length;
    },
  ],
  [
    "a bot banking in a hole its hive has not",
    (w, map) => {
      w.bots[2]!.goal = "bank";
      w.bots[2]!.target = map.holes[0].length;
    },
  ],
  [
    "a bot claiming a gate the map has not",
    (w, map) => {
      w.bots[1]!.goal = "claim";
      w.bots[1]!.target = map.gates.length;
    },
  ],
  [
    "a bot idling after an index no list holds",
    (w, map) =>
      (w.bots[3]!.target = Math.max(
        MAX_PLAYERS,
        map.piles.length,
        map.gates.length,
        map.holes[1].length,
      )),
  ],
  [
    "a bot heading for a platform the map has not",
    (w, map) => (w.bots[1]!.node = map.platforms.length),
  ],
  [
    "a bot flying a move the nav has not",
    (w, _map, edges) => (w.bots[2]!.edge = edges),
  ],
  ["a bot flying a move far past the nav", (w) => (w.bots[3]!.edge = 2 ** 30)],
];

test("a bot index above the map's own lists is refused, and the healthy round beside it still restores", () => {
  const room = stage("play"),
    plain = () => unpackMessage(packMessage(encodeWorld(room.world!))) as World;
  const map = MAPS[expected(room).mapId],
    edges = navEdgeCount(expected(room).mapId);
  assert.ok(edges > 0 && map.platforms.length > 0 && map.piles.length > 0);
  // The index one past each list is the first one refused; the one below it is a round the engine could be in.
  for (const [name, change] of indexCases) {
    const world = plain();
    change(world, map, edges);
    assert.equal(decodeWorld(world, expected(room)), undefined, name);
  }
  const last = plain();
  last.bots[0]!.goal = "gather";
  last.bots[0]!.target = map.piles.length - 1;
  last.bots[1]!.node = map.platforms.length - 1;
  last.bots[2]!.edge = edges - 1;
  // A guard is aimed at a place and watches nobody; the goals about a unit take the first slot like any other.
  last.bots[3]!.goal = "guard";
  last.bots[3]!.target = -1;
  last.bots[4]!.goal = "hunt";
  last.bots[4]!.target = 0;
  last.bots[5]!.goal = "flee";
  last.bots[5]!.target = 0;
  assert.ok(decodeWorld(last, expected(room)), "the last of each list");
  // Refusing leaves the room it was offered to alone: it still checkpoints and restores bit for bit.
  const whole = stage("play");
  assert.equal(hash(restore(whole)!), hash(whole));
  assert.deepEqual(wire(whole), wire(room));
});

test("every bot mind a played-out game reaches is inside the bounds the boundary checks", () => {
  // A bound too tight would refuse a healthy checkpoint, which is the worse failure: play real games past it.
  for (const mapId of MAP_IDS) {
    const world = createRound({ seed: 11 + mapId, mapId, botLevel: "hard" });
    const at = { seed: world.seed, mapId, botLevel: "hard" as const };
    for (let step = 0; step < 4_000 && !world.winner; step += 1) {
      stepRound(
        world,
        world.units.map((unit) => botInput(world, unit.slot)),
      );
      if (step % 17 === 0)
        assert.ok(
          decodeWorld(encodeWorld(world), at),
          `map ${mapId} at step ${world.step}, goals ${world.bots.map((mind) => mind.goal).join(" ")}`,
        );
    }
  }
});

test("a round that is not one the engine could have made is refused", () => {
  const room = stage("play"),
    plain = () => unpackMessage(packMessage(encodeWorld(room.world!))) as World;
  assert.ok(!("events" in plain()));
  assert.ok(decodeWorld(plain(), expected(room)));
  for (const raw of [null, 7, "world", [], new Map()])
    assert.equal(decodeWorld(raw, expected(room)), undefined);
  for (const [name, change] of worldCases) {
    const world = plain();
    change(world);
    assert.equal(decodeWorld(world, expected(room)), undefined, name);
  }
  // A decided round carries its winner.
  const won = { ...plain(), winner: { team: 1, kind: "economy" } };
  assert.deepEqual(decodeWorld(won, expected(room))?.winner, won.winner);
  // A round the engine cannot step is refused at the boundary, not in the fold.
  const broken = plain();
  broken.bots[2]!.edge = 1_000_000;
  broken.bots[2]!.goal = "ride";
  assert.doesNotThrow(() => decodeWorld(broken, expected(room)));
});

test("the lobby after a set and a pause both restore; BETWEEN_TICKS bounds the pause", () => {
  const between = stage("between");
  const restored = restore(between)!;
  assert.equal(restored.resumeAt, between.resumeAt);
  assert.equal(restored.endAt + BETWEEN_TICKS, restored.resumeAt);
  const over = restore(stage("over"))!;
  assert.deepEqual(
    [over.winner, over.score],
    [stage("over").winner, stage("over").score],
  );
});
