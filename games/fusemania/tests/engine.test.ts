import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK_LEAD_MS,
  BATTLE_MODE,
  BOO,
  CAPACITY,
  DOUBLE,
  DROPPED,
  DRUNK,
  FULL_RATING,
  GOOD,
  GREAT,
  HELD,
  ITEM_MS,
  LATE_MS,
  MARVELOUS,
  MINED,
  MINES,
  MISS,
  NO_ITEM,
  PERFECT,
  POINTS,
  RELEASE,
  SCORE_MODE,
  SHIELD,
  STAR,
  TICK_MS,
  USE,
  cloneWorld,
  compileSteps,
  createTiming,
  createWorld,
  decodeWorld,
  encodeWorld,
  forecast,
  itemNotes,
  parseSimfile,
  ranking,
  stepWorld,
  NO_JUDGMENT,
  toView,
  turnedMine,
  wasHit,
  writeSsc,
  type Input,
  type Pending,
  type World,
} from "../src/engine/index.js";
import * as basics from "../src/basics.js";
import { GRID_SSC, beatMs, testLibrary } from "./fixtures/songs.js";

const library = testLibrary();
const EASY = 0,
  HARD = 1;

function world(
  charts: readonly number[] = [EASY],
  mode = SCORE_MODE,
  bots: readonly boolean[] = [],
): World {
  const made = createWorld(
    library,
    "grid",
    mode,
    1234,
    charts.map((chart, index) => ({
      id: `p${index}`,
      bot: bots[index] === true,
      chart,
    })),
    1000,
  );
  assert.ok(made);
  return made;
}
/** Folds ticks until the song clock reaches `ms`, feeding each input on the first tick at or after its time. */
function run(state: World, ms: number, inputs: readonly Input[] = []): void {
  const queue = [...inputs].sort((a, b) => a.ms - b.ms);
  while (state.ms < ms && state.phase !== "over") {
    const now = state.ms + TICK_MS;
    const due: Input[] = [];
    while (queue.length && queue[0]!.ms <= now) due.push(queue.shift()!);
    stepWorld(
      library,
      state,
      due.sort((a, b) => a.slot - b.slot),
    );
  }
}
const tapAt = (slot: number, column: number, ms: number): Input[] => [
  { slot, code: column, ms },
  { slot, code: column + RELEASE, ms: ms + 60 },
];

test("the basics repeat the engine's numbers", () => {
  assert.equal(basics.CAPACITY, CAPACITY);
  assert.equal(basics.FULL_RATING, FULL_RATING);
});

test("a simfile reads as .ssc and as .sm, and writes back the same notes", () => {
  const sim = parseSimfile(GRID_SSC);
  assert.equal(sim.title, "Grid");
  assert.equal(sim.charts.length, 2);
  assert.deepEqual(parseSimfile(writeSsc(sim)), sim);
  const sm = `#TITLE:Old;\n#ARTIST:A;\n#MUSIC:old.ogg;\n#OFFSET:-0.5;\n#BPMS:0.000=120.000,8=240;\n#STOPS:4=0.5;
// a comment
#NOTES:
     dance-single:
     someone:
     Hard:
     8:
     0.1,0.2,0.3,0.4,0.5:
1000
0100
0010
0001
,
2000
0000
3000
000M
;`;
  const old = parseSimfile(sm);
  assert.equal(old.charts[0]!.difficulty, "Hard");
  assert.equal(old.charts[0]!.meter, 8);
  assert.deepEqual(
    old.charts[0]!.notes.map((note) => [
      note.beat,
      note.column,
      note.kind,
      note.endBeat,
    ]),
    [
      [0, 0, "tap", undefined],
      [1, 1, "tap", undefined],
      [2, 2, "tap", undefined],
      [3, 3, "tap", undefined],
      [4, 0, "hold", 6],
      [7, 3, "mine", undefined],
    ],
  );
  assert.throws(() => parseSimfile("#TITLE:x;"), /tempo/);
  assert.throws(() => parseSimfile("#BPMS:0=120;"), /steps/);
});

