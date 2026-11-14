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
}): TickLoop {
  const beat = beatS(deps.bpm),
    lapS = (deps.ticks ?? LAP_TICKS) * beat;
  let origin: number | undefined,
    lap = 0,
    run = 0;
  const stop = () => {
    if (origin !== undefined) deps.song.stop();
    origin = undefined;
  };
  return {
    frame() {
      const clock = deps.clock();
      if (!clock?.running) return stop();
      const now = clock.now();
      if (origin === undefined) {
        origin = now + TICK_LEAD_S;
        lap = 0;
        run++;
        deps.song.play(origin, 0);
        return;
      }
      // The lap that may be started now: the one after the lap whose last tick has gone quiet.
      const due = Math.floor((now - origin + beat - CLICK_S - QUIET_S) / lapS);
      if (due > lap) {
        lap = due;
        deps.song.play(origin + lap * lapS, 0);
      }
    },
    bpm: deps.bpm,
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
