import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMatch, loadMap } from "../src/engine/index.js";
import { createCueTracker } from "../src/app/audio.js";
import { minimapCell, minimapMarkup } from "../src/render/minimap.js";
import {
  hexCenter,
  neuronArtwork,
  structureArtwork,
} from "../src/render/board.js";
import { structureArt } from "../src/render/art.js";
import { boardSize } from "../src/render/projection.js";

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
  const { width, height } = boardSize(w.map.width, w.map.height);
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

test("neuron anatomy varies with location and remains identical across ghost, world and team", () => {
  const kinds = new Set<string>();
  const shapes = (markup: string) => markup.match(/ d="[^"]+"/g)?.join("");
  for (let cell = 0; cell < 40; cell++) {
    const worldArt = neuronArtwork(12, cell, 0);
    assert.equal(structureArtwork(12, cell, "neuron", 0), worldArt);
    kinds.add(/neuron-body neuron-(\w+)/.exec(worldArt)![1]!);
    const teamArt = neuronArtwork(12, cell, 1);
    assert.equal(
      shapes(teamArt),
      shapes(worldArt),
      "team does not change anatomy",
    );
    assert.notEqual(teamArt, worldArt, "team changes colour");
    assert.doesNotMatch(
      worldArt,
      /<image/,
      "drawn procedurally, not from sprites",
    );
  }
  assert.deepEqual(
    [...kinds].sort(),
    ["bipolar", "granule", "pyramidal", "stellate"],
    "uses genuinely different cell types, not transformed copies",
  );
});

test("spectators hear shared events without personal victory or defeat cues", () => {
  const w = world(),
    track = createCueTracker(),
    cues = (local: string) => track(w, local).map((e) => e.cue);
  assert.deepEqual(cues(""), ["matchStart"]);
  w.tick++;
  w.outcomes = [
    { type: "constructed", tick: w.tick, playerId: "other", cell: 1 },
  ];
  assert.deepEqual(cues(""), ["build"]);
  w.tick++;
  w.outcomes = [];
  w.finished = true;
  w.winnerId = "solo";
  assert.deepEqual(cues(""), []);
});

test("audio cues follow resolved events once, remain bounded and ignore rollback bursts", () => {
  const w = world();
  const track = createCueTracker();
  const cues = (world: typeof w, local: string) =>
    track(world, local).map((e) => e.cue);
  assert.deepEqual(cues(w, "solo"), ["matchStart"]);
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
  w.outcomes = [];
  w.finished = true;
  w.winnerId = "solo";
  assert.deepEqual(cues(w, "solo"), ["victory"]);
  w.tick++;
  w.outcomes = [];
  assert.deepEqual(cues(w, "solo"), []);
});