test("the tempo map: an offset, a tempo change and a stop", () => {
  const timing = createTiming({
    offset: -0.5,
    bpms: [
      [0, 120],
      [8, 240],
    ],
    stops: [[4, 0.5]],
  });
  assert.equal(timing.timeAt(0), 0.5);
  // A note on the stop's beat is hit before the pause.
  assert.equal(timing.timeAt(4), 2.5);
  assert.equal(timing.timeAt(5), 3.5);
  assert.equal(timing.timeAt(8), 5);
  assert.equal(timing.timeAt(9), 5.25);
  assert.equal(timing.beatAt(2.75), 4);
  assert.equal(timing.beatAt(3.5), 5);
  assert.equal(timing.beatAt(5.25), 9);
  assert.equal(timing.bpmAt(3), 120);
  assert.equal(timing.bpmAt(8), 240);
});

test("a chart compiles to milliseconds, lanes and a full score", () => {
  const steps = library.steps("grid", HARD)!;
  assert.equal(steps.notes[0]!.ms, beatMs(4));
  assert.equal(steps.holds, 2);
  assert.equal(steps.mines[0]!.length, 1);
  assert.equal(steps.full, steps.steps * POINTS[0] + 2 * 5);
  assert.equal(library.song("grid")!.charts[1]!.name, "Hard");
  // A chart index past the hardest is the hardest; another width is refused.
  assert.equal(library.steps("grid", 7), steps);
  assert.equal(library.steps("nope", 0), undefined);
  const wide = parseSimfile(GRID_SSC).charts[0]!;
  assert.equal(
    compileSteps(
      { ...wide, notes: [{ beat: 0, column: 5, kind: "tap" }] },
      { offset: 0, bpms: [[0, 120]], stops: [] },
    ),
    undefined,
  );
});

test("a press is judged by how far it is from the note, whatever tick logged it", () => {
  const cases: [number, number][] = [
    [0, MARVELOUS],
    [22, MARVELOUS],
    [-23, PERFECT],
    [45, PERFECT],
    [-90, GREAT],
    [135, GOOD],
    [-180, BOO],
  ];
  for (const [off, judgment] of cases) {
    const state = world();
    run(state, beatMs(4) + 400, tapAt(0, 0, beatMs(4) + off));
    const player = state.players[0]!;
    assert.equal(player.counts[judgment], 1, `off ${off}`);
    assert.equal(player.score, POINTS[judgment]);
    assert.equal(player.judgedOff, off);
    assert.ok(wasHit(player.hits, 0));
  }
});

test("a note nobody pressed is a miss once the room's clock is past its window", () => {
  const state = world();
  // The window closes 180 ms after the note; the room waits `LATE_MS` more for a press still on its way.
  run(state, beatMs(4) + 150 + LATE_MS);
  assert.equal(state.players[0]!.counts[MISS], 0);
  run(state, beatMs(4) + 150 + LATE_MS + TICK_MS);
  assert.equal(state.players[0]!.counts[MISS], 1);
  assert.equal(state.players[0]!.next[0], 1);
  assert.ok(!wasHit(state.players[0]!.hits, 0));
  // A press too early, or in the wrong column, judges nothing.
  const stray = world();
  run(stray, beatMs(4) - 200, [
    ...tapAt(0, 0, beatMs(4) - 250),
    ...tapAt(0, 2, beatMs(4) - 250),
  ]);
  assert.equal(stray.players[0]!.next[0], 0);
  assert.equal(stray.players[0]!.judged, -1);
});

test("a combo runs through Great and breaks on Good, on Boo and on a miss", () => {
  for (const [off, judgment] of [
    [130, GOOD],
    [-170, BOO],
  ] as const) {
    const state = world();
    run(state, beatMs(8), [
      ...tapAt(0, 0, beatMs(4)),
      ...tapAt(0, 1, beatMs(5) + 80),
      ...tapAt(0, 2, beatMs(6) + off),
      ...tapAt(0, 3, beatMs(7)),
    ]);
    const player = state.players[0]!;
    assert.equal(player.counts[judgment], 1);
    assert.equal(player.best, 2);
    assert.equal(player.combo, 1);
    run(state, beatMs(10));
    assert.equal(state.players[0]!.combo, 0);
  }
});

