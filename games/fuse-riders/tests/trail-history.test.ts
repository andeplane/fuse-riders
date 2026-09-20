import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyTick, createRoomState } from "../src/engine/apply-tick.js";
import { BotController } from "../src/engine/bot-controller.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { addPlayer, createGame, toView } from "../src/engine/game.js";
import type { WorldView } from "../src/engine/view.js";
import type { TrailSegment } from "../src/shared/protocol.js";
import { presentWorld } from "../src/render/time/present.js";
import {
  completeTrailStrokes,
  establishedTrailStrokes,
  trailPaths,
  type TrailStroke,
} from "../src/render/phaser/trails.js";
import { TrailHistory } from "../src/render/phaser/trail-history.js";
import { streamReader, type Recording } from "./fixtures/replay-log.js";
import { classicSettings } from "./fixtures/classic-settings.js";

/** The fade reads the view's rules, as the scene does. */
const RULES = toView(createGame("trail-rules", classicSettings(), 1)).rules;

const segment = (
  tick: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): TrailSegment => ({
  x1,
  y1,
  x2,
  y2,
  createdTick: tick,
  expiresAtTick: tick + 160,
});
const rider = () => {
  const game = createGame("trail-test", classicSettings(), 42);
  addPlayer(game, { id: "p", name: "Player", slot: 0, color: "#22d3ee" });
  return {
    ...toView(game).players[0]!,
    alive: true,
    x: 25,
    y: 10,
    portalCooldownUntilTick: 0,
    trail: [segment(9, 0, 0, 10, 0), segment(10, 10, 0, 20, 10)],
  };
};
type Rider = WorldView["players"][number];
const withTrail = (trail: TrailSegment[]): Rider => ({ ...rider(), trail });

/** Cheap structural equality, so a 1200-tick replay can check every frame; failures fall back to deepEqual. */
function same(a: readonly TrailStroke[], b: readonly TrailStroke[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x.color !== y.color || x.alive !== y.alive) return false;
    if (x.paths.length !== y.paths.length) return false;
    for (let p = 0; p < x.paths.length; p++) {
      const u = x.paths[p]!,
        v = y.paths[p]!;
      if (u.length !== v.length) return false;
      for (let k = 0; k < u.length; k++)
        if (u[k]!.x !== v[k]!.x || u[k]!.y !== v[k]!.y) return false;
    }
  }
  return true;
}

test("the cache reproduces a full rebuild on every frame of a replayed match", () => {
  const recording: Recording = JSON.parse(
    readFileSync(
      new URL("./fixtures/mechanics-recording.json", import.meta.url),
      "utf8",
    ),
  );
  const state = createRoomState(recording.matchId, defaultRoomSettings());
  const bots = new BotController();
  const streams = streamReader(recording.entries);
  const complete = new TrailHistory();
  const established = new TrailHistory();
  let older: WorldView | undefined;
  let segments = 0,
    built = 0,
    detached = 0,
    deaths = 0;
  const rounds = new Set<number>();
  for (let tick = 1; tick <= 1200; tick++) {
    applyTick(state, recording.creator, streams(tick), bots);
    const newer = { ...toView(state.game), tick: state.game.tick };
    const local = newer.players[0];
    rounds.add(state.game.round);
    // Three frames per tick, as a 60 Hz screen draws a 20 Hz simulation, with the local rider led ahead.
    for (const fraction of [0.34, 0.67, 1]) {
      const at = (older?.tick ?? newer.tick) + fraction;
      const view = presentWorld(
        older,
        newer,
        Math.min(at, newer.tick),
        local && {
          id: local.id,
          controls: { left: fraction > 0.5, right: false },
          lead: fraction,
        },
      );
      const scope = `${recording.matchId}:${view.round}`;
      const colorTick = view.tick;
      const mine = complete.complete(
        view.players,
        scope,
        view.tick,
        view.phase,
        view.rules,
        colorTick,
      );
      const reference = completeTrailStrokes(
        view.players,
        view.tick,
        view.phase,
        view.rules,
        colorTick,
      );
      if (!same(mine, reference)) assert.deepEqual(mine, reference);
      const frame = established.update(view.players, scope, colorTick, RULES);
      const establishedReference = establishedTrailStrokes(
        view.players,
        colorTick,
        RULES,
      );
      if (!same(frame.strokes, establishedReference))
        assert.deepEqual(frame.strokes, establishedReference);
      built += frame.built;
      for (const player of view.players) {
        segments += Math.max(0, player.trail.length - 1);
        if (player.trail.some((s) => s.detached)) detached++;
        if (!player.alive) deaths++;
      }
    }
    older = newer;
  }
  assert.ok(rounds.size > 1, "the slice crosses a round boundary");
  assert.ok(detached > 0, "the slice detaches trails");
  assert.ok(deaths > 0, "the slice kills riders");
  // The point of the change: most established segments are never re-derived.
  assert.ok(
    built < segments / 10,
    `built ${built} of ${segments} established segments`,
  );
});

