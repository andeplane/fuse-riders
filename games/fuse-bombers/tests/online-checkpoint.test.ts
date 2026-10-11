import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, PRESENCE, SPECTATOR } from "fuse-netcode";
import { MAX_SNAPSHOT_BYTES, SnapshotAssembler, World } from "fuse-netcode";
import { decodeSnapshot, encodeSnapshot } from "fuse-netcode";
import { packMessage, unpackMessage, type StreamEntries } from "fuse-netcode";
import { DEFAULT_TUNING, DOWN, LEFT, RIGHT, UP } from "../src/engine/index.js";
import { createRound, encodeRound } from "../src/engine/index.js";
import { carveCircle, createGrid, encodeGrid } from "../src/engine/grid.js";
import { buildTempleGrid } from "../src/engine/temple-map.js";
import {
  BETWEEN_TICKS,
  DEFAULT_SETTINGS,
  PLAY,
  PRESS,
} from "../src/online/game.js";
import { bombersGame as game, createRoom } from "../src/online/game.js";
import { foldTick, hash, type Entry, type Room } from "../src/online/game.js";

const { encode, decode } = game.checkpoint;
/** The fields as a peer reads them: through MessagePack and its limits (−0 arrives as 0). */
const wire = (room: Room) =>
  unpackMessage(packMessage(encode(room))) as unknown[];
const restore = (room: Room) => decode(wire(room), room.tick);

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
const COMPASS = [UP, UP | RIGHT, RIGHT, DOWN | RIGHT, DOWN, DOWN | LEFT, LEFT];
/** The two riders' next tick, from the room alone: a turn every so often, a press every 31 ticks. */
function script(room: Room): Bodies {
  if (room.stage !== "running") return {};
  const t = room.tick + 1,
    scope = [room.matchId, room.round];
  const pilot = (period: number, phase: number) => [
    ...((t + phase) % period ? [] : [[PLAY, ...scope, COMPASS[t % 7]]]),
    ...((t + phase) % 31 ? [] : [[PRESS, ...scope, t, t % 3]]),
  ];
  return { a: pilot(45, 0), b: pilot(70, 11) };
}

/**
 * A match to two wins of two riders, four hard bots and a watcher, where `b` steps away mid-match; the room is kept at
 * each point a checkpoint must carry, ending in the lobby of the next match.
 */