test("a combo remembers the worst judgment in it until it breaks", () => {
  const state = world();
  const player = state.players[0]!;
  assert.equal(player.worst, NO_JUDGMENT);
  run(state, beatMs(4) + 400, tapAt(0, 0, beatMs(4)));
  assert.equal(player.worst, MARVELOUS);
  run(state, beatMs(5) + 400, tapAt(0, 1, beatMs(5) + 80));
  assert.equal(player.worst, GREAT);
  // A better step does not take the Great back.
  run(state, beatMs(6) + 400, tapAt(0, 2, beatMs(6) + 30));
  assert.equal(player.combo, 3);
  assert.equal(player.worst, GREAT);
  assert.equal(toView(library, state).players[0]!.worst, GREAT);
  // A Good breaks it, and the next combo starts clean.
  run(state, beatMs(7) + 400, tapAt(0, 3, beatMs(7) + 130));
  assert.equal(player.combo, 0);
  assert.equal(player.worst, NO_JUDGMENT);
  run(state, beatMs(8) + 400, tapAt(0, 0, beatMs(8) + 30));
  assert.equal(player.worst, PERFECT);
  // So does a miss.
  run(state, beatMs(11));
  assert.equal(player.combo, 0);
  assert.equal(player.worst, NO_JUDGMENT);
});

test("a hold is kept to its tail, may be caught again quickly, and is dropped when let go", () => {
  const head = beatMs(6),
    tail = beatMs(8);
  const kept = world([HARD]);
  run(kept, tail + 400, [
    { slot: 0, code: 1, ms: head },
    { slot: 0, code: 1 + RELEASE, ms: tail - 100 },
  ]);
  assert.equal(kept.players[0]!.counts[HELD], 1);
  const caught = world([HARD]);
  run(caught, tail + 400, [
    { slot: 0, code: 1, ms: head },
    { slot: 0, code: 1 + RELEASE, ms: head + 300 },
    { slot: 0, code: 1, ms: head + 500 },
    { slot: 0, code: 1 + RELEASE, ms: tail + 10 },
  ]);
  assert.equal(caught.players[0]!.counts[HELD], 1);
  assert.equal(caught.players[0]!.counts[DROPPED], 0);
  const dropped = world([HARD]);
  run(dropped, tail + 400, [
    { slot: 0, code: 1, ms: head },
    { slot: 0, code: 1 + RELEASE, ms: head + 300 },
    { slot: 0, code: 1, ms: head + 700 },
  ]);
  assert.equal(dropped.players[0]!.counts[DROPPED], 1);
  // The head stays judged; the hold is drawn as missed.
  assert.equal(dropped.players[0]!.counts[MARVELOUS], 1);
  assert.ok(!wasHit(dropped.players[0]!.hits, 2));
  // A head never pressed is a miss and a dropped hold.
  const never = world([HARD]);
  run(never, tail + 400);
  assert.equal(never.players[0]!.counts[DROPPED], 1);
});

