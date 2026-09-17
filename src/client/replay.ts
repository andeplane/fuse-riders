import type { WorldView } from "../engine/view.js";
import { momentKey, type Moment } from "../engine/moments.js";
import {
  describeMoment,
  rankMoments,
  type MomentCard,
} from "../engine/match-recap.js";
import { interpolateWorld } from "../online/prediction.js";

/**
 * Instant replay (ADR 044): presentation only. Every screen already receives one authoritative world snapshot per
 * tick; the recorder keeps the last few seconds of those references, cuts a clip around a moment, and the director
 * turns wall-clock time into a clip frame with a broadcast speed ramp, a push-in on the protagonist and the cues the
 * audio plays. Nothing here touches the simulation, and a screen that missed the frames simply shows no replay.
 */
export const CLIP_BEFORE_TICKS = 40;
export const CLIP_AFTER_TICKS = 16;
/** Frames kept behind the newest one; enough for a clip plus the frames that arrive after the moment. */
export const RECORDER_KEEP_TICKS = 120;
export const MAX_CLIPS = 16;
/** Live play stays on screen this long after the round ends before the replay cuts in. */
export const HOLD_MS = 1000;
export const BARS_IN_MS = 450;
export const BARS_OUT_MS = 400;
export const SLOW_FACTOR = 0.25;
export const REPLAY_ZOOM = 1.35;
const TICK_MS = 50;

export interface ReplayClip {
  key: string;
  moment: Moment;
  frames: WorldView[];
}

/** Keeps recent authoritative frames for one match and the clips cut from them. */
export class ReplayRecorder {
  private matchId = "";
  private round = -1;
  private frames: WorldView[] = [];
  private readonly clips = new Map<string, ReplayClip>();
  record(snapshot: WorldView, matchId: string): void {
    if (matchId !== this.matchId) {
      this.matchId = matchId;
      this.clips.clear();
      this.round = -1;
    }
    if (snapshot.round !== this.round) {
      this.round = snapshot.round;
      this.frames = [];
    }
    if (!Number.isInteger(snapshot.tick)) return;
    const last = this.frames[this.frames.length - 1];
    if (last && snapshot.tick <= last.tick) return;
    this.frames.push(snapshot);
    while (
      this.frames.length &&
      this.frames[0]!.tick < snapshot.tick - RECORDER_KEEP_TICKS
    )
      this.frames.shift();
  }
  /** Cuts the clip around a moment once its impact frame has arrived; the same moment always yields the same clip. */
  cut(moment: Moment, matchId: string): ReplayClip | undefined {
    const key = momentKey(moment);
    const existing = this.clips.get(key);
    if (existing) return existing;
    if (matchId !== this.matchId || moment.round !== this.round)
      return undefined;
    const frames = this.frames.filter(
      (frame) =>
        frame.tick >= moment.tick - CLIP_BEFORE_TICKS &&
        frame.tick <= moment.tick + CLIP_AFTER_TICKS,
    );
    const last = frames[frames.length - 1];
    if (frames.length < 8 || !last || last.tick < moment.tick) return undefined;
    const clip = { key, moment, frames };
    this.clips.set(key, clip);
    if (this.clips.size > MAX_CLIPS)
      this.clips.delete(this.clips.keys().next().value!);
    return clip;
  }
  clip(key: string): ReplayClip | undefined {
    return this.clips.get(key);
  }
}

/** Playback speed around the impact: full speed, a ramp down to slow motion through the hit, and a ramp back up. */
export function speedAt(tick: number, impactTick: number): number {
  const d = tick - impactTick;
  if (d < -8) return 1;
  if (d < -3) return 1 + ((SLOW_FACTOR - 1) * (d + 8)) / 5;
  if (d <= 4) return SLOW_FACTOR;
  if (d < 10) return SLOW_FACTOR + ((1 - SLOW_FACTOR) * (d - 4)) / 6;
  return 1;
}

/** Camera push-in on the protagonist: in before the hit, held through it, released after. */
export function zoomAt(tick: number, impactTick: number): number {
  const d = tick - impactTick;
  const ease = (t: number) => t * t * (3 - 2 * t);
  if (d < -14) return 1;
  if (d < -4) return 1 + (REPLAY_ZOOM - 1) * ease((d + 14) / 10);
  if (d <= 8) return REPLAY_ZOOM;
  if (d < 16) return REPLAY_ZOOM - (REPLAY_ZOOM - 1) * ease((d - 8) / 8);
  return 1;
}

export interface ReplayTimeline {
  clip: ReplayClip;
  /** Milliseconds into playback at which each frame is reached. */ at: number[];
  playMs: number;
  totalMs: number;
  focus?: { x: number; y: number };
}

