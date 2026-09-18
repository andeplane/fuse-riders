import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AVATAR } from "../src/shared/avatars.ts";
import type { Moment } from "../src/engine/moments.ts";
import { createGame, toView } from "../src/engine/game.ts";
import type { WorldView } from "../src/engine/view.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";
import {
  BARS_IN_MS,
  BARS_OUT_MS,
  CLIP_AFTER_TICKS,
  CLIP_BEFORE_TICKS,
  HOLD_MS,
  MAX_CLIPS,
  RECORDER_KEEP_TICKS,
  REPLAY_ZOOM,
  SLOW_FACTOR,
  ReplayDirector,
  ReplayRecorder,
  buildTimeline,
  describeClip,
  replayFrameAt,
  speedAt,
  zoomAt,
  zoomOrigin,
} from "../src/client/replay.ts";

type Rider = {
  id: string;
  x: number;
  y?: number;
  name?: string;
  color?: string;
  slot?: number;
};
function world(
  tick: number,
  round: number,
  riders: Rider[],
  phase: WorldView["phase"] = "playing",
): WorldView {
  return {
    tick,
    round,
    phase,
    matchLength: 5,
    aimBounce: false,
    bombChargeTicks: 8,
    width: 1600,
    height: 900,
    boundaryInset: 20,
    players: riders.map((rider, index) => ({
      id: rider.id,
      name: rider.name ?? rider.id.toUpperCase(),
      slot: rider.slot ?? index,
      color: rider.color ?? `#00000${index}`,
      connected: true,
      avatarId: DEFAULT_AVATAR,
      x: rider.x,
      y: rider.y ?? 450,
      angle: 0,
      alive: true,
      roundWins: 0,
      matchScoreUnits: 0,
      roundScoreUnits: 0,
      bombReadyAtTick: 0,
      aimSlowTicks: 0,
      aimSlowSpentTicks: 0,
      trail: [],
      extraBombs: 0,
      fuseLevel: 0,
      powerPickups: 0,
      reloadDurationTicks: 80,
      invulnerableUntilTick: 0,
      drunkUntilTick: 0,
      inkUntilTick: 0,
      targetBombArmed: false,
      tripleShotArmed: false,
      fiveShotArmed: false,
      nitroUntilTicks: [],
      snailUntilTicks: [],
      rangeLevel: 0,
      grip: false,
      shielded: false,
      shieldGraceUntilTick: 0,
      portalCooldownUntilTick: 0,
      portalGraceUntilTick: 0,
      speed: 7.5,
      turn: 0.14,
      nextVolleyAngles: [0],
    })),
    rules: toView(createGame("replay-rules", classicSettings(), 1)).rules,
    openEdges: false,
    map: "classic",
    obstacles: [],
    bombs: [],
    blasts: [],
    pickups: [],
    portalPairs: [],
    gravityFields: [],
    leaderboard: [],
    roundPlacements: [],
    matchStats: [],
    moments: [],
  };
}
const moment = (overrides: Partial<Moment> = {}): Moment => ({
  kind: "directHit",
  round: 1,
  tick: 100,
  elapsed: 40,
  playerId: "a",
  targetIds: ["b"],
  value: 1,
  ...overrides,
});
/** Frames from `from` to `to` with rider a riding east and b parked. */
function footage(
  recorder: ReplayRecorder,
  from: number,
  to: number,
  matchId = "m",
  round = 1,
): void {
  for (let tick = from; tick <= to; tick += 1)
    recorder.record(
      world(tick, round, [
        { id: "a", x: tick * 7.5, name: "Ada", color: "#22d3ee" },
        { id: "b", x: 900, name: "Byte" },
      ]),
      matchId,
    );
}

