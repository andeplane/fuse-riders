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
 * 4. Where the browser pairs the two clocks itself (`AudioContext.getOutputTimestamp`: the sample leaving the device
 *    and the page-clock time it does so), that pair is the mapping: it is taken at one instant, so it carries
 *    neither the clock's steps nor a separately reported latency. Measured on Chrome on macOS, the pair holds
 *    within 0.2 ms from one frame to the next, where a clock reading is up to a step (5.3 ms there) stale, and
 *    it puts the output 8 ms further behind the clock than `outputLatency` does: the buffer being rendered is
 *    part of the way out. The stepped clock and the reported latency remain the fallback, and what a start is
 *    scheduled on.
 *
 * With no audio clock (a `?mute` page, a song still loading, a suspended context) the position is the room's own,
 * carried forward with `now()`.
 */
export interface SongClockDeps {
  /** `performance.now()`. */
  now(): number;
  /** The shared audio clock, when there is one. */
  audio(): AudioClock | undefined;
  /**
   * Milliseconds the sound reaches the player later than the browser knows (the audio offset: Bluetooth, a TV, a
   * soundbar). Counted as output latency, so the song is started that much earlier and the heard position, the
   * picture and the judging all move together. 0 when absent.
   */
  extraLatencyMs?(): number;
  /** False keeps the mapping on the stepped clock and the reported latency (to compare the two). */
  pairing?(): boolean;
}
/** Where the heard position comes from. */
export type ClockSource = "paired" | "reported";
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
   * The newest reading of `audio clock - performance seconds` and the smoothed value a start is scheduled with,
   * in seconds (diagnostics); undefined while the audio clock is not running. `source` says what the heard
   * position is read from, `lagMs` how far behind the clock the heard sample is taken to be (the extra latency
   * included), and `pairedMs` the distance of the newest browser pair from the value in use (undefined without one).
   */
  mapping():
    | {
        reading: number;
        smoothed: number;
        source: ClockSource;
        lagMs: number;
        pairedMs: number | undefined;
      }
    | undefined;
  /**
   * The audio-clock time (seconds) at which song position `ms` is scheduled to leave the context (not the time it
   * is heard), or undefined while nothing plays. For a listener that hears the song through a microphone.
   */
  scheduledAt(ms: number): number | undefined;
  /**
   * The audio clock's own time (seconds, latency not taken off) at performance time `at`, or undefined while it
   * is not running.
   */
  clockTime(at: number): number | undefined;
  /** How often the song has been started: the first start and every realignment since. */
  readonly starts: number;
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
/** Seconds over which a moved clock pair is taken up: its readings are already steady, so this only spreads a step. */
const PAIR_GLIDE_S = 0.25;
/** A pair older than this is from before a stall (they are renewed every few ms); one from the future is not one. */
const PAIR_STALE_MS = 250,
  PAIR_EARLY_MS = 20;
/** The output is behind the clock, by less than this; a reading may be a step stale, hence the slack ahead. */
const PAIR_MAX_LAG_S = 2,
  PAIR_AHEAD_S = 0.03;
/** Without a usable pair for this long, the mapping goes back to the stepped clock. */
const PAIR_HOLD_S = 1;