test("an append splits exactly where a rebuild would, holes and crossings included", () => {
  const history = new TrailHistory();
  // A missing tick 11 is a real hole even though 12 starts exactly where 10 ended.
  const trail = [
    segment(9, 0, 0, 10, 0),
    segment(10, 10, 0, 20, 0),
    segment(12, 20, 0, 30, 0),
    segment(13, 30, 0, 30, 10),
    segment(14, 30, 10, 30, 20),
  ];
  let grown: TrailSegment[] = [];
  for (const next of trail) {
    grown = [...grown, next];
    const player = withTrail(grown);
    assert.deepEqual(
      history.update([player], "match:1", 0, RULES).strokes,
      establishedTrailStrokes([player], 0, RULES),
      `after ${grown.length} segments`,
    );
  }
  const established = history.update(
    [withTrail(trail)],
    "match:1",
    0,
    RULES,
  ).strokes;
  assert.deepEqual(
    established[0]!.paths,
    trailPaths(trail.slice(0, -1)),
    "the hole survives the append",
  );
  assert.equal(established[0]!.paths.length, 2);
});

test("expiry off the head rebuilds only the group it straddles", () => {
  const history = new TrailHistory();
  const trail = [
    segment(9, 0, 0, 10, 0),
    segment(10, 10, 0, 20, 0),
    segment(11, 20, 0, 30, 0),
    segment(12, 30, 0, 40, 0),
    segment(13, 40, 0, 50, 0),
  ];
  history.update([withTrail(trail)], "match:1", 0, RULES);
  for (let dropped = 1; dropped < trail.length; dropped++) {
    const player = withTrail(trail.slice(dropped));
    const frame = history.update([player], "match:1", 0, RULES);
    assert.equal(frame.changed, true);
    assert.deepEqual(
      frame.strokes,
      establishedTrailStrokes([player], 0, RULES),
      `after ${dropped} expired`,
    );
  }
});

test("a rewind or a corrected segment falls back to a full rebuild", () => {
  const history = new TrailHistory();
  const trail = [
    segment(9, 0, 0, 10, 0),
    segment(10, 10, 0, 20, 0),
    segment(11, 20, 0, 30, 0),
    segment(12, 30, 0, 40, 0),
  ];
  history.update([withTrail(trail)], "match:1", 0, RULES);
  // Rollback: the world rewinds and the trail is shorter than the retained history.
  const rewound = withTrail(trail.slice(0, 2));
  const back = history.update([rewound], "match:1", 0, RULES);
  assert.equal(back.changed, true);
  assert.deepEqual(back.strokes, establishedTrailStrokes([rewound], 0, RULES));
  // Rollback that replays differently: the same length, different geometry from the second segment on.
  history.update([withTrail(trail)], "match:1", 0, RULES);
  const replayed = withTrail([
    trail[0]!,
    segment(10, 10, 0, 10, 10),
    segment(11, 10, 10, 10, 20),
    segment(12, 10, 20, 10, 30),
  ]);
  const after = history.update([replayed], "match:1", 0, RULES);
  assert.deepEqual(
    after.strokes,
    establishedTrailStrokes([replayed], 0, RULES),
  );
  assert.equal(after.built, 3, "the whole rider is rebuilt, not extended");
  // A gun cut moves an endpoint without changing the length; the retained window must not be reused.
  const clipped = withTrail([
    { ...trail[0]!, x2: 6 },
    ...trail.slice(1),
  ] as TrailSegment[]);
  assert.deepEqual(
    history.update([clipped], "match:1", 0, RULES).strokes,
    establishedTrailStrokes([clipped], 0, RULES),
  );
});

test("a trail repaints when it detaches and again on every tick it fades", () => {
  const history = new TrailHistory();
  const trail = [
    segment(9, 0, 0, 10, 0),
    segment(10, 10, 0, 20, 0),
    segment(11, 20, 0, 30, 0),
  ];
  const alive = withTrail(trail);
  assert.equal(
    history.update([alive], "match:1", 60, RULES).strokes[0]!.alive,
    true,
  );
  const detach = (segments: TrailSegment[]): TrailSegment[] =>
    segments.map((s) => ({ ...s, detached: { id: 1, decayStartTick: 70 } }));
  const detached = { ...alive, alive: false, trail: detach(trail) };
  const first = history.update([detached], "match:1", 40, RULES);
  assert.equal(first.changed, true);
  assert.equal(first.built, trail.length - 1, "detachment repaints the rider");
  assert.equal(first.strokes[0]!.alive, false);
  assert.deepEqual(
    first.strokes,
    establishedTrailStrokes([detached], 40, RULES),
  );
  // Fading is a colour change over stationary geometry: repainted, but nothing is re-derived.
  const later = history.update([detached], "match:1", 55, RULES);
  assert.equal(later.changed, true);
  assert.equal(later.built, 0);
  assert.notEqual(later.strokes[0]!.color, first.strokes[0]!.color);
  assert.deepEqual(
    later.strokes,
    establishedTrailStrokes([detached], 55, RULES),
  );
  // Erosion at both ends of the piece: geometry moved, so it is rebuilt.
  const eroded = {
    ...detached,
    trail: [
      { ...detached.trail[0]!, x1: 3.75 },
      ...detached.trail.slice(1, -1),
      { ...detached.trail.at(-1)!, x2: 26.25 },
    ],
  };
  const shrunk = history.update([eroded], "match:1", 60, RULES);
  assert.ok(shrunk.built > 0);
  assert.deepEqual(
    shrunk.strokes,
    establishedTrailStrokes([eroded], 60, RULES),
  );
  // A frame inside the same tick reuses everything.
  assert.deepEqual(
    history.update([eroded], "match:1", 60, RULES).changed,
    false,
  );
});

