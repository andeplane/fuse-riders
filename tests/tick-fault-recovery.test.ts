import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoomState,
  hashRoomState,
  type RoomState,
} from "../src/engine/apply-tick.js";
import {
  PHASES,
  TickFault,
  addPlayer,
  startMatch,
  COUNTDOWN_TICKS,
  type Phase,
} from "../src/engine/game.js";
import type { TickContext } from "../src/engine/sim/context.js";
import { neutralControls } from "../src/engine/input-log.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  SNAPSHOT_INTERVAL,
  World,
  type WorldFault,
} from "../src/online/rollback.js";
import {
  DIVERGENCE_LIMIT,
  FAULT_EVIDENCE_MS,
  RoomRuntime,
} from "../src/online/room-runtime.js";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";

/**
 * The seam: PHASES with one more phase in the middle of the tick, after riders have been stepped and pickups collected
 * and before anything is committed, that throws when it is told to. No engine or runtime code is patched.
 */
function failingWhen(shouldFail: (ctx: TickContext) => boolean): Phase[] {
  const at = PHASES.findIndex((phase) => phase.name === "commitMovement");
  assert.ok(at > 0);
  return [
    ...PHASES.slice(0, at),
    {
      name: "injectedFailure",
      when: "playing",
      run: (ctx) => {
        if (shouldFail(ctx)) throw new Error("injected");
      },
    },
    ...PHASES.slice(at),
  ];
}
const failingAt = (shouldFail: (tick: number) => boolean): Phase[] =>
  failingWhen(({ state }) => shouldFail(state.tick));

/** p0 is this replica's rider and the other a bot, so the world never stalls waiting for a stream nobody feeds. */
function room(): RoomState {
  const state = createRoomState("fault", defaultRoomSettings());
  addPlayer(state.game, { id: "p0", name: "P0", slot: 0, color: "#fff" });
  addPlayer(state.game, { id: "bot:1", name: "Ada", slot: 1, color: "#fff" });
  state.bots.add("bot:1");
  // Seated the way a JOIN entry seats a rider, so p0's stream folds into its controls.
  state.folds.set("p0", { ...neutralControls(), generation: 1 });
  startMatch(state.game);
  return state;
}

const QUIET = { loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 40 };
const STOPPED = "Simulation stopped — reload this page";

/** A room of online replicas that all run `phases`, joined and with the match started. */
function mesh(
  ids: readonly string[],
  phases: (id: string) => Phase[] | undefined,
  options: NetworkOptions = QUIET,
) {
  const net = new FakeNetwork(ids[0]!, options);
  const faults = new Map<string, WorldFault[]>(ids.map((id) => [id, []]));
  const runtimes = ids.map((id) => {
    const runtime = net.add(id, defaultRoomSettings(), {
      humanName: id,
      phases: phases(id),
      simulationError: (fault) => faults.get(id)!.push(fault),
    });
    runtime.start();
    runtime.command({ type: "join", name: id });
    net.step(1000);
    return runtime;
  });
  assert.ok(runtimes[0]!.command({ type: "action", action: "start" }));
  const requests = () =>
    net.reliableLog.filter((message) => message.type === "snapshotRequest")
      .length;
  return { net, runtimes, faults, requests };
}

// ---- the world --------------------------------------------------------------------------------------------------------

