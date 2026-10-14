import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, type StreamEntries } from "fuse-netcode";
import {
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  type Entry,
} from "../src/online/game.js";
import {
  createArena,
  decodeArena,
  encodeArena,
  stepArena,
  syncKeepers,
} from "../src/engine/arena.js";
import { bombPath } from "../src/engine/bomb.js";
import { decodeMind, freshMind } from "../src/engine/bot-mind.js";
import { landing, navGraph, physics } from "../src/engine/bot-nav.js";
import { POWER_KINDS } from "../src/engine/power-rules.js";
import { grantPower } from "../src/engine/power-ups.js";
import {
  DEFAULT_TUNING,
  S,
  createWorld,
  type Tuning,
} from "../src/engine/world.js";
import { MAPS } from "../src/engine/maps.js";

const SPIRE: Tuning = {
  ...DEFAULT_TUNING,
  map: "spire",
  experiment: "movement",
};

test("Spire bot goals and falling landings use the full map dimensions", () => {
  assert.ok(decodeMind({ ...freshMind(), goalX: 2000 }, SPIRE));
  assert.equal(decodeMind({ ...freshMind(), goalX: 2241 }, SPIRE), undefined);
  const body = createWorld(SPIRE);
  Object.assign(body, {
    x: 1980 * S,
    feet: 1000 * S,
    vx: 0,
    vy: S,
    grounded: false,
  });
  assert.equal(landing(body, MAPS.spire.platforms, physics(SPIRE)), 2);
});

test("zone motion changes navigation even after another setting warmed the cache", () => {
  const on: Tuning = { ...SPIRE, speed: 361 };
  const off: Tuning = {
    ...on,
    jumpPads: "off",
    lifts: "off",
    lowGravity: "off",
  };
  const first = structuredClone(navGraph(on).edges);
  const disabled = structuredClone(navGraph(off).edges);
  assert.notDeepEqual(first, disabled);
  assert.deepEqual(navGraph(on).edges, first);
});

test("Spire bomb forecasts follow the same lift field as live bombs", () => {
  const arena = createArena({ ...SPIRE, powerUps: 0 });
  syncKeepers(arena, [
    { id: "keeper", slot: 0, generation: 1, connected: true },
  ]);
  const bomb = {
    id: 0,
    owner: "keeper",
    kind: "plain" as const,
    x: 660 * S,
    y: 900 * S,
    vx: 0,
    vy: 0,
    fuse: 90,
  };
  arena.bombs.push(bomb);
  arena.keepers[0]!.bomb.cooldown = 150;
  const forecast = bombPath(bomb, 20, arena.tuning).path;
  for (const position of forecast) {
    stepArena(arena);
    assert.deepEqual({ x: bomb.x, y: bomb.y }, position);
  }
  assert.ok(bomb.vy < 0, "the lift pulls the bomb upward");
});

test("a hazard clears every power and its air actions before checkpointing", () => {
  for (const kind of POWER_KINDS) {
    const arena = createArena(SPIRE);
    syncKeepers(arena, [
      { id: "keeper", slot: 0, generation: 1, connected: true },
    ]);
    const keeper = arena.keepers[0]!;
    keeper.spawnGuard = 0;
    Object.assign(keeper.world, {
      x: 300 * S,
      feet: 1221 * S,
      grounded: false,
      vx: 0,
      vy: 0,
    });
    grantPower(keeper, kind, SPIRE.jumpMode);
    stepArena(arena);
    assert.equal(keeper.bomb.fate, "hazard", kind);
    assert.equal(keeper.power.kind, "", kind);
    assert.equal(keeper.world.bonusJumps, 0, kind);
    assert.equal(keeper.world.dash, 0, kind);
    assert.ok(decodeArena(encodeArena(arena)), kind);
  }
});

test("five Spire bots with bombs, powers and hazards replay through chained restores", () => {
  const tuning: Tuning = { ...SPIRE, rules: "score" };
  const room = createRoom("lobby", tuning);
  const entries: Entry[] = Array.from({ length: 5 }, (_, slot): Entry => [
    slot + 1,
    1,
    BOT,
    "add",
    `bot:${slot + 1}`,
    `Bot ${slot + 1}`,
    slot,
  ]);
  entries.push([6, 1, ACTION, "start", "match"]);
  const stream = (values: Entry[]) =>
    new Map<string, StreamEntries<Entry>>([
      ["host", { generation: 1, entries: values }],
    ]);
  foldTick(room, "host", stream(entries));
  let restored = structuredClone(room);
  for (let tick = 0; tick < 500; tick++) {
    foldTick(room, "host", stream([]));
    foldTick(restored, "host", stream([]));
    assert.equal(hash(restored), hash(room), `tick ${tick}`);
    if (tick % 7 === 0) {
      const next = decode(encode(restored), restored.tick);
      assert.ok(next, `tick ${tick} checkpoint`);
      restored = next;
    }
  }
  assert.ok(room.simulation.keepers.some((keeper) => keeper.bomb.thrown > 0));
});
