import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_WIDTH,
  TICK_HZ,
  castleCenter,
  createRound,
  damageScale,
  futureAngle,
  isLoaded,
  step,
  view,
  type RoundState,
  type TickEvent,
} from "../src/engine/index.js";
import { carveCrater, highestGround } from "../src/engine/terrain.js";
import {
  addRocket,
  clearSky,
  placeGate,
  playOut,
  spamInputs,
} from "./engine-helpers.js";

const DEG = Math.PI / 180;

function eventsOf<T extends TickEvent["type"]>(
  events: readonly TickEvent[],
  type: T,
): Extract<TickEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<TickEvent, { type: T }> => e.type === type,
  );
}

function run(
  state: RoundState,
  ticks: number,
  inputs: (s: RoundState) => boolean[] = () => [],
) {
  const all: TickEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(state, inputs(state)));
  return all;
}

test("createRound validates the player count", () => {
  assert.throws(() => createRound({ seed: 1, playerCount: 1 }), RangeError);
  assert.throws(() => createRound({ seed: 1, playerCount: 7 }), RangeError);
  assert.throws(() => createRound({ seed: 1, playerCount: 2.5 }), RangeError);
  for (let n = 2; n <= 6; n++)
    assert.equal(createRound({ seed: 1, playerCount: n }).castles.length, n);
});

test("castles are spread left to right, parked on the ground, and aim at their opponents", () => {
  for (let n = 2; n <= 6; n++) {
    const s = createRound({ seed: 42 + n, playerCount: n });
    const xs = s.castles.map((c) => c.x);
    for (let i = 1; i < n; i++)
      assert.ok(
        (xs[i] ?? 0) - (xs[i - 1] ?? 0) > 150,
        `spread ${xs.join(",")}`,
      );
    assert.ok((xs[0] ?? 0) < 200 && (xs[n - 1] ?? 0) > ARENA_WIDTH - 200);
    for (const c of s.castles) {
      const ground = highestGround(s.terrain, c.x - 32, c.x + 32);
      assert.equal(c.y, ground);
      assert.ok(c.angle >= c.arcMin && c.angle <= c.arcMax);
      assert.equal(c.hp, c.maxHp);
    }
    const first = s.castles[0];
    const last = s.castles[n - 1];
    assert.ok(first && last);
    assert.equal(first.facing, "right");
    assert.ok(first.arcMax < 90 * DEG);
    assert.equal(last.facing, "left");
    assert.ok(last.arcMin > 90 * DEG);
    for (const c of s.castles.slice(1, -1)) {
      assert.equal(c.facing, "both");
      assert.ok(c.arcMin < 30 * DEG && c.arcMax > 150 * DEG);
    }
  }
});

test("the launcher sweeps back and forth across its arc", () => {
  const s = createRound({ seed: 3, playerCount: 3 });
  const c = s.castles[1];
  assert.ok(c);
  let min = Infinity;
  let max = -Infinity;
  let reversals = 0;
  let dir = c.sweepDir;
  for (let i = 0; i < TICK_HZ * 6; i++) {
    step(s);
    min = Math.min(min, c.angle);
    max = Math.max(max, c.angle);
    if (c.sweepDir !== dir) reversals++;
    dir = c.sweepDir;
    assert.ok(c.angle >= c.arcMin - 1e-9 && c.angle <= c.arcMax + 1e-9);
  }
  assert.ok(reversals >= 2, `reversals ${reversals}`);
  assert.ok(max - min > 0.9 * (c.arcMax - c.arcMin));
});

test("pressing when loaded fires a volley of `units` rockets; pressing while reloading does nothing", () => {
  const s = createRound({ seed: 5, playerCount: 2 });
  clearSky(s);
  const c = s.castles[0];
  assert.ok(c);
  assert.equal(isLoaded(c), false, "starts with a short initial reload");
  assert.deepEqual(eventsOf(step(s, [true]), "fired"), []);
  while (!isLoaded(c)) step(s);
  const angle = c.angle;
  const fired = eventsOf(step(s, [true, false]), "fired");
  assert.equal(fired.length, 1);
  assert.equal(fired[0]?.angle, angle);
  assert.equal(fired[0]?.units, c.units);
  assert.equal(isLoaded(c), false);
  run(s, 60);
  assert.equal(c.stats.rocketsFired, c.units);
  assert.equal(c.volleyLeft, 0);
  assert.deepEqual(eventsOf(step(s, [true]), "fired"), [], "still reloading");
  const reload = Math.round(c.reloadTime * TICK_HZ);
  assert.equal(c.reloadTotalTicks, reload);
});

