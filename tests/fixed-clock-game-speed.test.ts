import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import {
  RULES,
  createRoomState,
  hashRoomState,
} from "../src/engine/apply-tick.js";
import {
  BOTS_ONLY_STEPS_PER_TICK,
  COUNTDOWN_TICKS,
  addPlayer,
  eliminatePlayer,
  startMatch,
  step,
} from "../src/engine/game.js";
import { MAX_STEPS_PER_TICK } from "../src/engine/tick-driver.js";
import { TICK_MS } from "../src/online/clock.js";
import { World, type Frame } from "../src/online/rollback.js";
import {
  SnapshotAssembler,
  decodeSnapshot,
  encodeSnapshot,
} from "../src/online/snapshot.js";
import { packMessage, unpackMessage } from "../src/online/packet.js";
import { ACTION, BOT, JOIN } from "../src/engine/input-log.js";
import type { RoomRuntime } from "../src/online/room-runtime.js";

/**
 * #258 N2: game speed is simulation steps per log tick, decided from folded state, and the shared clock never changes
 * rate. These drive whole runtimes over the deterministic lossy `FakeNetwork`.
 */

const HUMANS = ["host", "guest"] as const;
const SLOW_MS = 800;
/** Humans hear each other late, so each speculates about the other; bots are simulated by everyone. */
const options = (): NetworkOptions => ({
  loss: 0.05,
  duplicate: 0.1,
  baseMs: 20,
  jitterMs: 50,
  reliableMs: 40,
  oneWayMs: () => SLOW_MS,
});

interface Run {
  net: FakeNetwork;
  runtimes: Map<string, RoomRuntime>;
  /** Every frame each member published, in order, rollback republishes included. */
  frames: Map<string, Frame[]>;
  /** Clock ticks each member advanced per wall-clock second, sampled from the start of the match. */
  rates: number[];
  step: (ms: number) => void;
}

/** Two humans who never steer and two bots, on the open classic arena. */
function start(seed: number): Run {
  const net = new FakeNetwork("host", options(), seed);
  const runtimes = new Map<string, RoomRuntime>();
  for (const id of HUMANS) {
    const runtime = net.add(id, classicSettings(), { humanName: id });
    runtime.start();
    runtime.command({ type: "join", name: id });
    runtimes.set(id, runtime);
    net.step(1500);
  }
  const host = runtimes.get("host")!;
  for (let bot = 0; bot < 2; bot++)
    host.command({ type: "bot", action: "add" });
  net.step(1500);
  assert.ok(host.command({ type: "action", action: "start" }));
  const frames = new Map<string, Frame[]>(HUMANS.map((id) => [id, []]));
  const seen = new WeakSet<Frame>();
  const rates: number[] = [];
  let last: number[] | undefined;
  const step = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      net.step(10);
      for (const id of HUMANS)
        for (const frame of net.recorded.get(id)!.states)
          if (!seen.has(frame)) {
            seen.add(frame);
            frames.get(id)!.push(frame);
          }
      if (net.now % 1000 !== 0) continue;
      const clocks = HUMANS.map((id) => runtimes.get(id)!.metrics().clockTick);
      if (last)
        rates.push(...clocks.map((clock, index) => clock - last![index]!));
      last = clocks;
    }
  };
  return { net, runtimes, frames, rates, step };
}

/** Log tick of the first frame in the first round that shows `id` dead. */
function deathTick(frames: readonly Frame[], id: string): number | undefined {
  return frames.find(
    (frame) =>
      frame.round === 1 &&
      frame.phase === "playing" &&
      frame.players.some((player) => player.id === id && !player.alive),
  )?.logTick;
}
/** How far the game's clock has run ahead of the log's: grows by two for every fast log tick. */
const lead = (frame: Frame): number => frame.tick - frame.logTick;
/** Whether `frames` ever went back on steps it had already run: only a rollback that changed the count does that. */
function flipped(frames: readonly Frame[]): boolean {
  let most = 0;
  for (const frame of frames) {
    if (lead(frame) < most) return true;
    most = Math.max(most, lead(frame));
  }
  return false;
}

