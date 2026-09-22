import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  createMatch,
  decodeState,
  encodeState,
  hashState,
  candidateVector,
  UNIT,
  WIDTH,
} from "../src/engine/index.js";
import {
  crateLanding,
  scheduleCrate,
  searchCrate,
} from "../src/engine/crate-search.js";
import { generateTerrain } from "../src/engine/terrain.js";
import { traceCrateShot } from "../src/engine/level.js";
function ready() {
  const s = createMatch(
    "crates",
    123,
    Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Bird ${i}` })),
  );
  while (s.phase === "preparing") advance(s);
  assert.equal(s.phase, "aiming");
  return s;
}
test("supply search survives a checkpoint, stays within its tick quota and delivers a descending crate", () => {
  const s = ready();
  scheduleCrate(s);
  assert.ok(s.crateSearch);
  const hash = hashState(s);
  scheduleCrate(s);
  assert.equal(
    hashState(s),
    hash,
    "a second request must neither replace work nor consume randomness",
  );
  const restored = decodeState(encodeState(s));
  assert.ok(restored);
  for (let i = 0; s.crateSearch && i < 100; i++) {
    const job = s.crateSearch,
      before = job.work;
    advance(s);
    advance(restored);
    assert.ok(job.work - before <= 2200);
    assert.ok(job.work <= 100_000);
    assert.equal(hashState(s), hashState(restored));
  }
  assert.equal(s.crateSearch, null);
  assert.equal(s.crates.length, 1);
  const crate = s.crates[0]!,
    startY = crate.y;
  advance(s);
  assert.equal(crate.grounded, false);
  assert.ok(crate.y > startY);
  for (let i = 0; i < 170; i++) advance(s);
  assert.equal(crate.grounded, true);
  assert.ok(decodeState(encodeState(s)));
});
test("invalid, flooded or exhausted crate searches skip drops without changing healthy terrain", () => {
  const s = ready();
  scheduleCrate(s);
  const valid = encodeState(s),
    terrain = s.terrain.bits.slice();
  const invalid = encodeState(s);
  invalid.crateSearch!.sites[0] = -1;
  assert.equal(decodeState(invalid), undefined);
  s.crateSearch!.work = 100_000;
  searchCrate(s);
  assert.equal(s.crateSearch, null);
  assert.equal(s.crates.length, 0);
  assert.deepEqual(s.terrain.bits, terrain);
  const flooded = decodeState(valid)!;
  flooded.water = 300;
  searchCrate(flooded);
  assert.equal(flooded.crateSearch, null);
  assert.equal(flooded.crates.length, 0);
  const full = ready();
  full.crates = [1, 2, 3].map((id) => ({
    id,
    x: 20000,
    y: 20000,
    vy: 0,
    grounded: false,
  }));
  full.nextEntity = 4;
  scheduleCrate(full);
  assert.equal(full.crateSearch, null);
});
test("a ledge-supported crate lands at its certified full-width position and the witness really collects it", () => {
  const state = ready();
  state.terrain = generateTerrain(123, 5, true).terrain;
  // A one-cell ledge inside the crate's left edge is twenty cells above its center column's ground.
  const index = 430 * WIDTH + 495;
  state.terrain.bits[index >>> 3]! |= 1 << (index & 7);
  const landing = crateLanding(state, 500);
  assert.ok(landing);
  assert.equal(landing.crate.y, 425 * UNIT - 1);
  state.crates.push({ ...landing.crate, y: landing.spawnY, grounded: false });
  state.nextEntity++;
  for (let tick = 0; tick < 250 && !state.crates[0]!.grounded; tick++)
    advance(state);
  assert.equal(state.crates[0]!.grounded, true);
  assert.equal(state.crates[0]!.y, landing.crate.y);
  const from = state.players[state.active]!;
  let collected = false;
  for (let index = 0; index < 201 && !collected; index++) {
    const vector = candidateVector(from, state.crates[0]!, state.wind, index);
    if (
      !vector ||
      !traceCrateShot(
        state.terrain,
        state.players,
        from,
        vector,
        state.wind,
        state.crates,
        state.crates[0]!,
      ).hit
    )
      continue;
    const copy = decodeState(encodeState(state))!;
    let facts = advance(copy, [
      {
        type: "launch",
        actor: from.id,
        round: copy.round,
        turn: copy.turn,
        ordinal: from.ordinal + 1,
        weapon: "pebble",
        ...vector,
      },
    ]);
    for (let tick = 0; tick < 220; tick++) {
      if (
        facts.some((fact) => fact.type === "pickup" && fact.actor === from.id)
      ) {
        collected = true;
        break;
      }
      if (copy.turn !== state.turn) break;
      facts = advance(copy);
    }
    assert.ok(
      collected,
      "an admitted crate witness must reproduce an actual live pickup",
    );
  }
  assert.ok(
    collected,
    "the uneven support fixture has a usable Pebble witness",
  );
});
