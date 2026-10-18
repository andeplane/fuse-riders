import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_WINNER,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  botCommands,
  createWorld,
  stepTick,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";

/**
 * The bot league on the generated maps: one even match of normal bots at each map's own size ends with a winner
 * inside a bound sized to the map. Measured (rules fuse-front-9): Rust Canyon 1v1 7.5 minutes, Glass Lakes 2v2 10.4,
 * Iron Delta 3v3 13.1; each bound is a little over twice that. About a minute of CPU in all, so it has its own file.
 */
const MATCHES = [
  { id: "rust-canyon", size: 1, minutes: 18 },
  { id: "glass-lakes", size: 2, minutes: 24 },
  { id: "iron-delta", size: 3, minutes: 30 },
];

for (const { id, size, minutes } of MATCHES)
  test(`${size}v${size} normal bots on ${id} end with a winner inside ${minutes} minutes`, () => {
    const map = mapById(id);
    const seats = Array.from({ length: 2 * size }, (_, seat) => seat);
    const limit = (minutes * 60 * STEPS_PER_SECOND) / STEPS_PER_TICK;
    let world = createWorld(map, seats, 1);
    for (let tick = 0; tick < limit && world.winner === NO_WINNER; tick++)
      world = stepTick(
        map,
        world,
        world.players.flatMap((p) => botCommands(map, world, p.seat, "normal")),
      );
    assert.ok(world.winner === 0 || world.winner === 1, `${world.winner}`);
  });
