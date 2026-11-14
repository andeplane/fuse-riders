import test from "node:test";
import assert from "node:assert/strict";
import {
  LESSONS as ENGINE_LESSONS,
  QUEEN_EGGS,
  createRound,
  viewOf,
} from "../src/engine/index.js";
import { DEFAULT_SETTINGS, type Settings } from "../src/online/index.js";
import {
  CLIMB,
  FRESH,
  LESSONS,
  advance,
  bestKey,
  bestTime,
  factsOf,
  lessonById,
  playSeconds,
  recordTime,
  setupAction,
  stepText,
  tutorialSettings,
  type Facts,
  type Lesson,
  type Progress,
  type TimeStore,
} from "../src/app/tutorial.js";

const facts = (patch: Partial<Facts> = {}): Facts => ({
  kind: "worker",
  carrying: false,
  grounded: true,
  riding: false,
  diving: false,
  dead: false,
  y: 258,
  holes: 0,
  gates: 0,
  enemyEggs: QUEEN_EGGS,
  kills: 0,
  presses: 0,
  attacks: 0,
  winner: null,
  ...patch,
});
const lesson = (id: string): Lesson => lessonById(id)!;
const NONE = { kills: 0, presses: 0, attacks: 0 };
/** Plays `frames` through a lesson from the start. */
function play(of: Lesson, frames: readonly Facts[]): Progress {
  let progress = FRESH;
  for (const frame of frames) progress = advance(of, progress, frame);
  return progress;
}
/** A store in memory, with what was written. */
class MemoryStore implements TimeStore {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

test("four lessons: berries, warrior and snail as a Cyan Worker, then the Queen", () => {
  assert.deepEqual(
    LESSONS.map((each) => [each.id, each.slot, each.steps.length]),
    [
      ["berries", 2, 3],
      ["warrior", 2, 5],
      ["snail", 2, 2],
      ["queen", 0, 4],
    ],
  );
  assert.deepEqual(
    LESSONS.map((each) => each.id),
    [...ENGINE_LESSONS],
    "the engine sets up the same lessons",
  );
  assert.equal(lessonById("nope"), undefined);
  assert.equal(lessonById(null), undefined);
});

test("berries: jump, pick one up, bank it", () => {
  const berries = lesson("berries");
  let progress = play(berries, [facts(), facts()]);
  assert.deepEqual([progress.step, progress.outcome], [0, "playing"]);
  progress = advance(berries, progress, facts({ grounded: false }));
  assert.equal(progress.step, 0, "falling off the spawn ledge is not a jump");
  progress = advance(berries, progress, facts({ presses: 1 }));
  assert.equal(progress.step, 0, "a press that has not left the ground yet");
  progress = advance(berries, progress, facts({ presses: 1, grounded: false }));
  assert.equal(progress.step, 1, "in the air");
  progress = advance(berries, progress, facts({ carrying: true }));
  assert.equal(progress.step, 2);
  progress = advance(berries, progress, facts({ carrying: true, holes: 0 }));
  assert.equal(progress.step, 2, "a hole not yet filled");
  progress = advance(berries, progress, facts({ holes: 1 }));
  assert.equal(progress.outcome, "won");
  assert.equal(
    advance(
      berries,
      progress,
      facts({ winner: { team: 1, kind: "military" } }),
    ),
    progress,
    "a finished lesson stays finished",
  );
  // Riding the snail is not a jump.
  assert.equal(
    play(berries, [
      facts(),
      facts({ presses: 1, grounded: false, riding: true }),
    ]).step,
    0,
  );
});

test("a hole filled before the step began does not count", () => {
  const berries = lesson("berries");
  const progress = play(berries, [
    facts({ holes: 4 }),
    facts({ holes: 4, presses: 1, grounded: false }),
    facts({ holes: 4, carrying: true }),
    facts({ holes: 4 }),
  ]);
  assert.equal(progress.step, 2);
  assert.equal(advance(berries, progress, facts({ holes: 5 })).outcome, "won");
});

test("warrior: berry, gate, climb, attack, first kill", () => {
  const warrior = lesson("warrior");
  let progress = play(warrior, [facts({ carrying: true })]);
  assert.equal(progress.step, 1);
  progress = advance(warrior, progress, facts({ kind: "warrior", y: 214 }));
  assert.equal(progress.step, 2, "out of the gate");
  progress = advance(
    warrior,
    progress,
    facts({ kind: "warrior", y: 214 - CLIMB + 1 }),
  );
  assert.equal(progress.step, 2, "not high enough yet");
  progress = advance(
    warrior,
    progress,
    facts({ kind: "warrior", y: 214 - CLIMB }),
  );
  assert.equal(progress.step, 3);
  progress = advance(warrior, progress, facts({ kind: "warrior", attacks: 1 }));
  assert.equal(progress.step, 4);
  progress = advance(
    warrior,
    progress,
    facts({ kind: "warrior", attacks: 1, kills: 1 }),
  );
  assert.equal(progress.outcome, "won");
});

test("steps that finish on one frame are judged from where the first began", () => {
  const warrior = lesson("warrior");
  const flying = play(warrior, [
    facts({ carrying: true }),
    facts({ kind: "warrior", y: 214 }),
    facts({ kind: "warrior", y: 214 - CLIMB }),
  ]);
  assert.equal(flying.step, 3);
  const struck = advance(
    warrior,
    flying,
    facts({ kind: "warrior", y: 150, attacks: 1, kills: 1 }),
  );
  assert.equal(struck.outcome, "won", "the attack and its kill, seen together");
  const climbing = advance(warrior, flying, facts({ kind: "warrior", y: 100 }));
  assert.deepEqual([climbing.step, climbing.start?.y], [3, 214 - CLIMB]);
});

test("snail: climb on and ride home; the enemy's snail win loses the lesson", () => {
  const snail = lesson("snail");
  const riding = play(snail, [facts({ riding: true })]);
  assert.equal(riding.step, 1);
  assert.equal(
    advance(snail, riding, facts({ winner: { team: 0, kind: "snail" } }))
      .outcome,
    "won",
  );
  assert.equal(
    advance(snail, riding, facts({ winner: { team: 1, kind: "snail" } }))
      .outcome,
    "lost",
  );
  assert.equal(
    advance(snail, riding, facts({ winner: { team: 0, kind: "military" } }))
      .outcome,
    "lost",
    "winning another way is not the lesson",
  );
});

test("queen: claim a gate, dive, attack, kill the enemy Queen", () => {
  const queen = lesson("queen");
  const done = play(queen, [
    facts({ kind: "queen" }),
    facts({ kind: "queen", gates: 1 }),
    facts({ kind: "queen", gates: 1, diving: true }),
    facts({ kind: "queen", gates: 1, attacks: 2 }),
    facts({ kind: "queen", gates: 1, attacks: 2, enemyEggs: QUEEN_EGGS - 1 }),
  ]);
  assert.equal(done.outcome, "won");
  const lost = play(queen, [
    facts({ kind: "queen", winner: { team: 1, kind: "economy" } }),
  ]);
  assert.deepEqual([lost.step, lost.outcome], [0, "lost"]);
});

test("the step's text names the keys of the device in use", () => {
  const berries = lesson("berries");
  assert.equal(
    stepText(berries, FRESH, "keys"),
    "BERRIES 1/3 · Press Space to jump. Hold it for a higher jump.",
  );
  const snail = lesson("snail");
  assert.match(
    stepText(snail, { ...FRESH, step: 1 }, "keys"),
    /Hold ← \/ A \(toward your goal\) and the snail crawls home\. Space hops off\./,
  );
  assert.match(
    stepText(snail, { ...FRESH, step: 1 }, "pad"),
    /Hold the stick left/,
  );
  assert.match(
    stepText(snail, { ...FRESH, step: 1 }, "touch"),
    /Hold the pad left/,
  );
  assert.match(stepText(berries, FRESH, "pad"), /Press A \/ Cross to jump/);
  assert.match(stepText(berries, FRESH, "touch"), /Press Big button to jump/);
  const queen = lesson("queen");
  assert.match(
    stepText(queen, { ...FRESH, step: 1 }, "keys"),
    /hold ↓ \/ S to dive/,
  );
  assert.match(
    stepText(queen, { ...FRESH, step: 2 }, "pad"),
    /Press B \/ Circle/,
  );
  assert.match(
    stepText(lesson("warrior"), { ...FRESH, step: 4 }, "keys"),
    /press X: the blade kills what is in front of it/,
  );
  assert.equal(
    stepText(berries, { ...FRESH, step: 3, outcome: "won" }, "keys"),
    "BERRIES: DONE",
  );
  assert.match(
    stepText(berries, { ...FRESH, outcome: "lost" }, "keys"),
    /Again!/,
  );
  for (const each of LESSONS)
    for (const step of each.steps)
      for (const device of ["keys", "pad", "touch"] as const)
        assert.doesNotMatch(
          step.text({
            move: "M",
            button: "B",
            attack: "X",
            down: "D",
            left: "L",
          }),
          /↑|\bUp\b|\bW\b/,
          device,
        );
});

test("facts are read off a real round view", () => {
  const view = viewOf(createRound({ seed: 7, mapId: 1, botLevel: "easy" }));
  const queen = factsOf(view, 0, { kills: 2, presses: 4, attacks: 3 })!;
  assert.deepEqual(
    [
      queen.kind,
      queen.holes,
      queen.gates,
      queen.enemyEggs,
      queen.kills,
      queen.presses,
      queen.attacks,
      queen.winner,
    ],
    ["queen", 0, 0, QUEEN_EGGS, 2, 4, 3, null],
  );
  assert.equal(factsOf(view, 2, NONE)!.kind, "worker");
  assert.equal(factsOf(view, 9, NONE), undefined);
  const claimed = {
    ...view,
    gates: view.gates.map((gate, index) => ({
      ...gate,
      owner: index === 0 ? 0 : 1,
    })),
    berries: [3, 5],
    eggs: [3, 1],
  };
  const read = factsOf(claimed, 2, NONE)!;
  assert.deepEqual([read.gates, read.holes, read.enemyEggs], [1, 3, 1]);
  assert.deepEqual(
    [factsOf(claimed, 3, NONE)!.holes, factsOf(claimed, 3, NONE)!.enemyEggs],
    [5, 3],
  );
  const bare = { ...view, berries: [], eggs: [] };
  assert.deepEqual(
    [factsOf(bare, 0, NONE)!.holes, factsOf(bare, 0, NONE)!.enemyEggs],
    [0, QUEEN_EGGS],
  );
});

test("the page steers the solo room into the lesson's seat and settings, and plays again after a loss", () => {
  const worker = lesson("berries"),
    right = tutorialSettings(DEFAULT_SETTINGS, worker);
  assert.deepEqual(
    [
      right.botLevel,
      right.map,
      right.wins,
      right.display,
      right.passive,
      right.lesson,
      right.quick,
    ],
    ["easy", 1, 1, false, true, "berries", true],
  );
  const at = (
    stage: "lobby" | "running" | "between" | "over",
    slot: number,
    settings: Settings,
    outcome: Progress["outcome"] = "playing",
  ) => setupAction({ stage, slot, settings }, worker, outcome);
  assert.equal(
    at("running", 0, DEFAULT_SETTINGS),
    "lobby",
    "solo starts as the Queen",
  );
  assert.equal(at("running", 2, DEFAULT_SETTINGS), "lobby", "wrong settings");
  assert.equal(at("lobby", 0, DEFAULT_SETTINGS), "seat");
  assert.equal(at("lobby", 2, DEFAULT_SETTINGS), "settings");
  assert.equal(at("lobby", 2, right), "start");
  for (const wrong of [
    { ...right, passive: false },
    { ...right, lesson: "snail" as const },
    { ...right, quick: false },
  ]) {
    assert.equal(at("lobby", 2, wrong), "settings");
    assert.equal(at("running", 2, wrong), "lobby");
  }
  assert.equal(at("running", 2, right), "none");
  assert.equal(at("between", 2, right), "none");
  assert.equal(at("over", 2, right, "lost"), "rematch");
  assert.equal(at("over", 2, right, "playing"), "rematch");
  assert.equal(at("over", 2, right, "won"), "none");
  assert.equal(
    setupAction(
      {
        stage: "running",
        slot: 0,
        settings: tutorialSettings(DEFAULT_SETTINGS, lesson("queen")),
      },
      lesson("queen"),
      "playing",
    ),
    "none",
  );
});

test("a finished lesson keeps its best time on this device", () => {
  const store = new MemoryStore();
  assert.equal(bestTime(store, "snail"), undefined);
  assert.equal(recordTime(store, "snail", 42.5), 42.5);
  assert.equal(store.items.get(bestKey("snail")), "42.5");
  assert.equal(
    recordTime(store, "snail", 50),
    42.5,
    "a slower run keeps the best",
  );
  assert.equal(recordTime(store, "snail", 30), 30);
  assert.equal(bestTime(store, "snail"), 30);
  store.setItem(bestKey("queen"), "garbage");
  assert.equal(bestTime(store, "queen"), undefined);
  assert.equal(playSeconds(1234), 20.6);
});
