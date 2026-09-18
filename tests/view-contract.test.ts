import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BotController } from "../src/engine/bot-controller.js";
import { applyTick, createRoomState } from "../src/engine/apply-tick.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  BLAST_VISIBLE_TICKS,
  GRAVITY_FIELD_TICKS,
  TICK_HZ,
  TRAIL_WIDTH,
  gravityCoreRadius,
  riderMotionStep,
} from "../src/engine/tuning.js";
import { edgesOpen } from "../src/engine/arena-map.js";
import {
  GUN_HEADSHOT_RADIUS,
  GUN_HOLE_RADIUS,
  GUN_RADIUS,
} from "../src/engine/gun.js";
import { PORTAL_WALL_HALF_WIDTH } from "../src/engine/portal.js";
import { TRAIL_DECAY_PAUSE_TICKS } from "../src/engine/trail-lifecycle.js";
import { bombsPerShot, volleyAngles } from "../src/engine/launch-modifiers.js";
import { toView, type WorldView } from "../src/engine/view.js";
import { legacySnapshot } from "./fixtures/legacy-snapshot.js";
import { streamReader, type Recording } from "./fixtures/replay-log.js";

const recording: Recording = JSON.parse(
  readFileSync(
    new URL("./fixtures/mechanics-recording.json", import.meta.url),
    "utf8",
  ),
);

/** The view with everything issue #254 added taken off again: what a screen was given before. */
function withoutAddedFields(view: WorldView): unknown {
  const { tick, round, rules, openEdges, tracks, ...before } = view;
  void [tick, round, rules, openEdges, tracks];
  return {
    ...before,
    players: view.players.map(
      ({ speed, turn, nextVolleyAngles, ...player }) => {
        void [speed, turn, nextVolleyAngles];
        return player;
      },
    ),
    gravityFields: view.gravityFields.map(
      ({ durationTicks, coreRadius, ...field }) => {
        void [durationTicks, coreRadius];
        return field;
      },
    ),
  };
}

test("the view publishes every field it did before #254, unchanged, over the whole golden recording", () => {
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    streams = streamReader(recording.entries);
  let compared = 0,
    volleys = 0,
    holes = 0,
    open = 0,
    paces = new Set<number>();
  for (let tick = 1; tick <= recording.ticks; tick++) {
    const events = applyTick(state, recording.creator, streams(tick), bots);
    // Every tick something happened on, and every seventh besides: a field that drifted shows up within a third of a second.
    if (events.length === 0 && tick % 7 !== 0) continue;
    const game = state.game,
      view = toView(game);
    assert.deepEqual(
      withoutAddedFields(view),
      legacySnapshot(game),
      `tick ${tick}`,
    );
    compared++;

    // What was added is the rules, stated as data: each value is what the renderer used to work out for itself.
    assert.equal(view.tick, game.tick);
    assert.equal(view.round, game.round);
    assert.deepEqual(view.rules, {
      tickHz: TICK_HZ,
      blastVisibleTicks: BLAST_VISIBLE_TICKS,
      trailWidth: TRAIL_WIDTH,
      trailDecayPauseTicks: TRAIL_DECAY_PAUSE_TICKS,
      gunRadius: GUN_RADIUS,
      gunHoleRadius: GUN_HOLE_RADIUS,
      gunHeadshotRadius: GUN_HEADSHOT_RADIUS,
      portalWallHalfWidth: PORTAL_WALL_HALF_WIDTH,
    });
    assert.equal(view.openEdges, edgesOpen(game));
    if (view.openEdges) open++;
    for (const field of view.gravityFields) {
      assert.equal(field.durationTicks, GRAVITY_FIELD_TICKS);
      assert.equal(field.coreRadius, gravityCoreRadius(field.radius));
      holes++;
    }
    for (const rider of view.players) {
      const player = game.players.get(rider.id)!;
      const step = riderMotionStep(
        player,
        game.tick + 1,
        game.roundStartedTick,
      );
      assert.equal(rider.speed, step.distance);
      assert.equal(rider.turn, step.turn);
      paces.add(rider.speed);
      // The scene adds the heading back: the sum has to be the angle the simulation launches at, to the bit.
      assert.deepEqual(
        rider.nextVolleyAngles.map((offset) => rider.angle + offset),
        volleyAngles(rider.angle, bombsPerShot(player)),
      );
      if (rider.nextVolleyAngles.length > 1) volleys++;
    }
  }
  assert.ok(compared > recording.ticks / 7, `${compared} ticks compared`);
  assert.ok(volleys > 0, "the recording fans a volley");
  assert.ok(holes > 0, "the recording opens a black hole");
  assert.ok(open > 0, "the recording plays a map with open edges");
  assert.ok(paces.size > 3, "the recording changes pace");
});

test("a rider's published speed is the step the simulation then takes", () => {
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    streams = streamReader(recording.entries);
  let steps = 0;
  for (let tick = 1; tick <= Math.min(recording.ticks, 4000); tick++) {
    const before = toView(state.game);
    applyTick(state, recording.creator, streams(tick), bots);
    if (before.phase !== "playing" || state.game.phase !== "playing") continue;
    // A bots-only log tick runs several steps; the view states one step, the one the next step takes.
    if (state.game.tick !== before.tick + 1) continue;
    for (const rider of before.players) {
      const after = state.game.players.get(rider.id);
      // A rider that died, bounced, was stopped at a contact or went through a gate did not take a whole step.
      if (
        !rider.alive ||
        !after?.alive ||
        after.portalCooldownUntilTick !== rider.portalCooldownUntilTick
      )
        continue;
      const moved = Math.hypot(after.x - rider.x, after.y - rider.y);
      if (before.openEdges && moved > rider.speed * 2) continue; // crossed an open edge
      assert.ok(
        moved <= rider.speed + 1e-6,
        `tick ${tick}: ${rider.id} moved ${moved}, the view said ${rider.speed}`,
      );
      if (Math.abs(moved - rider.speed) < 1e-6) steps++;
    }
  }
  assert.ok(steps > 1000, `${steps} whole steps matched their published speed`);
});
