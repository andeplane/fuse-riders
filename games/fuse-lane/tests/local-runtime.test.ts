import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIEFING,
  END_WEEK,
  HANDOFF,
  READY,
  WEEK,
  hashRoom,
  type FuseLaneView,
} from "../src/game/index.js";
import { LocalMatch, type LocalSetup } from "../src/app/local.js";
import {
  LocalRuntime,
  SAVE_KEY,
  type LocalDeps,
} from "../src/app/local-runtime.js";
import type { Store } from "../src/app/session.js";

const setup = (humans: number, bots: number): LocalSetup => ({
  humans: ["Ada", "Bo"].slice(0, humans).map((name, index) => ({
    name,
    avatar: ["fox", "cat"][index]!,
  })),
  bots,
  level: 1,
  goals: [30, 30, 30, 30],
  weekSeconds: 45,
  seed: "runtime-1",
});

/** A store in memory that can be told to refuse reads or writes, as a full or blocked `localStorage` does. */
class FakeStore implements Store {
  readonly items = new Map<string, string>();
  refuseReads = false;
  refuseWrites = false;
  writes = 0;
  getItem(key: string): string | null {
    if (this.refuseReads) throw new Error("blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.refuseWrites) throw new Error("quota");
    this.writes++;
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    if (this.refuseWrites) throw new Error("blocked");
    this.items.delete(key);
  }
}

/** A hand-turned clock and interval: `fire()` runs the registered callback once, as one interval would. */
class FakeDeps implements LocalDeps {
  time = 0;
  callback: (() => void) | undefined;
  interval = 0;
  stopped = 0;
  constructor(readonly store: FakeStore = new FakeStore()) {}
  now(): number {
    return this.time;
  }
  every(callback: () => void, ms: number): () => void {
    this.callback = callback;
    this.interval = ms;
    return () => {
      this.stopped++;
      this.callback = undefined;
    };
  }
  fire(times = 1): void {
    for (let n = 0; n < times; n++) this.callback?.();
  }
}

function runtimeFor(match: LocalMatch, deps: FakeDeps) {
  const frames: FuseLaneView[] = [];
  const runtime = new LocalRuntime(match, (view) => frames.push(view), deps);
  return { runtime, frames };
}

test("saved: no save, a store that refuses, a damaged save and another version are all no match; bad saves are forgotten", () => {
  const store = new FakeStore();
  assert.equal(LocalRuntime.saved(store), undefined);
  store.items.set(SAVE_KEY, "{not json");
  assert.equal(LocalRuntime.saved(store), undefined);
  assert.equal(store.items.has(SAVE_KEY), false, "a corrupt save is forgotten");
  const good = LocalMatch.create(setup(1, 1)).save();
  store.items.set(SAVE_KEY, JSON.stringify({ ...good, v: 2 }));
  assert.equal(LocalRuntime.saved(store), undefined);
  assert.equal(store.items.has(SAVE_KEY), false, "so is another version's");
  store.items.set(SAVE_KEY, JSON.stringify(good));
  const match = LocalRuntime.saved(store);
  assert.ok(match);
  assert.equal(match.room.week, 1);
  store.refuseReads = true;
  assert.equal(LocalRuntime.saved(store), undefined);
  store.refuseReads = false;
  assert.ok(store.items.has(SAVE_KEY), "a refused read forgets nothing");
  store.refuseWrites = true;
  LocalRuntime.forget(store);
  store.items.set(SAVE_KEY, "[]");
  assert.equal(
    LocalRuntime.saved(store),
    undefined,
    "nor does forgetting throw",
  );
  store.refuseWrites = false;
  LocalRuntime.forget(store);
  assert.equal(store.items.has(SAVE_KEY), false);
});

test("the runtime folds a tick per interval and saves at every change of phase or turn, and every 5 s", () => {
  const deps = new FakeDeps();
  const { runtime, frames } = runtimeFor(LocalMatch.create(setup(2, 0)), deps);
  const room = runtime.match.room;
  runtime.start();
  assert.equal(deps.interval, 50);
  assert.equal(frames.length, 1, "the first frame shows at once");
  assert.equal(room.phase, HANDOFF);
  const tick = room.tick;
  deps.fire();
  assert.equal(room.tick, tick + 1);
  assert.equal(frames.length, 2);
  const first = deps.store.writes;
  assert.ok(first >= 1, "the first fold saves");
  // Waiting on the handoff: nothing changes, so the next save comes after 100 ticks.
  deps.fire(98);
  assert.equal(deps.store.writes, first);
  deps.fire(2);
  assert.equal(deps.store.writes, first + 1);
  // The tap starts the turn: a change of phase saves at once, and the save resumes to the same room.
  assert.ok(runtime.play([READY, room.week, room.turn]));
  deps.fire();
  assert.equal(room.phase, WEEK);
  assert.equal(deps.store.writes, first + 2);
  const resumed = LocalRuntime.saved(deps.store)!;
  assert.equal(hashRoom(resumed.room), hashRoom(room));
  // Between frames the board draws a fraction of the way from the older to the newer.
  deps.time += 25;
  const timing = runtime.frameTiming();
  assert.ok(timing.older);
  assert.equal(timing.tick, room.tick - 0.5);
});

test("paused: the clock stops, nothing is played, the frame says so and the match is saved", () => {
  const deps = new FakeDeps();
  const { runtime, frames } = runtimeFor(LocalMatch.create(setup(1, 1)), deps);
  const room = runtime.match.room;
  runtime.start();
  deps.fire();
  const writes = deps.store.writes;
  runtime.setPaused(true);
  assert.equal(deps.store.writes, writes + 1, "pausing saves");
  assert.equal(frames.length, 3, "and shows a frame");
  const tick = room.tick;
  deps.fire(50);
  assert.equal(room.tick, tick, "no folds while paused");
  assert.equal(runtime.play([END_WEEK, room.week]), false, "no input either");
  assert.equal(runtime.frameTiming().older, undefined);
  runtime.setPaused(false);
  assert.ok(runtime.play([END_WEEK, room.week]));
  deps.fire();
  assert.equal(room.phase, BRIEFING);
});

test("a resumed match starts paused, and stopping ends the loop and saves", () => {
  const deps = new FakeDeps();
  const { runtime, frames } = runtimeFor(LocalMatch.create(setup(1, 1)), deps);
  runtime.start(true);
  assert.equal(runtime.paused, true);
  assert.equal(frames.length, 1);
  const tick = runtime.match.room.tick;
  deps.fire(10);
  assert.equal(runtime.match.room.tick, tick);
  runtime.stop();
  assert.equal(deps.stopped, 1);
  assert.equal(deps.callback, undefined);
  assert.ok(deps.store.items.has(SAVE_KEY));
  runtime.stop();
  assert.equal(deps.stopped, 1, "a second stop has no loop to end");
});

test("a store that refuses writes leaves the game playing unsaved; a finished match is forgotten", () => {
  const deps = new FakeDeps();
  deps.store.refuseWrites = true;
  const runtime = LocalRuntime.fromSetup(setup(1, 1), () => {}, deps);
  runtime.start();
  deps.fire(3);
  runtime.setPaused(true);
  assert.equal(deps.store.items.size, 0);
  deps.store.refuseWrites = false;
  runtime.save();
  assert.ok(deps.store.items.has(SAVE_KEY));
  runtime.match.room.stage = "over";
  runtime.save();
  assert.equal(deps.store.items.has(SAVE_KEY), false);
  // Over: the clock has nothing left to fold, and a resume of it would not start paused.
  const tick = runtime.match.room.tick;
  runtime.setPaused(false);
  deps.fire();
  assert.equal(runtime.match.room.tick, tick);
  const over = new LocalRuntime(runtime.match, () => {}, new FakeDeps());
  over.start(true);
  assert.equal(over.paused, false);
});
