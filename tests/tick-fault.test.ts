import assert from "node:assert/strict";
import test from "node:test";
import { BotController } from "../src/engine/bot-controller.js";
import {
  applyTick,
  createRoomState,
  hashRoomState,
  type RoomState,
} from "../src/engine/apply-tick.js";
import {
  PHASES,
  TickFault,
  addPlayer,
  createGame,
  startMatch,
  step,
  COUNTDOWN_TICKS,
  type Phase,
} from "../src/engine/game.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  SNAPSHOT_INTERVAL,
  World,
  type WorldFault,
} from "../src/online/rollback.js";
import { RoomRuntime } from "../src/online/room-runtime.js";
import { FakeNetwork } from "./fixtures/fake-room.js";

/**
 * The seam: PHASES with one more phase in the middle of the tick, after riders have been moved and pickups collected
 * and before anything is committed, that throws on the ticks it is told to. No engine code is patched.
 */
function failingAt(shouldFail: (tick: number) => boolean): Phase[] {
  const at = PHASES.findIndex((phase) => phase.name === "commitMovement");
  assert.ok(at > 0);
  return [
    ...PHASES.slice(0, at),
    {
      name: "injectedFailure",
      when: "playing",
      run: ({ state }) => {
        if (shouldFail(state.tick)) throw new Error("injected");
      },
    },
    ...PHASES.slice(at),
  ];
}

/** p0 is this replica's rider and p1 a bot, so the world never stalls waiting for a stream nobody feeds. */
function room(): RoomState {
  const state = createRoomState("fault", defaultRoomSettings());
  addPlayer(state.game, { id: "p0", name: "P0", slot: 0, color: "#fff" });
  addPlayer(state.game, { id: "bot:1", name: "Ada", slot: 1, color: "#fff" });
  state.bots.add("bot:1");
  startMatch(state.game);
  return state;
}

test("a phase that throws surfaces as a TickFault naming the tick and the phase, and the state is left mid-tick", () => {
  const game = createGame("fault");
  for (let slot = 0; slot < 2; slot++)
    addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  const failing = game.tick + 1;
  const before = structuredClone(game);
  assert.throws(
    () =>
      step(
        game,
        new Map(),
        failingAt((tick) => tick === failing),
      ),
    (error) =>
      error instanceof TickFault &&
      error.tick === failing &&
      error.phase === "injectedFailure" &&
      error.cause instanceof Error &&
      error.cause.message === "injected",
  );
  // This is why a driver must not keep the state: the clock moved and nobody did.
  assert.equal(game.tick, failing);
  assert.deepEqual(
    [...game.players.values()].map(({ x, y }) => [x, y]),
    [...before.players.values()].map(({ x, y }) => [x, y]),
  );
  // Without the injected phase the same list is the ordinary tick.
  const control = structuredClone(before);
  step(control, new Map());
  const viaSeam = structuredClone(before);
  step(
    viaSeam,
    new Map(),
    failingAt(() => false),
  );
  assert.deepEqual(viaSeam, control);
});

test("a world whose tick throws stands on its last whole snapshot, reports the fault once and simulates no further", () => {
  const failing = COUNTDOWN_TICKS + 2 * SNAPSHOT_INTERVAL + 2;
  const world = new World(
    room(),
    "p0",
    "p0",
    failingAt((tick) => tick === failing),
  );
  const healthy = new World(room(), "p0", "p0");
  const lastWhole = failing - 1 - ((failing - 1) % SNAPSHOT_INTERVAL);

  let result = world.advance(failing - 1);
  assert.equal(result.fault, undefined);
  assert.equal(world.tick, failing - 1);

  assert.doesNotThrow(() => (result = world.advance(failing + 20)));
  const fault: WorldFault = result.fault!;
  assert.equal(fault.tick, failing);
  assert.equal(fault.phase, "injectedFailure");
  assert.ok(fault.error instanceof TickFault);
  assert.equal(world.fault, fault);

  // Whole again: exactly the state a healthy world has at that snapshot's tick, not the half-simulated one.
  healthy.advance(lastWhole);
  assert.equal(world.tick, lastWhole);
  assert.equal(hashRoomState(world.state), hashRoomState(healthy.state));
  assert.equal(world.view()[0]!.tick, lastWhole);
  assert.equal(world.servable().tick, lastWhole);
  assert.equal(
    hashRoomState(world.servable().state),
    hashRoomState(healthy.state),
  );

  // Stopped, not spinning: nothing is simulated or re-thrown, and the fault is not reported a second time.
  const again = world.advance(failing + 20);
  assert.deepEqual(again, { events: [] });
  assert.equal(world.tick, lastWhole);

  // A state from a peer that got past the tick replaces the world and clears the fault.
  healthy.advance(failing + 5);
  world.install(structuredClone(healthy.state));
  assert.equal(world.fault, undefined);
  assert.equal(world.advance(failing + 9).fault, undefined);
  healthy.advance(failing + 9);
  assert.equal(hashRoomState(world.state), hashRoomState(healthy.state));
});

