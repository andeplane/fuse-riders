import test from "node:test";
import assert from "node:assert/strict";
import { PRESENCE } from "fuse-netcode";
import {
  MISS,
  SCORE_MODE,
  UP,
  createLibrary,
  createTiming,
  createWorld,
  parseSimfile,
  ranking,
} from "../src/engine/index.js";
import { PLAY } from "../src/online/game.js";
import { fold, run, runTo, started } from "./fixtures/room.js";
import { beatMs, testLibrary } from "./fixtures/songs.js";

/** A file a player might load: a header and one `.sm` chart of four taps, with `notes` in front of its rows. */
const file = (header: string, notes = "", chart = "") =>
  `#TITLE:T;\n${header}\n#NOTES:\n dance-single:\n :\n Hard:\n 8:\n 0:\n${notes}1000\n0100\n0010\n0001\n;${chart}`;

test("a file of unclosed annotations is read in the time its length takes", () => {
  // A hundred thousand open braces cost seconds when each one scanned to the end of the data.
  const began = performance.now();
  const sim = parseSimfile(file("#BPMS:0=120;", "{".repeat(100_000) + "\n"));
  assert.ok(performance.now() - began < 1500);
  assert.equal(sim.charts.length, 1);
  // An annotation that is closed is still taken out of its row.
  const noted = parseSimfile(file("#BPMS:0=120;", "{attack}10[k1]00\n"));
  assert.equal(noted.charts[0]!.notes.length, 5);
});

test("a file's tempo changes and charts are bounded", () => {
  const tempos = Array.from(
    { length: 5000 },
    (_, index) => `${index}=${120 + (index % 7)}`,
  ).join(",");
  const sim = parseSimfile(file(`#BPMS:${tempos};`));
  assert.ok(sim.timing.bpms.length <= 2001, `${sim.timing.bpms.length}`);
  const many = parseSimfile(
    file(
      "#BPMS:0=120;",
      "",
      "\n#NOTES:\n dance-single:\n :\n Easy:\n 1:\n 0:\n1000\n;".repeat(60),
    ),
  );
  assert.equal(many.charts.length, 32);
});

test("the tempo map finds its piece by bisection as the walk did", () => {
  const timing = createTiming({
    offset: -0.25,
    bpms: [
      [0, 120],
      [8, 240],
      [16, 60],
    ],
    stops: [
      [4, 0.5],
      [8, 0.25],
    ],
  });
  // Beat 0 at 0.25 s; 2 beats a second to beat 4, where the stop sits after the row.
  assert.equal(timing.timeAt(-2), -0.75);
  assert.equal(timing.timeAt(4), 2.25);
  assert.equal(timing.timeAt(5), 3.25);
  assert.equal(timing.timeAt(8), 4.75);
  assert.equal(timing.timeAt(12), 6);
  assert.equal(timing.timeAt(17), 8);
  assert.equal(timing.beatAt(2.5), 4);
  assert.equal(timing.beatAt(3.25), 5);
  assert.equal(timing.beatAt(6), 12);
  assert.equal(timing.bpmAt(7.9), 120);
  assert.equal(timing.bpmAt(8), 240);
  assert.equal(timing.bpmAt(100), 60);
});

test("a chart with its own tempo keeps the song's offset unless it names one", () => {
  const ssc = (own: string) =>
    `#TITLE:T;\n#OFFSET:-0.095;\n#BPMS:0=120;\n#NOTEDATA:;\n#STEPSTYPE:dance-single;\n#DIFFICULTY:Hard;\n#METER:8;\n${own}#NOTES:\n1000\n0100\n0010\n0001\n;`;
  assert.deepEqual(parseSimfile(ssc("#BPMS:0=150;\n")).charts[0]!.timing, {
    offset: -0.095,
    bpms: [[0, 150]],
    stops: [],
  });
  assert.equal(
    parseSimfile(ssc("#OFFSET:0.2;\n#BPMS:0=150;\n")).charts[0]!.timing!.offset,
    0.2,
  );
  assert.equal(parseSimfile(ssc("")).charts[0]!.timing, undefined);
});

test("a song whose times a match cannot carry is left out of the library", () => {
  const load = (header: string) =>
    createLibrary([{ id: "own", audio: "own.mp3", ssc: file(header) }]).song(
      "own",
    );
  assert.ok(load("#OFFSET:0;\n#BPMS:0=120;"));
  // Notes ten seconds before the music: they would be missed before the lead-in is over.
  assert.equal(load("#OFFSET:10;\n#BPMS:0=120;"), undefined);
  // A tempo that puts the last note hours out: past what the log and a checkpoint accept.
  assert.equal(load("#OFFSET:0;\n#BPMS:0=0.0001;"), undefined);
});

test("equal ratings are ranked by the longer combo, then by fewer misses, then by seat", () => {
  const library = testLibrary();
  const world = createWorld(
    library,
    "grid",
    SCORE_MODE,
    7,
    ["a", "b", "c"].map((id) => ({ id, bot: false, chart: 0 })),
    1000,
  )!;
  assert.deepEqual(ranking(library, world), [0, 1, 2]);
  world.players[2]!.best = 5;
  assert.deepEqual(ranking(library, world), [2, 0, 1]);
  world.players[0]!.counts[MISS] = 3;
  assert.deepEqual(ranking(library, world), [2, 1, 0]);
});

test("a seat that goes away lets go of its keys", () => {
  const room = started();
  runTo(room, beatMs(4));
  // Bo's key goes down and Bo's device drops off before its key-up is heard.
  fold(room, { b: [[PLAY, 1, 1, beatMs(4)]] });
  assert.notEqual(room.world!.players[1]!.down[1], UP);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  run(room, 2);
  assert.equal(room.world!.players[1]!.down[1], UP);
});
