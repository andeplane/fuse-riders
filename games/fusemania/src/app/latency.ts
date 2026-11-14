/**
 * Input latency probe: what the page can measure of the way from a key going down to the game knowing about it.
 *
 * A press is stamped by the browser (`event.timeStamp`), handled some time later (the listener runs), and shown at
 * the next animation frame. The judge uses the stamp, so the first of those delays does not move a judgment; the
 * probe records all three so the claim can be checked on any device:
 *
 * - `handlerMs`: listener start minus `event.timeStamp`. Time the event waited for the main thread.
 * - `frameMs`: start of the next animation frame minus `event.timeStamp`. The soonest the press can be drawn.
 * - `drawnMs`: end of that frame's drawing minus `event.timeStamp`. The picture is handed to the browser here.
 *
 * and, once a frame, the things a judgment's accuracy rests on: the frame interval, how long the frame's work
 * took, how late the frame callback ran after its own timestamp, and how far the audio clock's reading was from
 * the smoothed mapping the stamps are converted with (a reading is the clock's last step, so
 * this is mostly the size of the clock's steps).
 *
 * What comes before `event.timeStamp` (the switch, USB or Bluetooth polling, the operating system) and what comes
 * after the picture is handed over (compositor, display) or the sound is scheduled (anything the browser's
 * `outputLatency` does not know about) cannot be seen from a page; `games/fusemania/LATENCY.md` says what that leaves.
 */

export const PROBE_SAMPLES = 600;

/** p50, p95, p99 and the largest of what was recorded, ms; `n` is how many. */
export interface Spread {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
export interface LatencyReport {
  /** Per press. */
  handlerMs: Spread;
  frameMs: Spread;
  drawnMs: Spread;
  /** Per frame. */
  frameIntervalMs: Spread;
  frameWorkMs: Spread;
  /** Frame callback start minus the frame's own timestamp. */
  frameLagMs: Spread;
  /** Absolute distance of each audio clock reading from the smoothed mapping. */
  clockJitterMs: Spread;
  /**
   * Absolute distance of each of the browser's clock pairs from the mapping in use: the jitter a press's song
   * time really carries where the browser pairs the clocks. Empty where it does not.
   */
  pairJitterMs: Spread;
  /** Presses by source. */
  keys: number;
  touches: number;
  /** Presses whose stamp was unusable (zero, or over half a second from now) and were stamped at handling time. */
  unstamped: number;
}

/** Nearest-rank percentiles of `values`. */
export function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
  };
}

/** A fixed number of the newest values. */
function ring(size: number) {
  const values: number[] = [];
  let next = 0;
  return {
    push(value: number) {
      if (!Number.isFinite(value)) return;
      if (values.length < size) values.push(value);
      else values[next] = value;
      next = (next + 1) % size;
    },
    values: (): readonly number[] => values,
    clear() {
      values.length = 0;
      next = 0;
    },
  };
}

export interface LatencyProbe {
  /**
   * A press: the browser's stamp, when its listener started (both on the page's clock, ms) and whether the stamp
   * was usable for judging.
   */
  press(
    source: "key" | "touch",
    stamp: number,
    handled: number,
    used: boolean,
  ): void;
  /** A frame began: its own timestamp and the page's clock when its callback started. */
  frameStart(timestamp: number, now: number): void;
  /** That frame's work is done. */
  frameEnd(now: number): void;
  /** An audio clock reading this frame and the smoothed value it is compared with, both in seconds. */
  clock(reading: number, smoothed: number): void;
  /** How far this frame's clock pair was from the mapping in use, ms. */
  pair(ms: number): void;
  report(): LatencyReport;
  reset(): void;
}

