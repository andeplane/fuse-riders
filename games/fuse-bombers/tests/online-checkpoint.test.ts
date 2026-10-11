import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, PRESENCE, SPECTATOR } from "fuse-netcode";
import { MAX_SNAPSHOT_BYTES, SnapshotAssembler, World } from "fuse-netcode";
import { decodeSnapshot, encodeSnapshot } from "fuse-netcode";
import { packMessage, unpackMessage, type StreamEntries } from "fuse-netcode";
import { DEFAULT_TUNING, DOWN, LEFT, RIGHT, UP } from "../src/engine/index.js";
import {
  createRound,
  decodeRound,
  encodeRound,
  step,
} from "../src/engine/index.js";
import { carveCircle, createGrid, encodeGrid } from "../src/engine/grid.js";
import { buildTempleGrid } from "../src/engine/temple-map.js";
import {
  BETWEEN_TICKS,
  DEFAULT_SETTINGS,
  PLAY,
  PRESS,
  roundSeed,
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
    // What a peer accepted it can serve again after play: stepping never leaves what the decoder takes.
    for (let i = 0; i < 90; i++) fold(room, script(room));
    assert.ok(restore(room), "an accepted room checkpoints after a minute on");
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

// ---- what a hostile snapshot is held to: the ranges and relations the engine itself keeps ----

type Change = readonly [Path, unknown];
/** `fields` with every change applied. */
const changed = (fields: unknown[], ...changes: Change[]) =>
  changes.reduce((copy, [path, value]) => edit(copy, path, value), fields);

test("a value the engine cannot reach is refused, and each range is taken up to its edge", () => {
  const fields = wire(battle),
    world = fields[WORLD] as unknown[][],
    steps = battle.world!.tick;
  const rows = (list: number) => world[list] as unknown[][];
  const alive = rows(8).findIndex((c) => c[6]);
  const shell = rows(9).findIndex((r) => !r[8] && !r[9]);
  // The memory of a bot whose castle still flies.
  const bot = rows(14).findIndex(
    (_, i) => rows(8)[(world[3] as number[][])[i]![0]!]![6],
  );
  assert.ok(alive >= 0 && shell >= 0 && bot >= 0);
  const accepts = (...change: Change[]) =>
    decode(changed(fields, ...change), battle.tick) !== undefined;
  const spawn = rows(10)[0]![2] as number;
  // [what, where, an edge of its range that stays, the next value out that goes]
  // prettier-ignore
  const ranges: [string, Path, unknown, unknown][] = [
    ["a castle's x", [WORLD, 8, alive, 0], 4800, 4801],
    ["a castle's y", [WORLD, 8, alive, 1], 2700, -1],
    ["a castle's speed", [WORLD, 8, alive, 2], 400, 401],
    ["a castle's reload", [WORLD, 8, alive, 9], 156, 157],
    ["a tally", [WORLD, 8, 0, 19], 2 ** 30 - 1, 2 ** 30],
    ["the damage dealt", [WORLD, 8, 0, 21], 1e100, 1e101],
    ["a rocket's right edge", [WORLD, 9, shell, 2], 4880, 4881],
    ["a rocket's left edge", [WORLD, 9, shell, 2], -80, -81],
    ["a rocket's floor", [WORLD, 9, shell, 3], 2760, 2761],
    ["a rocket's sky", [WORLD, 9, shell, 3], -1e5, -100_001],
    ["a rocket's speed", [WORLD, 9, shell, 4], 1e4, 10_001],
    ["a gate's drift", [WORLD, 10, 0, 5], 30, 31],
    ["a gate's bob", [WORLD, 10, 0, 9], 420, 421],
    ["a gate's span", [WORLD, 10, 0, 3], spawn + 1320, spawn + 1321],
    ["a gate's start within its ends", [WORLD, 10, 0, 4], rows(10)[0]![7], (rows(10)[0]![7] as number) + 1],
    ["a crate's x", [WORLD, 11, 0, 2], 4800, 4801],
    ["a ghost's x", [WORLD, 12, 0, 1], 4800, 4801],
    ["a ghost's speed", [WORLD, 12, 0, 3], 520, 521],
    ["a ghost's reload", [WORLD, 12, 0, 7], 210, 211],
    ["a bot's spot", [WORLD, 14, bot, 3], 4800, 4801],
    ["a bot's plan", [WORLD, 14, bot, 7], steps + 512, steps + 513],
    ["a bot's press", [WORLD, 14, bot, 8], steps + 512, steps + 513],
    ["a bot's dodge", [WORLD, 14, bot, 10], steps + 512, steps + 513],
    ["the next id", [WORLD, 17], 2 ** 30 - 1, 2 ** 30],
  ];
  assert.ok(accepts(), "the checkpoint itself");
  for (const [what, path, edge, past] of ranges) {
    assert.ok(accepts([path, edge]), `${what} at its edge`);
    assert.ok(!accepts([path, past]), `${what} past it`);
  }
  // Power is what the gates passed can have made, ×10 at most each; more is a few gates from Infinity.
  const power = (value: number, gates: number): Change[] => [
    [[WORLD, 9, shell, 6], value],
    [[WORLD, 9, shell, 10], Array.from({ length: gates }, (_, i) => i + 1)],
  ];
  for (const [value, gates] of [
    [1, 0],
    [10, 1],
    [100, 2],
    [1e64, 64],
  ] as const)
    assert.ok(
      accepts(...power(value, gates)),
      `power ${value} through ${gates} gates`,
    );
  for (const [value, gates] of [
    [11, 0],
    [100.001, 2],
    [1e300, 0],
    [1e65, 64],
  ] as const)
    assert.ok(
      !accepts(...power(value, gates)),
      `power ${value} through ${gates} gates`,
    );
  // Parts that each fit but do not fit together.
  assert.ok(!accepts([[WORLD, 12], []]), "a fallen castle without its ghost");
  assert.ok(
    !accepts([[WORLD, 14, bot, 1], true]),
    "a bot flying a ghost over a living castle",
  );
  assert.ok(
    !accepts(
      [[WORLD, 9, shell, 8], true],
      [[WORLD, 9, shell, 1], -1],
      [[WORLD, 9, shell, 7], false],
    ),
    "a sudden-death bomb before sudden death",
  );
});

test("a decided round's result is what its survivors make it, and an undecided round is under its time limit", () => {
  const limit = DEFAULT_TUNING.maxRoundTime * 60;
  /** A round stepped once at `tick` of sudden death by hand, castles with the HP given and nobody firing. */
  function warped(tick: number, ...hp: number[]) {
    const world = createRound({ seed: 5, playerCount: hp.length });
    world.tick = tick;
    world.phase = "sudden-death";
    hp.forEach((left, i) => (world.castles[i]!.hp = left));
    step(world);
    return world;
  }
  const timedOut = (...hp: number[]) => warped(limit - 1, ...hp);
  const accepts = (fields: unknown[], ...change: Change[]) =>
    decodeRound(changed(fields, ...change)) !== undefined;
  const RESULT = 6;
  // The most HP wins; level at the top is a draw.
  const lead = encodeRound(timedOut(100, 60, 80)),
    level = encodeRound(timedOut(90, 90, 40));
  assert.deepEqual(lead[RESULT], [0, "timeout", limit - 1]);
  assert.deepEqual(level[RESULT], [null, "timeout", limit - 1]);
  assert.ok(accepts(lead) && accepts(level));
  for (const [fields, winner] of [
    [lead, 2],
    [lead, null],
    [level, 0],
  ] as const)
    assert.ok(
      !accepts(fields, [[RESULT, 0], winner]),
      `timeout won by ${winner}`,
    );
  for (const reason of ["last-standing", "wipeout"])
    assert.ok(!accepts(lead, [[RESULT, 1], reason]), `${reason} with 3 left`);
  assert.ok(!accepts(lead, [[RESULT, 2], limit - 2]), "a timeout early");
  assert.ok(!accepts(lead, [[RESULT, 2], limit]), "a result past the limit");
  assert.ok(!accepts(lead, [[4], limit - 1]), "decided at the step it ends on");
  // The same against a round that is over with one survivor.
  const over = wire(rooms.get("over")!)[WORLD] as unknown[];
  assert.ok(accepts(over));
  const survivor = (over[RESULT] as unknown[])[0] as number;
  assert.ok(!accepts(over, [[RESULT, 0], survivor === 0 ? 1 : 0]), "a loser");
  assert.ok(!accepts(over, [[RESULT, 0], null]), "a draw with one left");
  assert.ok(!accepts(over, [[RESULT, 1], "wipeout"]), "a wipeout, one left");
  assert.ok(!accepts(over, [[RESULT, 1], "timeout"]), "a timeout, one left");
  // A round not yet decided has not reached its limit: the step that does decides it.
  const late = encodeRound(warped(limit - 3, 100, 60, 80));
  assert.deepEqual(
    [late[4], late[5], late[6]],
    [limit - 2, "sudden-death", null],
  );
  assert.ok(accepts(late) && accepts(late, [[4], limit - 1]));
  assert.ok(!accepts(late, [[4], limit]), "undecided at the limit");
});

test("a match that was decided plays no further round", () => {
  const tick = (name: string) => rooms.get(name)!.tick;
  const over = wire(rooms.get("over")!),
    running = wire(rooms.get("sudden death")!);
  const settle = (wins: number) => ({
    wins,
    difficulty: "hard",
    display: false,
  });
  // Over: the latest round crowns bot:2 (two wins) and nobody was crowned before it.
  assert.ok(decode(over, tick("over")));
  const results = over[6] as unknown[][];
  const crowned = changed(over, [[6, 0, 1], "bot:2"]);
  assert.deepEqual(
    results.map((r) => r[1]),
    ["bot:3", "bot:2", "bot:2"],
  );
  assert.ok(decode(crowned, tick("over")) === undefined, "crowned in round 2");
  // Running: the round before it already gave bot:3 the wins the match needs.
  assert.ok(decode(running, tick("sudden death")));
  const done = changed(running, [[4], settle(1)]);
  assert.ok(decode(done, tick("sudden death")) === undefined, "crowned, on");
});

test("a sparse array or a −0 from a source other than MessagePack does not get through", () => {
  const hole = (list: unknown) => {
    const copy = [...(list as unknown[])];
    delete copy[1];
    return copy;
  };
  const fields = wire(battle),
    world = fields[WORLD] as unknown[][];
  const withHole = (path: Path) =>
    changed(fields, [path, hole(at(fields, path))]);
  for (const path of [
    [5],
    [8],
    [WORLD, 8],
    [WORLD, 9],
    [WORLD, 13],
    [WORLD, 14],
  ])
    assert.ok(
      decode(withHole(path), battle.tick) === undefined,
      path.join("."),
    );
  const chunks = [(world[7] as unknown[])[0]]; // the terrain's runs, then a hole where a second chunk would be
  chunks.length = 2;
  for (const [part, value] of [
    [13, hole(world[13])],
    [7, chunks],
  ] as const)
    assert.ok(
      decodeRound(changed(world, [[part], value])) === undefined,
      `a hole in part ${part}`,
    );
  // −0 reads as 0 wherever the round takes a number, as the hash counts it, so no peer holds a sign the others lack.
  const negate = (v: unknown): unknown =>
    v === 0 ? -0 : Array.isArray(v) ? v.map(negate) : v;
  const negative = [...fields];
  negative[WORLD] = world.map((part, i) => (i === 7 ? part : negate(part)));
  const room = decode(negative, battle.tick);
  assert.ok(room, "the round with every zero negative");
  assert.equal(hash(room), hash(battle));
  assert.deepEqual(negativeZeros(room.world), []);
});
/** The paths of every number in `value` that `bad` picks out. */
function numbersWhere(
  value: unknown,
  bad: (n: number) => boolean,
  path = "",
  out: string[] = [],
) {
  if (typeof value === "number") {
    if (bad(value)) out.push(path);
  } else if (Array.isArray(value))
    value.forEach((v, i) => numbersWhere(v, bad, `${path}[${i}]`, out));
  else if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value)
  )
    for (const [k, v] of Object.entries(value))
      numbersWhere(v, bad, `${path}.${k}`, out);
  return out;
}
const negativeZeros = (value: unknown) =>
  numbersWhere(value, (n) => Object.is(n, -0));