test("a roll needs tapping and a mine goes off under a press or a held key", () => {
  const head = beatMs(9),
    tail = beatMs(12);
  const rolled = world([HARD]);
  const taps: Input[] = [];
  for (let at = head; at < tail; at += 300) taps.push(...tapAt(0, 2, at));
  run(rolled, tail + 800, taps);
  assert.equal(rolled.players[0]!.counts[HELD], 1);
  const lazy = world([HARD]);
  run(lazy, tail + 800, tapAt(0, 2, head));
  // The hold before it was never pressed, and the roll ran out of taps.
  assert.equal(lazy.players[0]!.counts[DROPPED], 2);
  const mine = beatMs(13);
  const pressed = world([HARD]);
  run(pressed, mine + 600, tapAt(0, 0, mine + 30));
  assert.equal(pressed.players[0]!.counts[MINED], 1);
  const held = world([HARD]);
  run(held, mine + 600, [
    { slot: 0, code: 0, ms: mine - 300 },
    { slot: 0, code: RELEASE, ms: mine + 200 },
  ]);
  assert.equal(held.players[0]!.counts[MINED], 1);
  const dodged = world([HARD]);
  run(dodged, mine + 600, tapAt(0, 0, mine - 300));
  assert.equal(dodged.players[0]!.counts[MINED], 0);
  assert.equal(dodged.players[0]!.mine[0], 1);
});

test("a timestamp is held within its tick's bounds and never goes back", () => {
  // Logged a second late: judged as late as the tick allows, which is far outside the window.
  const late = world();
  run(late, beatMs(4) + 950);
  stepWorld(library, late, [{ slot: 0, code: 0, ms: beatMs(4) }]);
  assert.equal(late.players[0]!.counts[MARVELOUS], 0);
  assert.equal(late.players[0]!.last, late.ms - TICK_MS - LATE_MS);
  stepWorld(library, late, [{ slot: 0, code: RELEASE, ms: -5000 }]);
  assert.ok(late.players[0]!.last >= late.ms - TICK_MS - LATE_MS);
});

test("the forecast shows a press at once and the fold agrees with it", () => {
  const state = world([HARD]);
  run(state, beatMs(4) - 100);
  const now = beatMs(4) + 10;
  const pending: Pending[] = [
    { code: 0, ms: beatMs(4) + 5, at: state.ms + 2 * TICK_MS },
    { code: 3, ms: beatMs(4) - 15, at: state.ms + 2 * TICK_MS },
  ];
  const before = cloneWorld(state);
  const seen = forecast(library, state, 0, pending, now);
  assert.deepEqual(state, before, "the forecast leaves the room alone");
  assert.equal(seen.players[0]!.counts[MARVELOUS], 2);
  assert.equal(seen.players[0]!.combo, 2);
  // The room folds the same entries on their tick and reaches the same judgments.
  stepWorld(library, state, []);
  stepWorld(library, state, [
    { slot: 0, code: 0, ms: beatMs(4) + 5 },
    { slot: 0, code: 3, ms: beatMs(4) - 15 },
  ]);
  assert.deepEqual(state.players[0]!.counts, seen.players[0]!.counts);
  assert.equal(state.players[0]!.score, seen.players[0]!.score);
  // A miss shows as soon as the rider's own clock is past the window, not `LATE_MS` later.
  const idle = forecast(library, state, 0, [], beatMs(6) + 181);
  assert.equal(idle.players[0]!.counts[MISS], 1);
  assert.equal(state.players[0]!.counts[MISS], 0);
});

test("a battle hands out items on its item notes, and a bot plays and throws them", () => {
  const steps = library.steps("grid", EASY)!;
  const items = [...itemNotes(steps)];
  assert.ok(items.length >= 4);
  assert.equal(steps.notes[items[0]!]!.ms, beatMs(4) + 4000);
  const state = world([EASY, EASY], BATTLE_MODE, [false, true]);
  const note = steps.notes[items[0]!]!;
  run(state, note.ms + 300, tapAt(0, note.column, note.ms));
  assert.notEqual(state.players[0]!.item, NO_ITEM);
  assert.equal(state.players[0]!.itemAt, note.ms);
  // The bot hit most of what came by, picked its item up and threw it a moment later.
  const bot = state.players[1]!;
  assert.ok(bot.counts[MARVELOUS]! + bot.counts[PERFECT]! >= 5);
  run(state, note.ms + 2500);
  assert.equal(state.players[1]!.item, NO_ITEM);
  assert.equal(state.players[1]!.used, 1);
  // Score mode has no items at all.
  const plain = world([EASY]);
  run(plain, note.ms + 300, tapAt(0, note.column, note.ms));
  assert.equal(plain.players[0]!.item, NO_ITEM);
});

