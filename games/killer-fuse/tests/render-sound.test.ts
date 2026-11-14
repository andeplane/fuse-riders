import test from "node:test";
import assert from "node:assert/strict";
import type { GameEvent } from "../src/engine/index.js";
import {
  planEvent,
  planFlap,
  planLanding,
  type SoundCue,
  type SoundName,
} from "../src/render/effects.js";
import { SfxGate, STINGS } from "../src/render/sound.js";
import { openingView, SIZES, unitView } from "./render-kit.js";

const cue = (name: SoundName, patch: Partial<SoundCue> = {}): SoundCue => ({
  name,
  volume: 1,
  pan: 0,
  ...patch,
});

/** Every name a cue may carry; the gate must have a recipe for each of them. */
const NAMES: readonly SoundName[] = [
  "flap",
  "jump",
  "land",
  "pickup",
  "deposit",
  "kick",
  "bounce",
  "attack",
  "glance",
  "stomp",
  "gateEnter",
  "gateLock",
  "gateUse",
  "gateClaim",
  "kill",
  "queenKill",
  "snailMount",
  "snailCatch",
  "snailEat",
  "respawn",
  "regrow",
  "countdown",
  "go",
  "victoryMilitary",
  "victoryEconomy",
  "victorySnail",
  "defeat",
];

test("every sound has something to play: notes, noise or both", () => {
  const gate = new SfxGate();
  for (const name of NAMES) {
    const voicing = gate.admit(cue(name), 100);
    assert.ok(voicing, name);
    const notes = voicing.recipe.notes?.length ?? 0;
    const hiss = voicing.recipe.hiss?.length ?? 0;
    assert.ok(notes + hiss > 0, `${name} makes no sound`);
    // Short like an arcade cue: nothing may ring on past a second and a half.
    for (const note of voicing.recipe.notes ?? [])
      assert.ok(note.at + note.length <= 2, `${name} rings for too long`);
  }
});

test("a name that just played is held back; a different one is not", () => {
  const gate = new SfxGate();
  assert.ok(gate.admit(cue("flap"), 10), "the first flap sounds");
  assert.equal(
    gate.admit(cue("flap"), 10),
    null,
    "six units flapping is one flap",
  );
  assert.equal(
    gate.admit(cue("flap"), 10.03),
    null,
    "and still one a frame later",
  );
  assert.ok(gate.admit(cue("jump"), 10), "a Worker's jump is its own sound");
  assert.ok(
    gate.admit(cue("flap"), 10.08),
    "the gap passes and the next flap sounds",
  );
});

test("the countdown beeps once a second however often the card is drawn", () => {
  const gate = new SfxGate();
  assert.ok(gate.admit(cue("countdown"), 0));
  for (let frame = 1; frame < 20; frame += 1)
    assert.equal(
      gate.admit(cue("countdown"), frame / 60),
      null,
      `frame ${frame} must not beep again`,
    );
  assert.ok(gate.admit(cue("countdown"), 1));
});

test("clearing the gate lets everything sound again, as a new round does", () => {
  const gate = new SfxGate();
  assert.ok(gate.admit(cue("kill"), 5));
  assert.equal(gate.admit(cue("kill"), 5), null);
  gate.clear();
  assert.ok(gate.admit(cue("kill"), 5));
});

test("a sting takes the stage; a loud effect only ducks the music", () => {
  const gate = new SfxGate();
  for (const name of STINGS) {
    const voicing = gate.admit(cue(name), 100);
    assert.ok(voicing?.sting, `${name} should play alone`);
    assert.ok(voicing.duck, `${name} should duck the music`);
  }
  const killed = gate.admit(cue("kill"), 100);
  assert.equal(killed?.sting, false, "a kill does not stop the music");
  assert.equal(killed?.duck, true, "but the music steps back under it");
  const flap = gate.admit(cue("flap"), 100);
  assert.equal(flap?.duck, false, "a flap changes nothing");
});

test("a cue's loudness and side are kept inside the mixer's range", () => {
  const gate = new SfxGate();
  const left = gate.admit(cue("kill", { volume: 4, pan: -9 }), 1);
  assert.deepEqual(
    [left?.volume, left?.pan],
    [1, -1],
    "a cue off the edge of the arena pans hard left, no further",
  );
  const right = gate.admit(cue("queenKill", { volume: -1, pan: 9 }), 1);
  assert.deepEqual([right?.volume, right?.pan], [0, 1]);
});

/**
 * The audit: every event the engine emits must reach the speakers, or be one of the three that are deliberately
 * silent. `bump` has not been emitted since rules 4; a dropped berry and a snail letting go are the quiet halves
 * of a pair whose other half already sounded.
 */
