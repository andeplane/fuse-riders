import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTick,
  createRoomState,
  hashRoomState,
} from "../src/engine/apply-tick.js";
import { BotController } from "../src/engine/bot-controller.js";
import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  READY,
  SETTINGS,
  SPECTATOR,
  isEntry,
  type Entry,
} from "../src/engine/input-log.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { fuseGame } from "../src/online/fuse-game.js";
import { FakeNetwork } from "./fixtures/fake-room.js";

function fixture() {
  const state = createRoomState("ready-room", classicSettings());
  const bots = new BotController();
  const tick = (streams: Record<string, Entry[]> = {}, generation = 0) =>
    applyTick(
      state,
      "host",
      new Map(
        Object.entries(streams).map(([id, entries]) => [
          id,
          {
            generation,
            entries: entries.map(
              (entry) => [entry[0], state.tick + 1, ...entry.slice(2)] as Entry,
            ),
          },
        ]),
      ),
      bots,
    );
  tick({
    host: [
      [1, 1, JOIN, "a", "Ada", 0, "robot", 0],
      [2, 1, JOIN, "b", "Bo", 1, "robot", 0],
    ],
  });
  const vote = (
    ready = true,
    matchId = state.game.matchId,
    phase: "lobby" | "matchOver" = "lobby",
  ): Entry => [1, state.tick + 1, READY, ready, matchId, phase];
  return { state, tick, vote };
}

test("ready input validates its boolean, match and phase at the boundary", () => {
  assert.ok(isEntry([1, 1, READY, true, "match", "lobby"]));
  assert.ok(isEntry([1, 1, READY, false, "match", "matchOver"]));
  for (const value of [
    [1, 1, READY, 1, "match", "lobby"],
    [1, 1, READY, true, "", "lobby"],
    [1, 1, READY, true, "match", "playing"],
    [1, 1, READY, true, "match", "lobby", 0],
  ])
    assert.equal(isEntry(value), false);
});

test("each rider can toggle; only unanimous votes start and consume readiness", () => {
  const { state, tick, vote } = fixture();
  tick({ a: [vote()] });
  assert.equal(state.game.phase, "lobby");
  tick({ a: [vote(false)], b: [vote()] });
  assert.equal(state.game.phase, "lobby");
  assert.deepEqual(fuseGame.view(state).readyPlayers, ["b"]);
  tick({ a: [vote()] });
  assert.equal(state.game.phase, "countdown");
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
  tick({ a: [vote()], b: [vote()] });
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
});

test("unseated host, spectators and bots never hold up a ready check", () => {
  const { state, tick, vote } = fixture();
  tick({
    host: [
      [1, 1, BOT, "add", "bot:1", "AI", 2],
      [2, 1, SPECTATOR, "join", "watcher", "Watcher", 0],
    ],
  });
  tick({ a: [vote()], b: [vote()], watcher: [vote()] });
  assert.equal(state.game.phase, "countdown");
});

test("one human can ready with AI; a lone rider waits for a second seat", () => {
  const { state, tick, vote } = fixture();
  tick({ host: [[1, 1, PRESENCE, "b", false, 0]], a: [vote()] });
  assert.equal(state.game.phase, "lobby");
  tick({ host: [[1, 1, BOT, "add", "bot:1", "AI", 2]] });
  assert.equal(state.game.phase, "countdown");
});

test("reconnect, changed settings and lobby reset clear consent; stale scopes and generations cannot vote", () => {
  const { state, tick, vote } = fixture();
  tick({ a: [vote()] });
  tick({ host: [[1, 1, PRESENCE, "a", true, 1]] });
  tick({ a: [vote()] }); // old stream generation
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
  tick({ a: [vote()] }, 1);
  assert.deepEqual(fuseGame.view(state).readyPlayers, ["a"]);
  tick({ host: [[1, 1, SETTINGS, classicSettings()]] });
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
  tick(
    {
      a: [vote(true, "old-match"), vote(true, state.game.matchId, "matchOver")],
    },
    1,
  );
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
  tick({ a: [vote()] }, 1);
  tick({ host: [[1, 1, ACTION, "lobby", "new-match"]] });
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
});