function playOutRound(run: Run): void {
  for (
    let i = 0;
    i < 2400 &&
    HUMANS.some((id) => {
      const frame = run.net.frame(id);
      return !frame || frame.round === 1;
    });
    i++
  )
    run.step(50);
  assert.ok(
    HUMANS.every((id) => (run.net.frame(id)?.round ?? 1) > 1),
    "the first round ended on every replica",
  );
}

/** Heal the network, let every replica settle, and require the same state hash at every tick all of them reported. */
function assertConverged(run: Run): void {
  const settledAfter = Math.max(
    ...[...run.runtimes.values()].map((runtime) => runtime.metrics().tick),
  );
  run.net.options = { ...options(), loss: 0, duplicate: 0, jitterMs: 0 };
  run.step(5000);
  const common = [...(run.net.reportedHashes.get("host")?.keys() ?? [])].filter(
    (tick) =>
      tick > settledAfter &&
      HUMANS.every((id) => run.net.reportedHashes.get(id)?.has(tick)),
  );
  assert.ok(common.length >= 3, "several confirmed ticks shared after repair");
  for (const tick of common)
    assert.equal(
      new Set(HUMANS.map((id) => run.net.reportedHashes.get(id)!.get(tick)))
        .size,
      1,
      `replicas disagree at log tick ${tick}`,
    );
  for (const runtime of run.runtimes.values()) {
    assert.equal(runtime.metrics().mismatches, 0);
    assert.equal(runtime.metrics().snapshotRequest, false);
  }
}

function assertOneClockRate(run: Run): void {
  assert.ok(run.rates.length > 20, "the clock was sampled throughout");
  const perSecond = 1000 / TICK_MS;
  assert.ok(
    run.rates.every((ticks) => Math.abs(ticks - perSecond) <= 1),
    `the wall clock ran at ${perSecond} ticks a second throughout: ${run.rates.map((ticks) => ticks.toFixed(2)).join(" ")}`,
  );
}

const stop = (run: Run) => {
  for (const runtime of run.runtimes.values()) runtime.stop();
};

for (const seed of [11, 20260918])
  test(`only bots survive: every replica runs three steps per log tick on one clock rate and converges, through loss and jitter (${seed})`, () => {
    const run = start(seed);
    try {
      playOutRound(run);
      for (const id of HUMANS) {
        const frames = run.frames.get(id)!,
          end = frames.filter((frame) => frame.round === 1).at(-1)!;
        assert.ok(
          lead(end) >= 2 * 10,
          `${id} ran at least ten fast log ticks: the game clock is ${lead(end)} steps ahead of the log`,
        );
        assert.ok(
          HUMANS.every((human) => deathTick(frames, human) !== undefined),
        );
      }
      assert.ok(run.net.droppedFast > 0 && run.net.reorderedFast > 0);
      assertOneClockRate(run);
      assertConverged(run);
    } finally {
      stop(run);
    }
  });

