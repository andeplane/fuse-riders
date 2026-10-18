import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, LEAVE } from "fuse-netcode";
import { NO_WINNER, STEPS_PER_TICK } from "../src/engine/index.js";
import {
  CAST,
  COUNTDOWN_TICKS,
  DEFAULT_SETTINGS,
  MOVE,
  ORDER,
  STANCE,
  STEER,
  createRoom,
  decode,
  encode,
  foldTick,
  frontGame,
  hash,
  isEntry,
  mapOf,
  parseSettings,
  view,
  type Entry,
  type FrontEvent,
  type Room,
  type Settings,
} from "../src/online/game.js";
import { mapsFor } from "../src/online/maps.js";
import { pickHero } from "../src/app/model.js";
import { Mesh, type TestRuntime } from "./fixtures/mesh.js";

/** Each member's whole stream; the fold reads the entries stamped with the tick it folds. */
type Log = Map<string, unknown[][]>;
function log(room: Room, entries: Log, id: string, ...body: unknown[]): void {
  if (!entries.has(id)) entries.set(id, []);
  const stream = entries.get(id)!;
  stream.push([stream.length + 1, room.tick + 1, ...body]);
}
function fold(room: Room, entries: Log, ticks: number): FrontEvent[] {
  const events: FrontEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const streams = new Map(
      [...entries].map(([id, list]) => [
        id,
        { generation: 1, entries: list as Entry[] },
      ]),
    );
    events.push(...foldTick(room, "host", streams));
  }
  return events;
}
/** A room with the host seated in `slot` and a match started on the next tick, past its countdown. */
function match(settings: Partial<Settings> = {}, slot = 0) {
  const room = createRoom("lobby", { ...DEFAULT_SETTINGS, ...settings });
  const entries: Log = new Map();
  log(room, entries, "host", JOIN, "host", "Host", slot, "brick", 1);
  fold(room, entries, 1);
  log(room, entries, "host", ACTION, "start", "match-1");
  fold(room, entries, 1 + COUNTDOWN_TICKS);
  return { room, entries };
}

test("a match plays 2, 4 or 6 slots by size, grown to fit the highest seat, and bots fill every empty one", () => {
  for (const size of [1, 2, 3]) {
    const { room } = match({ size });
    assert.equal(room.stage, "running");
    assert.deepEqual(
      room.world!.players.map((p) => [p.seat, p.team]),
      Array.from({ length: 2 * size }, (_, s) => [s, s % 2]),
    );
    assert.deepEqual(
      view(room).bots.map((b) => b.slot),
      Array.from({ length: 2 * size - 1 }, (_, s) => s + 1),
    );
  }
  assert.equal(match({ size: 1 }, 3).room.world!.players.length, 4);
  const bots = [...DEFAULT_SETTINGS.bots];
  bots[1] = "hard";
  assert.equal(match({ bots }).room.play.bots[1], "hard");
  assert.deepEqual(view(match({ bots }).room).bots, [
    { slot: 1, difficulty: "hard" },
  ]);
});

test("bot fill is deterministic: two replicas of a 3v3 agree, and the bots play", () => {
  const bots = [...DEFAULT_SETTINGS.bots];
  [bots[1], bots[2]] = ["hard", "easy"];
  const a = match({ size: 3, bots }),
    b = match({ size: 3, bots });
  const start = structuredClone(a.room.world!.heroes);
  const events = fold(a.room, a.entries, 400);
  fold(b.room, b.entries, 400);
  assert.equal(hash(a.room), hash(b.room));
  assert.equal(a.room.world!.step, (400 + 1) * STEPS_PER_TICK);
  assert.ok(
    a.room.world!.heroes.slice(1).some((h, i) => h.x !== start[i + 1]!.x),
    "bot heroes walk",
  );
  // Every event carries the step it happened on, in order, so a screen can dedupe it across a rollback re-run.
  assert.ok(events.length > 0);
  assert.ok(events.every((e, i) => i === 0 || e.step >= events[i - 1]!.step));
});

test("a rider's controls count in its own match only, and at most four a tick", () => {
  const { room, entries } = match({ size: 1 });
  log(room, entries, "host", STANCE, "old-match", 1);
  fold(room, entries, 1);
  assert.equal(room.world!.players[0]!.stance, "push", "a stale match");
  log(room, entries, "host", STEER, "match-1", 8, 0);
  for (let i = 0; i < 4; i++) log(room, entries, "host", STANCE, "match-1", 0);
  log(room, entries, "host", STANCE, "match-1", 1);
  fold(room, entries, 1);
  assert.equal(room.world!.heroes[0]!.steerX, 8);
  assert.equal(
    room.world!.players[0]!.stance,
    "push",
    "past the fourth, dropped",
  );
  log(room, entries, "host", STANCE, "match-1", 1);
  fold(room, entries, 1);
  assert.equal(room.world!.players[0]!.stance, "hold");
});

