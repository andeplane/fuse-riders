import assert from "node:assert/strict";
import test from "node:test";
import { BombInputBuffer } from "../src/engine/bomb-input.js";
import {
  AIM,
  CANCEL,
  PRESS,
  RELEASE,
  foldPlayerEntries,
  neutralControls,
  quantizeAim,
  type Entry,
  type HeldControls,
} from "../src/engine/input-log.js";
import type { AimPoint, BombActionCommand } from "../src/engine/primitives.js";

/**
 * Two implementations turn a rider's bomb button into the ordered `press` / `release` / `cancel` commands `step` reads:
 * `BombInputBuffer`, written for the LAN server's per-connection frames, and `foldPlayerEntries`, the fold of log
 * entries every online replica agrees on. The architecture review (C2) says they drifted. This file feeds both the
 * same device behaviour and writes down where they part, as found on `14e1452` (#309) before they were unified.
 *
 * A device is modelled by what it does, not by either implementation: it presses (always a new gesture, numbered
 * from 1), aims, releases or cancels the gesture it holds, and misbehaves in the ways a lossy or hostile link can:
 * resends, stale ids, a second press over a held one. Each act becomes one frame for the buffer and the entries the
 * wire contract (`docs/online/PROTOCOL.md`: PRESS/RELEASE/CANCEL carry the gesture id, a RELEASE may carry its aim)
 * has for it.
 */
type Act =
  | "pressIdle"
  | "pressOverHeld"
  | "resendPress"
  | "aimHeld"
  | "releaseHeld"
  | "releaseHeldAimed"
  | "releaseStale"
  | "cancelHeld"
  | "cancelStale"
  | "unheldFrame";

/** Aims on the uint16 grid, so the log's quantisation is the identity and cannot be what differs. */
const gridAim = (random: () => number): AimPoint => ({
  x: Math.floor(random() * 65536) / 65535,
  y: Math.floor(random() * 65536) / 65535,
});
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

class Pair {
  readonly buffer = new BombInputBuffer();
  readonly held: HeldControls = neutralControls();
  private entries: Entry[] = [];
  private seq = 0;
  private tick = 1;
  /** The device's own view: the gesture it holds (0: none) and the newest it ever pressed. */
  active = 0;
  latest = 0;

  private log(...body: number[]): void {
    this.entries.push([++this.seq, this.tick, ...body] as unknown as Entry);
  }
  act(act: Act, aim?: AimPoint): void {
    const q = aim ? quantizeAim(aim) : undefined;
    switch (act) {
      case "pressIdle":
      case "pressOverHeld":
        this.active = ++this.latest;
        this.buffer.accept(true, "press");
        this.log(PRESS, this.active);
        return;
      case "resendPress":
        this.buffer.accept(true, "press");
        this.log(PRESS, this.active);
        return;
      case "aimHeld":
        this.buffer.accept(true, undefined, aim);
        this.log(AIM, ...q!);
        return;
      case "releaseHeld":
      case "releaseHeldAimed":
        this.buffer.accept(false, "release", aim);
        this.log(RELEASE, this.active, ...(q ?? []));
        this.active = 0;
        return;
      case "releaseStale":
        this.buffer.accept(false, "release");
        this.log(RELEASE, this.latest);
        return;
      case "cancelHeld":
        this.buffer.accept(false, "cancel");
        this.log(CANCEL, this.active);
        this.active = 0;
        return;
      case "cancelStale":
        this.buffer.accept(false, "cancel");
        this.log(CANCEL, this.latest);
        return;
      case "unheldFrame":
        // A frame that says "not held" with no edge. The log has no entry for it: nothing changed that a device logs.
        this.buffer.accept(false);
        return;
    }
  }
  /** Ends the tick: what each side hands `step`. */
  drain(): { buffer: BombActionCommand[]; fold: BombActionCommand[] } {
    const fold = [
      ...(foldPlayerEntries(this.held, this.entries).bombCommands ?? []),
    ];
    this.entries = [];
    this.tick += 1;
    return { buffer: this.buffer.drainCommands(), fold };
  }
}

const possible = (pair: Pair): Act[] =>
  pair.active
    ? [
        "pressOverHeld",
        "resendPress",
        "aimHeld",
        "releaseHeld",
        "releaseHeldAimed",
        "cancelHeld",
        "unheldFrame",
      ]
    : pair.latest
      ? ["pressIdle", "releaseStale", "cancelStale", "unheldFrame"]
      : ["pressIdle", "unheldFrame"];

/** One act per tick until the two disagree; returns the act they first disagreed on, if any. */
function firstDivergence(seed: number, ticks: number): Act | undefined {
  const random = seeded(seed),
    pair = new Pair();
  for (let tick = 0; tick < ticks; tick++) {
    const acts = possible(pair),
      act = acts[Math.floor(random() * acts.length)]!;
    pair.act(
      act,
      act === "aimHeld" || act === "releaseHeldAimed"
        ? gridAim(random)
        : undefined,
    );
    const { buffer, fold } = pair.drain();
    try {
      assert.deepEqual(buffer, fold);
    } catch {
      return act;
    }
  }
  return undefined;
}

test("differential, one act per tick: the buffer and the fold part on exactly three acts", () => {
  const found = new Map<Act, number>();
  let agreed = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const act = firstDivergence(seed, 60);
    if (act) found.set(act, (found.get(act) ?? 0) + 1);
    else agreed++;
  }
  assert.deepEqual([...found.keys()].sort(), [
    "cancelStale",
    "pressOverHeld",
    "unheldFrame",
  ]);
  assert.equal(agreed, 0, "sixty acts never pass without one of the three");
});