test("a throw while a rollback re-simulates is contained the same way", () => {
  let armed = false;
  const failing = COUNTDOWN_TICKS + SNAPSHOT_INTERVAL + 1;
  const world = new World(
    room(),
    "p0",
    "p0",
    failingAt((tick) => armed && tick === failing),
  );
  world.stream("p0", 1);
  world.advance(failing + 6);
  assert.equal(world.fault, undefined);
  armed = true;
  // A late steer, stamped before the failing tick, rolls the world back across it.
  const received = world.receive(
    "p0",
    [[1, failing - 1, 0, 1]],
    1,
    failing + 6,
    failing + 6,
  );
  assert.equal(received.status, "accepted");
  assert.equal(received.fault?.tick, failing);
  assert.ok(world.tick < failing);
  assert.equal(world.tick % SNAPSHOT_INTERVAL, 0);
  assert.deepEqual(world.advance(failing + 10), { events: [] });
});

test("applyTick passes the seam through and does not hide the throw", () => {
  const state = room();
  const bots = new BotController();
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++)
    applyTick(state, "p0", new Map(), bots);
  assert.throws(
    () =>
      applyTick(
        state,
        "p0",
        new Map(),
        bots,
        failingAt(() => true),
      ),
    TickFault,
  );
});

test("a solo runtime reports a simulation fault, stops cleanly and tells the page to reload", () => {
  const net = new FakeNetwork("solo", {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  const faults: WorldFault[] = [];
  const failing = COUNTDOWN_TICKS + 10;
  const statuses: string[] = [];
  const frames: number[] = [];
  const solo = new RoomRuntime(
    "SOLO",
    defaultRoomSettings(),
    {
      state: (frame) => frames.push(frame.tick),
      event: () => {},
      status: (text) => statuses.push(text),
      ready: () => {},
    },
    {
      dependencies: net.dependencies("solo"),
      phases: failingAt((tick) => tick === failing),
      simulationError: (fault) => faults.push(fault),
    },
  );
  try {
    solo.start();
    assert.doesNotThrow(() => net.step(10_000));
    assert.equal(faults.length, 1, "reported once, not once per frame");
    assert.equal(faults[0]!.tick, failing);
    assert.equal(faults[0]!.phase, "injectedFailure");
    const metrics = solo.metrics();
    assert.equal(metrics.faults, 1);
    assert.deepEqual(metrics.lastFault, {
      tick: failing,
      phase: "injectedFailure",
    });
    assert.ok(metrics.tick < failing, "the world never passes the tick");
    assert.ok(
      frames.every((tick) => tick < failing),
      "no frame of a half-simulated tick is ever published",
    );
    assert.equal(statuses.at(-1), "Simulation stopped — reload this page");
  } finally {
    solo.stop();
  }
});

test("a replica whose tick throws is replaced from a healthy peer and the room converges", () => {
  const net = new FakeNetwork("host", {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 40,
  });
  const faults: WorldFault[] = [];
  let failures = 0;
  const host = net.add("host", defaultRoomSettings(), { humanName: "host" });
  host.start();
  host.command({ type: "join", name: "host" });
  net.step(1000);
  // Only this replica is broken, and only once: the analogue of local damage, which a peer's state can repair.
  const rider = net.add("rider", defaultRoomSettings(), {
    humanName: "rider",
    phases: failingAt(
      (tick) => tick > COUNTDOWN_TICKS + 40 && failures++ === 0,
    ),
    simulationError: (fault) => faults.push(fault),
  });
  rider.start();
  rider.command({ type: "join", name: "rider" });
  net.step(1000);
  try {
    assert.ok(host.command({ type: "action", action: "start" }));
    net.step(12_000);
    assert.equal(faults.length, 1);
    assert.equal(rider.metrics().faults, 1);
    assert.ok(
      net.recorded
        .get("rider")!
        .statuses.includes("Simulation fault · resyncing"),
    );
    assert.ok(
      net.reliableLog.some(
        (message) =>
          message.from === "rider" && message.type === "snapshotRequest",
      ),
      "the faulted replica asked a peer for its state",
    );
    assert.ok(
      rider.metrics().tick > faults[0]!.tick + 20,
      "and rides on past the tick that failed",
    );
    assert.equal(rider.metrics().snapshotRequest, false);
    const common = [...(net.reportedHashes.get("host")?.keys() ?? [])].filter(
      (tick) =>
        tick > faults[0]!.tick + 20 &&
        net.reportedHashes.get("rider")?.has(tick),
    );
    assert.ok(common.length >= 3, "shared confirmed ticks after the repair");
    for (const tick of common)
      assert.equal(
        net.reportedHashes.get("rider")!.get(tick),
        net.reportedHashes.get("host")!.get(tick),
        `replicas disagree at ${tick}`,
      );
  } finally {
    host.stop();
    rider.stop();
  }
});