test("a friend who joins mid-match takes over a bot's slot, and hands it back on leaving", () => {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  const entries: Log = new Map();
  log(room, entries, "host", JOIN, "host", "Host", 0, "brick", 1);
  log(room, entries, "host", BOT, "add", "bot:1", "Rivet", 1);
  fold(room, entries, 1);
  assert.equal(room.seats.get("bot:1")?.slot, 1);
  log(room, entries, "host", ACTION, "start", "match-1");
  fold(room, entries, 50 + COUNTDOWN_TICKS);
  assert.deepEqual(
    [...room.seats.keys()],
    ["host"],
    "the added AI is fill now",
  );
  log(room, entries, "host", JOIN, "friend", "Friend", 1, "brick", 1);
  fold(room, entries, 1);
  assert.deepEqual(view(room).bots, []);
  log(room, entries, "friend", STANCE, "match-1", 2);
  fold(room, entries, 1);
  assert.equal(room.world!.players[1]!.stance, "follow");
  log(room, entries, "host", LEAVE, "friend");
  fold(room, entries, 1);
  assert.deepEqual(
    view(room).bots.map((b) => b.slot),
    [1],
  );
});

test("a checkpoint round-trips through JSON and plays on to the same hashes", () => {
  const { room, entries } = match({ size: 2 });
  fold(room, entries, 300);
  const fields = JSON.parse(JSON.stringify(encode(room))) as unknown[];
  const copy = decode(fields, room.tick)!;
  assert.ok(copy);
  assert.equal(hash(copy), hash(room));
  assert.match(hash(room), /^[0-9a-f]{16}$/);
  fold(room, entries, 40);
  fold(copy, entries, 40);
  assert.equal(hash(copy), hash(room));
  const lobby = createRoom("lobby", DEFAULT_SETTINGS);
  assert.equal(hash(decode(encode(lobby), 0)!), hash(lobby));
  // During the countdown the world has not stepped.
  const early = createRoom("lobby", DEFAULT_SETTINGS);
  const log2: Log = new Map();
  log(early, log2, "host", JOIN, "host", "Host", 0, "brick", 1);
  log(early, log2, "host", ACTION, "start", "m");
  fold(early, log2, 5);
  assert.equal(hash(decode(encode(early), early.tick)!), hash(early));
});

test("a corrupt checkpoint is refused whole and leaves the room untouched", () => {
  const { room, entries } = match({ size: 1 });
  fold(room, entries, 30);
  const before = hash(room),
    good = () => JSON.parse(JSON.stringify(encode(room))) as unknown[];
  // prettier-ignore
  const corrupt: [string, (f: unknown[]) => void, number?][] = [
    ["a tick its world's step cannot be", () => {}, room.tick + 1],
    ["an earlier tick", () => {}, room.tick - 1],
    ["a step off by one", (f) => ((f[6] as number[])[0]! += 1)],
    ["over without a winner", (f) => (f[1] = "over")],
    ["a lobby with a world", (f) => (f[1] = "lobby")],
    ["an unknown stage", (f) => (f[1] = "between")],
    ["a settings key too many", (f) => Object.assign(f[2] as object, { x: 1 })],
    ["size 4", (f) => ((f[3] as Settings).size = 4)],
    ["a bot level unknown", (f) => ((f[3] as { bots: string[] }).bots[0] = "mad")],
    ["two seats in one slot", (f) => (f[4] as unknown[][]).push(["x", "X", 0, "brick", true, false, false, 1, false])],
    ["a seat with a bad name", (f) => ((f[4] as unknown[][])[0]![1] = " ")],
    ["a start in the future", (f) => (f[5] = room.tick + COUNTDOWN_TICKS + 1)],
    ["a missing field", (f) => f.pop()],
    ["a world that is not one", (f) => (f[6] = [1, 2, 3])],
  ];
  for (const [what, change, tick] of corrupt) {
    const fields = good();
    change(fields);
    assert.equal(decode(fields, tick ?? room.tick), undefined, what);
  }
  assert.equal(hash(room), before);
  assert.equal(room.world!.winner, NO_WINNER);
});