function record(): Map<string, Room> {
  const room = createRoom("m0", {
    ...DEFAULT_SETTINGS,
    wins: 2,
    difficulty: "hard",
  });
  const bots = [2, 3, 4, 5].map((n) => [BOT, "add", `bot:${n}`, "Zeppo", n]);
  const at = new Map<string, Room>();
  const keep = (name: string, when: boolean) => {
    if (when && !at.has(name)) at.set(name, structuredClone(room));
  };
  // prettier-ignore
  fold(room, { a: [[JOIN, "a", "Ada", 0, "gunship", 1], [JOIN, "b", "Bo", 1, "gunship", 1], ...bots,
    [SPECTATOR, "join", "w", "Wren", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  while (room.stage !== "over" && room.tick < 9000) {
    const away = room.tick === 900;
    fold(room, away ? { b: [[PRESENCE, "b", false, 1]] } : script(room));
    const world = room.world!;
    keep("countdown", room.tick === room.startAt - 20);
    // prettier-ignore
    keep("battle", world.ghosts.length > 0 && world.rockets.length >= 12 && world.crates.length > 0);
    keep(
      "sudden death",
      world.rockets.some((r) => r.bomb),
    );
    keep("aftermath", room.stage === "running" && room.endAt > 0);
    keep("between", room.stage === "between");
  }
  keep("over", true);
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  keep("lobby", room.stage === "lobby");
  return at;
}
const rooms = record();
const battle = rooms.get("battle")!;

test("the checkpoint carries a room whole at every stage, and the restored room plays on bit for bit", () => {
  // prettier-ignore
  assert.deepEqual([...rooms.keys()].sort(), ["aftermath", "battle", "between", "countdown", "lobby", "over",
    "sudden death"]);
  const over = rooms.get("over")!;
  assert.equal(over.seats.get("w")?.watcher, true);
  assert.equal(over.seats.get("b")?.away, true);
  assert.ok(over.winner !== "" && over.results.length >= 2);
  for (const [name, room] of rooms) {
    const restored = restore(room);
    assert.ok(restored, name);
    assert.equal(hash(restored), hash(room), name);
    assert.deepEqual(wire(restored), wire(room), name);
    for (let i = 0; i < 90; i++) {
      const bodies = script(room);
      fold(room, bodies);
      fold(restored, bodies);
    }
    assert.equal(hash(restored), hash(room), `${name}, 90 ticks on`);
  }
  const stray = Object.assign({ extra: 1 }, DEFAULT_SETTINGS, { wins: 0 });
  assert.ok(restore(createRoom("m0", stray)), "a room made with bad settings");
});

test("a worst-case room (every rocket in the air, the temple riddled) stays far below the snapshot cap", (t) => {
  const room = structuredClone(battle),
    world = room.world!;
  let r = 7;
  const next = () =>
    (r = (Math.imul(r, 1_103_515_245) + 12_345) >>> 0) / 0x1_0000_0000;
  for (let i = 0; i < 6000; i++)
    carveCircle(world.terrain, next() * 4800, next() * 2700, 8 + next() * 30);
  const lineage = Array.from({ length: 16 }, (_, k) => k + 1);
  const shells = () => world.rockets.filter((x) => !x.ghost).length;
  while (shells() < DEFAULT_TUNING.maxRockets)
    // prettier-ignore
    world.rockets.push({ id: world.nextId++, owner: world.rockets.length % 6, x: next() * 4800, y: next() * 2700,
      vx: next() * 900 - 450, vy: next() * 900 - 450, power: 1 + next(), mega: next() < 0.2, bomb: false,
      ghost: false, gates: lineage, age: Math.floor(next() * 700) });
  const bytes = packMessage(encode(room)).byteLength,
    runs = encodeGrid(world.terrain).length;
  t.diagnostic(`${world.rockets.length} rockets, ${runs} runs: ${bytes} B`);
  assert.ok(bytes < MAX_SNAPSHOT_BYTES / 4, `${bytes} bytes`);
  const restored = restore(room);
  assert.ok(restored);
  assert.equal(hash(restored), hash(room));
  world.rockets.push({ ...world.rockets.at(-1)!, id: world.nextId++ });
  assert.ok(restore(room) === undefined, "a shell past maxRockets");
});

type Path = readonly (number | string)[];
type Tree = Record<number | string, unknown>;
const at = (value: unknown, path: Path) =>
  path.reduce((v: unknown, key) => (v as Tree | undefined)?.[key], value);
/** Every path into `value`, through arrays and plain objects. */
function paths(value: unknown, path: Path = [], out: Path[] = []): Path[] {
  out.push(path);
  if (value !== null && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      paths(item, [...path, Array.isArray(value) ? Number(key) : key], out);
  return out;
}
const DROP = Symbol("drop");
/** A copy of `fields` with `value` at `path`, or the node there dropped from its array or object. */
function edit(fields: unknown[], path: Path, value: unknown) {
  const copy = structuredClone(fields),
    parent = at(copy, path.slice(0, -1)) as Tree,
    key = path.at(-1)!;
  if (value !== DROP) parent[key] = value;
  else if (Array.isArray(parent)) parent.splice(key as number, 1);
  else delete parent[key];
  return copy;
}
const WORLD = 10;
/** The fixed-length parts: the room, its settings, a seat, a result, a held pair, the round and each of its records. */
// prettier-ignore
const isRecord = ([a, b, ...rest]: Path) => a === undefined ||
  (b === undefined ? [3, 4, WORLD].includes(a as number)
    : !rest.length ? (a === WORLD ? b === 6 : [5, 6, 9].includes(a as number))
    : a === WORLD && rest.length === 1 && [3, 8, 9, 10, 11, 12, 14].includes(b as number));

/** `room`'s checkpoint, refused with a field mistyped or not finite, a list past its cap, a record cut or padded. */
function sweep(room: Room): void {
  const fields = wire(room);
  const refused = (copy: unknown[], why: string) =>
    assert.ok(decode(copy, room.tick) === undefined, why);
  const set = (path: Path, value: unknown, why: string) =>
    refused(edit(fields, path, value), why);
  // The terrain's runs are `decodeGrid`'s to check (tests/engine-grid.test.ts): one in 97 here.
  const all = paths(fields).filter(
    (p) => p[0] !== WORLD || p[1] !== 7 || p.length < 4 || +p[3]! % 97 === 0,
  );
  for (const path of all) {
    const value = at(fields, path),
      why = `at ${path.join(".")}`;
    if (path.length && Array.isArray(value))
      set(path, Array(100_000).fill(value[0] ?? 0), `${why} huge`);
    else if (path.length && (value === null || typeof value !== "object")) {
      set(path, typeof value === "string" ? 7 : String(value), why);
      if (typeof value === "number")
        for (const bad of [NaN, -Infinity]) set(path, bad, `${why} ${bad}`);
    }
    if (!isRecord(path) || value === null) continue;
    if (Array.isArray(value)) {
      const [short, long] = [value.slice(1), [...value, 0]];
      refused(path.length ? edit(fields, path, short) : short, why);
      refused(path.length ? edit(fields, path, long) : long, why);
    } else {
      set([...path, Object.keys(value as object)[0]!], DROP, `${why} short`);
      set(path, { ...(value as object), extra: 1 }, `${why} long`);
    }
  }
}

test("a corrupt checkpoint is refused, field by field", () => {
  for (const name of ["battle", "over"]) sweep(rooms.get(name)!);
  const fields = wire(battle),
    world = fields[WORLD] as unknown[][];
  const refused = (copy: unknown[], why: string, tick = battle.tick) =>
    assert.ok(decode(copy, tick) === undefined, why);
  const find = (list: number, test: (item: unknown[]) => unknown) =>
    world[list]!.findIndex((item) => test(item as unknown[]));
  const [alive, dead] = [find(8, (c) => c[6]), find(8, (c) => !c[6])],
    shell = find(9, (r) => !r[8] && !r[9]),
    steps = battle.world!.tick;
  // prettier-ignore
  const cases: [string, Path, unknown][] = [
    ["the phase against the fuse", [WORLD, 5], battle.world!.phase === "playing" ? "sudden-death" : "playing"],
    ["over without a result", [WORLD, 5], "over"],
    ["a living castle without HP", [WORLD, 8, alive, 5], 0],
    ["a wreck with a shield", [WORLD, 8, dead, 12], 10],
    ["a gate past its expiry", [WORLD, 10, 0, 3], steps - 1],
    ["a ghost from a later step", [WORLD, 12, 0, 8], steps + 1],
    ["a rocket past its life", [WORLD, 9, 0, 11], 721],
    ["a bomb of a castle's", [WORLD, 9, shell, 8], true],
    ["a lineage through one gate twice", [WORLD, 9, shell, 10], [1, 1]],
    ["held directions of a watcher", [9], [["w", 1]]],
    ["hp past maxHp", [WORLD, 8, alive, 5], DEFAULT_TUNING.castleHp[6]! + 1],
    ["a full turn", [WORLD, 8, 0, 7], 2 * Math.PI],
    ["a rocket of nobody's", [WORLD, 9, 0, 1], 6],
    ["a gate id not yet handed out", [WORLD, 9, 0, 10], [world[17]]],
    ["a crate id twice", [WORLD, 11, 0, 0], (world[9]![0] as unknown[])[0]],
    ["a ghost of a living castle", [WORLD, 12, 0, 0], alive],
    ["a bit past the controls", [WORLD, 13, 0], 32],
    ["a seat past the last slot", [5, 0, "slot"], 6],
    ["two seats in one slot", [5, 1, "slot"], 0],
    ["a bot at another level", [WORLD, 3, 0, 1], "easy"],
    ["the world's steps against the countdown", [7], (fields[7] as number) + 1],
    ["a round seeded for another match", [0], "m9"],
    ["a terrain of another size", [WORLD, 7], [encodeGrid(createGrid(400, 400, 4))]],
  ];
  for (const [why, path, value] of cases)
    refused(edit(fields, path, value), why);
  refused(fields, "another tick", battle.tick + 1);
  const between = rooms.get("between")!;
  refused(wire(between), "a scoreboard run out", between.tick + BETWEEN_TICKS);
  // Rock where the temple had none, and its indestructible rock carved.
  const temple = buildTempleGrid();
  for (const part of ["solid", "hard"] as const) {
    const room = structuredClone(battle),
      grid = room.world!.terrain;
    const i =
      part === "solid"
        ? temple.solid.findIndex((w) => w === 0)
        : temple.hard.findIndex((w) => w !== 0);
    grid[part][i] = part === "solid" ? 1 : 0;
    assert.ok(restore(room) === undefined, part);
  }
  // prettier-ignore
  assert.throws(() => encodeRound(createRound({ seed: 1, playerCount: 2, tuning: { gravity: 1 } })), RangeError);
});

test("seeded random corruption never throws, and whatever is accepted checkpoints and plays on", (t) => {
  const bases = [...rooms.values()].map(
    (room) => [wire(room), room.tick] as const,
  );
  let r = 99,
    accepted = 0;
  const next = (n: number) =>
    ((r = (Math.imul(r, 1_103_515_245) + 12_345) >>> 0) >>> 8) % n;
  // prettier-ignore
  const PALETTE = [0, 1, -1, 0.5, -0, 6, 0x8000_0000, Number.MAX_SAFE_INTEGER + 2, 1e300, NaN, Infinity, "", "x",
    true, false, null, [], {}];
  for (let n = 0; n < 1500; n++) {
    const [base, tick] = bases[next(bases.length)]!;
    let fields = base as unknown[];
    for (let k = 1 + next(3); k > 0; k--) {
      // A random walk down from the top, where the structure is.
      const path: number[] = [];
      let node: unknown = fields;
      while (Array.isArray(node) && node.length && (!path.length || next(4))) {
        path.push(next(node.length));
        node = node[path.at(-1)!];
      }
      const pick = next(PALETTE.length + 2),
        v = at(fields, path);
      // prettier-ignore
      fields = edit(fields, path, pick < PALETTE.length ? PALETTE[pick]
        : pick > PALETTE.length || !Array.isArray(v) ? DROP : [...v, ...v]);
    }
    const room = decode(fields, tick + (next(8) ? 0 : 1));
    if (!room) continue;
    accepted++;
    const again = restore(room);
    assert.ok(again, "an accepted room checkpoints");
    assert.equal(hash(again), hash(room));
    for (let i = 0; i < 3; i++) fold(room, script(room));
  }
  t.diagnostic(`${accepted} of 1500 mutated checkpoints accepted`);
  assert.ok(accepted > 0 && accepted < 1500);
});

test("a late joiner restores a running match from a peer's snapshot and folds on in step with it", () => {
  const replica = (self: string, room: Room) =>
    new World(game, room, "a", self);
  const source = replica("a", createRoom("m0", DEFAULT_SETTINGS));
  const own = source.stream("a", 1);
  source.stream("b", 1);
  // prettier-ignore
  for (const body of [[JOIN, "a", "Ada", 0, "gunship", 1], [JOIN, "b", "Bo", 1, "gunship", 1],
    [BOT, "add", "bot:1", "Baron", 2]]) own.append(1, body);
  own.append(2, [ACTION, "start", "m1"]);
  own.through = 900;
  const entries: Entry[] = [];
  for (let i = 0; i < 40; i++) {
    const at = [i + 1, 70 + i * 20] as const;
    entries.push(
      i % 3
        ? [...at, PLAY, "m1", 1, i % 2 ? UP | LEFT : DOWN]
        : [...at, PRESS, "m1", 1, i + 1, 0],
    );
  }
  type Replica = ReturnType<typeof replica>;
  /** Five of b's entries, as the replica reaches them, complete through the last one's tick. */
  const send = (world: Replica, from: number) => {
    const batch = entries.slice(from, from + 5),
      through = batch.at(-1)![1];
    world.advance(Math.max(world.tick, batch[0]![1] - 1));
    const sent = world.receive("b", batch, from + 5, through, world.tick);
    assert.equal(sent.status, "accepted");
  };
  for (let i = 0; i < 20; i += 5) send(source, i);
  source.advance(entries[19]![1]);
  const chunks = encodeSnapshot(source, 3),
    assembler = new SnapshotAssembler(game, 3);
  let complete: ReturnType<typeof assembler.accept>;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  const decoded = decodeSnapshot(game, complete!.bytes, 3);
  assert.ok(decoded, "the snapshot decodes");
  const { state, streams } = decoded;
  assert.ok(state.stage === "running" && state.world!.tick > 0, "mid-round");
  const joiner = replica("c", state);
  for (const s of streams) {
    const base = { seq: s.seq, tick: state.tick, ordinal: s.ordinal };
    joiner.stream(s.id, s.generation, base);
    const last = s.entries.at(-1)?.[0] ?? s.seq;
    joiner.receive(s.id, s.entries, last, state.tick, state.tick);
  }
  joiner.receive("a", [], 4, 900, joiner.tick);
  for (const world of [source, joiner]) {
    for (let i = 20; i < 40; i += 5) send(world, i);
    world.receive("b", [], 40, 900, world.tick);
    world.advance(900);
  }
  assert.equal(joiner.tick, 900);
  assert.equal(hash(joiner.state), hash(source.state));
  assert.ok(source.state.world!.castles[1]!.stats.volleys > 6, "b flew on");
});
