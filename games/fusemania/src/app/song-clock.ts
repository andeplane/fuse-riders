import type { AudioClock, ClockedSong } from "fuse-ui/game-audio";

/**
 * The song position that is being heard, as a function of `performance.now()`.
 *
 * Notes are drawn and key presses judged against what the player hears, so the position comes from the audio clock,
 * not from frame times. Three facts make that work:
 *
 * 1. A sample scheduled at audio-clock time `c` is heard when the clock reads `c + L`, `L` being the output latency.
 *    A song played with `song.play(at, offset)` is therefore heard at position `offset + (c - L - at)` when the clock
 *    reads `c`.
 * 2. Starting it with `at = c0 + lead` and `offset = room(c0) + L + lead` makes that `room(c0) + (c - c0)`: the heard
 *    position is the room's position. The lead keeps the start out of the past.
 * 3. The audio clock moves in steps (about 3 ms, 10 to 20 ms on some browsers), so it is not read directly. A
 *    smoothed `skew = clock - performance seconds` turns any performance time, a frame's or a key press's, into a
 *    clock time: `c = ms / 1000 + skew`.
 *
 * With no audio clock (a `?mute` page, a song still loading, a suspended context) the position is the room's own,
 * carried forward with `now()`.
 */
export interface SongClockDeps {
  /** `performance.now()`. */
  now(): number;
  /** The shared audio clock, when there is one. */
  audio(): AudioClock | undefined;
}
export interface SongClock {
  /** Feed the perf-to-audio mapping; call once per animation frame and before `follow`. */
  sample(): void;
  /**
   * Keeps playback aligned with the room. `roomMs` is where the room's shared clock says the song is right now, in
   * milliseconds (negative during the countdown before the song starts); `song` is the decoded song or undefined when
   * there is none (muted, still loading, failed). Starts playback when a song is first given and the audio clock runs,
   * restarts it when the heard position has drifted more than `RESYNC_MS` from the room (tab was hidden, context
   * suspended, device glitch), and stops it when `roomMs` is undefined (no song running).
   */
  follow(roomMs: number | undefined, song: ClockedSong | undefined): void;
  /**
   * The heard song position in ms at performance time `at` (default: now). While a song plays on a running audio clock
   * this comes from the audio clock minus output latency; otherwise it is the room's position extrapolated with
   * `now()` from the last `follow`. It does not jump when switching between the two (playback is scheduled so they
   * agree). 0 while no song is running.
   */
  songMs(at?: number): number;
  /** Whether positions currently come from the audio clock. */
  readonly audible: boolean;
  /** Heard minus room position at the last follow, ms (diagnostics). 0 while positions are the room's. */
  readonly drift: number;
  /**
   * The audio-clock time (seconds) of the sound being heard at performance time `at` (default: now), or undefined
   * while the audio clock is not running. For sounds scheduled without a song: a click scheduled at audio-clock
   * time `c` is heard when this reads `c`, so a tap's distance from the click is `audioTime(tap) - c`.
   */
  audioTime(at?: number): number | undefined;
  /**
   * The newest reading of `audio clock - performance seconds`, the smoothed value presses are converted with and
   * the audio clock itself, all in seconds (diagnostics); undefined while the audio clock is not running.
   */
  mapping(): { reading: number; smoothed: number; audio: number } | undefined;
  stop(): void;
}

/** Heard and room positions further apart than this restart playback. */
export const RESYNC_MS = 120;
/** The least time between two starts of the same song. */
export const RESTART_MS = 1000;
/** How far ahead of the audio clock a start is scheduled, so it is never in the past. */
export const LEAD_MS = 60;
/** Samples of a running audio clock before playback starts, so the start is placed on a settled mapping. */
export const SETTLE_SAMPLES = 8;

/** A reading this far from the estimate is a different clock (a resumed context, a long stall): take it as it is. */
const SNAP_S = 0.05;
/**
 * How fast the estimate falls toward readings that are behind it, in seconds per second. A reading is the clock's
 * last step, so it is stale by up to a step and never early: an older reading only moves the estimate this slowly,
 * just faster than an audio device's clock drifts from the system's (a few hundred parts per million at worst).
 */
const FALL = 0.0005;
/**
 * How fast the estimate rises to a fresher reading once settled, in seconds per second: a correction of a
 * millisecond or two is spread over a few frames instead of showing as one step in the notes.
 */
const RISE = 0.02;
/** Readings remembered to notice the audio clock losing time (a device glitch smaller than `SNAP_S`). */
const WINDOW = 24;
/** Every remembered reading at least this far behind the estimate means the clock fell back, not a stale read. */
const FELL_BACK_S = 0.008;
/** Seconds over which a changed output latency is taken up; browsers re-estimate it while playing. */
const LATENCY_GLIDE_S = 0.5;