test("ready checkpoints round trip and reject invalid or live-phase votes", () => {
  const { state, tick, vote } = fixture();
  tick({ a: [vote()] });
  const fields = fuseGame.checkpoint.encode(state);
  const restored = fuseGame.checkpoint.decode(fields, state.tick);
  assert.ok(restored);
  assert.equal(hashRoomState(restored), hashRoomState(state));
  const corrupt = structuredClone(fields);
  const folds = corrupt[2] as unknown[][];
  folds[0]![5] = false;
  assert.equal(fuseGame.checkpoint.decode(corrupt, state.tick), undefined);
  tick({ b: [vote()] });
  const playing = fuseGame.checkpoint.encode(state);
  (playing[2] as unknown[][])[0]!.push(true);
  assert.equal(fuseGame.checkpoint.decode(playing, state.tick), undefined);
});

test("rematch waits for the results pause, ignores stale lobby votes and starts once", () => {
  const { state, tick, vote } = fixture();
  // Public engine state fixture: a finished match still presenting its final result.
  state.game.phase = "matchOver";
  state.game.phaseEndsAtTick = state.game.tick + 3;
  tick({
    a: [vote(true, state.game.matchId, "matchOver")],
    b: [vote(true, state.game.matchId, "matchOver")],
  });
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
  tick();
  tick();
  tick({ a: [vote()], b: [vote()] });
  assert.equal(state.game.phase, "matchOver");
  const previous = state.game.matchId;
  tick({
    a: [vote(true, previous, "matchOver")],
    b: [vote(true, previous, "matchOver")],
  });
  assert.equal(state.game.phase, "countdown");
  assert.notEqual(state.game.matchId, previous);
  assert.deepEqual(fuseGame.view(state).readyPlayers, []);
});

test("lossy, duplicated and reordered ready votes converge without host interaction", () => {
  const net = new FakeNetwork("tv", {
    loss: 0.15,
    baseMs: 20,
    jitterMs: 100,
    reliableMs: 30,
    duplicate: 0.3,
  });
  const tv = net.add("tv", classicSettings(), { displayOnly: true });
  tv.start();
  net.step(300);
  const a = net.add("a", classicSettings());
  a.start();
  a.command({ type: "join", name: "Ada" });
  const b = net.add("b", classicSettings());
  b.start();
  b.command({ type: "join", name: "Bo" });
  net.step(3000);
  assert.equal(tv.command({ type: "ready", ready: true }), false);
  assert.ok(a.command({ type: "ready", ready: true }));
  net.step(1000);
  assert.equal(net.frame("tv")?.phase, "lobby");
  a.command({ type: "ready", ready: false });
  net.step(1000);
  b.command({ type: "ready", ready: true });
  net.step(1000);
  assert.equal(net.frame("tv")?.phase, "lobby");
  a.command({ type: "ready", ready: true });
  net.step(1200);
  for (const id of ["tv", "a", "b"])
    assert.equal(net.frame(id)?.phase, "countdown");
  net.step(10000);
  let compared = 0;
  for (const [tick, hash] of net.reportedHashes.get("tv") ?? []) {
    const others = [
      net.reportedHashes.get("a")?.get(tick),
      net.reportedHashes.get("b")?.get(tick),
    ];
    if (others.some((h) => !h)) continue;
    assert.deepEqual(others, [hash, hash]);
    compared++;
  }
  assert.ok(compared > 0);
  assert.ok(
    net.droppedFast > 0 && net.duplicatedFast > 0 && net.reorderedFast > 0,
  );
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("checkpoint readiness cannot preload consent during the results presentation", () => {
  const { state, tick, vote } = fixture();
  tick({ host: [[1, 1, SETTINGS, { ...classicSettings(), length: 1 }]] });
  tick({ a: [vote()], b: [vote()] });
  for (let step = 0; step < 2000 && state.game.phase !== "matchOver"; step++)
    tick();
  assert.equal(state.game.phase, "matchOver");
  assert.ok(state.game.tick < state.game.phaseEndsAtTick!);
  const fields = fuseGame.checkpoint.encode(state);
  assert.ok(
    fuseGame.checkpoint.decode(fields, state.tick),
    "the complete-results fixture is otherwise valid",
  );
  for (const fold of fields[2] as unknown[][]) fold.push(true);
  assert.equal(fuseGame.checkpoint.decode(fields, state.tick), undefined);
});