export function createLatencyProbe(size = PROBE_SAMPLES): LatencyProbe {
  const handler = ring(size),
    toFrame = ring(size),
    drawn = ring(size),
    interval = ring(size),
    work = ring(size),
    lag = ring(size),
    jitter = ring(size),
    pairs = ring(size);
  /** Stamps of presses not yet followed by a frame. */
  let waiting: number[] = [],
    /** Stamps of presses whose frame has begun and not ended. */
    drawing: number[] = [],
    lastFrame = Number.NaN,
    frameBegan = Number.NaN,
    keys = 0,
    touches = 0,
    unstamped = 0;
  return {
    press(source, stamp, handled, used) {
      if (source === "key") keys++;
      else touches++;
      if (!used) {
        unstamped++;
        return;
      }
      handler.push(handled - stamp);
      if (waiting.length < 64) waiting.push(stamp);
    },
    frameStart(timestamp, now) {
      if (Number.isFinite(lastFrame)) interval.push(timestamp - lastFrame);
      lastFrame = timestamp;
      frameBegan = now;
      lag.push(now - timestamp);
      for (const stamp of waiting) toFrame.push(now - stamp);
      drawing = waiting;
      waiting = [];
    },
    frameEnd(now) {
      if (Number.isFinite(frameBegan)) work.push(now - frameBegan);
      for (const stamp of drawing) drawn.push(now - stamp);
      drawing = [];
    },
    clock(reading, smoothed) {
      jitter.push(Math.abs(reading - smoothed) * 1000);
    },
    pair(ms) {
      pairs.push(Math.abs(ms));
    },
    report: () => ({
      handlerMs: spread(handler.values()),
      frameMs: spread(toFrame.values()),
      drawnMs: spread(drawn.values()),
      frameIntervalMs: spread(interval.values()),
      frameWorkMs: spread(work.values()),
      frameLagMs: spread(lag.values()),
      clockJitterMs: spread(jitter.values()),
      pairJitterMs: spread(pairs.values()),
      keys,
      touches,
      unstamped,
    }),
    reset() {
      for (const each of [
        handler,
        toFrame,
        drawn,
        interval,
        work,
        lag,
        jitter,
        pairs,
      ])
        each.clear();
      waiting = [];
      drawing = [];
      lastFrame = frameBegan = Number.NaN;
      keys = touches = unstamped = 0;
    },
  };
}

const ms = (value: number) =>
  value >= 100 ? value.toFixed(0) : value.toFixed(1);
const line = (label: string, values: Spread) =>
  values.n
    ? `${label.padEnd(18)}${ms(values.p50).padStart(6)}${ms(values.p95).padStart(7)}${ms(values.p99).padStart(7)}${ms(values.max).padStart(7)}  n=${values.n}`
    : `${label.padEnd(18)}     -`;

/** What else the overlay says, read from the page each time it is drawn. */
export interface LatencyContext {
  /** `AudioContext.baseLatency` and `outputLatency` in ms, where the browser reports them. */
  baseMs: number | undefined;
  outputMs: number | undefined;
  /** Heard minus room position, ms. */
  driftMs: number;
  audible: boolean;
  /** The input offset in use, ms. */
  offsetMs: number;
  /** This run's hit errors so far: mean, standard deviation and how many. */
  hits: { biasMs: number; spreadMs: number; used: number };
}

/** The overlay's text: a table of p50, p95, p99 and max in ms. */
export function latencyText(
  report: LatencyReport,
  context: LatencyContext,
): string {
  const known = (value: number | undefined) =>
    value === undefined ? "not reported" : `${ms(value)} ms`;
  return [
    `${"ms".padEnd(18)}${"p50".padStart(6)}${"p95".padStart(7)}${"p99".padStart(7)}${"max".padStart(7)}`,
    line("press > handler", report.handlerMs),
    line("press > frame", report.frameMs),
    line("press > drawn", report.drawnMs),
    line("frame interval", report.frameIntervalMs),
    line("frame work", report.frameWorkMs),
    line("frame start lag", report.frameLagMs),
    line("audio clock step", report.clockJitterMs),
    line("clock pair jitter", report.pairJitterMs),
    `audio base latency  ${known(context.baseMs)}`,
    `audio output latency  ${known(context.outputMs)}`,
    `song ${context.audible ? "on the audio clock" : "on the room clock (no sound)"}, drift ${ms(context.driftMs)} ms`,
    `presses: ${report.keys} key, ${report.touches} touch, ${report.unstamped} without a usable stamp`,
    `hit error: ${context.hits.used ? `${context.hits.biasMs >= 0 ? "+" : "−"}${ms(Math.abs(context.hits.biasMs))} ±${ms(context.hits.spreadMs)} ms over ${context.hits.used} steps` : "-"} (input offset ${context.offsetMs} ms)`,
    "not measurable here: key switch to browser, display, audio the browser does not know of",
  ].join("\n");
}