const SILENT: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "bump",
  "berryDrop",
  "snailFree",
]);

test("every simulation event is heard", () => {
  const view = openingView();
  const events: GameEvent[] = [
    // Not a Queen: her death is announced by `queenKill` on the same step, so a plain `kill` for her is silent.
    { type: "kill", victim: 2, killer: 3 },
    { type: "queenKill", victim: 0, killer: 3, eggsLeft: 2 },
    { type: "bounce", a: 1, b: 2, x: 100, y: 100 },
    { type: "bump", worker: 1, target: 2 },
    { type: "attack", slot: 0 },
    { type: "glance", a: 0, b: 1, x: 100, y: 100 },
    { type: "stomped", slot: 1, by: 2, x: 100, y: 100 },
    { type: "berryPickup", slot: 1, pile: 0 },
    { type: "berryDrop", slot: 1 },
    { type: "berryKick", slot: 1 },
    { type: "depositStart", slot: 1, team: 0, hole: 0 },
    { type: "berryDeposit", slot: 1, team: 0, hole: 0 },
    { type: "berryKickIn", slot: 1, team: 0, hole: 0 },
    { type: "berryRegrow" },
    { type: "gateOffer", slot: 1, gate: 0 },
    { type: "gateLock", slot: 1, gate: 0 },
    { type: "gateUse", slot: 1, gate: 0, kind: "warrior", x: 100, y: 100 },
    { type: "gateClaim", slot: 1, gate: 0, team: 0 },
    { type: "snailMount", slot: 1 },
    { type: "snailCatch", victim: 1, rider: 2 },
    { type: "snailEat", victim: 1, rider: 2 },
    { type: "snailFree", victim: 1 },
    { type: "respawn", slot: 1, egg: 0 },
    { type: "victory", team: 0, kind: "military" },
  ];
  const gate = new SfxGate();
  for (const event of events) {
    const plan = planEvent(event, view, 1, SIZES);
    if (SILENT.has(event.type)) {
      assert.deepEqual(plan.sounds, [], `${event.type} is meant to be silent`);
      continue;
    }
    assert.ok(plan.sounds.length > 0, `${event.type} makes no sound`);
    for (const sound of plan.sounds)
      assert.ok(
        gate.admit(sound, 1000 + events.indexOf(event) * 10),
        `${event.type} has no recipe for ${sound.name}`,
      );
  }
  // The names above are the whole union: a new event kind fails this until it is given a sound or named silent.
  const covered = new Set(events.map((event) => event.type));
  const all: GameEvent["type"][] = [
    "kill",
    "queenKill",
    "bounce",
    "bump",
    "attack",
    "glance",
    "stomped",
    "berryPickup",
    "berryDrop",
    "berryKick",
    "depositStart",
    "berryDeposit",
    "berryKickIn",
    "berryRegrow",
    "gateOffer",
    "gateLock",
    "gateUse",
    "gateClaim",
    "snailMount",
    "snailCatch",
    "snailEat",
    "snailFree",
    "respawn",
    "victory",
  ];
  for (const type of all) assert.ok(covered.has(type), `${type} is untested`);
});

test("a flap, a jump and a landing are heard too, the local player's loudest", () => {
  const queen = unitView({ slot: 0, kind: "queen" });
  const worker = unitView({ slot: 1, kind: "worker" });
  assert.deepEqual(
    planFlap(queen, 0).sounds.map((sound) => sound.name),
    ["flap"],
  );
  assert.deepEqual(
    planFlap(worker, 0).sounds.map((sound) => sound.name),
    ["jump"],
  );
  assert.ok(
    (planFlap(queen, 0).sounds[0]?.volume ?? 0) >
      (planFlap(queen, 4).sounds[0]?.volume ?? 0),
  );
  assert.deepEqual(
    planLanding(worker, 1, 1).sounds.map((sound) => sound.name),
    ["land"],
  );
});

test("the losing side hears the defeat sting, the winning side and a watcher the fanfare", () => {
  const view = openingView();
  const won: GameEvent = { type: "victory", team: 0, kind: "economy" };
  const names = (localSlot: number) =>
    planEvent(won, view, localSlot, SIZES).sounds.map((sound) => sound.name);
  assert.deepEqual(
    names(0),
    ["victoryEconomy"],
    "slot 0 is on the winning team",
  );
  assert.deepEqual(names(2), ["victoryEconomy"]);
  assert.deepEqual(names(1), ["defeat"], "odd slots are team 1");
  assert.deepEqual(
    names(-1),
    ["victoryEconomy"],
    "a watcher hears the winner's",
  );
});