test("the recorder keeps a bounded window of authoritative frames, ignores repeats and fractions, and forgets other rounds and matches", () => {
  const recorder = new ReplayRecorder();
  footage(recorder, 1, 200);
  recorder.record(world(150, 1, [{ id: "a", x: 0 }]), "m");
  recorder.record({ ...world(201, 1, [{ id: "a", x: 0 }]), tick: 200.5 }, "m");
  const clip = recorder.cut(moment({ tick: 190 }), "m")!;
  assert.equal(clip.frames[0]!.tick, 190 - CLIP_BEFORE_TICKS);
  assert.equal(
    clip.frames[clip.frames.length - 1]!.tick,
    200,
    "the clip ends at the newest frame, ten short of the full tail",
  );
  assert.equal(
    recorder.cut(moment({ tick: 60, targetIds: ["c"] }), "m"),
    undefined,
    `frames older than ${RECORDER_KEEP_TICKS} ticks behind the newest are gone`,
  );
  assert.equal(
    recorder.cut(moment({ tick: 190, round: 2 }), "m"),
    undefined,
    "a moment from another round has no footage",
  );
  assert.equal(
    recorder.cut(moment({ tick: 190, targetIds: ["d"] }), "other"),
    undefined,
    "nor from another match",
  );
  assert.equal(
    recorder.cut(moment({ tick: 191 }), "m"),
    clip,
    "the same play, whatever tick a rewind put it on, yields the same clip",
  );
  footage(recorder, 1, 100, "m", 2);
  assert.equal(recorder.clip(clip.key), clip, "clips survive the next round");
  footage(recorder, 1, 100, "rematch", 1);
  assert.equal(recorder.clip(clip.key), undefined, "a new match forgets them");
});

test("a clip needs its impact frame and enough footage, and the kept clips are bounded", () => {
  const recorder = new ReplayRecorder();
  footage(recorder, 1, 99);
  assert.equal(
    recorder.cut(moment({ tick: 100 }), "m"),
    undefined,
    "the impact frame has not arrived",
  );
  footage(recorder, 100, 100);
  const clip = recorder.cut(moment({ tick: 100 }), "m")!;
  assert.equal(clip.frames[clip.frames.length - 1]!.tick, 100);
  const thin = new ReplayRecorder();
  footage(thin, 98, 104);
  assert.equal(
    thin.cut(moment({ tick: 100 }), "m"),
    undefined,
    "seven frames is not a replay",
  );
  const many = new ReplayRecorder();
  footage(many, 1, 300);
  const keys = Array.from(
    { length: MAX_CLIPS + 2 },
    (_, index) =>
      many.cut(moment({ tick: 250, targetIds: [`t${index}`] }), "m")!.key,
  );
  assert.equal(many.clip(keys[0]!), undefined, "the oldest clip is dropped");
  assert.ok(many.clip(keys[keys.length - 1]!), "the newest is kept");
});

test("the speed ramp slows through the impact and the camera pushes in around it", () => {
  assert.equal(speedAt(0, 100), 1);
  assert.equal(speedAt(92, 100), 1);
  assert.equal(speedAt(100, 100), SLOW_FACTOR);
  assert.equal(speedAt(104, 100), SLOW_FACTOR);
  assert.equal(speedAt(110, 100), 1);
  assert.ok(
    speedAt(95, 100) > SLOW_FACTOR && speedAt(95, 100) < 1,
    "ramping down",
  );
  assert.ok(
    speedAt(107, 100) > SLOW_FACTOR && speedAt(107, 100) < 1,
    "ramping up",
  );
  assert.equal(zoomAt(80, 100), 1);
  assert.equal(zoomAt(96, 100), REPLAY_ZOOM);
  assert.equal(zoomAt(108, 100), REPLAY_ZOOM);
  assert.equal(zoomAt(116, 100), 1);
  assert.ok(zoomAt(90, 100) > 1 && zoomAt(90, 100) < REPLAY_ZOOM);
  assert.ok(zoomAt(112, 100) > 1 && zoomAt(112, 100) < REPLAY_ZOOM);
  assert.deepEqual(
    zoomOrigin(
      { width: 1600, height: 900 },
      { width: 1600, height: 900 },
      { x: 400, y: 450 },
    ),
    { x: 400, y: 450 },
  );
  assert.deepEqual(
    zoomOrigin(
      { width: 800, height: 900 },
      { width: 1600, height: 900 },
      { x: 400, y: 450 },
    ),
    { x: 200, y: 450 - 225 + 225 },
    "letterboxed top and bottom at half scale",
  );
  assert.deepEqual(
    zoomOrigin(
      { width: 1600, height: 1800 },
      { width: 1600, height: 900 },
      { x: 0, y: 0 },
    ),
    { x: 0, y: 450 },
    "pillarboxed: the world starts a quarter of the way down",
  );
});

