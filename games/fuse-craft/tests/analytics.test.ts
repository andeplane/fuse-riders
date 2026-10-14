import assert from "node:assert/strict";
import test from "node:test";
import type { PlayFrame } from "fuse-ui/play-metrics";
import { observeLocalPlay, observeOnlinePlay } from "../src/app/analytics.js";
import type { NeuralSession } from "../src/app/contracts.js";
import { createMatch, loadMap } from "../src/engine/index.js";
import { bundledMap, DEFAULT_MAP } from "../src/online/maps.js";
import { Mesh } from "./fixtures/mesh.js";

test("local play observes results; watching reports bots without a seat", () => {
  let world = createMatch(loadMap(bundledMap(DEFAULT_MAP)), {}, [
    { id: "solo", slot: 0 },
  ]);
  const listeners = new Set<() => void>();
  const session: NeuralSession = {
    localPlayerId: "solo",
    canControl: true,
    view: () => world,
    dispatch() {},
    dispatchBatch() {
      return true;
    },
    reset() {},
    dispose: () => listeners.clear(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const frames: PlayFrame[] = [];
  assert.equal(
    observeLocalPlay(session, "skirmish", (frame) => frames.push(frame)),
    session,
  );
  assert.equal(frames[0]!.active, true);
  assert.equal(frames[0]!.seated, true);
  assert.equal(frames[0]!.botCount, world.players.length - 1);
  world = { ...world, finished: true };
  for (const listener of listeners) listener();
  assert.equal(frames.at(-1)!.ended, true);
  session.dispose();
  assert.equal(listeners.size, 0);
  const watch: PlayFrame[] = [];
  observeLocalPlay({ ...session, canControl: false }, "watch", (frame) =>
    watch.push(frame),
  );
  assert.equal(watch[0]!.seated, false);
  assert.equal(watch[0]!.botCount, world.players.length);
});

test("online observations ignore connecting and distinguish lobby, players and bots", () => {
  const mesh = new Mesh("host");
  const host = mesh.open("host"),
    friend = mesh.open("friend");
  const frames: PlayFrame[] = [];
  assert.equal(
    observeOnlinePlay(friend, (frame) => frames.push(frame)),
    friend,
  );
  assert.equal(frames.length, 0, "connecting is not a match");
  mesh.until(() => friend.room().stage === "lobby");
  assert.equal(frames.at(-1)!.active, false);
  assert.equal(frames.at(-1)!.seated, false);
  host.join("Host");
  friend.join("Friend");
  host.addBot();
  mesh.until(() => friend.room().seats.length === 3);
  host.start();
  mesh.until(() => frames.at(-1)?.active === true);
  const playing = frames.at(-1)!;
  assert.equal(playing.playerCount, 3);
  assert.equal(playing.botCount, 1);
  assert.equal(playing.seated, true);
  assert.equal(playing.ended, false);
  assert.equal(playing.matchId, friend.view().matchId);
  host.dispose();
  friend.dispose();
});