test("rockets fly, carve craters on impact and expire", () => {
  const s = createRound({ seed: 9, playerCount: 2 });
  clearSky(s);
  const before = s.terrain.version;
  const events = run(s, TICK_HZ * 8, (st) =>
    st.tick < TICK_HZ * 3 ? spamInputs(st) : [],
  );
  assert.ok(eventsOf(events, "crater").length > 0);
  assert.ok(s.terrain.version > before);
  run(s, TICK_HZ * 12);
  assert.equal(s.rockets.length, 0, "all rockets landed or left the arena");
});

test("rockets that blow up without a crater report it", () => {
  const s = createRound({ seed: 10, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  // Dig to bedrock, then drop a rocket there: nothing left to carve.
  const x = 800;
  for (let i = 0; i < 40; i++)
    carveCrater(s.terrain, x, s.terrain.surface[x] ?? 0, 30);
  addRocket(s, { owner: 0, x, y: s.terrain.bedrock - 20, vy: 600 });
  let events = run(s, 10);
  assert.deepEqual(
    eventsOf(events, "rocket-exploded").map((e) => [e.owner, e.cause]),
    [[0, "ground"]],
  );
  assert.equal(eventsOf(events, "crater").length, 0);
  // Without gravity a rocket fired upward never comes down and times out in the air.
  addRocket(s, { owner: 1, x, y: 100, vy: -1 });
  events = run(s, Math.round(s.tuning.rocketMaxAge * TICK_HZ) + 2);
  assert.deepEqual(
    eventsOf(events, "rocket-exploded").map((e) => [e.owner, e.cause]),
    [[1, "expired"]],
  );
  assert.equal(s.rockets.length, 0);
});

test("castles settle when the ground under them is blown away", () => {
  const s = createRound({ seed: 12, playerCount: 2 });
  const c = s.castles[0];
  assert.ok(c);
  const y0 = c.y;
  for (let x = c.x - 60; x <= c.x + 60; x += 10)
    carveCrater(s.terrain, x, y0, 30);
  step(s);
  assert.ok(c.y > y0 && c.y < y0 + 30, "falls gradually");
  run(s, TICK_HZ);
  assert.equal(c.y, highestGround(s.terrain, c.x - 32, c.x + 32));
});

test("a rocket passing a gate splits into `multiplier` rockets, once per gate per lineage", () => {
  const s = createRound({ seed: 13, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  const gate = placeGate(s, 600, 200, 5);
  addRocket(s, { x: 560, y: 200, vx: 600, vy: 0 });
  const events = run(s, 30);
  const splits = eventsOf(events, "gate-split");
  assert.equal(splits.length, 1);
  assert.equal(splits[0]?.created, 4);
  assert.equal(s.rockets.length, 5);
  for (const r of s.rockets) assert.deepEqual(r.gates, [gate.id]);
  // Fly the whole swarm back through the same gate: nothing multiplies again.
  for (const r of s.rockets) {
    r.x = 560;
    r.y = 200;
    r.vx = 600;
    r.vy = 0;
  }
  assert.equal(eventsOf(run(s, 30), "gate-split").length, 0);
  assert.equal(s.rockets.length, 5);
});

test("gates keep their distance from each other at spawn, respawn and while drifting (#36)", () => {
  let respawns = 0;
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 8; seed++) {
      playOut({ seed: 36_000 + seed, playerCount: n }, spamInputs, (s) => {
        const { gateSpacing } = s.tuning;
        respawns += eventsOf(s.events, "gate-spawned").length;
        for (const a of s.gates) {
          assert.ok(
            a.minX <= a.x && a.x <= a.maxX,
            `gate ${a.id} left its lane`,
          );
          for (const b of s.gates) {
            if (a.id >= b.id) continue;
            assert.ok(
              Math.abs(a.x - b.x) >= gateSpacing,
              `seed ${seed}, ${n}p, tick ${s.tick}: gates ${a.id} and ${b.id} at x ${a.x} and ${b.x}`,
            );
          }
        }
      });
    }
  }
  assert.ok(respawns > 100, `only ${respawns} respawns`);
});

test("the rocket cap holds and folds capped children into rocket power", () => {
  const s = createRound({
    seed: 14,
    playerCount: 2,
    tuning: { gravity: 0, maxRockets: 30, splitReserve: 0 },
  });
  clearSky(s);
  placeGate(s, 600, 200, 10);
  for (let i = 0; i < 10; i++)
    addRocket(s, { x: 560 - i * 3, y: 170 + i * 6, vx: 600, vy: 0 });
  run(s, 30);
  assert.ok(s.rockets.length <= 30);
  const power = s.rockets.reduce((sum, r) => sum + r.power, 0);
  assert.ok(Math.abs(power - 100) < 1e-9, `total power ${power}`);
});

test("hitting a crate awards its card to the shooter", () => {
  const s = createRound({ seed: 15, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  const c = s.castles[0];
  assert.ok(c);
  const units = c.units;
  s.crates.push({
    id: 999,
    card: "unit",
    x: 700,
    y: 250,
    baseY: 250,
    bobPhase: 0,
    radius: 20,
    spawnTick: 0,
  });
  addRocket(s, { owner: 0, x: 640, y: 250, vx: 600, vy: 0 });
  const taken = eventsOf(run(s, 20), "crate-taken");
  assert.equal(taken.length, 1);
  assert.equal(taken[0]?.castleId, 0);
  assert.equal(c.units, units + 1);
  assert.equal(s.crates.length, 0);
});

test("shields absorb damage and pop; direct hits damage the castle", () => {
  const s = createRound({ seed: 16, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  const target = s.castles[1];
  assert.ok(target);
  target.shieldHp = 2;
  const center = castleCenter(target, s.tuning);
  addRocket(s, { owner: 0, x: center.x, y: center.y - 150, vx: 0, vy: 600 });
  let events = run(s, 20);
  const shieldHits = eventsOf(events, "hit");
  assert.equal(shieldHits.length, 1);
  assert.equal(shieldHits[0]?.shielded, true);
  assert.equal(eventsOf(events, "shield-popped").length, 1);
  assert.equal(target.hp, target.maxHp);

  addRocket(s, { owner: 0, x: center.x, y: center.y - 150, vx: 0, vy: 600 });
  events = run(s, 20);
  const hits = eventsOf(events, "hit");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.shielded, false);
  assert.equal(target.hp, target.maxHp - s.tuning.rocketDamage);
  assert.equal(s.castles[0]?.stats.damageDealt, 2 * s.tuning.rocketDamage);
});

test("own rockets never hurt their own castle", () => {
  const s = createRound({ seed: 17, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  const me = s.castles[0];
  assert.ok(me);
  const center = castleCenter(me, s.tuning);
  addRocket(s, { owner: 0, x: center.x, y: center.y - 150, vx: 0, vy: 600 });
  assert.equal(eventsOf(run(s, 30), "hit").length, 0);
  assert.equal(me.hp, me.maxHp);
});

test("destroying the last opponent ends the round with a winner", () => {
  const s = createRound({ seed: 18, playerCount: 3, tuning: { gravity: 0 } });
  clearSky(s);
  const [a, b, c] = s.castles;
  assert.ok(a && b && c);
  b.hp = 1;
  c.hp = 1;
  for (const t of [b, c]) {
    const center = castleCenter(t, s.tuning);
    addRocket(s, { owner: 0, x: center.x, y: center.y - 50, vx: 0, vy: 600 });
  }
  const events = run(s, 20);
  assert.equal(eventsOf(events, "castle-destroyed").length, 2);
  const over = eventsOf(events, "round-over");
  assert.equal(over.length, 1);
  assert.deepEqual(
    s.result && { winner: s.result.winner, reason: s.result.reason },
    {
      winner: 0,
      reason: "last-standing",
    },
  );
  assert.equal(s.phase, "over");
  assert.equal(a.stats.kills, 2);

  // After the round is over nothing fires and the result is frozen.
  const result = s.result;
  a.reloadTicks = 0;
  assert.equal(
    eventsOf(
      run(s, 120, () => [true, true, true]),
      "fired",
    ).length,
    0,
  );
  assert.equal(s.result, result);
});

test("a simultaneous wipe-out is a draw", () => {
  const s = createRound({ seed: 19, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  const [a, b] = s.castles;
  assert.ok(a && b);
  a.hp = 1;
  b.hp = 1;
  for (const t of [a, b]) {
    const center = castleCenter(t, s.tuning);
    addRocket(s, {
      owner: -1,
      bomb: true,
      x: center.x,
      y: center.y - 50,
      vx: 0,
      vy: 600,
    });
  }
  run(s, 20);
  assert.equal(s.result?.winner, null);
  assert.equal(s.result?.reason, "wipeout");
});

test("the fuse starts sudden death: bombs fall and damage escalates", () => {
  const s = createRound({ seed: 20, playerCount: 2, tuning: { fuseTime: 2 } });
  const before = run(s, 2 * TICK_HZ);
  assert.equal(eventsOf(before, "sudden-death-started").length, 0);
  assert.equal(damageScale(s), 1);
  const events = run(s, 5 * TICK_HZ);
  assert.equal(eventsOf(events, "sudden-death-started").length, 1);
  assert.equal(s.phase, "sudden-death");
  assert.ok(
    s.rockets.some((r) => r.bomb) ||
      eventsOf(events, "crater").some((e) => e.owner === -1),
  );
  assert.ok(damageScale(s) > 1);
});

test("the round is decided on HP at the hard time limit", () => {
  const s = createRound({
    seed: 21,
    playerCount: 3,
    tuning: { fuseTime: 1000, maxRoundTime: 3 },
  });
  clearSky(s);
  const b = s.castles[1];
  const c = s.castles[2];
  assert.ok(b && c);
  b.hp = 150;
  c.hp = 120;
  const events = run(s, 3 * TICK_HZ);
  assert.equal(eventsOf(events, "round-over").length, 1);
  assert.equal(s.result?.reason, "timeout");
  assert.equal(s.result?.winner, 0);

  const tie = createRound({
    seed: 21,
    playerCount: 2,
    tuning: { fuseTime: 1000, maxRoundTime: 1 },
  });
  clearSky(tie);
  run(tie, TICK_HZ);
  assert.equal(tie.result?.winner, null);
});

test("arcs narrow toward the remaining opponents", () => {
  const s = createRound({ seed: 22, playerCount: 3 });
  clearSky(s);
  const mid = s.castles[1];
  const right = s.castles[2];
  assert.ok(mid && right);
  assert.equal(mid.facing, "both");
  right.alive = false;
  step(s);
  assert.equal(mid.facing, "left");
  assert.ok(mid.arcMin > 90 * DEG);
  assert.ok(mid.angle >= mid.arcMin && mid.angle <= mid.arcMax);
});

test("futureAngle predicts the metronome sweep", () => {
  const s = createRound({ seed: 23, playerCount: 4 });
  clearSky(s);
  const ks = [0, 1, 17, 90, 250];
  const expected = ks.map((k) => futureAngle(s, 2, k));
  const seen: number[] = [s.castles[2]?.angle ?? NaN];
  for (let k = 1; k <= 250; k++) {
    step(s);
    seen.push(s.castles[2]?.angle ?? NaN);
  }
  assert.deepEqual(
    expected,
    ks.map((k) => seen[k]),
  );
});

test("the view hides the RNG and the spawn schedule", () => {
  const v = view(createRound({ seed: 24, playerCount: 2 }));
  // @ts-expect-error bots must not see the RNG state
  assert.equal(typeof v.rng, "number");
  // @ts-expect-error nor when the next crate or bomb is due
  assert.equal(typeof v.nextBombTick, "number");
  assert.equal(v.castles.length, 2);
});