test("an attack lands on the others after its warning; a shield swallows it", () => {
  const state = world([EASY, EASY, EASY], BATTLE_MODE);
  run(state, 1000);
  state.players[0]!.item = DRUNK;
  state.players[2]!.item = SHIELD;
  stepWorld(library, state, [{ slot: 2, code: USE, ms: state.ms }]);
  assert.equal(state.players[2]!.shield, state.ms + ITEM_MS[SHIELD]!);
  stepWorld(library, state, [{ slot: 0, code: USE, ms: state.ms }]);
  const thrown = state.ms;
  assert.equal(state.players[0]!.item, NO_ITEM);
  assert.deepEqual(state.players[0]!.effects, []);
  assert.deepEqual(state.players[1]!.effects, [
    [
      DRUNK,
      thrown + ATTACK_LEAD_MS,
      thrown + ATTACK_LEAD_MS + ITEM_MS[DRUNK]!,
      0,
    ],
  ]);
  assert.deepEqual(state.players[2]!.effects, []);
  assert.equal(state.players[2]!.shield, 0);
  assert.equal(state.players[2]!.blocked, thrown);
  // The button with an empty hand does nothing.
  stepWorld(library, state, [{ slot: 0, code: USE, ms: state.ms }]);
  assert.equal(state.players[0]!.used, 1);
  // Long after it ran out the effect is forgotten.
  run(state, thrown + 30_000);
  assert.deepEqual(state.players[1]!.effects, []);
});

test("double doubles, a star hits everything, and mines replace taps", () => {
  const doubled = world([EASY], BATTLE_MODE);
  run(doubled, 1000);
  doubled.players[0]!.item = DOUBLE;
  stepWorld(library, doubled, [{ slot: 0, code: USE, ms: doubled.ms }]);
  run(doubled, beatMs(4) + 300, tapAt(0, 0, beatMs(4)));
  assert.equal(doubled.players[0]!.score, POINTS[MARVELOUS] * 2);

  const starred = world([EASY], BATTLE_MODE);
  run(starred, 1500);
  starred.players[0]!.item = STAR;
  stepWorld(library, starred, [{ slot: 0, code: USE, ms: starred.ms }]);
  run(starred, beatMs(8));
  assert.ok(starred.players[0]!.counts[MARVELOUS]! >= 4);
  assert.equal(starred.players[0]!.counts[MISS], 0);

  const mined = world([EASY, EASY], BATTLE_MODE);
  run(mined, 1000);
  mined.players[1]!.item = MINES;
  stepWorld(library, mined, [{ slot: 1, code: USE, ms: mined.ms }]);
  const victim = mined.players[0]!;
  const steps = library.steps("grid", EASY)!;
  const turned = steps.notes
    .map((note, id) => ({ note, id }))
    .filter(({ note, id }) =>
      turnedMine(victim.effects, mined.seed, id, note, itemNotes(steps)),
    );
  assert.ok(turned.length >= 2, "some taps turned");
  assert.ok(turned.length < 18, "not all of them");
  const first = turned[0]!;
  // Pressing one sets it off; leaving the next alone costs nothing.
  run(mined, first.note.ms + 600, tapAt(0, first.note.column, first.note.ms));
  assert.equal(mined.players[0]!.counts[MINED], 1);
  const misses = mined.players[0]!.counts[MISS]!;
  run(mined, turned[1]!.note.ms + 600);
  const between = steps.notes.filter(
    (note, id) =>
      note.ms > first.note.ms &&
      note.ms <= turned[1]!.note.ms &&
      !turned.some((each) => each.id === id),
  ).length;
  assert.equal(mined.players[0]!.counts[MISS]! - misses, between);
});