test("differential: without those three acts the two agree on every stream", () => {
  const drift: Act[] = ["cancelStale", "pressOverHeld", "unheldFrame"];
  for (let seed = 1; seed <= 400; seed++) {
    const random = seeded(seed),
      pair = new Pair();
    for (let tick = 0; tick < 60; tick++) {
      const acts = possible(pair).filter((act) => !drift.includes(act)),
        act = acts[Math.floor(random() * acts.length)]!;
      pair.act(
        act,
        act === "aimHeld" || act === "releaseHeldAimed"
          ? gridAim(random)
          : undefined,
      );
      const { buffer, fold } = pair.drain();
      assert.deepEqual(buffer, fold, `seed ${seed} tick ${tick} ${act}`);
    }
  }
});

/** The drift, one minimal case each: what the buffer hands `step`, and what every online replica folds. */
const names = (commands: BombActionCommand[]) =>
  commands.map((command) => command.action);
function both(script: (pair: Pair) => void) {
  const pair = new Pair();
  script(pair);
  const { buffer, fold } = pair.drain();
  return { buffer, fold };
}

test("drift 1: a second press over a held one restarts the charge online and is ignored by the buffer", () => {
  const { buffer, fold } = both((pair) => {
    pair.act("pressIdle");
    pair.drain();
    pair.act("pressOverHeld");
  });
  assert.deepEqual(names(buffer), []);
  assert.deepEqual(names(fold), ["cancel", "press"]);
});

test("drift 2: a cancel with nothing held is a command to the buffer and nothing online", () => {
  const { buffer, fold } = both((pair) => {
    pair.act("pressIdle");
    pair.act("releaseHeld");
    pair.drain();
    pair.act("cancelStale");
  });
  assert.deepEqual(names(buffer), ["cancel"]);
  assert.deepEqual(names(fold), []);
});

test("drift 3: an unheld frame with no edge cancels the buffer's charge; the log has no such entry", () => {
  const { buffer, fold } = both((pair) => {
    pair.act("pressIdle");
    pair.drain();
    pair.act("unheldFrame");
  });
  assert.deepEqual(names(buffer), ["cancel"]);
  assert.deepEqual(names(fold), []);
});

test("drift 4: a cancel wipes what the buffer had queued this tick, a launch included; online every command stands", () => {
  const { buffer, fold } = both((pair) => {
    pair.act("pressIdle");
    pair.act("releaseHeld");
    pair.act("pressIdle");
    pair.act("cancelHeld");
  });
  assert.deepEqual(names(buffer), ["cancel"]);
  assert.deepEqual(names(fold), ["press", "release", "press", "cancel"]);
});

test("drift 5: the buffer forgets an aim the moment nothing is held; the fold carries it into the next press", () => {
  const aim = { x: 0.25, y: 0.75 };
  const pair = new Pair();
  pair.buffer.accept(false, undefined, aim);
  const held = pair.held;
  foldPlayerEntries(held, [[1, 1, AIM, ...quantizeAim(aim)]]);
  pair.buffer.accept(true, "press");
  const folded = foldPlayerEntries(held, [[2, 2, PRESS, 1]]).bombCommands!;
  assert.deepEqual(pair.buffer.drainCommands(), [{ action: "press" }]);
  assert.equal(folded.length, 1);
  assert.ok(folded[0]!.aim, "the fold's press is aimed");
});

test("drift 6: a held frame whose press was lost arms the buffer, so its release is a command; online it is nothing", () => {
  const pair = new Pair();
  pair.buffer.accept(true);
  pair.buffer.accept(false, "release");
  assert.deepEqual(names(pair.buffer.drainCommands()), ["release"]);
  assert.deepEqual(
    foldPlayerEntries(pair.held, [[1, 1, RELEASE, 1]]).bombCommands,
    undefined,
  );
});

test("drift 7: past eight queued commands the buffer cancels and then wants a neutral frame; the fold has no such bound", () => {
  const pair = new Pair();
  for (let gesture = 0; gesture < 5; gesture++) {
    pair.act("pressIdle");
    if (gesture < 4) pair.act("releaseHeld");
  }
  const { buffer, fold } = pair.drain();
  assert.deepEqual(names(buffer), ["cancel"]);
  assert.equal(fold.length, 9);
  // Still held as far as the device knows: it lets go, and presses again in the same frame sequence.
  pair.act("releaseHeld");
  pair.act("pressIdle");
  const after = pair.drain();
  assert.deepEqual(names(after.buffer), ["press"]);
  assert.deepEqual(names(after.fold), ["release", "press"]);
});

test("the fold alone: gesture ids make duplicates and reordering harmless", () => {
  const held = neutralControls();
  const fold = (...entries: Entry[]) =>
    names([...(foldPlayerEntries(held, entries).bombCommands ?? [])]);
  assert.deepEqual(fold([1, 1, PRESS, 2]), ["press"]);
  assert.deepEqual(fold([2, 2, PRESS, 2]), [], "a duplicate press");
  assert.deepEqual(fold([3, 3, PRESS, 1]), [], "an older gesture, late");
  assert.deepEqual(fold([4, 4, RELEASE, 1]), [], "a release of another");
  assert.deepEqual(fold([5, 5, RELEASE, 2]), ["release"]);
  assert.deepEqual(fold([6, 6, RELEASE, 2]), [], "a duplicate release");
  assert.deepEqual(fold([7, 7, CANCEL, 2]), [], "a cancel after the release");
  assert.deepEqual(held.activeGesture, 0);
  assert.deepEqual(held.latestGesture, 2);
});
