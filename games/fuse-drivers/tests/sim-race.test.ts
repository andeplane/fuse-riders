import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BASE_STATS, config } from '../src/game/sim/config.js';
import { NEUTRAL_INPUT, type TruckInput } from '../src/game/sim/input.js';
import { reaches } from '../src/game/sim/geometry.js';
import { createRace, crosses, step, type RaceState } from '../src/game/sim/race.js';
import { parseTrack } from '../src/game/sim/track.js';

const track = parseTrack(JSON.parse(readFileSync('games/fuse-drivers/tracks/refinery.tmj', 'utf8')), 'refinery');

function canonical(v: unknown): string {
  return JSON.stringify(v, (_, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));
}
const hash = (s: RaceState) => createHash('sha256').update(canonical(s)).digest('hex').slice(0, 16);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}

/** Scripted inputs: two trucks, one steering a wobble, one holding right and nitro. */
const script = (tick: number, slot: number): TruckInput => {
  if (slot === 0) return { ...NEUTRAL_INPUT, right: tick % 40 < 12, left: tick % 40 >= 30, nitro: tick === 100 };
  return { ...NEUTRAL_INPUT, right: tick % 30 < 20, nitro: tick > 85 };
};

function replay(ticks: number) {
  let s = createRace(track, 42, [BASE_STATS, BASE_STATS]);
  for (let i = 0; i < ticks; i++) s = step(deepFreeze(s), [script(s.tick, 0), script(s.tick, 1)], track).state;
  return s;
}

test('replay is deterministic and matches the recorded hash', () => {
  const a = replay(600), b = replay(600);
  assert.equal(hash(a), hash(b));
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
  // Update this hash on purpose only, and say so in the commit message (AGENTS.md).
  assert.equal(hash(a), 'ff25a6f85bec7656');
});

test('countdown holds trucks and rocket start arms a boost', () => {
  let s = createRace(track, 1);
  const x0 = s.trucks[0].x;
  for (let i = 0; i < config.countdownTicks - 1; i++) s = step(s, [{ ...NEUTRAL_INPUT, nitro: i > 80 }], track).state;
  assert.equal(s.phase, 'countdown');
  assert.equal(s.trucks[0].x, x0);
  assert.equal(s.trucks[0].boostUntilTick, config.countdownTicks + config.truck.boostTicks);
  s = step(s, [NEUTRAL_INPUT], track).state;
  assert.equal(s.phase, 'racing');
});

test('crosses detects segment intersection in either direction', () => {
  const seg = { a: { x: 0, y: -10 }, b: { x: 0, y: 10 } };
  assert.ok(crosses({ x: -1, y: 0 }, { x: 1, y: 0 }, seg));
  assert.ok(crosses({ x: 1, y: 0 }, { x: -1, y: 0 }, seg));
  assert.ok(!crosses({ x: 1, y: 0 }, { x: 2, y: 0 }, seg));
});

test('reaches counts a move that stops exactly on a checkpoint once', () => {
  const line = { a: { x: 0, y: -1 }, b: { x: 0, y: 1 } };
  // A wall slide left a bot exactly on the refinery.reverse finish line; strict crossing missed the lap.
  assert.ok(reaches({ x: 2, y: 0 }, { x: 0, y: 0 }, line));
  assert.ok(!reaches({ x: 0, y: 0 }, { x: -2, y: 0 }, line));
  assert.ok(reaches({ x: 2, y: 0 }, { x: -2, y: 0 }, line));
  assert.ok(!reaches({ x: 2, y: 0 }, { x: 1, y: 0 }, line));
});

test('walls keep a truck on the track and penalise contact', () => {
  let s = createRace(track, 1);
  s = { ...s, phase: 'racing' };
  const r = config.truck.radius;
  for (let i = 0; i < 300; i++) s = step(s, [{ ...NEUTRAL_INPUT, left: true }], track).state;
  const t = s.trucks[0];
  for (const w of track.walls) {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, len2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((t.x - w.a.x) * dx + (t.y - w.a.y) * dy) / len2));
    assert.ok(Math.hypot(t.x - (w.a.x + u * dx), t.y - (w.a.y + u * dy)) >= r - 1e-6);
  }
  assert.ok(t.speed < t.stats.topSpeed);
});

test('a truck driven along the waypoints completes laps in order and finishes', () => {
  let s: RaceState = { ...createRace(track, 7), phase: 'racing' };
  let wp = 1;
  let laps: number[] = [];
  for (let i = 0; i < 30 * 120 && s.phase !== 'finished'; i++) {
    const t = s.trucks[0];
    const target = track.waypoints[wp % track.waypoints.length];
    if (Math.hypot(target.x - t.x, target.y - t.y) < 60) wp++;
    const want = Math.atan2(target.y - t.y, target.x - t.x);
    const err = Math.atan2(Math.sin(want - t.heading), Math.cos(want - t.heading));
    const r = step(s, [{ ...NEUTRAL_INPUT, left: err < -0.1, right: err > 0.1 }], track);
    s = r.state;
    laps.push(...r.events.filter((e) => e.type === 'lap').map((e) => e.tick));
    assert.ok(!r.events.some((e) => e.type === 'wrongWay'), `wrong way at tick ${s.tick}`);
  }
  assert.equal(laps.length, config.laps);
  assert.equal(s.phase, 'finished');
  assert.equal(s.placements[0], 0);
  assert.ok(s.trucks[0].finishedTick > 0);
});

test('landing on another truck spins it out without damage', () => {
  let s: RaceState = { ...createRace(track, 1, [BASE_STATS, BASE_STATS]), phase: 'racing', tick: 100 };
  const lander = { ...s.trucks[0], x: 700, y: 437, heading: 0, speed: 300, airborneUntilTick: 101, landAtTick: 101 };
  const victim = { ...s.trucks[1], x: 715, y: 437, heading: 0, speed: 300 };
  s = { ...s, trucks: [lander, victim] };
  const r = step(s, [NEUTRAL_INPUT, NEUTRAL_INPUT], track);
  assert.ok(r.state.trucks[1].spinUntilTick > r.state.tick);
  assert.equal(r.state.trucks[1].armor, victim.armor);
  assert.ok(r.events.some((e) => e.type === 'hit' && e.item === 'landing'));
});

// The upstream 'runner is frame-rate independent and bounds catch-up' test covered src/shared/runner.ts,
// which this port leaves behind: the monorepo owns the fixed-step loop.
