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
  BOTS_ONLY_MAX_STEPS_PER_TICK,
  BOTS_ONLY_STEPS_PER_TICK,
  COUNTDOWN_TICKS,
  addPlayer,
  eliminatePlayer,
  startMatch,
  step,
} from "../src/engine/game.js";
import { MAX_STEPS_PER_TICK } from "../src/engine/tick-driver.js";
import {
  TICK_MS,
  World,
  SnapshotAssembler,
  decodeSnapshot,
  encodeSnapshot,
  encodePacket,
  packMessage,
  roomHash,
  unpackMessage,
  BEHIND_STEPS,
  CATCHUP_STEPS,
} from "fuse-netcode";
import { type RoomRuntime } from "../src/online/room-runtime.js";
import {
  fuseGame,
  type Frame,
  type FuseWorld,
  type FuseSnapshot,
} from "../src/online/fuse-game.js";
import { ACTION, BOT, JOIN, STEER } from "../src/engine/input-log.js";

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
    fuseGame,
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

  const assembler = new SnapshotAssembler(fuseGame, 7);
  let bytes: Uint8Array | undefined;
  for (const chunk of encodeSnapshot(w, 7))
    bytes = assembler.accept(chunk)?.bytes ?? bytes;
  assert.ok(bytes);
  const decoded = decodeSnapshot(fuseGame, bytes, 7)!;
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
    return decodeSnapshot(fuseGame, packMessage(copy), 7);
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
  assert.equal(RULES, "fuse-p2p-53");
  assert.equal(MAX_STEPS_PER_TICK, BOTS_ONLY_MAX_STEPS_PER_TICK);
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
  const w = new World(fuseGame, state, "human", "human");
  w.stream("human", 1).through = w.tick + 5;
  const before = w.state.game.tick;
  w.advance(w.tick + 1);
  assert.equal(w.state.game.phase, "roundOver");
  assert.equal(w.state.game.tick, before + 1);
});