test("isEntry takes well-formed controls and refuses anything out of shape or range", () => {
  const ok: unknown[][] = [
    [1, 1, ORDER, "m", 0, 0],
    [1, 1, STANCE, "m", 2],
    // The wire admits any tile of the largest map; the engine refuses one off the map in play.
    [1, 1, MOVE, "m", 255, 255],
    [1, 1, STEER, "m", -8, 8],
    [1, 1, CAST, "m", 3, 0, 0],
    [1, 1, JOIN, "a", "Ann", 5, "brick", 1],
    [1, 1, ACTION, "start", "m"],
  ];
  for (const entry of ok) assert.ok(isEntry(entry), JSON.stringify(entry));
  const bad: unknown[] = [
    null,
    "x",
    [0, 1, STANCE, "m", 0],
    [1, 0, STANCE, "m", 0],
    [1, 1, STANCE, "", 0],
    [1, 1, STANCE, "m", 3],
    [1, 1, STANCE, "m", 0, 0],
    [1, 1, STANCE, "m"],
    [1, 1, STANCE, "m", 0.5],
    [1, 1, MOVE, "m", 256, 0],
    [1, 1, MOVE, "m", -1, 0],
    [1, 1, STEER, "m", 9, 0],
    [1, 1, CAST, "m", 4, 0, 0],
    [1, 1, ORDER, "m", 999, 0],
    [1, 1, ORDER, "m", 0, 3],
    [1, 1, 5, "m", 0],
    [1, 1, JOIN, "a", "Ann", 6, "brick", 1],
    [1, 1, JOIN, "a", "Ann", 0, "gunship", 1],
    [1, 1, JOIN, "__proto__", "Ann", 0, "brick", 1],
    [1, 1, ACTION, "start", ""],
  ];
  for (const entry of bad) assert.ok(!isEntry(entry), JSON.stringify(entry));
  assert.equal(frontGame.rules.startsWith("fuse-front-"), true);
});

/** A seeded generator, so a lossy mesh is the same mesh on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

test("two devices and bots play a 2v2 over a lossy, reordering mesh; a late device takes over a bot", () => {
  const mesh = new Mesh("host", { ...DEFAULT_SETTINGS, size: 2 });
  const random = seeded(7);
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.1) return { drop: true };
    if (roll < 0.2) return { delayMs: 20, duplicateMs: 60 };
    return { delayMs: 10 + Math.floor(random() * 70) };
  };
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  guest.command({ type: "join", name: "Guest" });
  mesh.run(2_000);
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(1_000 + COUNTDOWN_TICKS * 50);
  assert.equal(guest.roomState()!.stage, "running");
  assert.deepEqual(
    view(guest.roomState()!).bots.map((b) => b.slot),
    [2, 3],
  );
  let t = 0;
  mesh.run(3_000, () => {
    if (++t % 20 === 0) guest.control(STEER, t % 40 === 0 ? 8 : -8, 0);
    if (t === 50) host.control(STANCE, 1);
  });
  guest.control(STANCE, 2);
  mesh.run(1_500);
  aligned(mesh, [host, guest]);
  const [h, g] = [host.roomState()!, guest.roomState()!];
  assert.equal(hash(h), hash(g), "both replicas played the same match");
  assert.equal(h.world!.players[1]!.stance, "follow", "the guest's stance");
  assert.equal(h.world!.players[0]!.stance, "hold", "the host's stance");
  // A third device joins mid-match: it recovers the world from a checkpoint and rides slot 2's bot.
  mesh.fast = () => ({ delayMs: 15 });
  const late = mesh.join("late");
  mesh.run(2_000);
  late.command({ type: "join", name: "Late" });
  mesh.run(2_000);
  late.control(STANCE, 1);
  mesh.run(1_500);
  const rooms = [host, guest, late].map((r) => r.roomState()!);
  assert.deepEqual(
    view(rooms[2]!).bots.map((b) => b.slot),
    [3],
  );
  assert.equal(rooms[0]!.world!.players[2]!.stance, "hold");
  aligned(mesh, [host, guest, late]);
  assert.equal(
    new Set([host, guest, late].map((r) => hash(r.roomState()!))).size,
    1,
    "three replicas agree",
  );
});

/** Steps the mesh by 10 ms until every replica has folded the same log tick (one loop can run a tick ahead). */
function aligned(mesh: Mesh, runtimes: TestRuntime[]): void {
  for (let i = 0; i < 20; i++) {
    if (new Set(runtimes.map((r) => r.roomState()!.tick)).size === 1) return;
    mesh.run(10);
  }
  assert.fail("the replicas never folded the same tick");
}

