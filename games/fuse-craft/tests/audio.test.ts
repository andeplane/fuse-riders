import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMatch, loadMap } from "../src/engine/index.js";
import { POWERUP_KINDS } from "../src/engine/powerups.js";
import type { Outcome, StructureKind, World } from "../src/engine/types.js";
import {
  ALARM_TICKS,
  EVENT_CUES,
  UI_CUES,
  createCueTracker,
  cueRecipe,
  spatialize,
} from "../src/app/audio.js";

test("each weapon has its own sound, even when the shooter died that tick", () => {
  const { w, next } = duel();
  place(w, 10, "red", "tower");
  place(w, 11, "red", "siege");
  place(w, 12, "red", "spore");
  next([]);
  // The siege fired and was destroyed in the same tick.
  w.structures = w.structures.filter((s) => s.cell !== 11);
  // Spectating, so no alarm joins the weapon cues.
  const cues = next(
    [
      hit("red", 10, 50),
      hit("red", 11, 51),
      hit("red", 12, 52),
      { tick: w.tick, playerId: "red", type: "damage", cell: 53 },
    ],
    "",
  );
  assert.deepEqual(names(cues), ["zap", "artillery", "spore", "attack"]);
  assert.deepEqual(cues[0]!.cells, [10], "fire sounds from its source");
});

test("a hit on the player's network sounds the alarm, then rests", () => {
  const { w, next } = duel();
  place(w, 10, "red", "tower");
  place(w, 50, "blue", "neuron");
  next([]);
  assert.ok(names(next([hit("red", 10, 50)])).includes("alarm"));
  assert.ok(!names(next([hit("red", 10, 50)])).includes("alarm"));
  w.tick += ALARM_TICKS;
  assert.ok(names(next([hit("red", 10, 50)])).includes("alarm"));
  // Its own fire on a rival never alarms the player.
  place(w, 60, "red", "neuron");
  w.tick += ALARM_TICKS;
  assert.ok(!names(next([hit("blue", 50, 60)])).includes("alarm"));
});

test("losses and kills sound different, and elimination is the biggest", () => {
  const { w, next } = duel();
  const cues = next([
    { tick: w.tick + 1, playerId: "blue", type: "destroyed", cell: 4 },
    { tick: w.tick + 1, playerId: "red", type: "destroyed", cell: 5 },
    { tick: w.tick + 1, playerId: "red", type: "eliminated" },
  ]);
  assert.deepEqual(names(cues), ["destroy", "lost", "eliminated"]);
});

test("personal feedback is the player's alone; spectators hear none of it", () => {
  const personal: Outcome["type"][] = [
    "queued",
    "dispatched",
    "researchStarted",
    "rejected",
    "stalled",
  ];
  const { w, next } = duel();
  const outcomes = (playerId: string) =>
    personal.map((type) => ({ tick: w.tick, playerId, type, cell: 3 }));
  assert.deepEqual(names(next(outcomes("red"))), []);
  assert.deepEqual(names(next(outcomes("red"), "")), []);
  assert.deepEqual(names(next(outcomes("blue"))), [
    "place",
    "dispatch",
    "stall",
    "researchStart",
    "invalid",
  ]);
});

test("powerups chime as they appear and when someone claims one", () => {
  const { w, next } = duel();
  w.powerups = [{ id: 1, cell: 30, kind: POWERUP_KINDS[0], expiresAt: 999 }];
  w.powerupSerial++;
  const spawned = next([]);
  assert.deepEqual(names(spawned), ["powerupSpawn"]);
  assert.deepEqual(spawned[0]!.cells, [30]);
  assert.deepEqual(names(next([claim("blue")])), ["powerup"]);
  assert.deepEqual(names(next([claim("red")])), ["powerupRival"]);
});

test("dominance warns the player when a rival takes the map", () => {
  const { w, next } = duel();
  const at = (type: Outcome["type"], playerId: string) => ({
    tick: w.tick,
    playerId,
    type,
  });
  assert.deepEqual(names(next([at("dominating", "blue")])), ["dominating"]);
  assert.deepEqual(names(next([at("dominating", "red")])), ["threat"]);
  assert.deepEqual(names(next([at("dominanceBroken", "red")])), [
    "dominanceBroken",
  ]);
});

