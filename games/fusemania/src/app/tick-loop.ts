import type { AudioClock, ClockedSong } from "fuse-ui/game-audio";
import { CLICK_S, LAP_TICKS, beatS } from "./click-track.js";

/**
 * An endless, steady click on the audio clock: one short lap of ticks (`lapWav`) started again and again, each lap
 * scheduled at the exact clock time the one before it ends. Tick `index` of a run therefore leaves the context at
 * `origin + index * beat`, however long the click has been running and whatever the frames did in between.
 *
 * A lap is started from a frame, in the silence after the last tick of the lap before it, so replacing that lap
 * cuts nothing. A frame that comes too late (a tab that slept) starts the lap that should be playing by then, from
 * where it would have got to: the beat is kept, only the ticks in between are lost.
 */
export interface TickLoop {
  /** Call once a frame: starts the click once the audio clock runs, and keeps it going. */
  frame(): void;
  readonly bpm: number;
  /** The index of the last tick that sounds, when the click has an end. */
  readonly last: number | undefined;
  /** The click had an end and has reached it: it stays silent, and keeps its origin, until `stop()`. */
  readonly over: boolean;
  /** Counts the click's starts: a clock that stopped and came back starts a new run, with a new origin. */
  readonly run: number;
  /** The audio-clock time (seconds) of this run's tick 0; undefined while the clock is not running. */
  readonly origin: number | undefined;
  /** The audio-clock time (seconds) tick `index` of this run leaves the context at. */
  scheduledAt(index: number): number | undefined;
  stop(): void;
}

/** How far ahead of the audio clock the first tick is put, so it is never in the past. */
export const TICK_LEAD_S = 0.25;
/** The silence left after a lap's last tick before the next lap may replace it. */
const QUIET_S = 0.03;

export function createTickLoop(deps: {
  clock(): AudioClock | undefined;
  /** One lap, as `lapWav(bpm, ticks)` made it. */
  song: ClockedSong;
  bpm: number;
  ticks?: number;
  /**
   * How many ticks sound before the click falls silent, for a click with an end. It is ended by the first frame
   * after its last tick has left the context, going by the audio clock and not by when that tick is heard: with a
   * long output latency the tick after it would otherwise have left for the speakers already. A frame that stalls
   * for most of a beat at that moment lets the next tick out; nothing counts it.
   */
  count?: number;
}): TickLoop {
  const beat = beatS(deps.bpm),
    lapTicks = deps.ticks ?? LAP_TICKS,
    lapS = lapTicks * beat,
    count = deps.count;
  let origin: number | undefined,
    lap = 0,
    run = 0,
    /** The last tick has sounded and the song was let go: the origin stays, for whoever is still listening. */
    over = false;
  const stop = () => {
    if (origin !== undefined && !over) deps.song.stop();
    origin = undefined;
    over = false;
  };
  return {
    frame() {
      const clock = deps.clock();
      // A click that has ended stays ended, and keeps its origin, whatever the clock does afterwards.
      if (over) return;
      if (!clock?.running) return stop();
      const now = clock.now();
      if (origin === undefined) {
        origin = now + TICK_LEAD_S;
        lap = 0;
        run++;
        deps.song.play(origin, 0);
        return;
      }
      if (
        count !== undefined &&
        now >= origin + (count - 1) * beat + CLICK_S + QUIET_S
      ) {
        over = true;
        deps.song.stop();
        return;
      }
      // The lap that may be started now: the one after the lap whose last tick has gone quiet.
      const due = Math.floor((now - origin + beat - CLICK_S - QUIET_S) / lapS);
      if (due > lap && (count === undefined || due * lapTicks < count)) {
        lap = due;
        deps.song.play(origin + lap * lapS, 0);
      }
    },
    bpm: deps.bpm,
    last: count === undefined ? undefined : count - 1,
    get over() {
      return over;
    },
    get run() {
      return run;
    },
    get origin() {
      return origin;
    },
    scheduledAt: (index) =>
      origin === undefined ? undefined : origin + index * beat,
    stop,
  };
}