test("the confirmed tick handed to reports is in game time, so a decided round after a fast endgame still counts as final", () => {
  const w = new World(
    fuseGame,
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

// ---- Pacing by steps: a fast log tick costs three steps, so catch-up and rollback re-runs are budgeted in steps ----

/** Host and guest who never steer and two bots on a clean network, run until only the bots race. */
function fastPhase(): FakeNetwork {
  const net = new FakeNetwork(
    "host",
    { loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 20 },
    7,
  );
  for (const id of HUMANS) {
    const runtime = net.add(id, classicSettings(), { humanName: id });
    runtime.start();
    runtime.command({ type: "join", name: id });
    net.step(1500);
  }
  const host = net.runtimes.get("host")!;
  for (let bot = 0; bot < 2; bot++)
    host.command({ type: "bot", action: "add" });
  net.step(1500);
  assert.ok(host.command({ type: "action", action: "start" }));
  for (let i = 0; i < 4000 && !botsOnly(net); i++) net.step(10);
  assert.ok(botsOnly(net), "the humans crashed and a bot races on");
  return net;
}
function botsOnly(net: FakeNetwork): boolean {
  const frame = net.frame("host");
  return (
    frame?.phase === "playing" &&
    frame.players.every((p) => p.id.startsWith("bot:") || !p.alive) &&
    frame.players.some((p) => p.id.startsWith("bot:") && p.alive)
  );
}
/** Hide the guest until its clock is `gap` log ticks past its frozen world, still in the fast phase. */
function hideFor(net: FakeNetwork, gap: number): RoomRuntime {
  const guest = net.runtimes.get("guest")!;
  net.setHidden("guest", true);
  while (Math.floor(guest.metrics().clockTick) - guest.metrics().tick < gap)
    net.step(10);
  assert.ok(botsOnly(net), "the bots still race while the guest is hidden");
  return guest;
}
const snapshotAsks = (net: FakeNetwork, since: number) =>
  net.reliableLog.filter(
    (m) => m.from === "guest" && m.type === "snapshotRequest" && m.at >= since,
  ).length;

test("a replica far behind in the fast phase catches up at no more than CATCHUP_STEPS steps per loop interval and converges", () => {
  const net = fastPhase();
  try {
    // 120 fast log ticks are 360 steps: under BEHIND_STEPS, so the guest catches up rather than fetching a snapshot.
    const guest = hideFor(net, 120);
    const shownAt = net.now,
      from = guest.metrics();
    net.setHidden("guest", false);
    const perInterval: number[] = [];
    while (guest.metrics().tick < Math.floor(guest.metrics().clockTick) - 1) {
      const before = guest.metrics().steps;
      net.step(10); // Packets delivered in this interval, then the guest's loop pass: one budget window.
      perInterval.push(guest.metrics().steps - before);
      assert.ok(perInterval.length < 1000, "the guest caught up");
    }
    const caughtUp = guest.metrics();
    assert.equal(snapshotAsks(net, shownAt), 0, "caught up, no snapshot");
    assert.ok(
      caughtUp.steps - from.steps >= 3 * 120,
      `the backlog was fast: ${caughtUp.steps - from.steps} steps for ${caughtUp.tick - from.tick} log ticks`,
    );
    assert.ok(
      Math.max(...perInterval) <= CATCHUP_STEPS,
      `no interval ran more than ${CATCHUP_STEPS} steps: ${Math.max(...perInterval)}`,
    );
    assert.ok(
      perInterval.length >= Math.ceil(360 / CATCHUP_STEPS),
      "the catch-up spread over many passes",
    );
    // Converged: the same state hash at every tick both replicas reported past the guest's frozen world.
    net.step(4000);
    const common = [...(net.reportedHashes.get("host")?.keys() ?? [])].filter(
      (tick) => tick > from.tick && net.reportedHashes.get("guest")?.has(tick),
    );
    assert.ok(common.length >= 3, "several confirmed ticks shared");
    for (const tick of common)
      assert.equal(
        net.reportedHashes.get("guest")!.get(tick),
        net.reportedHashes.get("host")!.get(tick),
        `replicas disagree at log tick ${tick}`,
      );
    assert.equal(guest.metrics().mismatches, 0);
  } finally {
    for (const runtime of net.runtimes.values()) runtime.stop();
  }
});

test("the snapshot threshold is BEHIND_STEPS estimated steps: a fast backlog past a third of BEHIND_STEPS log ticks resyncs", () => {
  const threshold = BEHIND_STEPS / BOTS_ONLY_STEPS_PER_TICK; // 133⅓ fast log ticks
  for (const [gap, resyncs] of [
    [Math.floor(threshold) - 6, false],
    [Math.ceil(threshold) + 6, true],
  ] as const) {
    const net = fastPhase();
    try {
      const guest = hideFor(net, gap);
      const shownAt = net.now;
      net.setHidden("guest", false);
      net.step(10);
      assert.equal(
        snapshotAsks(net, shownAt) > 0,
        resyncs,
        `${gap} fast log ticks (${gap * BOTS_ONLY_STEPS_PER_TICK} steps) ${resyncs ? "fetch" : "do not fetch"} a snapshot`,
      );
      // Under the log-tick rule both gaps were far below 400 and neither would have.
      assert.ok(gap < 400);
      for (let i = 0; i < 400; i++) {
        net.step(10);
        const m = guest.metrics();
        if (m.tick >= Math.floor(m.clockTick) - 1) break;
      }
      assert.ok(
        guest.metrics().tick >= Math.floor(guest.metrics().clockTick) - 1,
        "either way the guest is current again",
      );
    } finally {
      for (const runtime of net.runtimes.values()) runtime.stop();
    }
  }
});

test("a deep rollback in the fast phase re-runs within the step budget, keeps the shown frames until it is done, and ends on the unbudgeted state", () => {
  const build = () => {
    const w = new World(
      fuseGame,
      createRoomState("m", classicSettings()),
      "creator",
      "creator",
    );
    const creator = w.stream("creator", 1),
      b = w.stream("b", 1);
    creator.append(1, [JOIN, "b", "B", 0, "fox", 1]);
    creator.append(1, [BOT, "add", "bot:1", "AI Hopper", 1]);
    creator.append(1, [BOT, "add", "bot:2", "AI Nova", 2]);
    creator.append(2, [ACTION, "start", "m"]);
    const to = (tick: number) => {
      creator.through = b.through = tick;
      w.advance(tick);
    };
    to(COUNTDOWN_TICKS + 2);
    eliminatePlayer(w.state.game, "b");
    to(w.tick + 60);
    assert.equal(w.state.game.phase, "playing", "the bots still race");
    return { w, b };
  };
  const late = (w: FuseWorld, b: { through: number }) =>
    w.receive("b", [[1, w.tick - 38, STEER, 1]], 1, b.through, w.tick);

  const reference = build();
  const straight = late(reference.w, reference.b);
  assert.ok(straight.rollbackTicks >= 38);

  const { w, b } = build();
  const at = w.tick,
    shown = w.view()[0]!,
    before = w.steps;
  w.refill(CATCHUP_STEPS);
  const result = late(w, b);
  assert.equal(result.rollbackTicks, straight.rollbackTicks);
  assert.ok(w.steps - before <= CATCHUP_STEPS, "the receive ran one budget");
  assert.ok(!w.settled, "the rest of the re-run is owed");
  let passes = 0;
  while (!w.settled) {
    assert.equal(w.tick, at, "the world's tick never goes back");
    assert.equal(w.view()[0], shown, "the old frames stay until it is done");
    w.refill(CATCHUP_STEPS);
    const start = w.steps;
    w.advance(at);
    assert.ok(w.steps - start <= CATCHUP_STEPS);
    passes++;
  }
  assert.ok(
    passes >= (straight.rollbackTicks * 3) / CATCHUP_STEPS - 2,
    `${straight.rollbackTicks} fast log ticks took ${passes} more passes`,
  );
  assert.equal(w.tick, at);
  assert.notEqual(w.view()[0], shown, "the re-run's frames replace them");
  assert.equal(w.view()[0]!.logTick, at);
  assert.equal(hashRoomState(w.state), hashRoomState(reference.w.state));
  assert.deepEqual(w.view()[0], reference.w.view()[0]);
});

/**
 * Host, "able" and guest; able's fast packets reach the guest 1.7 s (34 ticks) late. One steering flip by able, sent a
 * few ticks before something happens to the guest's own seat, reaches the guest after it and rolls it back to before
 * that seat change, and the first budget window's re-run stops short of it: the owed re-run has the seat as it was.
 */
function lateRollback(): { net: FakeNetwork; flip: () => void } {
  const net = new FakeNetwork(
    "host",
    {
      loss: 0,
      baseMs: 20,
      jitterMs: 0,
      reliableMs: 20,
      oneWayMs: (from, to) => (from === "able" && to === "guest" ? 1700 : 20),
    },
    3,
  );
  for (const id of ["host", "able", "guest"]) {
    net.add(id, classicSettings(), { humanName: id }).start();
    net.step(1500);
  }
  for (const id of ["host", "able"])
    net.runtimes.get(id)!.command({ type: "join", name: id });
  net.step(1500);
  let left = false,
    seq = 0;
  const flip = () => {
    left = !left;
    assert.ok(
      net.runtimes.get("able")!.command({
        type: "input",
        seq: ++seq,
        left,
        right: false,
        bomb: false,
      }),
    );
  };
  return { net, flip };
}
const bomb = (bombAction: "press" | "release", seq: number) =>
  ({
    type: "input",
    seq,
    left: false,
    right: false,
    bomb: bombAction === "press",
    bombAction,
  }) as const;
/** Step until the guest owes a re-run: able's late flip has just rolled it back. */
function untilOwed(net: FakeNetwork): void {
  const guest = net.runtimes.get("guest")!,
    rollbacks = guest.metrics().rollbacks;
  for (let i = 0; i < 400; i++) {
    net.step(10);
    if (guest.metrics().rollbacks > rollbacks) {
      assert.ok(!guest.metrics().settled, "the re-run is owed");
      return;
    }
  }
  assert.fail("the late flip never rolled the guest back");
}
/** Whether the guest's own newest frame shows it seated (and connected, or not). */
const seated = (net: FakeNetwork, connected = true) =>
  net
    .frame("guest")
    ?.players.some((p) => p.id === "guest" && p.connected === connected) ===
  true;

test("a release during a re-run that reaches back past this rider's own join is still logged: controls read the world's newest state, never the re-run", () => {
  const { net, flip } = lateRollback();
  try {
    const guest = net.runtimes.get("guest")!;
    flip();
    net.step(400);
    guest.command({ type: "join", name: "guest" });
    for (let i = 0; i < 100 && !seated(net); i++) net.step(10);
    assert.ok(seated(net));
    assert.ok(guest.command(bomb("press", 1)), "the press is taken");
    untilOwed(net);
    const before = guest.metrics().streams.guest!.lastSeq;
    assert.ok(guest.command(bomb("release", 2)), "the release is taken");
    assert.equal(
      guest.metrics().streams.guest!.lastSeq,
      before + 1,
      "and logged: the gesture ends",
    );
    net.step(1000);
    assert.ok(guest.metrics().settled);
    assert.ok(seated(net));
  } finally {
    for (const runtime of net.runtimes.values()) runtime.stop();
  }
});

test("the tick loop's own check fetches a snapshot for a backlog past BEHIND_STEPS: a stall that clears all at once", () => {
  // The guest hears the host 25 s late, so it stalls forty ticks past what it last heard; when the delay ends, the
  // stall rule lets it reach its clock at once, 460 lobby ticks (one step each) ahead. The tab was never hidden.
  let delayMs = 20;
  const net = new FakeNetwork(
    "host",
    {
      loss: 0,
      baseMs: 20,
      jitterMs: 0,
      reliableMs: 20,
      oneWayMs: (from, to) =>
        from === "host" && to === "guest" ? delayMs : 20,
    },
    5,
  );
  try {
    for (const id of ["host", "able", "guest"]) {
      const runtime = net.add(id, classicSettings(), { humanName: id });
      runtime.start();
      runtime.command({ type: "join", name: id });
      net.step(1500);
    }
    const guest = net.runtimes.get("guest")!,
      delayedAt = net.now;
    delayMs = 25_000;
    net.step(25_000);
    const stalled = guest.metrics();
    assert.ok(
      Math.floor(stalled.clockTick) - stalled.tick > BEHIND_STEPS,
      `stalled ${Math.floor(stalled.clockTick) - stalled.tick} ticks behind its clock`,
    );
    assert.equal(snapshotAsks(net, delayedAt), 0, "no snapshot while stalled");
    delayMs = 20;
    const at = net.now;
    net.step(200);
    assert.ok(
      snapshotAsks(net, at) > 0,
      "the backlog is fetched, not replayed",
    );
    net.step(3000);
    const m = guest.metrics();
    assert.ok(m.tick >= Math.floor(m.clockTick) - 1, "current again");
    assert.equal(m.mismatches, 0);
  } finally {
    for (const runtime of net.runtimes.values()) runtime.stop();
  }
});

test("a loop pass that throws after advancing still opens the next step budget: the world keeps advancing, and the throw still escapes the pass", () => {
  const net = new FakeNetwork(
    "host",
    { loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 20 },
    9,
  );
  try {
    // The host manages without a seat, so a gap in its stream stalls nobody: only the guest rides, with two bots.
    for (const id of ["host", "guest"]) {
      net.add(id, classicSettings(), { humanName: id }).start();
      net.step(1500);
    }
    const host = net.runtimes.get("host")!,
      guest = net.runtimes.get("guest")!;
    guest.command({ type: "join", name: "guest" });
    for (let bot = 0; bot < 2; bot++)
      host.command({ type: "bot", action: "add" });
    net.step(1500);
    assert.ok(host.command({ type: "action", action: "start" }));
    net.step(500);
    // A packet from the host skipping one entry opens a gap on the guest, whose loop then asks the transport about
    // the host after it has advanced, on every pass until the gap closes; the transport throws there.
    const clock = Math.floor(guest.metrics().clockTick),
      after = guest.metrics().streams.host!.contiguous + 2;
    net.transports.get("guest")!.events.fast(
      "host",
      encodePacket({
        room: roomHash("AB42:host"),
        from: "host",
        generation: 1,
        through: clock,
        lastSeq: after,
        entries: [[after, clock + 20, STEER, 0]],
        sentAt: 0,
        echoSentAt: 0,
        echoHeld: 0,
        clockTick: clock,
        hash: null,
      }),
    );
    assert.ok(guest.metrics().streams.host!.gap, "the gap is open");
    // Silence the host's own packets, which would otherwise answer the gap from the receive path first.
    net.muted.add("host");
    net.transports.get("guest")!.failing.add("host");
    const pass = net.ticks.get("guest")!;
    let thrown = 0;
    net.ticks.set("guest", () => {
      try {
        pass();
      } catch {
        thrown++;
      }
    });
    const from = guest.metrics();
    net.step(1000);
    const to = guest.metrics();
    assert.ok(
      thrown >= 90,
      `nearly every pass threw, and the throw escaped it: ${thrown}`,
    );
    assert.ok(
      to.tick >= Math.floor(to.clockTick) - 1 && to.tick - from.tick >= 19,
      `the world kept pace with its clock: ${from.tick} → ${to.tick}, clock ${to.clockTick.toFixed(1)}`,
    );
  } finally {
    for (const runtime of net.runtimes.values()) runtime.stop();
  }
});