export function createSongClock(deps: SongClockDeps): SongClock {
  /** Audio-clock seconds minus performance seconds, smoothed; undefined while the audio clock is not running. */
  let skew: number | undefined;
  /** Output latency in seconds, smoothed. */
  let latency = 0;
  let sampledAt = 0;
  let newest: { reading: number; audio: number } | undefined;
  let settled = 0;
  const recent: number[] = [];
  /** The room's position at the last follow. */
  let anchor: { at: number; room: number } | undefined;
  /** How the song was scheduled: position `offset` at audio-clock time `at`. */
  let playback: { song: ClockedSong; at: number; offset: number } | undefined;
  let startedAt = Number.NEGATIVE_INFINITY;
  let drift = 0;

  const drop = () => {
    playback?.song.stop();
    playback = undefined;
  };
  const halt = () => {
    drop();
    anchor = undefined;
    startedAt = Number.NEGATIVE_INFINITY;
    drift = 0;
  };
  const heard = (
    playing: { at: number; offset: number },
    clockSkew: number,
    at: number,
  ) => (playing.offset + at / 1000 + clockSkew - latency - playing.at) * 1000;

  return {
    sample() {
      const clock = deps.audio();
      if (!clock?.running) {
        skew = undefined;
        newest = undefined;
        settled = 0;
        recent.length = 0;
        return;
      }
      const at = deps.now() / 1000,
        reading = clock.now() - at,
        lag = clock.latency();
      newest = { reading, audio: reading + at };
      if (skew === undefined || Math.abs(reading - skew) > SNAP_S) {
        if (skew === undefined) latency = lag;
        skew = reading;
        settled = 1;
        recent.length = 0;
        recent.push(reading);
        sampledAt = at;
        return;
      }
      const elapsed = Math.max(0, Math.min(0.25, at - sampledAt));
      sampledAt = at;
      settled++;
      recent.push(reading);
      if (recent.length > WINDOW) recent.shift();
      if (reading >= skew)
        skew =
          settled <= SETTLE_SAMPLES
            ? reading
            : Math.min(reading, skew + RISE * elapsed);
      else {
        skew = Math.max(reading, skew - FALL * elapsed);
        if (recent.length === WINDOW) {
          const newest = Math.max(...recent),
            step = newest - Math.min(...recent);
          // Not one of them came near: the audio clock itself lost time. Half a step keeps a coarse clock, whose
          // readings are all well behind now and then, from counting.
          if (newest < skew - Math.max(FELL_BACK_S, step / 2)) skew = newest;
        }
      }
      latency =
        Math.abs(lag - latency) > SNAP_S
          ? lag
          : latency +
            (lag - latency) * (1 - Math.exp(-elapsed / LATENCY_GLIDE_S));
    },
    follow(roomMs, song) {
      if (roomMs === undefined) {
        halt();
        return;
      }
      const at = deps.now();
      anchor = { at, room: roomMs };
      if (playback && playback.song !== song) {
        drop();
        startedAt = Number.NEGATIVE_INFINITY;
      }
      // Nothing to play, or no running clock to play it on: the frozen song must not sound when the clock returns.
      if (!song || skew === undefined || !deps.audio()?.running) {
        drop();
        drift = 0;
        return;
      }
      drift = 0;
      if (playback) {
        drift = heard(playback, skew, at) - roomMs;
        const lost =
          !song.playing &&
          roomMs / 1000 + latency + LEAD_MS / 1000 < song.duration;
        if (Math.abs(drift) > RESYNC_MS || lost) drop();
      }
      if (
        !playback &&
        settled >= SETTLE_SAMPLES &&
        at - startedAt >= RESTART_MS
      ) {
        const lead = LEAD_MS / 1000,
          start = at / 1000 + skew + lead,
          offset = roomMs / 1000 + latency + lead;
        song.play(start, offset);
        playback = { song, at: start, offset };
        startedAt = at;
        drift = 0;
      }
    },
    songMs(at = deps.now()) {
      if (playback && skew !== undefined) return heard(playback, skew, at);
      return anchor ? anchor.room + (at - anchor.at) : 0;
    },
    get audible() {
      return playback !== undefined && skew !== undefined;
    },
    get drift() {
      return drift;
    },
    audioTime(at = deps.now()) {
      return skew === undefined ? undefined : at / 1000 + skew - latency;
    },
    mapping() {
      return skew === undefined || !newest
        ? undefined
        : { reading: newest.reading, smoothed: skew, audio: newest.audio };
    },
    stop: halt,
  };
}