const nonFinite = (value: unknown) =>
  numbersWhere(value, (n) => !Number.isFinite(n));

test("a rocket through gate after gate keeps a power its lineage explains, and the room still checkpoints", () => {
  const room = structuredClone(battle),
    world = room.world!;
  // Every gate on the first, ×10, and the rocket cap full of rockets that leave at once: no gate has room for a child,
  // so each only multiplies the power of the one rocket.
  const { x0, baseY } = world.gates[0]!;
  for (const g of world.gates)
    Object.assign(g, { multiplier: 10, x0, minX: x0, maxX: x0, vx: 0, baseY });
  const rocket = (id: number, x: number, y: number) => ({
    id,
    owner: 0,
    x,
    y,
    vx: 0,
    vy: 0,
    power: 1,
    mega: false,
    bomb: false,
    ghost: false,
    gates: [] as number[],
    age: 0,
  });
  const first = world.nextId;
  world.nextId += 1500;
  for (let i = 0; i < 1400; i++)
    world.rockets.push(rocket(first + i, -5000, 0));
  const lone = first + 1400;
  world.rockets.push(rocket(lone, x0, baseY));
  fold(room);
  const after = world.rockets.find((r) => r.id === lone)!;
  assert.deepEqual([after.gates.length, after.power], [7, 1e7]);
  const back = restore(room);
  assert.ok(back, "the room after seven gates");
  assert.equal(hash(back), hash(room));
});

