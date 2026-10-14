import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  createMatch,
  decodeState,
  encodeState,
  getView,
  hashState,
  isAction,
  projectShot,
  traceShot,
  UNIT,
  type Action,
  type Match,
} from "../src/engine/index.js";
import { carve, solid, groundAt } from "../src/engine/terrain.js";
import { sweep } from "../src/engine/physics.js";

function ready(count = 2, seed = 123): Match {
  const s = createMatch(
    "test",
    seed,
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `Bird ${i}`,
    })),
  );
  for (let n = 0; n < 3000 && s.phase === "preparing"; n++) advance(s);
  assert.equal(s.phase, "aiming", s.fault ?? "generation stalled");
  return s;
}
function shot(s: Match, weapon: "pebble" | "scatter" = "pebble"): Action {
  const bird = s.players[s.active]!;
  const vector = s.preparation.witnesses.find(
    (w) => w.from === bird.id && w.wind === s.wind,
  )!;
  return {
    type: "launch",
    actor: bird.id,
    round: s.round,
    turn: s.turn,
    ordinal: bird.ordinal + 1,
    weapon,
    vx: vector.vx,
    vy: vector.vy,
  };
}

test("headless maps establish actual directed Pebble hits in every wind", () => {
  for (const count of [2, 3, 5])
    for (const seed of [1, 123, 987654]) {
      const s = ready(count, seed);
      assert.equal(s.preparation.witnesses.length, count * (count - 1) * 5);
      for (const w of s.preparation.witnesses)
        assert.equal(
          traceShot(
            s.terrain,
            s.players,
            s.players.find((p) => p.id === w.from)!,
            w,
            w.wind,
            w.to,
          ).hit,
          true,
        );
    }
});
test("a legal Pebble damages an opponent, cuts terrain and advances the turn", () => {
  const s = ready();
  const action = shot(s),
    terrain = s.terrain.bits.slice(),
    turn = s.turn;
  advance(s, [action]);
  assert.equal(s.phase, "flight");
  assert.equal(s.players[0]!.ammo, 3);
  for (
    let i = 0;
    i < 350 && s.turn === turn && getView(s).phase !== "over";
    i++
  )
    advance(s);
  assert.ok(s.players[1]!.hp < 100);
  assert.notDeepEqual(s.terrain.bits, terrain);
  assert.ok(s.turn > turn || getView(s).phase === "over");
});
test("Scatter costs once, splits into three and ignores repeated or stale releases", () => {
  const s = ready(),
    action = shot(s, "scatter");
  advance(s, [action, action]);
  assert.equal(s.players[0]!.ammo, 2);
  let splits = 0,
    sawThree = false;
  for (let i = 0; i < 250; i++) {
    splits += advance(s, [action]).filter((f) => f.type === "split").length;
    sawThree ||= s.projectiles.length === 3;
    if (s.turn !== 1 || s.phase === "over") break;
  }
  assert.equal(splits, 1);
  assert.equal(sawThree, true);
  assert.equal(s.players[0]!.ammo, 2);
});
test("a crate struck by a Pebble grants one Scatter refill without another shot", () => {
  const s = ready();
  const p = s.players[0]!;
  s.crates = [
    {
      id: s.nextEntity++,
      x: p.x + 42 * UNIT,
      y: p.y - 20 * UNIT,
      vy: 0,
      grounded: false,
    },
  ];
  advance(s, [
    {
      type: "launch",
      actor: p.id,
      round: s.round,
      turn: s.turn,
      ordinal: 1,
      weapon: "pebble",
      vx: 1024,
      vy: -512,
    },
  ]);
  let picks = 0;
  for (let i = 0; i < 100; i++)
    picks += advance(s).filter((f) => f.type === "pickup").length;
  assert.equal(picks, 1);
  assert.equal(p.ammo, 4);
  assert.equal(s.shot, 1);
});
test("bad, out-of-turn and empty-inventory launches do not spend ammunition", () => {
  const s = ready();
  assert.equal(isAction({ ...shot(s), vx: 99999 }), false);
  advance(s, [{ ...shot(s), actor: "p1" }]);
  assert.equal(s.phase, "aiming");
  s.players[0]!.ammo = 0;
  assert.ok(
    advance(s, [shot(s, "scatter")]).some((f) => f.type === "rejected"),
  );
  assert.equal(s.phase, "aiming");
  assert.equal(s.shot, 0);
  advance(s, [shot(s)]);
  assert.equal(s.phase, "flight");
});
test("timeout passes, without firing or spending ammo", () => {
  const s = ready();
  const deadline = s.deadline;
  while (s.tick < deadline - 1) advance(s);
  advance(s, [shot(s, "scatter")]);
  assert.equal(s.shot, 0);
  assert.equal(s.players[0]!.ammo, 3);
  assert.equal(s.turn, 2);
});
test("caller-driven matches finish even when all players pass", () => {
  const s = ready(5);
  for (let i = 0; i < 15000 && s.phase !== "over"; i++) {
    const p = s.players[s.active]!;
    advance(
      s,
      s.phase === "aiming"
        ? [
            {
              type: "pass",
              actor: p.id,
              round: s.round,
              turn: s.turn,
              ordinal: p.ordinal + 1,
            },
          ]
        : [],
    );
  }
  assert.equal(s.phase, "over");
  assert.ok(s.players.filter((p) => p.hp > 0).length <= 1);
});
test("checkpoints during preparation, flight and settling reproduce future hashes", () => {
  const original = createMatch("test", 1, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ]);
  advance(original);
  const restored = decodeState(encodeState(original));
  assert.ok(restored);
  for (let i = 0; i < 400; i++) {
    const actions =
      original.phase === "aiming" && original.shot === 0
        ? [shot(original, "scatter")]
        : [];
    assert.deepEqual(advance(original, actions), advance(restored, actions));
    assert.equal(hashState(original), hashState(restored));
    if (i % 40 === 0)
      assert.equal(
        hashState(decodeState(encodeState(original))!),
        hashState(original),
      );
  }
});
test("checkpoint validation is atomic and refuses corrupt ranges and references", () => {
  const s = ready(),
    before = hashState(s);
  const bad = encodeState(s);
  bad.players[0]!.ammo = -1;
  assert.equal(decodeState(bad), undefined);
  assert.equal(hashState(s), before);
  const wrongClock = encodeState(s);
  wrongClock.step++;
  assert.equal(decodeState(wrongClock), undefined);
  const wrongTerrain = encodeState(s);
  wrongTerrain.terrain.bits = new Uint8Array(4);
  assert.equal(decodeState(wrongTerrain), undefined);
  const wrongWinner = encodeState(s);
  wrongWinner.winner = "missing";
  assert.equal(decodeState(wrongWinner), undefined);
  assert.equal(decodeState(null), undefined);
});
test("view and preview cannot mutate a match; two match instances remain independent", () => {
  const a = ready(2, 1),
    b = ready(2, 2),
    hash = hashState(a),
    bhash = hashState(b);
  const view = getView(a),
    v = shot(a);
  assert.ok(v.type === "launch");
  assert.ok(projectShot(view, v).length > 0);
  view.terrain.bits.fill(0);
  assert.equal(hashState(a), hash);
  advance(a, [v]);
  assert.equal(hashState(b), bhash);
});
test("swept contacts catch a thin cell even beyond a tick endpoint", () => {
  const s = ready(),
    y = Math.floor(s.players[0]!.y / UNIT) + 12;
  const hit = sweep(s.terrain, 10 * UNIT, 100 * UNIT, 0, y * UNIT, UNIT);
  assert.ok(hit);
  assert.equal(hit.kind, "terrain");
  assert.ok(hit.time.n < hit.time.d);
});
test("terrain cuts are monotonic, bounded and invalidate only changed chunks", () => {
  const s = ready(),
    x = 400,
    y = groundAt(s.terrain, x) + 10;
  assert.equal(solid(s.terrain, x, y), true);
  const removed = carve(s.terrain, x, y, 10);
  assert.ok(removed > 0);
  assert.equal(solid(s.terrain, x, y), false);
  const version = s.terrain.version;
  assert.equal(carve(s.terrain, x, y, 10), 0);
  assert.equal(s.terrain.version, version);
  assert.ok(s.terrain.revisions.some((n) => n > 0));
});