test("a world whose tick throws stands on its last whole snapshot, vouches for nothing and simulates no further", () => {
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
  assert.notEqual(world.hashAt(lastWhole), undefined);

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
  // But it no longer vouches for any tick: a hash is how peers tell a replica got past one.
  assert.equal(world.hashAt(lastWhole), undefined);

  // Stopped, not spinning: nothing is simulated or re-thrown, and the fault is not reported a second time.
  assert.deepEqual(world.advance(failing + 20), { events: [] });
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

test("a fault under mispredicted inputs heals itself when the correcting entry arrives, with no event repeated", () => {
  const failing = COUNTDOWN_TICKS + 2 * SNAPSHOT_INTERVAL + 1;
  // The tick throws only while p0 is still steering left: true of the prediction, not of the log once it is complete.
  const phases = failingWhen(
    ({ state, inputs }) =>
      state.tick === failing && inputs.get("p0")?.left === true,
  );
  const world = new World(room(), "p0", "p0", phases);
  const healthy = new World(room(), "p0", "p0");
  for (const replica of [world, healthy]) replica.stream("p0", 1);
  const held = [[1, COUNTDOWN_TICKS + 1, 0, 1]] as const;
  const released = [[2, failing - 2, 0, 0]] as const;
  world.receive("p0", held, 1, failing - 3, failing - 3);
  healthy.receive("p0", [...held, ...released], 2, failing + 10, failing + 10);

  const events = [...world.advance(failing + 4).events];
  assert.equal(world.fault?.tick, failing, "threw under the prediction");
  assert.equal(world.faultConfirmed(), false, "and the inputs were not in");

  // An entry after the tick says nothing about what the tick ran under; one at or before it does.
  const release = world.receive("p0", released, 2, failing + 10, failing + 10);
  assert.equal(release.status, "accepted");
  assert.equal(world.fault, undefined, "the corrected log gets another try");
  const retried = world.advance(failing + 10);
  assert.equal(retried.fault, undefined);
  events.push(...release.events, ...retried.events);
  assert.equal(world.tick, failing + 10);

  const reference = healthy.advance(failing + 10).events;
  assert.equal(hashRoomState(world.state), hashRoomState(healthy.state));
  assert.deepEqual(events, reference, "every event once, none twice");
});

// ---- the runtime ------------------------------------------------------------------------------------------------------

test("a solo runtime tries the tick once more, then stops for good and says so", () => {
  const net = new FakeNetwork("solo", QUIET);
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
    assert.doesNotThrow(() => net.step(30_000));
    // Once when it happened and once on the single retry with complete inputs: never once per frame.
    assert.deepEqual(
      faults.map((fault) => [fault.tick, fault.phase]),
      [
        [failing, "injectedFailure"],
        [failing, "injectedFailure"],
      ],
    );
    const metrics = solo.metrics();
    assert.equal(metrics.faults, 2);
    assert.equal(metrics.stopped, true);
    assert.deepEqual(metrics.lastFault, {
      tick: failing,
      phase: "injectedFailure",
    });
    assert.ok(metrics.tick < failing, "the world never passes the tick");
    assert.ok(
      frames.every((tick) => tick < failing),
      "no frame of a half-simulated tick is ever published",
    );
    assert.equal(statuses.at(-1), STOPPED, "and nothing papers over it");
    assert.equal(
      solo.command({
        type: "input",
        seq: 1,
        left: true,
        right: false,
        bomb: false,
      }),
      false,
      "a stopped page logs no more input",
    );
  } finally {
    solo.stop();
  }
});

test("a one-off throw costs one local retry: no snapshot, no strike, no stop", () => {
  let thrown = 0;
  const { net, runtimes, faults, requests } = mesh(["host", "rider"], (id) =>
    id === "rider"
      ? failingAt((tick) => tick > COUNTDOWN_TICKS + 40 && thrown++ === 0)
      : undefined,
  );
  try {
    const asked = requests();
    net.step(12_000);
    const rider = runtimes[1]!;
    assert.equal(faults.get("rider")!.length, 1);
    assert.equal(requests(), asked, "nothing was asked of anyone");
    assert.equal(rider.metrics().mismatches, 0);
    assert.equal(rider.metrics().stopped, false);
    assert.ok(rider.metrics().tick > faults.get("rider")![0]!.tick + 100);
  } finally {
    for (const runtime of runtimes) runtime.stop();
  }
});

test("a replica that keeps failing a tick its peer got past is replaced from that peer, once, and the room converges", () => {
  const failing = COUNTDOWN_TICKS + 41;
  let asked = Infinity;
  const harness = mesh(["host", "rider"], (id) =>
    id === "rider"
      ? // Local damage: this replica cannot simulate the tick from its own state; a peer's state past it is the cure.
        failingAt((tick) => tick === failing && harness.requests() <= asked)
      : undefined,
  );
  const { net, runtimes, faults, requests } = harness;
  try {
    asked = requests();
    net.step(15_000);
    const rider = runtimes[1]!;
    assert.ok(
      faults.get("rider")!.length >= 2,
      "when it happened, and on the retry",
    );
    assert.ok(faults.get("rider")!.every((fault) => fault.tick === failing));
    assert.ok(
      net.recorded
        .get("rider")!
        .statuses.includes("Simulation fault · resyncing"),
    );
    assert.equal(
      requests(),
      asked + 1,
      "one request, on evidence, to the peer that showed it",
    );
    assert.equal(
      rider.metrics().mismatches,
      1,
      "one strike of DIVERGENCE_LIMIT",
    );
    assert.equal(rider.metrics().stopped, false);
    assert.equal(rider.metrics().snapshotRequest, false);
    assert.ok(rider.metrics().tick > failing + 100, "and rides on");
    const common = [...(net.reportedHashes.get("host")?.keys() ?? [])].filter(
      (tick) =>
        tick > failing + 60 && net.reportedHashes.get("rider")?.has(tick),
    );
    assert.ok(common.length >= 3, "shared confirmed ticks after the repair");
    for (const tick of common)
      assert.equal(
        net.reportedHashes.get("rider")!.get(tick),
        net.reportedHashes.get("host")!.get(tick),
        `replicas disagree at ${tick}`,
      );
  } finally {
    for (const runtime of runtimes) runtime.stop();
  }
});

/**
 * The common case, and the one the first version of this got wrong (review B1): the fold is deterministic, so a throw
 * at a confirmed tick happens on every replica. Nobody got past it, so no snapshot can help and none may be asked for.
 */
test("when every replica throws at the same tick the room stops once and stays quiet", () => {
  const failing = COUNTDOWN_TICKS + 60;
  const ids = ["host", "rider", "third"];
  const { net, runtimes, faults, requests } = mesh(ids, () =>
    failingAt((tick) => tick === failing),
  );
  try {
    const asked = requests();
    net.step(FAULT_EVIDENCE_MS + 10_000);
    const settled = {
      faults: ids.map((id) => faults.get(id)!.length),
      sent: net.sentFast,
      reliable: net.reliableLog.length,
    };
    for (const [index, runtime] of runtimes.entries()) {
      const metrics = runtime.metrics();
      assert.equal(metrics.stopped, true, `${ids[index]} stopped`);
      assert.ok(metrics.tick < failing);
      assert.equal(net.recorded.get(ids[index]!)!.statuses.at(-1), STOPPED);
      // Bounded: each speculative occurrence, then the one retry on complete inputs.
      assert.ok(settled.faults[index]! >= 2 && settled.faults[index]! <= 4);
    }
    assert.equal(
      requests(),
      asked,
      "no snapshot was asked for: no peer can have passed the tick",
    );

    // Two more minutes: nothing restarts, nothing is sent, nothing is reported, nothing grows.
    const streams = runtimes.map((runtime) =>
      JSON.stringify(runtime.metrics().streams),
    );
    net.step(120_000);
    assert.deepEqual(
      ids.map((id) => faults.get(id)!.length),
      settled.faults,
    );
    assert.equal(requests(), asked);
    assert.equal(net.sentFast, settled.sent, "a stopped page sends no packets");
    assert.equal(net.reliableLog.length, settled.reliable);
    assert.deepEqual(
      runtimes.map((runtime) => JSON.stringify(runtime.metrics().streams)),
      streams,
    );
    for (const id of ids)
      assert.equal(net.recorded.get(id)!.statuses.at(-1), STOPPED);
  } finally {
    for (const runtime of runtimes) runtime.stop();
  }
});

/** Review S1: on main this is invisible; it must not freeze a replica for seconds or cost it strikes. */
test("a fault that exists only under a mispredicted input heals on the correcting entry, without a snapshot or a strike", () => {
  let failing = Infinity;
  const ids = ["host", "rider", "third"];
  const { net, runtimes, faults, requests } = mesh(
    ids,
    () =>
      failingWhen(
        ({ state, inputs }) =>
          state.tick === failing && inputs.get("rider")?.left === true,
      ),
    { loss: 0, baseMs: 300, jitterMs: 0, reliableMs: 40 },
  );
  try {
    const rider = runtimes[1]!;
    rider.command({
      type: "input",
      seq: 1,
      left: true,
      right: false,
      bomb: false,
    });
    net.step(4000);
    const asked = requests();
    // The release is stamped two ticks before the tick that throws, and is 300 ms away from everyone else.
    rider.command({
      type: "input",
      seq: 2,
      left: false,
      right: false,
      bomb: false,
    });
    failing = Math.floor(rider.metrics().clockTick) + 3;
    net.step(200);
    assert.ok(
      faults.get("host")!.length + faults.get("third")!.length > 0,
      "the replicas that had to predict the rider threw",
    );
    assert.equal(faults.get("rider")!.length, 0, "the rider knew");
    net.step(6000);
    for (const [index, runtime] of runtimes.entries()) {
      const metrics = runtime.metrics();
      assert.equal(metrics.stopped, false);
      assert.equal(metrics.mismatches, 0, `${ids[index]} spent no strike`);
      assert.ok(metrics.tick > failing + 60, `${ids[index]} rides on`);
      assert.ok(faults.get(ids[index]!)!.length <= 1);
    }
    assert.equal(requests(), asked, "no snapshot was needed");
    const common = [...(net.reportedHashes.get("host")?.keys() ?? [])].filter(
      (tick) =>
        tick > failing &&
        ids.every((id) => net.reportedHashes.get(id)?.has(tick)),
    );
    assert.ok(common.length >= 2);
    for (const tick of common)
      assert.equal(
        new Set(ids.map((id) => net.reportedHashes.get(id)!.get(tick))).size,
        1,
        `replicas disagree at ${tick}`,
      );
  } finally {
    for (const runtime of runtimes) runtime.stop();
  }
});

/** Review S2: a stopped authority must not remain the room's snapshot source or its only desync check. */
test("an authority that cannot get past its ticks stops after its strikes, and a late joiner is served by a healthy peer", () => {
  const from = COUNTDOWN_TICKS + 60;
  const ids = ["host", "rider"];
  const { net, runtimes, faults, requests } = mesh(ids, (id) =>
    id === "host" ? failingAt((tick) => tick >= from) : undefined,
  );
  let third: RoomRuntime | undefined;
  try {
    const [host, rider] = runtimes;
    net.step(60_000);
    assert.equal(host!.metrics().stopped, true);
    assert.equal(host!.metrics().mismatches, DIVERGENCE_LIMIT);
    assert.equal(net.recorded.get("host")!.statuses.at(-1), STOPPED);
    const hostFaults = faults.get("host")!.length;
    assert.equal(rider!.metrics().stopped, false);
    assert.ok(rider!.metrics().tick > from + 600, "the healthy rider plays on");
    assert.notEqual(
      net.frame("rider")!.players.find((player) => player.id === "host")
        ?.connected,
      true,
      "and sees the stopped page as a closed tab: absent, then pruned at a round boundary",
    );

    const asked = requests();
    third = net.add("third", defaultRoomSettings(), { humanName: "third" });
    third.start();
    third.command({ type: "join", name: "third" });
    net.step(15_000);
    assert.ok(requests() > asked);
    assert.ok(
      third.metrics().tick > rider!.metrics().tick - 40,
      `the joiner is at the head of the room (${third.metrics().tick} vs ${rider!.metrics().tick})`,
    );
    assert.equal(
      faults.get("host")!.length,
      hostFaults,
      "the stopped host stays stopped",
    );
    const common = [...(net.reportedHashes.get("rider")?.keys() ?? [])].filter(
      (tick) => net.reportedHashes.get("third")?.has(tick),
    );
    assert.ok(common.length >= 2);
    for (const tick of common)
      assert.equal(
        net.reportedHashes.get("third")!.get(tick),
        net.reportedHashes.get("rider")!.get(tick),
      );
  } finally {
    for (const runtime of runtimes) runtime.stop();
    third?.stop();
  }
});

test("statistics dropped for a damaged state are reported once per match", () => {
  const net = new FakeNetwork("solo", QUIET);
  const warnings: string[] = [];
  let damaged = false;
  const solo = new RoomRuntime(
    "SOLO",
    defaultRoomSettings(),
    { state: () => {}, event: () => {}, status: () => {}, ready: () => {} },
    {
      dependencies: net.dependencies("solo"),
      // The seam again: a phase that damages the state the way only a bug or a bad restore could.
      phases: [
        ...PHASES,
        {
          name: "injectedDamage",
          when: "playing",
          run: ({ state }) => {
            if (damaged) return;
            damaged = true;
            state.matchStats.delete("solo");
          },
        },
      ],
      simulationWarning: (text) => warnings.push(text),
    },
  );
  try {
    solo.start();
    net.step(8000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /no match statistics for solo/);
    assert.equal(solo.metrics().faults, 0, "and the simulation never threw");
  } finally {
    solo.stop();
  }
});

test("fault evidence followed by lost snapshots has a bounded terminal outcome", () => {
  let dropSnapshots = false;
  const failing = COUNTDOWN_TICKS + 41;
  const { net, runtimes, requests } = mesh(
    ["host", "rider"],
    (id) =>
      id === "rider" ? failingAt((tick) => tick === failing) : undefined,
    {
      ...QUIET,
      dropReliable: (_from, to, type) =>
        dropSnapshots && to === "rider" && type === "snapshot",
    },
  );
  try {
    dropSnapshots = true;
    net.step(25_000);
    assert.ok(
      net.recorded
        .get("rider")!
        .statuses.includes("Simulation fault · resyncing"),
    );
    assert.equal(runtimes[1]!.metrics().stopped, true);
    assert.equal(runtimes[1]!.metrics().snapshotRequest, false);
    const count = requests();
    net.step(10_000);
    assert.equal(
      requests(),
      count,
      "stopped recovery does not keep requesting snapshots",
    );
  } finally {
    for (const runtime of runtimes) runtime.stop();
  }
});

test("a speculative fault stops when the missing input owner leaves before correction", () => {
  let failing = Infinity;
  const { net, runtimes, faults } = mesh(
    ["host", "rider", "third"],
    (id) =>
      id === "host"
        ? failingWhen(
            ({ state, inputs }) =>
              state.tick === failing && inputs.get("rider")?.left === true,
          )
        : undefined,
    { ...QUIET, baseMs: 300 },
  );
  try {
    const rider = runtimes[1]!;
    rider.command({
      type: "input",
      seq: 1,
      left: true,
      right: false,
      bomb: false,
    });
    net.step(4000);
    rider.command({
      type: "input",
      seq: 2,
      left: false,
      right: false,
      bomb: false,
    });
    failing = Math.floor(rider.metrics().clockTick) + 3;
    net.step(200);
    assert.equal(
      faults.get("host")!.length,
      1,
      "host faulted on the still-speculative held input",
    );
    rider.stop();
    net.disconnect("rider");
    net.step(20_000);
    assert.equal(runtimes[0]!.metrics().stopped, true);
    assert.equal(net.recorded.get("host")!.statuses.at(-1), STOPPED);
  } finally {
    for (const runtime of runtimes) runtime.stop();
  }
});