test("the leader is the best rating for its chart, and the match ends with the song", () => {
  const state = world([EASY, HARD], SCORE_MODE, [false, true]);
  assert.deepEqual(ranking(library, state), [0, 1]);
  run(state, beatMs(8));
  assert.deepEqual(ranking(library, state), [1, 0]);
  const view = toView(library, state);
  assert.equal(view.players[1]!.place, 1);
  assert.ok(view.players[1]!.rating > 0);
  run(state, 10_000_000);
  assert.equal(state.phase, "over");
  assert.ok(state.ms >= state.endMs);
  const settled = state.players[1]!;
  const steps = library.steps("grid", HARD)!;
  assert.equal(
    settled.counts.slice(0, 6).reduce((sum, count) => sum + count, 0),
    steps.steps,
  );
  assert.equal(settled.counts[HELD]! + settled.counts[DROPPED]!, steps.holds);
  const frozen = cloneWorld(state);
  stepWorld(library, state, [{ slot: 0, code: 0, ms: state.ms }]);
  assert.deepEqual(state, frozen);
});

test("a checkpoint round-trips mid-match and a damaged one is refused whole", () => {
  const state = world([EASY, HARD], BATTLE_MODE, [false, true]);
  run(state, beatMs(20), [
    ...tapAt(0, 0, beatMs(4)),
    ...tapAt(0, 1, beatMs(5) + 50),
    { slot: 0, code: 2, ms: beatMs(6) },
  ]);
  const fields = encodeWorld(state);
  const wire = JSON.parse(JSON.stringify(fields)) as unknown[];
  assert.deepEqual(decodeWorld(library, wire), state);
  const damage = (change: (copy: unknown[][]) => void) => {
    const copy = JSON.parse(JSON.stringify(fields)) as unknown[][];
    change(copy);
    return decodeWorld(library, copy);
  };
  const player = (copy: unknown[][]) => (copy[6] as unknown[][])[0]!;
  assert.equal(
    damage((copy) => (copy[0] = "nope" as never)),
    undefined,
  );
  assert.equal(
    damage((copy) => (copy[1] = 7 as never)),
    undefined,
  );
  assert.equal(
    damage((copy) => (copy[3] = 12.5 as never)),
    undefined,
  );
  assert.equal(
    damage((copy) => (copy[4] = 1 as never)),
    undefined,
  );
  assert.equal(
    damage((copy) => (copy[5] = true as never)),
    undefined,
  );
  assert.equal(
    damage((copy) => (player(copy)[2] = 9)),
    undefined,
  );
  assert.equal(
    damage((copy) => ((player(copy)[3] as number[])[0] = 999)),
    undefined,
  );
  assert.equal(
    damage((copy) => ((player(copy)[5] as number[])[0] = 1)),
    undefined,
  );
  assert.equal(
    damage((copy) => (player(copy)[9] = -1)),
    undefined,
  );
  assert.equal(
    damage((copy) => (player(copy)[10] = 99_999)),
    undefined,
  );
  // The combo's worst judgment: none when there is no combo, one that keeps a combo while there is one.
  assert.equal(player(fields as unknown[][])[10], 0);
  for (const worst of [PERFECT, GOOD, 1.5, null])
    assert.equal(
      damage((copy) => (player(copy)[11] = worst)),
      undefined,
    );
  assert.equal(
    damage((copy) => (player(copy)[10] = 1)),
    undefined,
  );
  assert.ok(
    damage((copy) => {
      player(copy)[10] = 1;
      player(copy)[11] = GREAT;
    }),
  );
  assert.equal(
    damage((copy) => (player(copy)[14] as number[]).push(0)),
    undefined,
  );
  assert.equal(
    damage((copy) => (player(copy)[18] = 99)),
    undefined,
  );
  assert.equal(
    damage((copy) => (player(copy)[20] = [[DRUNK, 10, 5, 0]])),
    undefined,
  );
  assert.equal(
    damage((copy) => (copy[6] as unknown[]).push(player(copy))),
    undefined,
  );
  assert.equal(decodeWorld(library, [...wire, 1]), undefined);
  assert.equal(decodeWorld(library, null), undefined);
});
