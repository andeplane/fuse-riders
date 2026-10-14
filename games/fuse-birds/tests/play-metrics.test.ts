import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "fuse-netcode";
import { createMatch, getView } from "../src/engine/index.js";
import type { BirdsView } from "../src/online/game.js";
import {
  birdsPlayFrame,
  type MetricsContext,
} from "../src/app/play-metrics.js";

const context: MetricsContext = {
  memberId: "a",
  displayOnly: false,
  practice: false,
  roomScope: "room-scope",
};
const frame: Frame<BirdsView> = {
  tick: 1,
  logTick: 1,
  matchId: "lobby-scope",
  managerId: "a",
  stage: "lobby",
  world: null,
  seats: [
    {
      id: "a",
      name: "Skye",
      slot: 0,
      avatarId: "owl",
      connected: true,
      bot: false,
    },
    {
      id: "b",
      name: "Ember",
      slot: 1,
      avatarId: "owl",
      connected: true,
      bot: false,
    },
    {
      id: "tv",
      name: "TV",
      slot: -1,
      avatarId: "owl",
      connected: true,
      bot: false,
      watcher: true,
    },
  ],
};
const settings = { display: false };

test("seat observations count riders while displays and watchers never claim a played seat", () => {
  assert.deepEqual(birdsPlayFrame(frame, settings, context), {
    matchId: "lobby-scope",
    active: false,
    ended: false,
    playerCount: 2,
    botCount: 0,
    seated: true,
    mode: "online",
  });
  assert.equal(
    birdsPlayFrame(frame, settings, { ...context, memberId: "tv" }).seated,
    false,
  );
  assert.equal(
    birdsPlayFrame(frame, settings, { ...context, displayOnly: true }).seated,
    false,
  );
  assert.equal(
    birdsPlayFrame(frame, { display: true }, context).mode,
    "shared",
  );
});

test("preparation and faults are not starts or results; completed battles are results", () => {
  const world = getView(
    createMatch("battle", 42, [
      { id: "a", name: "Skye" },
      { id: "b", name: "Ember" },
    ]),
  );
  assert.equal(
    birdsPlayFrame({ ...frame, world }, settings, context).active,
    false,
  );
  const active = birdsPlayFrame(
    { ...frame, world: { ...world, phase: "aiming" } },
    settings,
    context,
  );
  assert.equal(active.active, true);
  assert.equal(active.ended, false);
  const fault = birdsPlayFrame(
    { ...frame, world: { ...world, phase: "fault" } },
    settings,
    context,
  );
  assert.equal(fault.active, false);
  assert.equal(fault.ended, false);
  const ended = birdsPlayFrame(
    { ...frame, world: { ...world, phase: "over" } },
    settings,
    context,
  );
  assert.equal(ended.active, false);
  assert.equal(ended.ended, true);
});

test("practice new maps get fresh deduplication scopes, including rounds after the first", () => {
  const world = getView(
    createMatch("practice", 42, [{ id: "a", name: "Skye" }]),
  );
  const practice = { ...context, practice: true };
  const first = birdsPlayFrame(
    { ...frame, world: { ...world, phase: "aiming" } },
    settings,
    practice,
  );
  const next = birdsPlayFrame(
    { ...frame, world: { ...world, round: 2, phase: "aiming" } },
    settings,
    practice,
  );
  assert.equal(first.mode, "practice");
  assert.notEqual(first.matchId, next.matchId);
  assert.equal(next.active, true);
  assert.equal(
    "round" in next,
    false,
    "each Birds battle is a match, including rematches",
  );
});
