import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AVATAR } from '../src/shared/avatars.ts';
import type { Moment } from '../src/shared/moments.ts';
import type { ViewSnapshot } from '../src/client/snapshot-stream.ts';
import {
  BARS_IN_MS, BARS_OUT_MS, CLIP_AFTER_TICKS, CLIP_BEFORE_TICKS, HOLD_MS, MAX_CLIPS, RECORDER_KEEP_TICKS, REPLAY_ZOOM, SLOW_FACTOR,
  ReplayDirector, ReplayRecorder, buildTimeline, describeClip, replayFrameAt, speedAt, zoomAt, zoomOrigin,
} from '../src/client/replay.ts';

type Rider = { id: string; x: number; y?: number; name?: string; color?: string; slot?: number };
function world(tick: number, round: number, riders: Rider[], phase: ViewSnapshot['phase'] = 'playing'): ViewSnapshot {
  return {
    tick, round, phase, bombChargeTicks: 8, width: 1600, height: 900, boundaryInset: 20,
    players: riders.map((rider, index) => ({
      id: rider.id, name: rider.name ?? rider.id.toUpperCase(), slot: rider.slot ?? index, color: rider.color ?? `#00000${index}`, connected: true, avatarId: DEFAULT_AVATAR,
      x: rider.x, y: rider.y ?? 450, angle: 0, alive: true, roundWins: 0, bombReadyAtTick: 0, trail: [], blastLevel: 0, invulnerableUntilTick: 0, drunkUntilTick: 0, inkUntilTick: 0,
      targetBombArmed: false, tripleShotArmed: false, fiveShotArmed: false, shielded: false, shieldGraceUntilTick: 0, portalCooldownUntilTick: 0, portalGraceUntilTick: 0,
    })),
    bombs: [], blasts: [], pickups: [], portalPairs: [], leaderboard: [], roundPlacements: [], matchStats: [], moments: [],
  };
}
const moment = (overrides: Partial<Moment> = {}): Moment => ({ kind: 'directHit', round: 1, tick: 100, elapsed: 40, playerId: 'a', targetIds: ['b'], value: 1, ...overrides });
/** Frames from `from` to `to` with rider a riding east and b parked. */
function footage(recorder: ReplayRecorder, from: number, to: number, matchId = 'm', round = 1): void {
  for (let tick = from; tick <= to; tick += 1) recorder.record(world(tick, round, [{ id: 'a', x: tick * 7.5, name: 'Ada', color: '#22d3ee' }, { id: 'b', x: 900, name: 'Byte' }]), matchId);
}

test('the recorder keeps a bounded window of authoritative frames, ignores repeats and fractions, and forgets other rounds and matches', () => {
  const recorder = new ReplayRecorder();
  footage(recorder, 1, 200);
  recorder.record(world(150, 1, [{ id: 'a', x: 0 }]), 'm');
  recorder.record({ ...world(201, 1, [{ id: 'a', x: 0 }]), tick: 200.5 }, 'm');
  const clip = recorder.cut(moment({ tick: 190 }), 'm')!;
  assert.equal(clip.frames[0]!.tick, 190 - CLIP_BEFORE_TICKS);
  assert.equal(clip.frames[clip.frames.length - 1]!.tick, 200, 'the clip ends at the newest frame, ten short of the full tail');
  assert.equal(recorder.cut(moment({ tick: 60, targetIds: ['c'] }), 'm'), undefined, `frames older than ${RECORDER_KEEP_TICKS} ticks behind the newest are gone`);
  assert.equal(recorder.cut(moment({ tick: 190, round: 2 }), 'm'), undefined, 'a moment from another round has no footage');
  assert.equal(recorder.cut(moment({ tick: 190, targetIds: ['d'] }), 'other'), undefined, 'nor from another match');
  assert.equal(recorder.cut(moment({ tick: 191 }), 'm'), clip, 'the same play, whatever tick a rewind put it on, yields the same clip');
  footage(recorder, 1, 100, 'm', 2);
  assert.equal(recorder.clip(clip.key), clip, 'clips survive the next round');
  footage(recorder, 1, 100, 'rematch', 1);
  assert.equal(recorder.clip(clip.key), undefined, 'a new match forgets them');
});

test('a clip needs its impact frame and enough footage, and the kept clips are bounded', () => {
  const recorder = new ReplayRecorder();
  footage(recorder, 1, 99);
  assert.equal(recorder.cut(moment({ tick: 100 }), 'm'), undefined, 'the impact frame has not arrived');
  footage(recorder, 100, 100);
  const clip = recorder.cut(moment({ tick: 100 }), 'm')!;
  assert.equal(clip.frames[clip.frames.length - 1]!.tick, 100);
  const thin = new ReplayRecorder();
  footage(thin, 98, 104);
  assert.equal(thin.cut(moment({ tick: 100 }), 'm'), undefined, 'seven frames is not a replay');
  const many = new ReplayRecorder();
  footage(many, 1, 300);
  const keys = Array.from({ length: MAX_CLIPS + 2 }, (_, index) => many.cut(moment({ tick: 250, targetIds: [`t${index}`] }), 'm')!.key);
  assert.equal(many.clip(keys[0]!), undefined, 'the oldest clip is dropped');
  assert.ok(many.clip(keys[keys.length - 1]!), 'the newest is kept');
});