export function createSongClock(deps: SongClockDeps): SongClock {
  /** Audio-clock seconds minus performance seconds, smoothed; undefined while the audio clock is not running. */
  let skew: number | undefined;
  /** Output latency in seconds, smoothed. */
  let latency = 0;
  let sampledAt = 0;
  let newest: number | undefined;
  let settled = 0;
  /** Heard audio-clock seconds minus performance seconds from the browser's own pairs, smoothed; undefined without. */
  let paired: number | undefined,
    pairedAt = 0,
    pairedOff: number | undefined;
  const recent: number[] = [];
  /** The room's position at the last follow. */
  let anchor: { at: number; room: number } | undefined;
  /** How the song was scheduled: position `offset` at audio-clock time `at`. */
  let playback: { song: ClockedSong; at: number; offset: number } | undefined;
  let startedAt = Number.NEGATIVE_INFINITY;
  let drift = 0,
    starts = 0;

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
  /** Heard audio-clock seconds minus performance seconds. */
  const heardSkew = (clockSkew: number) => paired ?? clockSkew - latency;
  const heard = (
    playing: { at: number; offset: number },
    clockSkew: number,
    at: number,
  ) => (playing.offset + at / 1000 + heardSkew(clockSkew) - playing.at) * 1000;
  const extra = () => {
    const ms = deps.extraLatencyMs?.() ?? 0;
    return Number.isFinite(ms) ? ms / 1000 : 0;
  };
  /** The browser's pair, when it is one to trust right now. */
  const pairOf = (clock: AudioClock, nowMs: number, reading: number) => {
    const pair = deps.pairing?.() === false ? undefined : clock.output?.();
    if (!pair) return;
    const age = nowMs - pair.performanceTime;
    if (!(age >= -PAIR_EARLY_MS && age <= PAIR_STALE_MS)) return;
    const value = pair.contextTime - pair.performanceTime / 1000,
      behind = reading - value;
    return behind >= -PAIR_AHEAD_S && behind <= PAIR_MAX_LAG_S
      ? value
      : undefined;
  };

  return {
    sample() {
      const clock = deps.audio();
      if (!clock?.running) {
        skew = undefined;
        newest = undefined;
        paired = pairedOff = undefined;
        settled = 0;
        recent.length = 0;
        return;
      }
      const nowMs = deps.now(),
        at = nowMs / 1000,
        reading = clock.now() - at,
        more = extra(),
        lag = clock.latency() + more;
      newest = reading;
      const before = skew ?? reading,
        fresh = skew === undefined || Math.abs(reading - before) > SNAP_S;
      const elapsed = fresh ? 0 : Math.max(0, Math.min(0.25, at - sampledAt));
      const pair = pairOf(clock, nowMs, reading);
      if (pair === undefined) {
        pairedOff = undefined;
        if (paired !== undefined && (fresh || at - pairedAt > PAIR_HOLD_S))
          paired = undefined;
      } else {
        const target = pair - more;
        pairedOff = paired === undefined ? 0 : (target - paired) * 1000;
        paired =
          paired === undefined || Math.abs(target - paired) > SNAP_S
            ? target
            : paired +
              (target - paired) * (1 - Math.exp(-elapsed / PAIR_GLIDE_S));
        pairedAt = at;
      }
      if (fresh) {
        if (skew === undefined) latency = lag;
        skew = reading;
        settled = 1;
        recent.length = 0;
        recent.push(reading);
        sampledAt = at;
        return;
      }
      sampledAt = at;
      settled++;
      recent.push(reading);
      if (recent.length > WINDOW) recent.shift();
      if (reading >= before)
        skew =
          settled <= SETTLE_SAMPLES
            ? reading
            : Math.min(reading, before + RISE * elapsed);
      else {
        let fallen = Math.max(reading, before - FALL * elapsed);
        if (recent.length === WINDOW) {
          const newest = Math.max(...recent),
            step = newest - Math.min(...recent);
          // Not one of them came near: the audio clock itself lost time. Half a step keeps a coarse clock, whose
          // readings are all well behind now and then, from counting.
          if (newest < fallen - Math.max(FELL_BACK_S, step / 2))
            fallen = newest;
        }
        skew = fallen;
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
          roomMs / 1000 + (skew - heardSkew(skew)) + LEAD_MS / 1000 <
            song.duration;
        if (Math.abs(drift) > RESYNC_MS || lost) drop();
      }
      if (
        !playback &&
        settled >= SETTLE_SAMPLES &&
        at - startedAt >= RESTART_MS
      ) {
        const lead = LEAD_MS / 1000,
          start = at / 1000 + skew + lead,
          offset = roomMs / 1000 + (skew - heardSkew(skew)) + lead;
        song.play(start, offset);
        playback = { song, at: start, offset };
        starts++;
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
      return skew === undefined ? undefined : at / 1000 + heardSkew(skew);
    },
    mapping() {
      return skew === undefined || newest === undefined
        ? undefined
        : {
            reading: newest,
            smoothed: skew,
            source: paired === undefined ? "reported" : "paired",
            lagMs: (skew - heardSkew(skew)) * 1000,
            pairedMs: pairedOff,
          };
    },
    scheduledAt(ms) {
      return playback && skew !== undefined
        ? playback.at + ms / 1000 - playback.offset
        : undefined;
    },
    clockTime(at) {
      return skew === undefined ? undefined : at / 1000 + skew;
    },
    get starts() {
      return starts;
    },
    stop: halt,
  };
}