test("a late human input that keeps the last human alive flips the fast-mode decision back on the replica that speculated past it, and every replica converges", () => {
  // A probe run finds who dies last and when. The same seed then replays identically up to the one input that differs:
  // the last human starts turning away a few ticks before its crash. Its packets reach the other human 800 ms late, so
  // that replica has already simulated the crash and the fast steps after it when the turn arrives, rolls back across
  // the boundary and replays those ticks at one step each. The turning rider's own replica never went fast there.
  const seed = 5;
  const probe = start(seed);
  let last: string, crash: number;
  try {
    for (let i = 0; i < 1200; i++) {
      probe.step(50);
      if (
        HUMANS.every(
          (id) => deathTick(probe.frames.get("host")!, id) !== undefined,
        )
      )
        break;
    }
    const deaths = HUMANS.map(
      (id) => [id, deathTick(probe.frames.get("host")!, id)!] as const,
    );
    [last, crash] = deaths.reduce((a, b) => (b[1] > a[1] ? b : a));
    assert.ok(
      deaths.every(([id, tick]) => id === last || tick < crash),
      "one human dies strictly last",
    );
    const atCrash = probe.frames
      .get("host")!
      .find((frame) => frame.logTick === crash)!;
    assert.ok(
      atCrash.players.some((p) => p.id.startsWith("bot:") && p.alive),
      "a bot was alive when the last human crashed, so the probe went fast",
    );
  } finally {
    stop(probe);
  }
  const other = HUMANS.find((id) => id !== last)!;
  const tried: string[] = [];
  // Turning early enough to miss the wall depends on the angle of approach; the first lead that saves the rider is used.
  for (const early of [8, 10, 12, 14]) {
    const run = start(seed);
    try {
      const turning = run.runtimes.get(last)!,
        at = crash - early;
      while (Math.floor(turning.metrics().clockTick) + 1 < at) run.step(10);
      assert.ok(
        turning.command({
          type: "input",
          seq: 1,
          left: true,
          right: false,
          bomb: false,
        }),
      );
      playOutRound(run);
      const own = run.frames.get(last)!;
      const survived = own.some(
        (frame) =>
          frame.round === 1 &&
          frame.logTick > crash + 5 &&
          frame.players.some((p) => p.id === last && p.alive),
      );
      tried.push(`${early}: ${survived ? "survived" : "crashed"}`);
      if (!survived) continue;
      assert.ok(
        flipped(run.frames.get(other)!),
        `${other} speculated the crash, ran fast steps past it and took them back when the turn arrived`,
      );
      assert.ok(
        !flipped(own),
        `${last}, which knew of its own turn, never ran a fast step it had to take back`,
      );
      assert.ok(
        run.net.runtimes.get(other)!.metrics().rollbacks > 0,
        "the flip came through a rollback",
      );
      for (const id of HUMANS) {
        const end = run.frames
          .get(id)!
          .filter((frame) => frame.round === 1)
          .at(-1)!;
        assert.ok(
          lead(end) > 0,
          `${id}: once the turning rider did die, the bots raced on at three steps per tick`,
        );
      }
      assertOneClockRate(run);
      assertConverged(run);
      return;
    } finally {
      stop(run);
    }
  }
  assert.fail(
    `no early turn kept ${last} alive past log tick ${crash}: ${tried.join(", ")}`,
  );
});

test("a snapshot carries both counters, and the guard refuses a game clock the log tick's steps cannot cover", () => {
  const w = new World(
    createRoomState("m", classicSettings()),
    "creator",
    "creator",
  );
  const creator = w.stream("creator", 1);
  creator.append(1, [JOIN, "creator", "Creator", 0, "fox", 1]);
  creator.append(1, [BOT, "add", "bot:1", "AI Hopper", 1]);
  creator.append(1, [BOT, "add", "bot:2", "AI Nova", 2]);
  creator.append(2, [ACTION, "start", "m"]);
  creator.through = COUNTDOWN_TICKS + 5;
  w.advance(COUNTDOWN_TICKS + 5);
  assert.equal(w.state.game.phase, "playing");
  eliminatePlayer(w.state.game, "creator");
  creator.through = COUNTDOWN_TICKS + 45;
  w.advance(COUNTDOWN_TICKS + 45);
  assert.equal(w.state.game.phase, "playing", "the bots still race");
  assert.equal(w.tick, COUNTDOWN_TICKS + 45);
  assert.ok(
    w.state.game.tick > w.tick + 40,
    `forty fast log ticks ran ${w.state.game.tick - w.tick} extra steps`,
  );

  const assembler = new SnapshotAssembler(7);
  let bytes: Uint8Array | undefined;
  for (const chunk of encodeSnapshot(w, 7))
    bytes = assembler.accept(chunk)?.bytes ?? bytes;
  assert.ok(bytes);
  const decoded = decodeSnapshot(bytes, 7)!;
  assert.equal(
    decoded.state.tick,
    w.tick,
    "the envelope's tick is the log tick",
  );
  assert.equal(decoded.state.game.tick, w.state.game.tick);
  assert.equal(hashRoomState(decoded.state), hashRoomState(w.state));

  const fields = unpackMessage(bytes) as unknown[];
  const withTick = (tick: number) => {
    const copy = structuredClone(fields);
    copy[2] = tick;
    // A consistent hash, so only the guard can refuse it.
    copy[8] = hashRoomState({ ...decoded.state, tick });
    return decodeSnapshot(packMessage(copy), 7);
  };
  const game = w.state.game.tick;
  assert.ok(withTick(game), "a log tick the game clock equals");
  assert.ok(
    withTick(Math.ceil(game / MAX_STEPS_PER_TICK)),
    "a log tick whose every step was fast",
  );
  assert.equal(
    withTick(Math.ceil(game / MAX_STEPS_PER_TICK) - 1),
    undefined,
    "more steps than the log ticks could run",
  );
  assert.equal(withTick(game + 1), undefined, "fewer steps than log ticks");
  assert.equal(RULES, "fuse-p2p-42");
  assert.equal(MAX_STEPS_PER_TICK, BOTS_ONLY_STEPS_PER_TICK);
});