test("only a match seen from its opening plays the opening sting", () => {
  const fresh = match();
  assert.deepEqual(names(createCueTracker()(fresh, "blue")), ["matchStart"]);
  const joined = match();
  joined.tick = 400;
  assert.deepEqual(names(createCueTracker()(joined, "blue")), []);
});

test("a tick's events keep a bounded number of positions per cue", () => {
  const { w, next } = duel();
  const cues = next(
    Array.from({ length: 50 }, (_, i) => ({
      tick: w.tick,
      playerId: "red",
      type: "constructed" as const,
      cell: i,
    })),
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0]!.cells.length, 8);
});

test("board sounds pan with the camera and fade off screen", () => {
  const view = { x: 0, y: 0, width: 200, height: 100 };
  assert.deepEqual(spatialize(view, { x: 100, y: 50 }), { pan: 0, gain: 1 });
  const right = spatialize(view, { x: 200, y: 50 });
  assert.ok(right.pan > 0.5 && right.gain === 1);
  assert.ok(spatialize(view, { x: 0, y: 50 }).pan < -0.5);
  const near = spatialize(view, { x: 300, y: 50 });
  const far = spatialize(view, { x: 5000, y: 50 });
  assert.ok(near.gain < 1 && far.gain < near.gain);
  assert.equal(far.gain, 0.15, "distant fighting stays faintly audible");
  assert.ok(Math.abs(far.pan) <= 0.85);
  assert.deepEqual(spatialize({ ...view, width: 0 }, { x: 1, y: 1 }), {
    pan: 0,
    gain: 1,
  });
});

test("every cue has a short, well-formed synthesis recipe", () => {
  for (const cue of [...UI_CUES, ...EVENT_CUES])
    for (const random of [() => 0, () => 0.5, () => 0.999]) {
      const layers = cueRecipe(cue, random);
      assert.ok(layers.length > 0, cue);
      for (const layer of layers) {
        const end = (layer.at ?? 0) + layer.dur;
        assert.ok(layer.dur > 0 && end <= 2.5, `${cue} length`);
        assert.ok(layer.gain > 0 && layer.gain <= 1, `${cue} gain`);
        // Exponential ramps need positive targets.
        const frequencies =
          layer.kind === "tone"
            ? [layer.from, layer.to, layer.filter?.from, layer.filter?.to]
            : [layer.filter.from, layer.filter.to];
        for (const f of frequencies)
          assert.ok(f === undefined || (f > 0 && f < 20_000), `${cue} pitch`);
      }
    }
});

function names(cues: { cue: string }[]) {
  return cues.map((e) => e.cue);
}

function match(): World {
  return createMatch(
    loadMap(
      JSON.parse(
        readFileSync(
          new URL("../maps/skirmish-24.json", import.meta.url),
          "utf8",
        ),
      ),
    ),
    {},
    [
      { id: "blue", slot: 0 },
      { id: "red", slot: 1 },
    ],
  );
}

/** A running two-player match heard by blue; `next` advances one tick. */
function duel() {
  const w = match();
  const track = createCueTracker();
  track(w, "blue");
  const next = (outcomes: Outcome[], local = "blue") => {
    w.tick++;
    w.outcomes = outcomes.map((o) => ({ ...o, tick: w.tick }));
    return track(w, local);
  };
  return { w, next };
}

function place(w: World, cell: number, ownerId: string, kind: StructureKind) {
  w.structures.push({
    id: 10_000 + cell,
    cell,
    ownerId,
    kind,
    hp: 10,
    connected: true,
  });
}

function hit(playerId: string, fromCell: number, cell: number): Outcome {
  return { tick: 0, playerId, type: "damage", cell, fromCell, amount: 1 };
}

function claim(playerId: string): Outcome {
  return { tick: 0, playerId, type: "claimed", cell: 30 };
}
