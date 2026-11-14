import type { System32Event, System32State } from "./system32Machine";
import {
  BSOD_MS,
  CONFIRMATIONS,
  CRASH_AFTER_LAST_STAGE_MS,
  currentStage,
  FOLD_STAGES,
  IDLE,
  nextDelay,
  reduceSystem32,
  RESTART_MS,
  stageClassNames,
  titlesMangled,
  TOTAL_FOLD_MS,
} from "./system32Machine";

function run(state: System32State, ...events: System32Event[]): System32State {
  return events.reduce(reduceSystem32, state);
}

const CONFIRMED: System32State = run(
  IDLE,
  { type: "remove" },
  { type: "confirm" },
  { type: "confirm" },
  { type: "confirm" },
);

describe("reduceSystem32", () => {
  it("asks three questions and starts folding on the third Yes", () => {
    const first = reduceSystem32(IDLE, { type: "remove" });
    expect(first).toEqual({ phase: "confirming", step: 0 });
    const second = reduceSystem32(first, { type: "confirm" });
    expect(second).toEqual({ phase: "confirming", step: 1 });
    const third = reduceSystem32(second, { type: "confirm" });
    expect(third).toEqual({ phase: "confirming", step: 2 });
    expect(reduceSystem32(third, { type: "confirm" })).toEqual({
      phase: "folding",
      stage: 0,
    });
    expect(CONFIRMATIONS).toHaveLength(3);
  });

  it("goes back to idle on No at any step, and ignores No elsewhere", () => {
    for (const step of [0, 1, 2]) {
      const asked = run(
        IDLE,
        { type: "remove" },
        ...Array.from({ length: step }, (): System32Event => ({
          type: "confirm",
        })),
      );
      expect(reduceSystem32(asked, { type: "cancel" })).toEqual(IDLE);
    }
    expect(reduceSystem32(CONFIRMED, { type: "cancel" })).toEqual(CONFIRMED);
  });

  it("ignores a second remove while anything is running, and confirm outside a question", () => {
    expect(reduceSystem32(CONFIRMED, { type: "remove" })).toEqual(CONFIRMED);
    expect(
      reduceSystem32({ phase: "confirming", step: 1 }, { type: "remove" }),
    ).toEqual({ phase: "confirming", step: 1 });
    expect(reduceSystem32(IDLE, { type: "confirm" })).toEqual(IDLE);
    expect(reduceSystem32(CONFIRMED, { type: "confirm" })).toEqual(CONFIRMED);
  });

  it("lands one stage per elapsed, crashes after the last, restarts, then is idle again", () => {
    let state = CONFIRMED;
    for (let stage = 1; stage <= FOLD_STAGES.length; stage++) {
      state = reduceSystem32(state, { type: "elapsed" });
      expect(state).toEqual({ phase: "folding", stage });
    }
    state = reduceSystem32(state, { type: "elapsed" });
    expect(state).toEqual({ phase: "crashed" });
    state = reduceSystem32(state, { type: "elapsed" });
    expect(state).toEqual({ phase: "restarting" });
    state = reduceSystem32(state, { type: "elapsed" });
    expect(state).toEqual(IDLE);
  });

  it("ignores elapsed while idle or asking", () => {
    expect(reduceSystem32(IDLE, { type: "elapsed" })).toEqual(IDLE);
    const asking: System32State = { phase: "confirming", step: 1 };
    expect(reduceSystem32(asking, { type: "elapsed" })).toEqual(asking);
  });

  it("restarts from the blue screen on any key, nowhere else", () => {
    expect(reduceSystem32({ phase: "crashed" }, { type: "restart" })).toEqual({
      phase: "restarting",
    });
    expect(reduceSystem32(CONFIRMED, { type: "restart" })).toEqual(CONFIRMED);
    expect(reduceSystem32(IDLE, { type: "restart" })).toEqual(IDLE);
  });

  it("aborts to idle from anywhere", () => {
    for (const state of [
      CONFIRMED,
      { phase: "crashed" },
      { phase: "restarting" },
      { phase: "confirming", step: 2 },
    ] satisfies System32State[])
      expect(reduceSystem32(state, { type: "abort" })).toEqual(IDLE);
  });

  it("jumps straight to a stage, clamped to the stages that exist", () => {
    expect(reduceSystem32(IDLE, { type: "jumpTo", stage: 4 })).toEqual({
      phase: "folding",
      stage: 4,
    });
    expect(reduceSystem32(IDLE, { type: "jumpTo", stage: 99 })).toEqual({
      phase: "folding",
      stage: FOLD_STAGES.length,
    });
    expect(reduceSystem32(IDLE, { type: "jumpTo", stage: -3 })).toEqual({
      phase: "folding",
      stage: 0,
    });
    expect(reduceSystem32(IDLE, { type: "jumpTo", stage: 2.9 })).toEqual({
      phase: "folding",
      stage: 2,
    });
    expect(reduceSystem32(IDLE, { type: "jumpTo", stage: Number.NaN })).toEqual(
      { phase: "folding", stage: 0 },
    );
  });
});