test("the timeline stretches the impact, focuses the protagonist, and plays hold, bars, clip and bars back", () => {
  const recorder = new ReplayRecorder();
  footage(recorder, 1, 120);
  const clip = recorder.cut(moment({ tick: 100 }), "m")!;
  const timeline = buildTimeline(clip);
  const realtime = (clip.frames.length - 1) * 50;
  assert.ok(
    timeline.playMs > realtime && timeline.playMs < realtime * 2,
    `slow motion lengthens playback: ${timeline.playMs} vs ${realtime}`,
  );
  assert.equal(
    timeline.totalMs,
    HOLD_MS + BARS_IN_MS + timeline.playMs + BARS_OUT_MS,
  );
  assert.deepEqual(
    timeline.focus,
    { x: 750, y: 450 },
    "the protagonist where it was at the impact tick",
  );
  assert.equal(replayFrameAt(timeline, 0).stage, "hold");
  assert.equal(
    replayFrameAt(timeline, HOLD_MS - 1).snapshot,
    undefined,
    "live play stays on screen during the hold",
  );
  const bars = replayFrameAt(timeline, HOLD_MS);
  assert.equal(bars.stage, "in");
  assert.equal(bars.snapshot, clip.frames[0]);
  assert.equal(bars.zoom, 1);
  const start = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS);
  assert.equal(start.stage, "play");
  assert.equal(start.snapshot!.tick, clip.frames[0]!.tick);
  assert.equal(start.slow, false);
  assert.equal(start.flash, 0);
  const between = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS + 25);
  assert.equal(
    between.snapshot!.tick,
    clip.frames[0]!.tick + 0.5,
    "frames interpolate at full speed",
  );
  assert.equal(
    between.snapshot!.players[0]!.x,
    clip.frames[0]!.players[0]!.x + 3.75,
  );
  const impactAt =
    timeline.at[clip.frames.findIndex((frame) => frame.tick === 100)]!;
  const impact = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS + impactAt);
  assert.equal(impact.snapshot!.tick, 100);
  assert.equal(impact.flash, 1);
  assert.equal(impact.slow, true);
  assert.equal(impact.zoom, REPLAY_ZOOM);
  assert.deepEqual(impact.focus, timeline.focus);
  const out = replayFrameAt(
    timeline,
    HOLD_MS + BARS_IN_MS + timeline.playMs + BARS_OUT_MS / 2,
  );
  assert.equal(out.stage, "out");
  assert.equal(out.snapshot, clip.frames[clip.frames.length - 1]);
  assert.equal(out.zoom, 1, "the last frame is past the push-in");
  assert.equal(replayFrameAt(timeline, timeline.totalMs).stage, "done");
  const described = describeClip(clip);
  assert.deepEqual(described, {
    card: {
      title: "BULLSEYE",
      icon: "◎",
      copy: "Ada BOMBED Byte ON THE HEAD",
      when: "ROUND 1 · 0:02",
    },
    color: "#22d3ee",
  });
  assert.equal(
    describeClip({
      ...clip,
      moment: moment({ playerId: "ghost", targetIds: [] }),
    }).color,
    "#29dfff",
    "an unknown protagonist keeps the default colour",
  );
  assert.deepEqual(
    buildTimeline({
      ...clip,
      moment: moment({ playerId: "ghost", targetIds: ["b"] }),
    }).focus,
    { x: 900, y: 450 },
    "a missing protagonist focuses the victim",
  );
  assert.equal(
    buildTimeline({
      ...clip,
      moment: moment({ playerId: "ghost", targetIds: [] }),
    }).focus,
    undefined,
  );
});