test("fast steps stop at the round's end: the pause after it runs at one step per tick", () => {
  const state = createRoomState("m", classicSettings());
  for (const [slot, id] of ["human", "bot:1", "bot:2"].entries())
    addPlayer(state.game, { id, name: id, slot, color: "#fff" });
  state.bots.add("bot:1").add("bot:2");
  startMatch(state.game);
  while (state.game.phase === "countdown") step(state.game, new Map());
  eliminatePlayer(state.game, "human");
  eliminatePlayer(state.game, "bot:2");
  // One bot left alive and the human dead: the next step ends the round, and nothing more runs in that tick.
  const w = new World(state, "human", "human");
  w.stream("human", 1).through = w.tick + 5;
  const before = w.state.game.tick;
  w.advance(w.tick + 1);
  assert.equal(w.state.game.phase, "roundOver");
  assert.equal(w.state.game.tick, before + 1);
});

test("the confirmed tick handed to reports is in game time, so a decided round after a fast endgame still counts as final", () => {
  const w = new World(
    createRoomState("m", classicSettings()),
    "creator",
    "creator",
  );
  const creator = w.stream("creator", 1);
  creator.append(1, [JOIN, "creator", "Creator", 0, "fox", 1]);
  creator.append(1, [BOT, "add", "bot:1", "AI Hopper", 1]);
  creator.append(1, [BOT, "add", "bot:2", "AI Nova", 2]);
  creator.append(2, [ACTION, "start", "m"]);
  creator.through = COUNTDOWN_TICKS + 5;
  w.advance(COUNTDOWN_TICKS + 5);
  eliminatePlayer(w.state.game, "creator");
  creator.through = 5000;
  for (let i = 0; i < 4000 && w.state.game.phase === "playing"; i++)
    w.advance(w.tick + 1);
  assert.equal(w.state.game.phase, "roundOver");
  creator.through = w.tick;
  const decided = w.state.game.decidedRound!;
  assert.ok(decided, "the round was decided");
  assert.ok(
    decided.tick > w.completeTick(),
    "in log ticks the decision looks unconfirmed: the two clocks must not be compared",
  );
  assert.equal(w.confirmedGameTick(), w.state.game.tick);
  assert.ok(decided.tick <= w.confirmedGameTick());
  // Partly confirmed: the game clock at that log tick, not the log tick itself.
  const at = w.tick - 3;
  creator.through = at;
  assert.equal(w.completeTick(), at);
  assert.ok(w.confirmedGameTick() > at);
  assert.ok(w.confirmedGameTick() < w.state.game.tick);
});
