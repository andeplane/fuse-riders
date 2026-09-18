import assert from "node:assert/strict";
import test from "node:test";
import { BombInputBuffer } from "../src/engine/bomb-input.js";
import {
  CANCEL,
  PRESS,
  RELEASE,
  foldPlayerEntries,
  neutralControls,
  type Entry,
  type HeldControls,
} from "../src/engine/input-log.js";
import type { BombActionCommand } from "../src/engine/primitives.js";

/**
 * Two implementations used to turn a rider's bomb button into the ordered `press` / `release` / `cancel` commands
 * `step` reads: `BombInputBuffer`, written for the LAN server's per-connection frames, and `foldPlayerEntries`, the
 * fold of log entries every online replica agrees on. The architecture review (C2) said they had drifted. The first
 * version of this file (commit `769a2fb`) fed both the same device behaviour and wrote down where they parted on
 * `14e1452`; the cases below keep those findings by name (drift 5, about Target Bomb's aim, went with the aim input
 * in `fuse-p2p-39`). Both now run one core (`src/engine/bomb-gesture.ts`)
 * with the fold's semantics, so what is asserted here is agreement.
 *
 * A device is modelled by what it does, not by either implementation: it presses (always a new gesture, numbered
 * from 1), releases or cancels the gesture it holds, and misbehaves in the ways a lossy or
 * hostile link can: resends, stale ids, a second press over a held one. Each act becomes one frame for the buffer and
 * the entries the wire contract (`docs/online/PROTOCOL.md`: PRESS/RELEASE/CANCEL carry the gesture id) has for it.
 */
type Act =
  | "pressIdle"
  | "pressOverHeld"
  | "resendPress"
  | "releaseHeld"
  | "releaseStale"
  | "cancelHeld"
  | "cancelStale"
  | "emptyFrame";
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
  act(act: Act): void {
    switch (act) {
      case "pressIdle":
      case "pressOverHeld":
        this.active = ++this.latest;
        this.buffer.accept("press");
        this.log(PRESS, this.active);
        return;
      case "resendPress":
        // The link repeats the entry. A device's frames have no such thing: the edge happened once.
        this.log(PRESS, this.active);
        return;
      case "releaseHeld":
        this.buffer.accept("release");
        this.log(RELEASE, this.active);
        this.active = 0;
        return;
      case "releaseStale":
        this.buffer.accept("release");
        this.log(RELEASE, this.latest);
        return;
      case "cancelHeld":
        this.buffer.accept("cancel");
        this.log(CANCEL, this.active);
        this.active = 0;
        return;
      case "cancelStale":
        this.buffer.accept("cancel");
        this.log(CANCEL, this.latest);
        return;
      case "emptyFrame":
        this.buffer.accept();
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
        "releaseHeld",
        "cancelHeld",
        "emptyFrame",
      ]
    : [
        "pressIdle",
        "emptyFrame",
        ...(pair.latest ? (["releaseStale", "cancelStale"] as const) : []),
      ];

test("differential: the buffer and the fold hand step the same commands, act for act, on every seeded stream", () => {
  const seen = new Set<Act>();
  let commands = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const random = seeded(seed),
      pair = new Pair();
    for (let tick = 0; tick < 60; tick++) {
      // Up to four acts land in one tick, as they do when a device outruns the clock; at most two commands each, so
      // the buffer's bound of eight is never what decides.
      const trace: Act[] = [];
      for (let count = Math.floor(random() * 5); count > 0; count--) {
        const acts = possible(pair),
          act = acts[Math.floor(random() * acts.length)]!;
        pair.act(act);
        trace.push(act);
        seen.add(act);
      }
      const { buffer, fold } = pair.drain();
      assert.deepEqual(buffer, fold, `seed ${seed} tick ${tick}: ${trace}`);
      commands += fold.length;
    }
  }
  assert.equal(seen.size, 8, "every act was exercised");
  assert.ok(commands > 10_000, `${commands} commands compared`);
});

/** The places the two parted before they shared a core, one minimal case each, now with one answer. */
const names = (commands: BombActionCommand[]) =>
  commands.map((command) => command.action);
function both(script: (pair: Pair) => void): BombActionCommand[] {
  const pair = new Pair();
  script(pair);
  const { buffer, fold } = pair.drain();
  assert.deepEqual(buffer, fold);
  return fold;
}

test("was drift 1: a second press over a held one restarts the charge (the buffer used to ignore it)", () => {
  const commands = both((pair) => {
    pair.act("pressIdle");
    pair.drain();
    pair.act("pressOverHeld");
  });
  assert.deepEqual(names(commands), ["cancel", "press"]);
});

test("was drift 2: a cancel with nothing held is nothing (the buffer used to emit a cancel)", () => {
  const commands = both((pair) => {
    pair.act("pressIdle");
    pair.act("releaseHeld");
    pair.drain();
    pair.act("cancelStale");
  });
  assert.deepEqual(commands, []);
});

test("was drift 3: a frame with no edge changes nothing (the buffer used to cancel on an unheld frame)", () => {
  const commands = both((pair) => {
    pair.act("pressIdle");
    pair.drain();
    pair.act("emptyFrame");
  });
  assert.deepEqual(commands, []);
  const pair = new BombInputBuffer();
  pair.accept("press");
  pair.cancel();
  assert.deepEqual(
    pair.drain(),
    ["press", "cancel"],
    "losing the button is said, as a device says it when its tab is hidden",
  );
});

test("was drift 4: a cancel closes its own gesture and leaves the tick's earlier commands alone (the buffer used to wipe a queued launch)", () => {
  const commands = both((pair) => {
    pair.act("pressIdle");
    pair.act("releaseHeld");
    pair.act("pressIdle");
    pair.act("cancelHeld");
  });
  assert.deepEqual(names(commands), ["press", "release", "press", "cancel"]);
});

test("was drift 6: a release nobody pressed for is nothing (a held frame with a lost press used to arm the buffer)", () => {
  const buffer = new BombInputBuffer();
  buffer.accept();
  buffer.accept("release");
  assert.deepEqual(buffer.drain(), []);
  assert.deepEqual(
    foldPlayerEntries(neutralControls(), [[1, 1, RELEASE, 1]]).bombCommands,
    undefined,
  );
});

test("was drift 7: the buffer still bounds its queue, now without a handshake: the next press is a press", () => {
  const buffer = new BombInputBuffer();
  for (let gesture = 0; gesture < 5; gesture++) {
    buffer.accept("press");
    if (gesture < 4) buffer.accept("release");
  }
  assert.deepEqual(buffer.drain(), ["cancel"], "nine commands in one tick");
  buffer.accept("release");
  assert.deepEqual(buffer.drain(), [], "the charge went with the queue");
  buffer.accept("press");
  assert.deepEqual(buffer.drain(), ["press"]);
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