export function buildTimeline(clip: ReplayClip): ReplayTimeline {
  const impact = clip.moment.tick;
  const at = [0];
  for (let index = 1; index < clip.frames.length; index += 1) {
    const previous = clip.frames[index - 1]!,
      frame = clip.frames[index]!;
    at.push(
      at[index - 1]! +
        ((frame.tick - previous.tick) * TICK_MS) / speedAt(frame.tick, impact),
    );
  }
  const playMs = at[at.length - 1]!;
  const impactFrame = clip.frames.find((frame) => frame.tick >= impact)!;
  const focused =
    impactFrame.players.find((player) => player.id === clip.moment.playerId) ??
    impactFrame.players.find((player) =>
      clip.moment.targetIds.includes(player.id),
    );
  return {
    clip,
    at,
    playMs,
    totalMs: HOLD_MS + BARS_IN_MS + playMs + BARS_OUT_MS,
    ...(focused ? { focus: { x: focused.x, y: focused.y } } : {}),
  };
}

export type ReplayStage = "hold" | "in" | "play" | "out" | "done";
export interface ReplayFrame {
  stage: ReplayStage;
  /** The world to draw; absent during the hold, when live play stays on screen. */
  snapshot?: WorldView;
  zoom: number;
  focus?: { x: number; y: number };
  slow: boolean;
  /** 1 at the impact tick, fading to 0 three ticks either side. */
  flash: number;
}

export function replayFrameAt(
  timeline: ReplayTimeline,
  elapsedMs: number,
): ReplayFrame {
  const { clip, at, playMs, focus } = timeline;
  const frames = clip.frames,
    first = frames[0]!,
    last = frames[frames.length - 1]!;
  const base = { zoom: 1, slow: false, flash: 0, ...(focus ? { focus } : {}) };
  if (elapsedMs < HOLD_MS) return { stage: "hold", ...base };
  const t = elapsedMs - HOLD_MS;
  if (t < BARS_IN_MS) return { stage: "in", snapshot: first, ...base };
  const p = t - BARS_IN_MS;
  if (p < playMs) {
    let index = 0;
    while (index + 1 < at.length && at[index + 1]! <= p) index += 1;
    // p < playMs = at[last], so index + 1 is always a frame and its span is positive.
    const older = frames[index]!,
      newer = frames[index + 1]!;
    const fraction = (p - at[index]!) / (at[index + 1]! - at[index]!);
    const tick = older.tick + (newer.tick - older.tick) * fraction;
    return {
      stage: "play",
      snapshot: interpolateWorld(older, newer, fraction),
      ...base,
      zoom: zoomAt(tick, clip.moment.tick),
      slow: speedAt(tick, clip.moment.tick) < 1,
      flash: Math.max(0, 1 - Math.abs(tick - clip.moment.tick) / 3),
    };
  }
  const o = p - playMs;
  if (o < BARS_OUT_MS)
    return {
      stage: "out",
      snapshot: last,
      ...base,
      zoom:
        zoomAt(last.tick, clip.moment.tick) +
        ((1 - zoomAt(last.tick, clip.moment.tick)) * o) / BARS_OUT_MS,
    };
  return { stage: "done", ...base };
}

/** Where a world point sits inside a canvas element that letterboxes the world (`object-fit: contain`). */
export function zoomOrigin(
  element: { width: number; height: number },
  world: { width: number; height: number },
  focus: { x: number; y: number },
): { x: number; y: number } {
  const scale = Math.min(
    element.width / world.width,
    element.height / world.height,
  );
  return {
    x: (element.width - world.width * scale) / 2 + focus.x * scale,
    y: (element.height - world.height * scale) / 2 + focus.y * scale,
  };
}

/** The chyron for a clip, naming riders from the clip's own frames, with the protagonist's colour. */
export function describeClip(clip: ReplayClip): {
  card: MomentCard;
  color: string;
} {
  const frame = clip.frames[clip.frames.length - 1]!;
  const byId = new Map(frame.players.map((player) => [player.id, player]));
  return {
    card: describeMoment(clip.moment, (id) => byId.get(id)?.name ?? id),
    color: byId.get(clip.moment.playerId)?.color ?? "#29dfff",
  };
}

export type ReplayCue = "in" | "impact" | "out";
export interface ReplayUpdate extends ReplayFrame {
  cues: ReplayCue[];
  clip: ReplayClip;
}

/**
 * Chooses and runs replays for one screen. Moments arrive as events during a round; when the round ends the best
 * one plays after a short hold, if the recorder has its frames. `watch` replays any kept clip on demand.
 */
