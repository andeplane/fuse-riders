import test from "node:test";
import assert from "node:assert/strict";
import { SURGE_AFTER } from "../src/engine/index.js";
import {
  BAR,
  DWELL_SECONDS,
  HEAT,
  LAYERS,
  LOOP,
  LOST_SECONDS,
  MOODS,
  MoodTracker,
  STEP,
  Sequencer,
  type Scene,
} from "../src/app/audio/music.js";

const match = (step = 100): Scene => ({ kind: "match", step });

test("every layer fills the eight-bar loop, and each looping mood's layers exist", () => {
  for (const [name, layer] of Object.entries(LAYERS)) {
    let voices = 0;
    for (let i = 0; i < LOOP; i++)
      voices += layer(i % BAR, Math.floor(i / BAR)).length;
    assert.ok(voices > 0, name);
  }
  for (const layers of Object.values(MOODS))
    for (const layer of layers) assert.ok(layer in LAYERS);
});

test("the sequencer hands each step out once, ahead of time, and switches layers only at a bar line", () => {
  const sequencer = new Sequencer(10, MOODS.calm);
  const first = sequencer.due(10, 0.2);
  assert.ok(first.length > 0);
  assert.ok(first.every(({ at }) => at >= 10 && at < 10.2));
  assert.deepEqual(sequencer.due(10, 0.2), []);
  sequencer.play(MOODS.fight);
  // Mid-bar: still calm until the next bar line.
  sequencer.due(10, 5 * STEP);
  assert.deepEqual(sequencer.playing, MOODS.calm);
  sequencer.due(10, BAR * STEP + 0.01);
  assert.deepEqual(sequencer.playing, MOODS.fight);
  // Pumped in small windows across the loop's wrap, every step comes once, on the grid, with no gap.
  const steady = new Sequencer(0, ["hats"]);
  const times = new Set<number>();
  for (let t = 0; t < (LOOP + 2 * BAR) * STEP; t += 0.05)
    for (const { at } of steady.due(t, 0.2)) times.add(Math.round(at / STEP));
  const hats = [...times].sort((a, b) => a - b);
  assert.ok(hats.every((step, i) => i === 0 || step - hats[i - 1]! === 4));
  assert.ok(hats.at(-1)! > LOOP);
  // A stalled pump skips its backlog: nothing handed out is in the past.
  const late = sequencer.due(100, 0.2);
  assert.ok(late.length > 0 && late.every(({ at }) => at >= 100));
});

test("the mood follows the scene: the lobby's theme, calm laning, fights near the hero, and the outros", () => {
  const mood = new MoodTracker();
  assert.equal(mood.next({ kind: "menu" }, 0), "menu");
  assert.equal(mood.next(match(), 1), "calm");
  // Calm holds until it has played its dwell, then the fight takes over.
  for (let i = 0; i < HEAT.on; i++) mood.combat(3);
  assert.equal(mood.next(match(), 3), "calm");
  for (let i = 0; i < HEAT.on; i++) mood.combat(8);
  assert.equal(mood.next(match(), 8), "fight");
  // Hysteresis: the fight stays while the heat cools above the lower threshold, then calm returns.
  assert.equal(mood.next(match(), 8 + HEAT.halfLife), "fight");
  const quiet = 8 + HEAT.halfLife * Math.log2(HEAT.max / HEAT.off) + 1;
  assert.equal(mood.next(match(), quiet), "calm");
  assert.equal(mood.next({ kind: "over", won: true }, quiet + 1), "victory");
  assert.equal(mood.next({ kind: "over", won: false }, quiet + 2), "defeat");
});

test("tension when this side's structure falls, for a while, and for good in sudden death", () => {
  const mood = new MoodTracker();
  mood.next(match(), 0);
  mood.lost(DWELL_SECONDS);
  assert.equal(mood.next(match(), DWELL_SECONDS), "tension");
  assert.equal(mood.next(match(), DWELL_SECONDS + LOST_SECONDS - 1), "tension");
  assert.equal(mood.next(match(), DWELL_SECONDS + LOST_SECONDS + 1), "calm");
  const late = DWELL_SECONDS * 2 + LOST_SECONDS + 2;
  assert.equal(mood.next(match(SURGE_AFTER), late), "tension");
  assert.equal(mood.next(match(SURGE_AFTER + 1), late + 100), "tension");
});
