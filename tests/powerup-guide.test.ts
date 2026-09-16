import { POWER_TUNING } from "../src/shared/power-progression.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { POWERUP_GUIDE } from '../src/client/powerup-guide.js';
import { INK_DURATION_TICKS, STAR_DURATION_TICKS, TICK_HZ } from '../src/shared/game.js';
import { DRUNK_DURATION_TICKS } from '../src/shared/drunk.js';
import { defaultRoomSettings, parseRoomSettings } from '../src/shared/room-settings.js';

const entry = (type: string) => {
  const found = POWERUP_GUIDE.find(candidate => candidate.type === type);
  assert.ok(found, `missing guide entry for ${type}`);
  return found;
};

test('power-up guide lists each room-configurable pickup exactly once', () => {
  const types = POWERUP_GUIDE.map(candidate => candidate.type);
  assert.equal(new Set(types).size, types.length);
  const weights = Object.fromEntries(types.map(type => [type, 1]));
  // parseRoomSettings rejects unknown pickup types, so every guide entry is a real configurable pickup.
  assert.deepEqual(parseRoomSettings({ version: 1, mode: 'devices', match: 'wins', length: 3, weights })?.weights, weights);
  for (const candidate of POWERUP_GUIDE) assert.ok(candidate.name && candidate.description, candidate.type);
});

test('power-up guide default-spawn flags match what a new room spawns', () => {
  const spawning = Object.entries(defaultRoomSettings().weights).filter(([, weight]) => weight > 0).map(([type]) => type).sort();
  assert.deepEqual(POWERUP_GUIDE.filter(candidate => candidate.spawnsByDefault).map(candidate => candidate.type).sort(), spawning);
  assert.equal(entry('star').spawnsByDefault, false);
  // The TV lobby legend lays these out two per row beside the QR card; past this the host's START RACE leaves the
  // 960px viewport. Adding a pickup means checking that layout, not just bumping the number (#166).
  assert.ok(POWERUP_GUIDE.filter(candidate => candidate.spawnsByDefault).length <= 16, 'the TV lobby legend fits sixteen default-spawning pickups');
});

test('power-up guide durations follow the simulation constants', () => {
  const seconds = (ticks: number) => `${ticks / TICK_HZ}s`;
  assert.match(entry('beer').description, new RegExp(`${seconds(DRUNK_DURATION_TICKS)}$`));
  assert.match(entry('ink').description, new RegExp(`${seconds(INK_DURATION_TICKS)}$`));
  assert.match(entry('star').description, new RegExp(`${seconds(STAR_DURATION_TICKS)}$`));
});

test('power guide explains the configured level threshold', () => { assert.ok(entry('power').description.includes(`collect ${POWER_TUNING.pickupsPerLevel} to level up`)); });