test("nothing established changed means the same strokes array, untouched input", () => {
  const history = new TrailHistory();
  const player = rider();
  const original = structuredClone(player);
  const first = history.update([player], "epoch:match:round1", 0, RULES);
  const moved = {
    ...player,
    x: 27,
    trail: [structuredClone(player.trail[0]!), { ...player.trail[1]!, x2: 27 }],
  };
  const next = history.update([moved], "epoch:match:round1", 0, RULES);
  assert.equal(first.changed, true);
  assert.equal(next.changed, false);
  assert.equal(next.strokes, first.strokes);
  assert.equal(
    history.update([structuredClone(moved)], "epoch:match:round1", 0, RULES)
      .changed,
    false,
  );
  assert.deepEqual(player, original, "presentation must not mutate the view");
  // What the scene reads after `complete()`, which returns strokes rather than a frame.
  assert.equal(history.changedLastFrame(), false);
  assert.equal(history.builtLastFrame(), 0);
  history.complete([rider()], "epoch:match:round2", 10.5, "playing", RULES);
  assert.equal(history.changedLastFrame(), true);
  assert.equal(history.builtLastFrame(), 1);
});

test("a new round, a new match, a rider leaving and a reset clear the cache", () => {
  const history = new TrailHistory();
  const player = rider();
  const second = { ...rider(), id: "q", color: "#ff0000" };
  assert.equal(
    history.update([player, second], "match:1", 0, RULES).strokes.length,
    2,
  );
  // A new round is a new scope: everything is rebuilt, nothing is carried over.
  const round2 = history.update([player, second], "match:2", 0, RULES);
  assert.equal(round2.changed, true);
  assert.equal(round2.built, 2);
  // A rider leaving shortens the roster; the remaining strokes are still the roster's, in order.
  const left = history.update([second], "match:2", 0, RULES);
  assert.equal(left.changed, true);
  assert.deepEqual(left.strokes, establishedTrailStrokes([second], 0, RULES));
  assert.deepEqual(history.update([], "match:2", 0, RULES).strokes, []);
  history.update([player], "match:2", 0, RULES);
  history.reset();
  assert.equal(history.update([player], "match:2", 0, RULES).changed, true);
  // A seat taken by a different rider at the same index is a different trail.
  history.update([player], "match:3", 0, RULES);
  const replaced = history.update(
    [{ ...player, id: "replacement" }],
    "match:3",
    0,
    RULES,
  );
  assert.equal(replaced.changed, true);
  assert.equal(replaced.built, 1);
  // A rider that changes its colour or dies repaints its whole trail, not just what arrived since.
  for (const changed of [
    { ...player, color: "#ff0000" },
    { ...player, alive: false },
  ]) {
    history.update([player], "match:4", 0, RULES);
    const frame = history.update([changed], "match:4", 0, RULES);
    assert.equal(frame.changed, true);
    assert.equal(frame.built, 1);
    assert.deepEqual(
      frame.strokes,
      establishedTrailStrokes([changed], 0, RULES),
    );
    history.reset();
  }
});

test("the complete strokes fold the volatile last segment and the tip into the same path", () => {
  const history = new TrailHistory();
  const player = rider();
  const view = (p: Rider, tick: number) =>
    history.complete([p], "match:1", tick, "playing", RULES);
  assert.deepEqual(
    view(player, 10.5),
    completeTrailStrokes([player], 10.5, "playing", RULES),
  );
  // The local rider's speculative segment is rewritten every frame: the established history must survive it.
  for (const x of [21, 23, 25, 27]) {
    const moving = {
      ...player,
      x,
      trail: [player.trail[0]!, { ...player.trail[1]!, x2: x, y2: 10 }],
    };
    assert.deepEqual(
      view(moving, 10.5),
      completeTrailStrokes([moving], 10.5, "playing", RULES),
      `tip at ${x}`,
    );
  }
  // A new piece that does not join the established tail opens its own path, not an extension of it.
  const jumped = {
    ...player,
    trail: [...player.trail, segment(12, 100, 100, 110, 100)],
  };
  assert.deepEqual(
    view(jumped, 12.5),
    completeTrailStrokes([jumped], 12.5, "playing", RULES),
  );
  const empty = { ...player, trail: [] };
  assert.deepEqual(view(empty, 12.5), []);
});
