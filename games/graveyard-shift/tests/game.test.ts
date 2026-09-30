import test from "node:test";
import assert from "node:assert/strict";
import { JOIN, PRESENCE, type StreamEntries } from "fuse-netcode";
import {
  CAPACITY,
  DURATION,
  MAX_GHOSTS,
  VACUUM,
  PULSE,
  RIGHT,
  UP,
  createWorld,
  stepWorld,
  botInput,
  carried,
  parseSettings,
  type Ghost,
  type World,
} from "../src/engine/world.js";
import { decodeWorld } from "../src/engine/codec.js";
import {
  READY,
  CANCEL,
  PLAY,
  createRoom,
  foldTick,
  encode,
  decode,
  hash,
  isEntry,
  type Entry,
  type Room,
} from "../src/online/game.js";

test("short pulse taps survive release in one tick, while cancellation suppresses the pending pulse", () => {
  for (const cancel of [false, true]) {
    const r = seated();
    fold(r, {
      a: [[3, 2, READY, "lobby", true]],
      b: [[1, 2, READY, "lobby", true]],
    });
    const end: Entry = cancel
      ? [5, 3, CANCEL, r.matchId, 1]
      : [5, 3, PLAY, r.matchId, 1, 0];
    fold(r, { a: [[4, 3, PLAY, r.matchId, 1, PULSE], end] });
    assert.equal(r.world!.hunters[0]!.cooldown, cancel ? 0 : 70);
    assert.equal(r.held.a, 0);
  }
});
const ghost = (id = 1, kind: 1 | 4 = 1): Ghost => ({
  id,
  kind,
  x: 530,
  y: 310,
  resistance: kind === 4 ? 100 : 36,
  emerge: 0,
  tug: 0,
  claim: [0, 0, 0, 0, 0],
  carrier: "",
});
function world() {
  const w = createWorld(47, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  w.hunters[0]!.x = 480;
  w.hunters[0]!.dx = 1;
  w.hunters[0]!.dy = 0;
  w.hunters[1]!.x = 580;
  w.hunters[1]!.dx = -1;
  w.hunters[1]!.dy = 0;
  w.ghosts = [ghost()];
  return w;
}
function run(
  w: World,
  n: number,
  bits: ReadonlyMap<string, number> = new Map(),
) {
  for (let i = 0; i < n; i++) stepWorld(w, bits);
}
test("sustained suction captures once; tank value stays unsecured", () => {
  const w = world();
  run(w, 60, new Map([["a", VACUUM]]));
  assert.deepEqual(w.hunters[0]!.tank, [1]);
  assert.equal(w.ghosts.find((g) => g.id === 1)!.carrier, "a");
  assert.equal(w.hunters[0]!.score, 0);
  assert.equal(carried(w, w.hunters[0]!), 1);
  assert.ok(decodeWorld(w));
});
test("contested capture has a bounded tug window and deterministic tie resolution", () => {
  const a = world(),
    b = structuredClone(a);
  const inputs = new Map([
    ["a", VACUUM],
    ["b", VACUUM],
  ]);
  run(a, 18, inputs);
  assert.equal(a.ghosts[0]!.resistance, 0);
  assert.equal(a.hunters.flatMap((h) => h.tank).length, 0);
  run(a, 24, inputs);
  run(b, 42, new Map([...inputs].reverse()));
  assert.deepEqual(a, b);
  assert.equal(
    a.hunters.flatMap((h) => h.tank).filter((id) => id === 1).length,
    1,
  );
});
test("higher sustained contribution wins instead of the last arriving beam", () => {
  const w = world();
  run(w, 20, new Map([["a", VACUUM]]));
  run(
    w,
    40,
    new Map([
      ["a", VACUUM],
      ["b", VACUUM],
    ]),
  );
  assert.equal(w.ghosts.find((g) => g.id === 1)!.carrier, "a");
});
test("wraith resistance is greater and its suction pulls a hunter", () => {
  const w = world();
  w.ghosts = [ghost(1, 4)];
  const x = w.hunters[0]!.x;
  run(w, 20, new Map([["a", VACUUM]]));
  assert.equal(w.hunters[0]!.tank.length, 0);
  assert.ok(w.hunters[0]!.x > x);
  assert.equal(w.ghosts[0]!.resistance, 80);
});
test("pulse releases exactly one ghost, protects the victim and keeps banked score", () => {
  const w = world(),
    victim = w.hunters[1]!;
  victim.x = 550;
  victim.tank = [1];
  victim.score = 9;
  w.ghosts[0]!.carrier = "b";
  stepWorld(
    w,
    new Map([
      ["a", PULSE],
      ["b", VACUUM],
    ]),
  );
  assert.equal(victim.tank.length, 0);
  assert.equal(w.ghosts[0]!.carrier, "");
  assert.equal(w.ghosts.filter((g) => g.id === 1).length, 1);
  assert.equal(victim.score, 9);
  assert.ok(victim.stun);
  assert.equal(victim.beam, 0);
  assert.equal(w.hunters[0]!.cooldown, 70);
  run(w, 10, new Map([["a", PULSE]]));
  assert.equal(victim.protection, 25);
});
test("full tanks cannot capture; deposits require uninterrupted stationary presence", () => {
  const w = world(),
    h = w.hunters[0]!;
  w.ghosts = Array.from({ length: 6 }, (_, i) => ({
    ...ghost(i + 1),
    carrier: i < 5 ? "a" : "",
  }));
  h.tank = [1, 2, 3, 4, 5];
  run(w, 3, new Map([["a", VACUUM]]));
  assert.equal(h.beam, 0);
  assert.equal(h.tank.length, CAPACITY);
  h.x = 100;
  h.y = 310;
  run(w, 20);
  assert.equal(h.score, 0);
  stepWorld(w, new Map([["a", RIGHT]]));
  assert.equal(h.deposit, 0);
  run(w, 24);
  assert.equal(h.score, 0);
  run(w, 1);
  assert.equal(h.score, 5);
  assert.equal(h.tank.length, 0);
  assert.ok(!w.ghosts.some((g) => g.carrier === "a"));
});
test("spawns respect the global arena plus tanks bound and emergence delay", () => {
  const w = world();
  run(w, 700);
  assert.equal(w.ghosts.length, MAX_GHOSTS);
  assert.equal(new Set(w.ghosts.map((g) => g.id)).size, MAX_GHOSTS);
});
test("bots bank ghosts through ordinary controls over a full deterministic round", () => {
  const a = createWorld(
      321,
      Array.from({ length: 5 }, (_, slot) => ({ id: `bot:${slot}`, slot })),
    ),
    b = structuredClone(a);
  for (let t = 0; t < DURATION; t++) {
    for (const w of [a, b])
      stepWorld(w, new Map(w.hunters.map((h) => [h.id, botInput(w, h)])));
    assert.ok(a.ghosts.length <= MAX_GHOSTS);
    if (t % 100 === 0) assert.ok(decodeWorld(a));
  }
  assert.deepEqual(a, b);
  assert.ok(a.hunters.reduce((n, h) => n + h.score, 0) > 0);
  const end = structuredClone(a);
  run(a, 10);
  assert.deepEqual(a, end);
});
test("checkpoint rejects corrupt bounds, duplicated ghosts, and inconsistent ownership atomically", () => {
  const w = world();
  assert.deepEqual(decodeWorld(w), w);
  for (const mutate of [
    (v: World) => {
      v.hunters[0]!.x = NaN;
    },
    (v: World) => {
      v.ghosts.push({ ...v.ghosts[0]! });
    },
    (v: World) => {
      v.hunters[0]!.tank = [1];
    },
    (v: World) => {
      v.ghosts[0]!.carrier = "b";
    },
    (v: World) => {
      v.ghosts[0]!.claim = [1];
    },
    (v: World) => {
      v.rng = -1;
    },
  ]) {
    const bad = structuredClone(w);
    mutate(bad);
    assert.equal(decodeWorld(bad), undefined);
  }
  const copy = decodeWorld(w)!;
  copy.hunters[0]!.score = 10;
  assert.equal(w.hunters[0]!.score, 0);
});
function fold(r: Room, entries: Record<string, Entry[]>, generation = 1) {
  const streams = new Map<string, StreamEntries<Entry>>(
    Object.entries(entries).map(([id, entries]) => [
      id,
      { generation, entries },
    ]),
  );
  foldTick(r, "a", streams);
}
function seated() {
  const r = createRoom("lobby", { display: false });
  fold(r, {
    a: [
      [1, 1, JOIN, "a", "Ada", 0, "hunter", 1],
      [2, 1, JOIN, "b", "Bo", 1, "hunter", 1],
    ],
  });
  return r;
}
test("readiness is unanimous, entries are scoped, and checkpoint replay converges", () => {
  const r = seated();
  fold(r, { a: [[3, 2, READY, "lobby", true]] });
  assert.equal(r.stage, "lobby");
  fold(r, { b: [[1, 3, READY, "lobby", true]] });
  assert.equal(r.stage, "running");
  const initial = decode(encode(r), r.tick)!;
  assert.ok(initial);
  assert.equal(hash(r), hash(initial));
  for (let i = 0; i < 60; i++) {
    const t = r.tick + 1;
    const es: Record<string, Entry[]> = {
      a: [[i + 4, t, PLAY, r.matchId, 1, i % 2 ? RIGHT : VACUUM]],
      b: [[i + 2, t, PLAY, r.matchId, 1, UP]],
    };
    fold(r, es);
    fold(initial, es);
  }
  assert.equal(hash(r), hash(initial));
  const before = r.world!.hunters[0]!.x;
  fold(r, { a: [[99, r.tick + 1, PLAY, "old-match", 1, RIGHT]] });
  assert.equal(r.world!.hunters[0]!.x, before);
});
test("disconnect and generation changes neutralize held input; stale entries stay inert", () => {
  const r = seated();
  fold(r, {
    a: [[3, 2, READY, "lobby", true]],
    b: [[1, 2, READY, "lobby", true]],
  });
  fold(r, { a: [[4, 3, PLAY, r.matchId, 1, RIGHT]] });
  const x = r.world!.hunters[0]!.x;
  fold(r, { a: [[5, 4, PRESENCE, "a", false, 1]] });
  assert.equal(r.world!.hunters[0]!.x, x);
  fold(r, {
    a: [
      [6, 5, PRESENCE, "a", true, 2],
      [7, 5, PLAY, r.matchId, 1, RIGHT],
    ],
  });
  assert.equal(r.world!.hunters[0]!.x, x);
  fold(r, { a: [[8, 6, PLAY, r.matchId, 1, RIGHT]] }, 2);
  assert.ok(r.world!.hunters[0]!.x > x);
});
test("wire and room checkpoint guards reject malformed values", () => {
  assert.equal(isEntry([1, 1, PLAY, "m", 1, 64]), false);
  assert.equal(isEntry([1, 1, PLAY, "m", 1, NaN]), false);
  assert.equal(isEntry([1, 1, READY, "m", true]), true);
  assert.equal(
    isEntry([1, 1, JOIN, "__proto__", "Name", 0, "hunter", 1]),
    false,
  );
  assert.equal(parseSettings({ display: false, extra: 1 }), undefined);
  assert.equal(parseSettings(null), undefined);
  const r = seated();
  const encoded = encode(r);
  assert.ok(decode(encoded, r.tick));
  assert.equal(decode(encoded.slice(1), r.tick), undefined);
  const bad = structuredClone(encoded);
  bad[7] = world();
  assert.equal(decode(bad, r.tick), undefined);
});