test('the speed ramp slows through the impact and the camera pushes in around it', () => {
  assert.equal(speedAt(0, 100), 1); assert.equal(speedAt(92, 100), 1); assert.equal(speedAt(100, 100), SLOW_FACTOR); assert.equal(speedAt(104, 100), SLOW_FACTOR); assert.equal(speedAt(110, 100), 1);
  assert.ok(speedAt(95, 100) > SLOW_FACTOR && speedAt(95, 100) < 1, 'ramping down'); assert.ok(speedAt(107, 100) > SLOW_FACTOR && speedAt(107, 100) < 1, 'ramping up');
  assert.equal(zoomAt(80, 100), 1); assert.equal(zoomAt(96, 100), REPLAY_ZOOM); assert.equal(zoomAt(108, 100), REPLAY_ZOOM); assert.equal(zoomAt(116, 100), 1);
  assert.ok(zoomAt(90, 100) > 1 && zoomAt(90, 100) < REPLAY_ZOOM); assert.ok(zoomAt(112, 100) > 1 && zoomAt(112, 100) < REPLAY_ZOOM);
  assert.deepEqual(zoomOrigin({ width: 1600, height: 900 }, { width: 1600, height: 900 }, { x: 400, y: 450 }), { x: 400, y: 450 });
  assert.deepEqual(zoomOrigin({ width: 800, height: 900 }, { width: 1600, height: 900 }, { x: 400, y: 450 }), { x: 200, y: 450 - 225 + 225 }, 'letterboxed top and bottom at half scale');
  assert.deepEqual(zoomOrigin({ width: 1600, height: 1800 }, { width: 1600, height: 900 }, { x: 0, y: 0 }), { x: 0, y: 450 }, 'pillarboxed: the world starts a quarter of the way down');
});

test('the timeline stretches the impact, focuses the protagonist, and plays hold, bars, clip and bars back', () => {
  const recorder = new ReplayRecorder();
  footage(recorder, 1, 120);
  const clip = recorder.cut(moment({ tick: 100 }), 'm')!;
  const timeline = buildTimeline(clip);
  const realtime = (clip.frames.length - 1) * 50;
  assert.ok(timeline.playMs > realtime && timeline.playMs < realtime * 2, `slow motion lengthens playback: ${timeline.playMs} vs ${realtime}`);
  assert.equal(timeline.totalMs, HOLD_MS + BARS_IN_MS + timeline.playMs + BARS_OUT_MS);
  assert.deepEqual(timeline.focus, { x: 750, y: 450 }, 'the protagonist where it was at the impact tick');
  assert.equal(replayFrameAt(timeline, 0).stage, 'hold'); assert.equal(replayFrameAt(timeline, HOLD_MS - 1).snapshot, undefined, 'live play stays on screen during the hold');
  const bars = replayFrameAt(timeline, HOLD_MS);
  assert.equal(bars.stage, 'in'); assert.equal(bars.snapshot, clip.frames[0]); assert.equal(bars.zoom, 1);
  const start = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS);
  assert.equal(start.stage, 'play'); assert.equal(start.snapshot!.tick, clip.frames[0]!.tick); assert.equal(start.slow, false); assert.equal(start.flash, 0);
  const between = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS + 25);
  assert.equal(between.snapshot!.tick, clip.frames[0]!.tick + .5, 'frames interpolate at full speed');
  assert.equal(between.snapshot!.players[0]!.x, clip.frames[0]!.players[0]!.x + 3.75);
  const impactAt = timeline.at[clip.frames.findIndex(frame => frame.tick === 100)]!;
  const impact = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS + impactAt);
  assert.equal(impact.snapshot!.tick, 100); assert.equal(impact.flash, 1); assert.equal(impact.slow, true); assert.equal(impact.zoom, REPLAY_ZOOM); assert.deepEqual(impact.focus, timeline.focus);
  const out = replayFrameAt(timeline, HOLD_MS + BARS_IN_MS + timeline.playMs + BARS_OUT_MS / 2);
  assert.equal(out.stage, 'out'); assert.equal(out.snapshot, clip.frames[clip.frames.length - 1]); assert.equal(out.zoom, 1, 'the last frame is past the push-in');
  assert.equal(replayFrameAt(timeline, timeline.totalMs).stage, 'done');
  const described = describeClip(clip);
  assert.deepEqual(described, { card: { title: 'BULLSEYE', icon: '◎', copy: 'Ada BOMBED Byte ON THE HEAD', when: 'ROUND 1 · 0:02' }, color: '#22d3ee' });
  assert.equal(describeClip({ ...clip, moment: moment({ playerId: 'ghost', targetIds: [] }) }).color, '#29dfff', 'an unknown protagonist keeps the default colour');
});

