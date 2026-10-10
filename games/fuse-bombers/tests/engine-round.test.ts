import test from "node:test";
import assert from "node:assert/strict";
import {
  TICK_HZ,
  castleCenter,
  createRound,
  damageScale,
  FIRE,
  futureAngle,
  gridHash,
  isLoaded,
  step,
  view,
  type RoundState,
  type TickEvent,
} from "../src/engine/index.js";
import {
  carveCircle,
  cellSolid,
  circleOverlapsSolid,
  fillRect,
  type Grid,
} from "../src/engine/grid.js";
import { bombStartY, crateBox, gateBox } from "../src/engine/round.js";
import { skyZones, spawnOrder, type Rect } from "../src/engine/temple-map.js";
import {
  addRocket,
  clearSky,
  held,
  openWorld,
  placeGate,
  playOut,
  spamInputs,
  type Inputs,
} from "./engine-helpers.js";

const TAU = 2 * Math.PI;

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
  inputs: (s: RoundState) => Inputs = () => [],
) {
  const all: TickEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(state, held(inputs(state))));
  return all;
}

/** Cells whose centre lies within `r` of (`x`, `y`) that are still rock. */
function rockWithin(grid: Grid, x: number, y: number, r: number): number {
  let n = 0;
  const c = grid.cell;
  for (let row = Math.floor((y - r) / c); row <= (y + r) / c; row++)
    for (let col = Math.floor((x - r) / c); col <= (x + r) / c; col++) {
      const [cx, cy] = [(col + 0.5) * c, (row + 0.5) * c];
      if (Math.hypot(cx - x, cy - y) <= r && cellSolid(grid, col, row)) n++;
    }
  return n;
}

/** Whether any rock cell touches the box. */
function rockIn(grid: Grid, b: Rect): boolean {
  const c = grid.cell;
  for (let row = Math.floor(b.y0 / c); row * c < b.y1; row++)
    for (let col = Math.floor(b.x0 / c); col * c < b.x1; col++)
      if (cellSolid(grid, col, row)) return true;
  return false;
}

const inside = (b: Rect, z: Rect) =>
  b.x0 >= z.x0 && b.x1 <= z.x1 && b.y0 >= z.y0 && b.y1 <= z.y1;
const overlap = (a: Rect, b: Rect, gap: number) =>
  a.x0 < b.x1 + gap &&
  b.x0 < a.x1 + gap &&
  a.y0 < b.y1 + gap &&
  b.y0 < a.y1 + gap;

test("createRound validates the player count", () => {
  assert.throws(() => createRound({ seed: 1, playerCount: 1 }), RangeError);
  assert.throws(() => createRound({ seed: 1, playerCount: 7 }), RangeError);
  assert.throws(() => createRound({ seed: 1, playerCount: 2.5 }), RangeError);
  assert.throws(() => createRound({ seed: NaN, playerCount: 2 }), RangeError);
  for (let n = 2; n <= 6; n++)
    assert.equal(createRound({ seed: 1, playerCount: n }).castles.length, n);
});

test("createRound refuses an aimPeriod the launcher cannot turn by", () => {
  const period = (aimPeriod: number) => () =>
    createRound({ seed: 1, playerCount: 2, tuning: { aimPeriod } });
  // Zero is an infinite angle per tick, NaN and Infinity poison or freeze it, and anything under two ticks a turn
  // is more than `turnLauncher`'s single wrap-around subtraction can bring back into [0, 2π).
  for (const bad of [0, -3.6, NaN, Infinity, -Infinity, 1 / TICK_HZ, 1e-9])
    assert.throws(period(bad), RangeError, `${bad}`);
  // The shortest accepted period still keeps every angle in range.
  const s = createRound({
    seed: 1,
    playerCount: 2,
    tuning: { aimPeriod: 2 / TICK_HZ },
  });
  for (let i = 0; i < 100; i++) {
    step(s);
    for (const c of s.castles)
      assert.ok(c.angle >= 0 && c.angle < TAU, `angle ${c.angle}`);
  }
});

