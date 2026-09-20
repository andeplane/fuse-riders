/**
 * Catch-up and rollback cost in the bots-only fast phase (#258 N2 follow-up). Run from the repo root:
 *
 *   pnpm exec tsx scripts/bench-catchup.ts [hiddenMs=6000] [rollbackDepth=38]
 *
 * 1. Catch-up: two humans who never steer and four bots on the in-memory `FakeNetwork` (no loss, 20 ms links). Once
 *    both humans are dead and a bot still races, the guest's tab is hidden for `hiddenMs` (its world freezes, its clock
 *    runs on), then shown. Every loop pass of the guest is timed with `performance.now()` until its world is back
 *    within a tick of its clock: the worst pass, the CPU spent, the passes, the fake time to converge (passes × 10 ms)
 *    and the wall time a browser would take (each pass lasting at least 10 ms or as long as it ran).
 * 2. Rollback: a `World` with one dead human and four bots deep in the fast phase receives a steering entry
 *    `rollbackDepth` log ticks late. Timed: the `receive` call, and (when the world paces re-simulation by a step
 *    budget) each 10 ms loop pass that finishes the replay.
 *
 * Wall times are this machine's; step counts are exact.
 */
import { performance } from "node:perf_hooks";
import { FakeNetwork } from "../games/fuse-riders/tests/fixtures/fake-room.js";
import { classicSettings } from "../games/fuse-riders/src/engine/room-settings.js";
import { createRoomState } from "../games/fuse-riders/src/engine/apply-tick.js";
import {
  COUNTDOWN_TICKS,
  eliminatePlayer,
} from "../games/fuse-riders/src/engine/game.js";
import {
  ACTION,
  BOT,
  JOIN,
  STEER,
} from "../games/fuse-riders/src/engine/input-log.js";
import { World } from "fuse-netcode";
import { fuseGame } from "../games/fuse-riders/src/online/fuse-game.js";
import * as runtimeModule from "../games/fuse-riders/src/online/room-runtime.js";

const hiddenMs = Number(process.argv[2] ?? 6000),
  depth = Number(process.argv[3] ?? 38);
const budget = (runtimeModule as { CATCHUP_STEPS?: number }).CATCHUP_STEPS;

function catchUp(): void {
  const net = new FakeNetwork(
    "host",
    { loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 20 },
    7,
  );
  for (const id of ["host", "guest"]) {
    const runtime = net.add(id, classicSettings(), { humanName: id });
    runtime.start();
    runtime.command({ type: "join", name: id });
    net.step(1500);
  }
  const host = net.runtimes.get("host")!,
    guest = net.runtimes.get("guest")!;
  for (let bot = 0; bot < 4; bot++)
    host.command({ type: "bot", action: "add" });
  net.step(1500);
  host.command({ type: "action", action: "start" });
  const fast = () => {
    const frame = net.frame("host");
    return (
      frame?.phase === "playing" &&
      frame.players.every((p) => p.id.startsWith("bot:") || !p.alive) &&
      frame.players.some((p) => p.id.startsWith("bot:") && p.alive)
    );
  };
  for (let i = 0; i < 4000 && !fast(); i++) net.step(10);
  if (!fast()) throw new Error("no bots-only phase reached");
  net.step(200);
  const before = guest.metrics();
  net.setHidden("guest", true);
  net.step(hiddenMs);
  const hiddenAt = guest.metrics();
  const gap = Math.floor(hiddenAt.clockTick) - hiddenAt.tick;
  const pass = net.ticks.get("guest")!;
  const times: number[] = [];
  net.ticks.set("guest", () => {
    const at = performance.now();
    pass();
    times.push(performance.now() - at);
  });
  const shownAt = net.now,
    gameBefore = net.frame("guest")!.tick;
  net.setHidden("guest", false);
  let snapshot = false;
  while (net.now - shownAt < 60_000) {
    net.step(10);
    const m = guest.metrics();
    if (m.snapshotRequest) snapshot = true;
    if (m.tick >= Math.floor(m.clockTick) - 1) break;
  }
  const after = guest.metrics(),
    steps = net.frame("guest")!.tick - gameBefore,
    worst = Math.max(...times),
    total = times.reduce((a, b) => a + b, 0);
  console.log(
    JSON.stringify({
      scenario: "catch-up",
      budget: budget ?? "none (CATCHUP_TICKS log ticks per pass)",
      hiddenMs,
      gapLogTicks: gap,
      phaseAtShow: net.frame("host")!.phase,
      fastWhileHidden: fast(),
      snapshotRequested: snapshot,
      logTicksCaughtUp: after.tick - hiddenAt.tick,
      gameSteps: steps,
      passes: times.length,
      worstPassMs: +worst.toFixed(1),
      p95PassMs: +[...times]
        .sort((a, b) => a - b)
        [Math.floor(times.length * 0.95)]!.toFixed(1),
      cpuMs: +total.toFixed(0),
      convergeFakeMs: net.now - shownAt,
      // A browser runs a pass every 10 ms or as soon as the previous one returns: the time to converge on this machine.
      convergeWallMs: +times
        .reduce((a, t) => a + Math.max(10, t), 0)
        .toFixed(0),
      mismatches: after.mismatches,
      startTick: before.tick,
    }),
  );
  for (const runtime of net.runtimes.values()) runtime.stop();
}