test("a value pushed to an extreme in any field is refused, or leaves a round that folds on finite and checkpoints", () => {
  const fields = wire(battle),
    world = fields[WORLD] as unknown[][];
  const lists = [8, 9, 10, 11, 12, 14].map(
    (list) => world[list] as unknown[][],
  );
  const alive = lists[0]!.findIndex((c) => c[6]),
    dead = lists[0]!.findIndex((c) => !c[6]);
  const EXTREMES = [-1, 0.5, 4800, 1e6, 1e300, 2 ** 30 - 1];
  let tried = 0,
    taken = 0;
  for (const [l, list] of lists.entries()) {
    for (const item of l === 0 ? [alive, dead] : [0]) {
      for (let field = 0; field < list[item]!.length; field++)
        for (const extreme of EXTREMES) {
          const path = [WORLD, [8, 9, 10, 11, 12, 14][l]!, item, field];
          const room = decode(changed(fields, [path, extreme]), battle.tick);
          tried++;
          if (!room) continue;
          taken++;
          for (let i = 0; i < 20; i++) fold(room, script(room));
          const why = `${path.join(".")} = ${extreme}`;
          assert.deepEqual(nonFinite(room.world), [], why);
          assert.ok(restore(room), `${why} after 20 ticks`);
        }
    }
  }
  assert.ok(taken > 100 && taken < tried, `${taken} of ${tried}`);
});