export class ReplayDirector {
  readonly recorder = new ReplayRecorder();
  /** Moments per `matchId:round`; a round's own list survives an early event for the next round. */
  private readonly pending = new Map<string, Moment[]>();
  /** The pause has begun and this moment will play once its aftermath frames are in, or when the hold runs out. */
  private armed?: { moment: Moment; matchId: string; at: number };
  private timeline?: ReplayTimeline;
  private startedAt = 0;
  private lastStage: ReplayStage = "done";
  private impactCued = false;
  private phase: WorldView["phase"] = "lobby";
  /** A replay torn down by a phase change still reports one `done` frame so the screen undresses. */
  private torn?: ReplayClip;
  get active(): boolean {
    return this.timeline !== undefined || this.armed !== undefined;
  }
  get current(): ReplayClip | undefined {
    return this.timeline?.clip;
  }
  /** Every authoritative snapshot. Entering a pause with moments on file arms the replay of the best one. */
  observe(snapshot: WorldView, matchId: string, now: number): void {
    this.recorder.record(snapshot, matchId);
    const scope = `${matchId}:${snapshot.round}`;
    for (const key of this.pending.keys())
      if (key !== scope && !key.startsWith(`${matchId}:`))
        this.pending.delete(key);
    const paused =
      snapshot.phase === "roundOver" || snapshot.phase === "matchOver";
    // Play that moves on (a reset, a rematch, the next countdown) takes the replay with it.
    if (!paused && (this.timeline || this.armed)) this.cancel();
    if (
      paused &&
      this.phase !== snapshot.phase &&
      !this.timeline &&
      !this.armed
    ) {
      const best = rankMoments(this.pending.get(scope) ?? [])[0]?.moment;
      if (best) this.armed = { moment: best, matchId, at: now };
      this.pending.delete(scope);
    }
    this.phase = snapshot.phase;
    this.settle(now, snapshot.tick);
  }
  /** Cuts the armed clip once the frames after the impact have arrived, or with what there is when the hold is over. */
  private settle(now: number, newestTick?: number): void {
    const armed = this.armed;
    if (!armed) return;
    const complete =
      newestTick !== undefined &&
      newestTick >= armed.moment.tick + CLIP_AFTER_TICKS;
    if (!complete && now - armed.at < HOLD_MS) return;
    this.armed = undefined;
    const clip = this.recorder.cut(armed.moment, armed.matchId);
    // A screen without the footage shows nothing; the pause the simulation extended simply passes.
    if (clip) this.play(clip, armed.at);
  }
  /** A moment event from the authority; only its own round's pause plays it. */
  moment(moment: Moment, matchId: string, round: number): void {
    const scope = `${matchId}:${round}`;
    let list = this.pending.get(scope);
    if (!list) {
      list = [];
      this.pending.set(scope, list);
      if (this.pending.size > 4)
        this.pending.delete(this.pending.keys().next().value!);
    }
    if (!list.some((existing) => momentKey(existing) === momentKey(moment)))
      list.push(moment);
  }
  /** Plays a kept clip, for the recap's watch-again; `now` is when its hold began. */
  play(clip: ReplayClip, now: number): void {
    this.armed = undefined;
    this.timeline = buildTimeline(clip);
    this.startedAt = now;
    this.lastStage = "hold";
    this.impactCued = false;
    this.torn = undefined;
  }
  cancel(): void {
    this.torn = this.timeline?.clip;
    this.timeline = undefined;
    this.armed = undefined;
    this.lastStage = "done";
  }
  /** The frame to draw this animation frame, or undefined for live play; carries the cues crossed since the last call. */
  frame(now: number): ReplayUpdate | undefined {
    this.settle(now);
    const timeline = this.timeline;
    if (!timeline) {
      const torn = this.torn;
      if (!torn) return undefined;
      this.torn = undefined;
      return {
        stage: "done",
        zoom: 1,
        slow: false,
        flash: 0,
        cues: [],
        clip: torn,
      };
    }
    const frame = replayFrameAt(timeline, now - this.startedAt);
    const cues: ReplayCue[] = [];
    if (frame.stage !== this.lastStage) {
      if (frame.stage === "in") cues.push("in");
      if (frame.stage === "out") cues.push("out");
      this.lastStage = frame.stage;
    }
    // The flash peaks on the impact tick; a clip cut short at the impact reaches it only as playback ends, so `out` cues it too.
    if (
      !this.impactCued &&
      ((frame.stage === "play" && frame.flash >= 0.99) || frame.stage === "out")
    ) {
      this.impactCued = true;
      cues.push("impact");
    }
    if (frame.stage === "done") this.timeline = undefined;
    return { ...frame, cues, clip: timeline.clip };
  }
}