describe("nextDelay", () => {
  it("waits for the user while idle or asking", () => {
    expect(nextDelay(IDLE)).toBeNull();
    expect(nextDelay({ phase: "confirming", step: 0 })).toBeNull();
  });

  it("waits each stage's delay, the crash hold after the last, then the blue screen and restart holds", () => {
    FOLD_STAGES.forEach((stage, index) => {
      expect(nextDelay({ phase: "folding", stage: index })).toBe(stage.delayMs);
    });
    expect(nextDelay({ phase: "folding", stage: FOLD_STAGES.length })).toBe(
      CRASH_AFTER_LAST_STAGE_MS,
    );
    expect(nextDelay({ phase: "crashed" })).toBe(BSOD_MS);
    expect(nextDelay({ phase: "restarting" })).toBe(RESTART_MS);
  });

  it("adds up to about a minute from the last Yes to the blue screen", () => {
    expect(TOTAL_FOLD_MS).toBeGreaterThanOrEqual(55_000);
    expect(TOTAL_FOLD_MS).toBeLessThanOrEqual(65_000);
  });
});

describe("stageClassNames", () => {
  it("is empty while nothing is happening or a question is open", () => {
    expect(stageClassNames(IDLE)).toEqual([]);
    expect(stageClassNames({ phase: "confirming", step: 2 })).toEqual([]);
  });

  it("accumulates the classes of every stage that has landed", () => {
    expect(stageClassNames({ phase: "folding", stage: 0 })).toEqual([
      "s32-folding",
    ]);
    expect(stageClassNames({ phase: "folding", stage: 3 })).toEqual([
      "s32-folding",
      "s32-icons-1",
      "s32-icons-2",
      "s32-icons-3",
    ]);
    expect(
      stageClassNames({ phase: "folding", stage: FOLD_STAGES.length }),
    ).toEqual(["s32-folding", ...FOLD_STAGES.map((stage) => stage.className)]);
  });

  it("names the crash and the restart", () => {
    expect(stageClassNames({ phase: "crashed" })).toEqual(["s32-crashed"]);
    expect(stageClassNames({ phase: "restarting" })).toEqual([
      "s32-restarting",
    ]);
  });

  it("has a unique class and a caption per stage", () => {
    const classes = new Set(FOLD_STAGES.map((stage) => stage.className));
    expect(classes.size).toBe(FOLD_STAGES.length);
    for (const stage of FOLD_STAGES) expect(stage.caption).not.toBe("");
  });
});

describe("currentStage and titlesMangled", () => {
  it("names the stage that landed last, none before the first or outside the fold", () => {
    expect(currentStage(IDLE)).toBeNull();
    expect(currentStage({ phase: "folding", stage: 0 })).toBeNull();
    expect(currentStage({ phase: "folding", stage: 1 })).toBe(FOLD_STAGES[0]);
    expect(currentStage({ phase: "crashed" })).toBeNull();
  });

  it("misspells titles from the titles stage on, and never outside the fold", () => {
    const titles = FOLD_STAGES.findIndex((stage) => stage.id === "titles");
    expect(titles).toBeGreaterThan(0);
    expect(titlesMangled({ phase: "folding", stage: titles })).toBe(false);
    expect(titlesMangled({ phase: "folding", stage: titles + 1 })).toBe(true);
    expect(titlesMangled({ phase: "crashed" })).toBe(false);
    expect(titlesMangled(IDLE)).toBe(false);
  });
});