test("the director arms at the pause, plays once the aftermath frames are in, and cues in, impact and out exactly once", () => {
  const director = new ReplayDirector();
  const at = (tick: number) => tick * 50;
  const riders = (tick: number) => [
    { id: "a", x: tick * 7.5, name: "Ada" },
    { id: "b", x: 900 },
  ];
  for (let tick = 1; tick <= 60; tick += 1)
    director.observe(world(tick, 1, riders(tick)), "m", at(tick));
  director.moment(
    moment({ kind: "bombDodge", tick: 40, targetIds: ["b"], value: 5 }),
    "m",
    1,
  );
  director.moment(moment({ kind: "directHit", tick: 60 }), "m", 1);
  director.moment(moment({ kind: "directHit", tick: 60 }), "m", 1);
  director.moment(
    moment({ kind: "multiKill", tick: 60, value: 3, targetIds: ["b", "c"] }),
    "m",
    2,
  );
  assert.equal(director.active, false, "nothing plays while the round runs");
  // The kill ends the round: the pause begins on the impact tick, before any aftermath frame exists.
  director.observe(world(61, 1, riders(61), "roundOver"), "m", at(61));
  assert.equal(director.active, true, "armed");
  assert.equal(director.current, undefined, "but not cut yet");
  assert.equal(
    director.frame(at(61) + 10),
    undefined,
    "live play stays on screen while the aftermath arrives",
  );
  for (let tick = 62; tick < 60 + CLIP_AFTER_TICKS; tick += 1)
    director.observe(world(tick, 1, riders(tick), "roundOver"), "m", at(tick));
  assert.equal(director.current, undefined, "one frame short");
  director.observe(
    world(60 + CLIP_AFTER_TICKS, 1, riders(60 + CLIP_AFTER_TICKS), "roundOver"),
    "m",
    at(60 + CLIP_AFTER_TICKS),
  );
  const clip = director.current!;
  assert.equal(
    clip.moment.kind,
    "directHit",
    "the heaviest moment of this round, not the dodge and not next round's",
  );
  assert.equal(
    clip.frames[clip.frames.length - 1]!.tick,
    60 + CLIP_AFTER_TICKS,
    "the clip carries the full aftermath",
  );
  const started = at(61);
  const bars = director.frame(started + HOLD_MS)!;
  assert.deepEqual(
    bars.cues,
    ["in"],
    "the hold is counted from the pause, not from the cut",
  );
  assert.deepEqual(
    director.frame(started + HOLD_MS + 10)!.cues,
    [],
    "a stage cues once",
  );
  const timeline = buildTimeline(clip);
  const impactAt =
    started +
    HOLD_MS +
    BARS_IN_MS +
    timeline.at[clip.frames.findIndex((frame) => frame.tick === 60)]!;
  assert.deepEqual(
    director.frame(impactAt - 20)!.cues,
    [],
    "not before the flash peaks",
  );
  assert.deepEqual(director.frame(impactAt)!.cues, ["impact"]);
  assert.deepEqual(
    director.frame(impactAt + 16)!.cues,
    [],
    "the impact cues once",
  );
  assert.deepEqual(
    director.frame(started + HOLD_MS + BARS_IN_MS + timeline.playMs + 1)!.cues,
    ["out"],
  );
  const done = director.frame(started + timeline.totalMs)!;
  assert.equal(done.stage, "done");
  assert.equal(director.active, false);
  assert.equal(
    director.frame(started + timeline.totalMs + 1),
    undefined,
    "live play afterwards",
  );
  director.observe(world(90, 1, riders(90), "roundOver"), "m", at(90));
  assert.equal(
    director.active,
    false,
    "the same pause does not restart the replay",
  );
  director.play(director.recorder.clip(done.clip.key)!, 99_000);
  assert.equal(director.active, true, "watch again replays a kept clip");
  director.observe(world(91, 2, riders(91), "countdown"), "m", 99_050);
  assert.equal(
    director.active,
    false,
    "the next countdown takes the replay with it",
  );
  const torn = director.frame(99_060)!;
  assert.equal(torn.stage, "done");
  assert.equal(
    torn.clip.key,
    done.clip.key,
    "one done frame so the screen undresses",
  );
  assert.equal(director.frame(99_070), undefined);
});

