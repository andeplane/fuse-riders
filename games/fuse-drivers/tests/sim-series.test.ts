import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../src/game/sim/config.js';
import { createRace } from '../src/game/sim/race.js';
import { applyRace, botShop, buy, createSeries, standings, statsFor, NO_LEVELS } from '../src/game/sim/series.js';
import { parseTrack } from '../src/game/sim/track.js';

const track = parseTrack(JSON.parse(readFileSync('games/fuse-drivers/tracks/refinery.tmj', 'utf8')), 'refinery');

test('a scripted five-race series accumulates points and money and ranks by points then money', () => {
  let s = createSeries(['refinery', 'sump', 'sidewinder'], 3, 9);
  assert.equal(s.tracks.length, 5);
  assert.equal(new Set(s.tracks.slice(0, 3)).size, 3, 'no repeats until the pool is exhausted');
  for (let r = 0; r < 5; r++) {
    const state = { ...createRace(track, r, Array(3).fill(statsFor(NO_LEVELS))), placements: [2, 0, 1] };
    state.trucks[2] = { ...state.trucks[2], kills: 1 };
    s = applyRace(s, state);
  }
  assert.equal(s.raceIndex, 5);
  assert.deepEqual(standings(s).map((d) => d.slot), [2, 0, 1]);
  const spent = { ...s, drivers: s.drivers.map((d) => ({ ...d, points: 10, money: d.slot === 2 ? 0 : d.money })) };
  assert.equal(standings(spent)[0].slot, 2, 'tie-break is money earned, not money left');
  assert.equal(s.drivers[2].points, 5 * config.points[0]);
  assert.equal(s.drivers[2].money, 5 * (config.prize[0] + config.killBonus));
  assert.equal(s.drivers[1].money, 5 * config.prize[2]);
});

test('shop rejects unaffordable and over-level purchases; max upgrades hit the documented stats', () => {
  const poor = { slot: 0, money: 100, earned: 100, points: 0, kills: 0, deaths: 0, lapsLed: 0, nitrosUsed: 0, levels: { ...NO_LEVELS } };
  assert.equal(buy(poor, 'topSpeed'), null);
  const rich = { ...poor, money: 100000 };
  let d = rich;
  for (let i = 0; i < 5; i++) d = buy(d, 'topSpeed')!;
  assert.equal(buy(d, 'topSpeed'), null);
  for (let i = 0; i < 3; i++) d = buy(d, 'armor')!;
  assert.equal(buy(d, 'armor'), null);
  const st = statsFor(d.levels);
  assert.equal(st.topSpeed, 250);
  assert.equal(st.maxArmor, 7);
  assert.ok(Math.abs(st.mass - 1.45) < 1e-9);
});

test('bots spend until nothing is affordable', () => {
  const d = botShop({ slot: 1, money: 2000, earned: 2000, points: 0, kills: 0, deaths: 0, lapsLed: 0, nitrosUsed: 0, levels: { ...NO_LEVELS } });
  assert.equal(d.levels.nitro, 3, 'three $500 nitros are the cheapest buys');
  assert.equal(d.money, 500);
  assert.equal(d.levels.topSpeed, 0, 'the next cheapest row costs $600');
  assert.ok(Math.abs(statsFor({ ...NO_LEVELS, tires: 5 }).turnRateHigh - (270 * Math.PI) / 180) < 1e-9);
});