test("heroes are picked once a team in the settings, and a start plays them with bots on the free ones", () => {
  const heroes = (...picks: (string | null)[]) => ({
    ...DEFAULT_SETTINGS,
    heroes: [...picks, ...Array(6 - picks.length).fill(null)],
  });
  assert.ok(
    parseSettings(heroes("vix", "vix", "rivet")),
    "the other team may repeat a hero",
  );
  for (const refused of [
    heroes("vix", null, "vix"),
    heroes("zed"),
    { ...DEFAULT_SETTINGS, heroes: [] },
  ])
    assert.equal(
      parseSettings(refused),
      undefined,
      JSON.stringify(refused.heroes),
    );
  const { heroes: _, ...old } = DEFAULT_SETTINGS;
  assert.equal(parseSettings(old), undefined, "settings without heroes");
  assert.equal(parseSettings(heroes("__proto__")), undefined);
  const seven = [...DEFAULT_SETTINGS.heroes, null];
  assert.equal(
    parseSettings({ ...DEFAULT_SETTINGS, heroes: seven }),
    undefined,
  );
  const picked = pickHero(pickHero(DEFAULT_SETTINGS, 2, "tally"), 0, "tally");
  assert.deepEqual(
    picked.heroes.slice(0, 3),
    ["tally", null, null],
    "a teammate's pick moves",
  );
  const { room } = match({ ...heroes("tally", null, null, "rivet"), size: 2 });
  assert.deepEqual(
    room.world!.heroes.map((h) => h.kind),
    ["tally", "brick", "vix", "rivet"],
  );
  assert.deepEqual(
    view(room).world!.heroes.map((h) => h.kind),
    ["tally", "brick", "vix", "rivet"],
  );
  // The picks and the world's heroes survive a checkpoint.
  const back = decode(JSON.parse(JSON.stringify(encode(room))), room.tick)!;
  assert.deepEqual(back.play.heroes, room.play.heroes);
  assert.equal(hash(back), hash(room));
});

test("the host's map plays when it holds the match's size; otherwise, or with none chosen, the size's default", () => {
  const played = (settings: Partial<Settings>, slot = 0) => {
    const { room } = match(settings, slot);
    return [room.play.map, mapOf(room).name, room.world!.players.length];
  };
  assert.deepEqual(played({ size: 1 }), ["rust-canyon", "Rust Canyon", 2]);
  assert.deepEqual(played({ size: 2 }), ["glass-lakes", "Glass Lakes", 4]);
  assert.deepEqual(played({ size: 3 }), ["iron-delta", "Iron Delta", 6]);
  assert.deepEqual(played({ size: 1, map: "dust-basin" }), [
    "dust-basin",
    "Dust Basin",
    2,
  ]);
  assert.deepEqual(played({ size: 1, map: "iron-delta" }), [
    "iron-delta",
    "Iron Delta",
    2,
  ]);
  // Too few forts for the size (grown to 2v2 by a rider in slot 3): that size's default instead.
  assert.deepEqual(played({ size: 1, map: "rust-canyon" }, 3), [
    "glass-lakes",
    "Glass Lakes",
    4,
  ]);
  assert.deepEqual(
    mapsFor(2).map((m) => m.id),
    ["dust-basin", "glass-lakes", "iron-delta"],
  );
  assert.deepEqual(
    mapsFor(3).map((m) => [m.id, m.teams, m.width, m.height]),
    [
      ["dust-basin", 3, 96, 56],
      ["iron-delta", 3, 256, 192],
    ],
  );
  for (const map of ["moon", "__proto__", 3])
    assert.equal(parseSettings({ ...DEFAULT_SETTINGS, map }), undefined);
  const { map: _, ...old } = DEFAULT_SETTINGS;
  assert.equal(parseSettings(old), undefined, "settings without a map");
});

test("a big-map match checkpoints and restores onto its own map, and no other", () => {
  const { room } = match({ size: 3 });
  const fields = JSON.parse(JSON.stringify(encode(room))) as unknown[];
  const copy = decode(fields, room.tick)!;
  assert.equal(hash(copy), hash(room));
  assert.equal(mapOf(copy).name, "Iron Delta");
  for (const map of ["dust-basin", null]) {
    const wrong = structuredClone(fields);
    (wrong[3] as Settings).map = map;
    assert.equal(decode(wrong, room.tick), undefined, String(map));
  }
});