test("castles hover at the seed's spawn anchors, clear of rock, launchers anywhere on the circle", () => {
  for (let n = 2; n <= 6; n++) {
    const s = createRound({ seed: 42 + n, playerCount: n });
    assert.deepEqual(
      s.castles.map((c) => ({ x: c.x, y: c.y })),
      spawnOrder(n, 42 + n),
    );
    for (const c of s.castles) {
      const r = s.tuning.castleRadius;
      assert.equal(circleOverlapsSolid(s.terrain, c.x, c.y, r), false);
      assert.ok(c.angle >= 0 && c.angle < TAU);
      assert.equal(c.hp, c.maxHp);
    }
    const before = s.castles.map((c) => [c.x, c.y]);
    run(s, TICK_HZ * 2);
    assert.deepEqual(
      s.castles.map((c) => [c.x, c.y]),
      before,
      "castles hover in place",
    );
  }
});

test("the launcher turns counter-clockwise, a full circle per aimPeriod", () => {
  const s = createRound({ seed: 3, playerCount: 3 });
  const c = s.castles[1];
  assert.ok(c);
  const period = Math.round(s.tuning.aimPeriod * TICK_HZ);
  const start = c.angle;
  let turned = 0;
  let wraps = 0;
  for (let i = 0; i < period; i++) {
    const before = c.angle;
    step(s);
    assert.ok(c.angle >= 0 && c.angle < TAU, `angle ${c.angle}`);
    let delta = c.angle - before;
    if (delta < 0) {
      wraps++;
      delta += TAU;
    }
    assert.ok(Math.abs(delta - TAU / period) < 1e-9, `step ${delta}`);
    turned += delta;
  }
  assert.equal(wraps, 1);
  assert.ok(Math.abs(turned - TAU) < 1e-6);
  assert.ok(Math.abs(c.angle - start) < 1e-6);
});

test("pressing when loaded fires a volley of `units` rockets; pressing while reloading does nothing", () => {
  const s = createRound({ seed: 5, playerCount: 2 });
  clearSky(s);
  const c = s.castles[0];
  assert.ok(c);
  assert.equal(isLoaded(c), false, "starts with a short initial reload");
  assert.deepEqual(eventsOf(step(s, [FIRE]), "fired"), []);
  while (!isLoaded(c)) step(s);
  const angle = c.angle;
  const fired = eventsOf(step(s, [FIRE, 0]), "fired");
  assert.equal(fired.length, 1);
  assert.equal(fired[0]?.angle, angle);
  assert.equal(fired[0]?.units, c.units);
  assert.equal(isLoaded(c), false);
  run(s, 60);
  assert.equal(c.stats.rocketsFired, c.units);
  assert.equal(c.volleyLeft, 0);
  assert.deepEqual(eventsOf(step(s, [FIRE]), "fired"), [], "still reloading");
  const reload = Math.round(c.reloadTime * TICK_HZ);
  assert.equal(c.reloadTotalTicks, reload);
});

test("a volley leaves at the angle the player saw, whichever way it points", () => {
  for (const angle of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI, 5.9]) {
    const s = createRound({ seed: 6, playerCount: 2 });
    clearSky(s);
    openWorld(s);
    const c = s.castles[0];
    assert.ok(c);
    c.reloadTicks = 0;
    c.angle = angle;
    const fired = eventsOf(step(s, [FIRE]), "fired");
    assert.equal(fired[0]?.angle, angle);
    const r = s.rockets[0];
    assert.ok(r);
    const speed = Math.hypot(r.vx, r.vy);
    // Within the per-rocket spread (and one tick of gravity) of the launcher's direction.
    assert.ok(Math.abs(r.vx / speed - Math.cos(angle)) < 0.05, `${angle}`);
    assert.ok(Math.abs(-r.vy / speed - Math.sin(angle)) < 0.05, `${angle}`);
  }
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
  assert.equal(s.rockets.length, 0, "all rockets landed or left the world");
});