test("the hold runs out: a screen whose aftermath frames never arrive plays what it has, and one without footage plays nothing", () => {
  const late = new ReplayDirector();
  for (let tick = 1; tick <= 60; tick += 1)
    late.observe(
      world(tick, 1, [
        { id: "a", x: tick },
        { id: "b", x: 900 },
      ]),
      "m",
      tick * 50,
    );
  late.moment(moment({ tick: 60 }), "m", 1);
  late.observe(
    world(
      61,
      1,
      [
        { id: "a", x: 61 },
        { id: "b", x: 900 },
      ],
      "roundOver",
    ),
    "m",
    3050,
  );
  assert.equal(late.current, undefined);
  assert.equal(late.frame(3050 + HOLD_MS - 1), undefined, "still live");
  const cut = late.frame(3050 + HOLD_MS)!;
  assert.equal(cut.stage, "in");
  assert.deepEqual(cut.cues, ["in"]);
  assert.equal(
    late.current!.frames[late.current!.frames.length - 1]!.tick,
    61,
    "cut with the footage on hand",
  );
  const short = buildTimeline(late.current!);
  assert.deepEqual(
    late.frame(3050 + HOLD_MS + BARS_IN_MS + short.playMs + 1)!.cues,
    ["out", "impact"],
    "an impact that is the last frame still stings as the bars leave",
  );
  const quiet = new ReplayDirector();
  for (let tick = 1; tick <= 70; tick += 1)
    quiet.observe(
      world(tick, 1, [{ id: "a", x: 0 }], tick > 60 ? "roundOver" : "playing"),
      "m",
      tick * 50,
    );
  assert.equal(quiet.active, false, "no moments, no replay");
  const joined = new ReplayDirector();
  joined.moment(moment({ tick: 50 }), "m", 1);
  joined.observe(world(61, 1, [{ id: "a", x: 0 }], "roundOver"), "m", 3050);
  assert.equal(
    joined.frame(3050 + HOLD_MS),
    undefined,
    "a screen that joined at the pause has no clip to show",
  );
  assert.equal(joined.active, false);
  const matchOver = new ReplayDirector();
  for (let tick = 1; tick <= 60; tick += 1)
    matchOver.observe(
      world(tick, 3, [
        { id: "a", x: tick },
        { id: "b", x: 900 },
      ]),
      "m",
      tick * 50,
    );
  matchOver.moment(moment({ tick: 55, round: 3 }), "m", 3);
  for (let tick = 61; tick <= 72; tick += 1)
    matchOver.observe(
      world(
        tick,
        3,
        [
          { id: "a", x: tick },
          { id: "b", x: 900 },
        ],
        "matchOver",
      ),
      "m",
      tick * 50,
    );
  assert.equal(
    matchOver.current?.moment.tick,
    55,
    "the final-round pause replays too",
  );
  const crowded = new ReplayDirector();
  for (let round = 1; round <= 6; round += 1)
    crowded.moment(moment({ round, tick: round * 100 }), "m", round);
  crowded.observe(world(601, 6, [{ id: "a", x: 0 }]), "m", 0);
  crowded.observe(world(602, 6, [{ id: "a", x: 0 }]), "other", 1);
  assert.equal(
    crowded.active,
    false,
    "stale rounds and other matches are pruned without effect",
  );
  assert.ok(CLIP_AFTER_TICKS > 0 && CLIP_BEFORE_TICKS > CLIP_AFTER_TICKS);
});