test('the director replays the best moment of a round once the pause begins and cues in, impact and out exactly once', () => {
  const director = new ReplayDirector();
  const at = (tick: number) => tick * 50;
  for (let tick = 1; tick <= 60; tick += 1) director.observe(world(tick, 1, [{ id: 'a', x: tick * 7.5, name: 'Ada' }, { id: 'b', x: 900 }]), 'm', at(tick));
  director.moment(moment({ kind: 'bombDodge', tick: 40, targetIds: ['b'], value: 5 }), 'm', 1);
  director.moment(moment({ kind: 'directHit', tick: 50 }), 'm', 1);
  director.moment(moment({ kind: 'directHit', tick: 50 }), 'm', 1);
  director.moment(moment({ kind: 'multiKill', tick: 50, value: 3, targetIds: ['b', 'c'] }), 'm', 2);
  assert.equal(director.active, false, 'nothing plays while the round runs');
  for (let tick = 61; tick <= 64; tick += 1) director.observe(world(tick, 1, [{ id: 'a', x: tick * 7.5 }, { id: 'b', x: 900 }], 'roundOver'), 'm', at(tick));
  assert.equal(director.active, true);
  assert.equal(director.current!.moment.kind, 'directHit', 'the heaviest moment of this round, not the dodge and not next round\'s');
  const started = at(61);
  const hold = director.frame(started + 10)!;
  assert.equal(hold.stage, 'hold'); assert.deepEqual(hold.cues, []);
  const bars = director.frame(started + HOLD_MS)!;
  assert.deepEqual(bars.cues, ['in']);
  assert.deepEqual(director.frame(started + HOLD_MS + 10)!.cues, [], 'a stage cues once');
  const timeline = buildTimeline(director.current!);
  const impactAt = started + HOLD_MS + BARS_IN_MS + timeline.at[director.current!.frames.findIndex(frame => frame.tick === 50)]!;
  assert.deepEqual(director.frame(impactAt - 20)!.cues, [], 'not before the flash peaks');
  assert.deepEqual(director.frame(impactAt)!.cues, ['impact']);
  assert.deepEqual(director.frame(impactAt + 16)!.cues, [], 'the impact cues once');
  assert.deepEqual(director.frame(started + HOLD_MS + BARS_IN_MS + timeline.playMs + 1)!.cues, ['out']);
  const done = director.frame(started + timeline.totalMs)!;
  assert.equal(done.stage, 'done'); assert.equal(director.active, false);
  assert.equal(director.frame(started + timeline.totalMs + 1), undefined, 'live play afterwards');
  director.observe(world(65, 1, [{ id: 'a', x: 0 }], 'roundOver'), 'm', at(65));
  assert.equal(director.active, false, 'the same pause does not restart the replay');
  const clip = director.recorder.clip(director.current?.key ?? done.clip.key)!;
  director.play(clip, 99_000);
  assert.equal(director.active, true, 'watch again replays a kept clip');
  director.cancel(); assert.equal(director.active, false);
});

test('a pause without footage or without moments plays nothing, and a moment that came before its frames waits for them', () => {
  const quiet = new ReplayDirector();
  for (let tick = 1; tick <= 70; tick += 1) quiet.observe(world(tick, 1, [{ id: 'a', x: 0 }], tick > 60 ? 'roundOver' : 'playing'), 'm', tick * 50);
  assert.equal(quiet.active, false);
  const late = new ReplayDirector();
  late.moment(moment({ tick: 50 }), 'm', 1);
  late.observe(world(61, 1, [{ id: 'a', x: 0 }], 'roundOver'), 'm', 3050);
  assert.equal(late.active, false, 'a screen that joined at the pause has no clip to show');
  const matchOver = new ReplayDirector();
  for (let tick = 1; tick <= 60; tick += 1) matchOver.observe(world(tick, 3, [{ id: 'a', x: tick }, { id: 'b', x: 900 }]), 'm', tick * 50);
  matchOver.moment(moment({ tick: 55, round: 3 }), 'm', 3);
  matchOver.observe(world(61, 3, [{ id: 'a', x: 61 }, { id: 'b', x: 900 }], 'matchOver'), 'm', 3050);
  assert.equal(matchOver.active, true, 'the final-round pause replays too');
  assert.ok(CLIP_AFTER_TICKS > 0 && CLIP_BEFORE_TICKS > CLIP_AFTER_TICKS);
});