test("a rocket stops where it enters rock and carves a circle there", () => {
  const s = createRound({ seed: 11, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
  fillRect(s.terrain, 2000, 1000, 2400, 1400, "rock");
  // Fast enough to cross several cells per sub-step: it must still stop at the face.
  addRocket(s, { owner: 0, x: 1801, y: 1202, vx: 3000, vy: 0 });
  const events = run(s, 5);
  const craters = eventsOf(events, "crater");
  assert.equal(craters.length, 1);
  const c = craters[0];
  assert.ok(c);
  assert.deepEqual([Math.round(c.x), c.y, c.owner], [2000, 1202, 0]);
  assert.equal(rockWithin(s.terrain, c.x, c.y, c.radius), 0);
  // The event names the cells that changed, from the left face inwards.
  const cell = s.terrain.cell;
  assert.equal(c.col0, 2000 / cell);
  assert.ok(c.col1 * cell >= c.x + c.radius - cell);
  assert.ok(c.row0 * cell <= c.y - c.radius + cell);
  assert.ok(c.row1 * cell >= c.y + c.radius - cell);
  assert.equal(s.terrain.version, 1);
  assert.equal(s.rockets.length, 0);
});

test("indestructible rock stops rockets without a crater; a wall one cell thick never lets one through", () => {
  const s = createRound({ seed: 10, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
  fillRect(s.terrain, 2000, 1000, 2004, 1400, "hard");
  const hash = gridHash(s.terrain);
  addRocket(s, { owner: 0, x: 1701, y: 1200, vx: 3000, vy: 0 });
  let events = run(s, 10);
  assert.deepEqual(
    eventsOf(events, "rocket-exploded").map((e) => [
      e.owner,
      e.cause,
      Math.round(e.x),
    ]),
    [[0, "ground", 2000]],
  );
  assert.equal(eventsOf(events, "crater").length, 0);
  assert.equal(gridHash(s.terrain), hash);
  // A hard skeleton survives a crater around it; the soft rock beside it goes.
  fillRect(s.terrain, 2004, 1000, 2020, 1400, "rock");
  addRocket(s, { owner: 0, x: 2201, y: 1200, vx: -600, vy: 0, mega: true });
  events = run(s, 20);
  assert.equal(eventsOf(events, "crater").length, 1);
  assert.equal(rockWithin(s.terrain, 2012, 1200, 10), 0);
  for (let y = 1000; y < 1400; y += 4)
    assert.ok(cellSolid(s.terrain, 500, y / 4), `hard cell at ${y}`);
  // Without gravity a rocket fired upward never comes down and times out in the air.
  addRocket(s, { owner: 1, x: 800, y: 100, vy: -1 });
  events = run(s, Math.round(s.tuning.rocketMaxAge * TICK_HZ) + 2);
  assert.deepEqual(
    eventsOf(events, "rocket-exploded").map((e) => [e.owner, e.cause]),
    [[1, "expired"]],
  );
  assert.equal(s.rockets.length, 0);
});

test("rockets leave the world sideways and below, but fall back from above the top", () => {
  const s = createRound({ seed: 12, playerCount: 2 });
  clearSky(s);
  openWorld(s);
  const { width, height } = s.terrain;
  const out = [
    addRocket(s, { x: width - 5, y: 1000, vx: 900 }),
    addRocket(s, { x: 5, y: 1000, vx: -900 }),
    addRocket(s, { x: 3000, y: height - 5, vy: 600 }),
  ];
  const up = addRocket(s, { x: 3000, y: 60, vy: -500 });
  run(s, 30);
  for (const r of out) assert.equal(s.rockets.includes(r), false);
  assert.ok(s.rockets.includes(up) && up.y < 0, "above the top: still flying");
  run(s, TICK_HZ * 2);
  assert.ok(up.y > 60, "it came back down");
});

test("castles hover: blowing the rock round them away does not move them", () => {
  const s = createRound({ seed: 12, playerCount: 2 });
  clearSky(s);
  openWorld(s);
  const c = s.castles[0];
  assert.ok(c);
  const [x, y] = [c.x, c.y];
  fillRect(s.terrain, x - 100, y - 200, x + 100, y - 40, "rock");
  addRocket(s, { owner: 1, x, y: y - 300, vy: 900, mega: true });
  const events = run(s, TICK_HZ);
  assert.ok(eventsOf(events, "crater").length > 0);
  assert.deepEqual([c.x, c.y], [x, y]);
});

test("an explosion in reach splashes a castle with no ground under it; a wreck in open air carves nothing", () => {
  const s = createRound({ seed: 14, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
  const target = s.castles[1];
  assert.ok(target);
  const { x, y } = castleCenter(target);
  // A lone pillar beside a castle in mid-air, its top level with the hull centre.
  fillRect(s.terrain, x + 38, y, x + 50, y + 30, "rock");
  addRocket(s, { owner: 0, x: x + 44, y: y - 300, vy: 900, vx: 0 });
  let events = run(s, 30);
  const splash = eventsOf(events, "hit");
  assert.equal(splash.length, 1);
  assert.equal(splash[0]?.splash, true);
  assert.equal(
    target.hp,
    target.maxHp - s.tuning.rocketDamage * s.tuning.splashFactor,
  );
  const other = s.castles[0];
  assert.ok(other);
  other.hp = 1;
  addRocket(s, { owner: 1, x: other.x, y: other.y - 200, vy: 900 });
  events = run(s, 30);
  assert.equal(eventsOf(events, "castle-destroyed").length, 1);
  assert.equal(eventsOf(events, "crater").length, 0);
});

test("a destroyed castle leaves a big crater in the rock round it", () => {
  const s = createRound({ seed: 15, playerCount: 3, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
  const victim = s.castles[1];
  assert.ok(victim);
  victim.hp = 1;
  const [x, y] = [victim.x, victim.y];
  fillRect(s.terrain, x - 80, y + 36, x + 80, y + 90, "rock");
  addRocket(s, { owner: 0, x, y: y - 200, vy: 900 });
  const craters = eventsOf(run(s, 30), "crater");
  const wreck = craters.find((c) => c.radius === s.tuning.wreckCraterRadius);
  assert.ok(wreck, "a wreck crater");
  assert.deepEqual([wreck.x, wreck.y], [x, y]);
});

test("a rocket passing a gate splits into `multiplier` rockets, once per gate per lineage", () => {
  const s = createRound({ seed: 13, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
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

test("gates and crates float inside the sky zones, clear of rock and of each other", () => {
  let gatesSpawned = 0;
  let cratesSpawned = 0;
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 3; seed++) {
      playOut({ seed: 36_000 + seed, playerCount: n }, spamInputs, (s) => {
        const t = s.tuning;
        const gates = s.gates.map(gateBox);
        const boxes = [...gates, ...s.crates.map(crateBox)];
        const spawned = s.events.filter(
          (e) => e.type === "gate-spawned" || e.type === "crate-spawned",
        );
        for (const e of spawned)
          if (e.type === "gate-spawned") gatesSpawned++;
          else cratesSpawned++;
        const where = `seed ${seed}, ${n}p, tick ${s.tick}`;
        for (const [i, a] of boxes.entries()) {
          assert.ok(
            skyZones.some((z) => inside(a, z)),
            `${where}: no zone`,
          );
          if (spawned.length > 0)
            assert.equal(rockIn(s.terrain, a), false, `${where}: in rock`);
          for (const [j, b] of boxes.entries()) {
            if (j <= i) continue;
            const gap = j < gates.length ? t.gateSpacing : 0;
            assert.equal(overlap(a, b, gap - 1e-6), false, `${where}: overlap`);
          }
        }
        for (const g of s.gates) {
          assert.ok(g.minX <= g.x && g.x <= g.maxX);
          assert.ok(Math.abs(g.y - g.baseY) <= g.bobAmp + 1e-9);
        }
        if (s.tick === 1)
          assert.equal(s.gates.length, t.gateCounts[n], "gates at the start");
      });
    }
  }
  assert.ok(gatesSpawned > 100, `only ${gatesSpawned} gates`);
  assert.ok(cratesSpawned > 50, `only ${cratesSpawned} crates`);
});

test("a crate that finds no room in the sky is tried again within a second, not after a respawn wait", () => {
  const s = createRound({ seed: 37, playerCount: 2 });
  clearSky(s);
  fillRect(s.terrain, 0, 0, s.terrain.width, s.terrain.height, "hard");
  const due = s.tick;
  s.nextCrateTick = due;
  step(s);
  assert.equal(s.crates.length, 0, "no room in solid rock");
  assert.ok(
    s.nextCrateTick > due && s.nextCrateTick <= due + TICK_HZ,
    `retry at ${s.nextCrateTick} after ${due}`,
  );
  // Once the sky has room again, the crate comes with the next retry rather than a 5 to 9 s respawn later.
  openWorld(s);
  const events = run(s, TICK_HZ);
  assert.equal(eventsOf(events, "crate-spawned").length, 1);
  assert.ok(
    s.nextCrateTick >= s.tick + s.tuning.crateRespawn[0] * TICK_HZ - TICK_HZ,
    "a spawned crate waits the full respawn time",
  );
});

test("the rocket cap holds and folds capped children into rocket power", () => {
  const s = createRound({
    seed: 14,
    playerCount: 2,
    tuning: { gravity: 0, maxRockets: 30, splitReserve: 0 },
  });
  clearSky(s);
  openWorld(s);
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
  openWorld(s);
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
  openWorld(s);
  const target = s.castles[1];
  assert.ok(target);
  target.shieldHp = 2;
  const center = castleCenter(target);
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
  openWorld(s);
  const me = s.castles[0];
  assert.ok(me);
  const center = castleCenter(me);
  addRocket(s, { owner: 0, x: center.x, y: center.y - 150, vx: 0, vy: 600 });
  assert.equal(eventsOf(run(s, 30), "hit").length, 0);
  assert.equal(me.hp, me.maxHp);
});

test("destroying the last opponent ends the round with a winner", () => {
  const s = createRound({ seed: 18, playerCount: 3, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
  const [a, b, c] = s.castles;
  assert.ok(a && b && c);
  b.hp = 1;
  c.hp = 1;
  for (const t of [b, c]) {
    const center = castleCenter(t);
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
  openWorld(s);
  const [a, b] = s.castles;
  assert.ok(a && b);
  a.hp = 1;
  b.hp = 1;
  for (const t of [a, b]) {
    const center = castleCenter(t);
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

test("sudden-death bombs appear a fixed height above a living castle, under any ceiling", () => {
  const s = createRound({
    seed: 20,
    playerCount: 3,
    tuning: { fuseTime: 0.1 },
  });
  const grid = s.terrain;
  openWorld(s);
  assert.equal(bombStartY(grid, 1000, 1500, 600), 900);
  assert.equal(bombStartY(grid, 1000, 300, 600), grid.cell, "inside the top");
  fillRect(grid, 900, 1100, 1100, 1200, "rock");
  assert.equal(bombStartY(grid, 1000, 1500, 600), 1200 + grid.cell / 2);
  openWorld(s);
  clearSky(s);
  const { bombHeight, bombScatter } = s.tuning;
  const seen = new Set<number>();
  for (let i = 0; i < 4 * TICK_HZ; i++) {
    step(s);
    for (const r of s.rockets) {
      if (!r.bomb || seen.has(r.id)) continue;
      seen.add(r.id);
      // One step after it appeared: within the scatter and about `bombHeight` above some castle.
      const above = s.castles.some(
        (c) =>
          Math.abs(r.x - c.x) <= bombScatter[0] + 10 &&
          Math.abs(r.y - Math.max(grid.cell, c.y - bombHeight)) < 10,
      );
      assert.ok(above, `bomb at ${r.x}, ${r.y}`);
    }
  }
  assert.ok(seen.size >= 3, `${seen.size} bombs`);
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

test("futureAngle predicts the launcher's turn exactly", () => {
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
  assert.throws(() => futureAngle(s, 9, 1), RangeError);
});

test("the view's terrain can be queried but not written or carved", () => {
  const s = createRound({ seed: 25, playerCount: 2 });
  const grid = view(s).terrain;
  assert.equal(grid.solid.length, s.terrain.solid.length);
  assert.equal(gridHash(grid), gridHash(s.terrain));
  // Compile-time guarantees, so nothing here runs: a bot or renderer holding the view cannot dig or write through it.
  const mutate = () => {
    // @ts-expect-error carveCircle wants the writable Grid
    carveCircle(grid, 0, 0, 1);
    // @ts-expect-error the bitsets are read-only array-likes
    grid.solid[0] = 0;
    // @ts-expect-error and so is the version
    grid.version = 7;
  };
  assert.equal(typeof mutate, "function");
});

test("the view hides the RNG and the spawn schedule", () => {
  const v = view(createRound({ seed: 24, playerCount: 2 }));
  // @ts-expect-error bots must not see the RNG state
  assert.equal(typeof v.rng, "number");
  // @ts-expect-error nor when the next crate or bomb is due
  assert.equal(typeof v.nextBombTick, "number");
  assert.equal(v.castles.length, 2);
});
