import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMatch, loadMap } from "../src/engine/index.js";
import { createCueTracker } from "../src/app/audio.js";
import { minimapCell, minimapMarkup } from "../src/render/minimap.js";
import { hexCenter } from "../src/render/board.js";
import { structureArt } from "../src/render/art.js";

function world() {
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
    [{ id: "solo", slot: 0 }],
  );
}

test("minimap navigation maps every tile back to itself and clamps outside clicks", () => {
  const w = world();
  const width = Math.sqrt(3) * 35 * (w.map.width + 0.5) + 35;
  const height = hexCenter(w.map.width, w.map.cells.length - 1).y + 35;
  w.map.cells.forEach((_, cell) => {
    const p = hexCenter(w.map.width, cell);
    assert.equal(minimapCell(w, p.x / width, p.y / height), cell);
  });
  assert.equal(minimapCell(w, -5, -5), 0);
  assert.equal(minimapCell(w, 5, 5), w.map.cells.length - 1);
  assert.match(minimapMarkup(w), /class="minimap-view"/);
});

test("tower identities are distinct across the shared presentation contract", () => {
  assert.equal(
    new Set(
      ["tower", "siege", "relay"].map((kind) =>
        structureArt(kind as "tower" | "siege" | "relay"),
      ),
    ).size,
    3,
  );
  assert.equal(structureArt("brain"), "brain-v3");
  assert.equal(structureArt("neuron"), "neuron-v3");
});

test("audio cues follow resolved events once, remain bounded and ignore rollback bursts", () => {
  const w = world();
  const cues = createCueTracker();
  assert.deepEqual(cues(w, "solo"), []);
  w.tick++;
  w.outcomes = Array.from({ length: 100 }, () => ({
    type: "damage",
    tick: w.tick,
    playerId: "solo",
    cell: 1,
    amount: 2,
  }));
  w.outcomes.push({
    type: "constructed",
    tick: w.tick,
    playerId: "solo",
    cell: 2,
  });
  assert.deepEqual(cues(w, "solo"), ["attack", "build"]);
  assert.deepEqual(cues(w, "solo"), []);
  w.tick = 0;
  assert.deepEqual(cues(w, "solo"), []);
  w.tick = 1;
  w.finished = true;
  w.winnerId = "solo";
  assert.deepEqual(cues(w, "solo"), ["victory"]);
  w.tick++;
  w.outcomes = [];
  assert.deepEqual(cues(w, "solo"), []);
});
