/**
 * How far ahead of the sound the picture has to be drawn. A frame's timestamp is the start of the frame; what is
 * drawn in it reaches the screen at the next refresh at the earliest, one frame interval later. Drawing the song
 * position of the frame's own timestamp therefore shows every arrow at least a frame late (16.7 ms at 60 Hz, 8.3 ms
 * at 120 Hz); drawing the position one interval ahead puts it where the sound will be when the frame is seen.
 * What the compositor and the panel add beyond that one frame is not knowable from a page: the visual offset is
 * for that.
 */
export interface FrameLead {
  /** A frame began, with its own timestamp (ms). */
  frame(timestamp: number): void;
  /** One frame interval, ms: the median of the newest frames, or 60 Hz's until a few have been seen. */
  readonly ms: number;
  /** The refresh rate that goes with it. */
  readonly hz: number;
}

/** Intervals outside these are not a display's refresh (a tab that slept, a clock that jumped). */
const LEAST_MS = 3,
  MOST_MS = 34,
  DEFAULT_MS = 1000 / 60;

export function createFrameLead(size = 45): FrameLead {
  const intervals: number[] = [];
  let last = Number.NaN,
    ms = DEFAULT_MS;
  return {
    frame(timestamp) {
      const interval = timestamp - last;
      last = timestamp;
      if (!(interval >= LEAST_MS && interval <= MOST_MS)) return;
      intervals.push(interval);
      if (intervals.length > size) intervals.shift();
      if (intervals.length < 8) return;
      const sorted = [...intervals].sort((a, b) => a - b);
      ms = sorted[sorted.length >> 1]!;
    },
    get ms() {
      return ms;
    },
    get hz() {
      return 1000 / ms;
    },
  };
}