function rollback(): void {
  const w = new World(
    fuseGame,
    createRoomState("room", classicSettings()),
    "creator",
    "creator",
  );
  const creator = w.stream("creator", 1),
    b = w.stream("b", 1);
  // One human (the creator only manages), dead once play starts, and four bots: the reviewer's workload.
  creator.append(1, [JOIN, "b", "B", 0, "fox", 1]);
  for (let bot = 1; bot <= 4; bot++)
    creator.append(1, [BOT, "add", `bot:${bot}`, `AI ${bot}`, bot]);
  creator.append(2, [ACTION, "start", "m"]);
  const to = (tick: number) => {
    creator.through = b.through = tick;
    w.advance(tick);
  };
  to(COUNTDOWN_TICKS + 2);
  eliminatePlayer(w.state.game, "b");
  const fastFrom = w.state.game.tick;
  to(w.tick + 60);
  const perTick = (w.state.game.tick - fastFrom) / 60;
  if (w.state.game.phase !== "playing") throw new Error("round ended");
  const pace = w as unknown as { refill?: (steps: number) => void };
  const tickBefore = w.tick;
  pace.refill?.(budget ?? Infinity);
  const at = performance.now();
  const result = w.receive(
    "b",
    [[1, w.tick - depth, STEER, 1]],
    1,
    b.through,
    w.tick,
  );
  const receiveMs = performance.now() - at;
  const passes: number[] = [];
  // Budgeted worlds finish the replay over later loop passes, each with a fresh budget, without advancing further.
  // A paced world keeps its tick and owes the re-run (`settled` false); an unpaced one finished it inside `receive`.
  const owed = () =>
    (w as unknown as { settled?: boolean }).settled === false ||
    w.tick < tickBefore;
  while (owed() && passes.length < 1000) {
    pace.refill?.(budget ?? Infinity);
    const start = performance.now();
    w.advance(tickBefore);
    passes.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      scenario: "rollback",
      budget: budget ?? "none",
      depthLogTicks: depth,
      rollbackTicks: result.rollbackTicks,
      stepsPerLogTick: +perTick.toFixed(2),
      receiveMs: +receiveMs.toFixed(1),
      laterPasses: passes.length,
      worstLaterPassMs: +Math.max(0, ...passes).toFixed(1),
      totalMs: +(receiveMs + passes.reduce((a, c) => a + c, 0)).toFixed(1),
      atTick: w.tick === tickBefore,
    }),
  );
}

catchUp();
rollback();