test("rooms of every size checkpoint all through a round", () => {
  for (const riders of [2, 3, 5]) {
    const id = `s${riders}`,
      room = createRoom(id, {
        ...DEFAULT_SETTINGS,
        wins: 1,
        difficulty: riders === 3 ? "easy" : "normal",
      });
    const bots = Array.from({ length: riders - 2 }, (_, i) => [
      BOT,
      "add",
      `bot:${i + 1}`,
      "Zeppo",
      i + 2,
    ]);
    // prettier-ignore
    fold(room, { a: [[JOIN, "a", "Ada", 0, "gunship", 1], [JOIN, "b", "Bo", 1, "gunship", 1], ...bots] });
    fold(room, { a: [[ACTION, "start", id]] });
    let checked = 0;
    while (room.stage !== "over" && room.tick < 6000) {
      fold(room, script(room));
      if (room.tick % 41 && !(room.world?.result && room.tick % 7 === 0))
        continue;
      const back = restore(room);
      assert.ok(back, `${riders} riders at ${room.tick}`);
      assert.equal(hash(back), hash(room), `${riders} riders at ${room.tick}`);
      checked++;
    }
    assert.equal(room.stage, "over", `${riders} riders`);
    assert.ok(checked > 10, `${checked} checkpoints`);
  }
});
