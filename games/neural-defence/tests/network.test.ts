import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RuntimeDependencies } from "fuse-netcode";
import { loadMap } from "../src/engine/index.js";
import { createSession } from "../src/online/session.js";
import {
  neuralGame,
  isEntry,
  type NeuralSettings,
} from "../src/online/game.js";
const map = loadMap(
  JSON.parse(
    readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
  ),
);
class Clock implements RuntimeDependencies {
  time = 0;
  serial = 0;
  loops = new Set<() => void>();
  now = () => this.time;
  hidden = () => false;
  token = () => `test-${++this.serial}`;
  generation = () => 1;
  schedule = (callback: () => void) => {
    this.loops.add(callback);
    return () => this.loops.delete(callback);
  };
  onVisibilityChange = () => () => {};
  run(ms: number) {
    for (let i = 0; i < ms; i += 10) {
      this.time += 10;
      for (const loop of this.loops) loop();
    }
  }
}
test("one human starts without bots, advances through shared runtime, and disposes its clock", () => {
  const clock = new Clock();
  const session = createSession(map, 0, "sandbox", {}, clock);
  clock.run(1000);
  assert.equal(session.view().players.length, 1);
  assert.equal(session.view().players[0]?.id, "solo");
  assert.ok(session.view().tick >= 18);
  assert.equal(session.view().finished, false);
  const initial = session.view().tick;
  session.dispatch({ type: "startResearch", research: "growth" });
  clock.run(200);
  assert.ok(session.view().tick > initial);
  session.reset();
  assert.ok(session.view().tick < initial);
  session.dispose();
  assert.equal(clock.loops.size, 0);
});
test("wire rejects malformed commands and checkpoints include management state in hash", () => {
  assert.equal(
    isEntry([1, 1, 1, "match", { type: "setPriority", cell: 0, weight: 999 }]),
    false,
  );
  const settings: NeuralSettings = {
    map,
    slot: 0,
    mode: "sandbox",
    engine: {},
  };
  const room = neuralGame.createRoom("match", settings);
  const hash = neuralGame.hash(room);
  room.stage = "running";
  assert.notEqual(neuralGame.hash(room), hash);
  const fields = neuralGame.checkpoint.encode(room);
  const restored = neuralGame.checkpoint.decode(fields, 0);
  assert.ok(restored);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
  assert.equal(neuralGame.checkpoint.decode(fields, 9), undefined);
  assert.equal(neuralGame.checkpoint.decode(["{}"], 0), undefined);
});
test("combat lab supplies an opposing network and exactly one test tower", () => {
  const lab = loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/combat-lab-12.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const clock = new Clock();
  const session = createSession(lab, 0, "combat-lab", {}, clock);
  assert.equal(session.view().players.length, 2);
  assert.equal(
    session.view().structures.filter((s) => s.kind === "tower").length,
    1,
  );
  clock.run(12_000);
  assert.ok(session.view().players.some((p) => p.statistics.damage > 0));
  session.dispose();
});
