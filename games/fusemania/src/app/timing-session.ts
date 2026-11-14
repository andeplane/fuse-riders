/**
 * What a `?debugtiming` page keeps about a session: every press from the browser's stamp to its judgment, the hit
 * errors by ear and by eye, and a log of all of it as JSON lines that a local dev server writes to a file
 * (`timing-logs/`) and any page can hand over as a download. Pure bookkeeping: the page feeds it, the panel and
 * the log read it.
 */

/** A press, from the browser's stamp to what the judge made of it. Times are ms. */
export interface PressRecord {
  id: number;
  source: "key" | "touch";
  /** The column (0 to 3), or -1 for the power-up button. */
  column: number;
  /** `event.timeStamp` and when the listener ran, on the page's clock; `used` is whether the stamp was usable. */
  stamp: number;
  handled: number;
  used: boolean;
  /** The song time the press was judged at: the heard position at the stamp, offsets taken off. */
  songMs: number;
  /** Stamp to the start of the next frame, and to the end of that frame's drawing. */
  frameMs?: number;
  drawnMs?: number;
  /** The judgment it earned (0 Marvelous … 4 Boo) and how far off the judge found it; absent when it hit nothing. */
  judgment?: number;
  offMs?: number;
  /**
   * Room left between the press's song time and the bounds of the tick it was logged for: the least of the two
   * sides. Negative means the room's clock moved the press.
   */
  slackMs?: number;
}

export const KEEP_PRESSES = 600;
export const KEEP_HITS = 2000;

export interface PressLog {
  /** A press was handled. Returns its record. */
  add(press: Omit<PressRecord, "id">): PressRecord;
  /** A frame began at `now` and finished drawing at `done`: presses not yet shown are shown by it. */
  frame(now: number, done: number): void;
  /**
   * The judge's newest judgment: given at song time `at`, `judgment`, `off` ms from its note. Attaches to the
   * press made at that song time, if there is one. Returns that press.
   */
  judged(at: number, judgment: number, off: number): PressRecord | undefined;
  /** The newest `count` presses, oldest first. */
  recent(count: number): readonly PressRecord[];
  readonly total: number;
  /** Presses the room's clock moved, and the least slack any press had. */
  readonly bent: number;
  readonly leastSlackMs: number | undefined;
  reset(): void;
}

export function createPressLog(): PressLog {
  let presses: PressRecord[] = [],
    next = 1,
    total = 0,
    bent = 0,
    least: number | undefined,
    shown = 0;
  return {
    add(press) {
      const record: PressRecord = { ...press, id: next++ };
      presses.push(record);
      if (presses.length > KEEP_PRESSES) {
        presses.shift();
        shown = Math.max(0, shown - 1);
      }
      total++;
      if (record.slackMs !== undefined) {
        if (record.slackMs < 0) bent++;
        if (least === undefined || record.slackMs < least)
          least = record.slackMs;
      }
      return record;
    },
    frame(now, done) {
      for (; shown < presses.length; shown++) {
        const press = presses[shown]!;
        if (!press.used) continue;
        press.frameMs = now - press.stamp;
        press.drawnMs = done - press.stamp;
      }
    },
    judged(at, judgment, off) {
      for (let index = presses.length - 1; index >= 0; index--) {
        const press = presses[index]!;
        // A press is logged to the whole millisecond; older presses than a second are not this judgment's.
        if (press.songMs < at - 1000) break;
        if (press.judgment === undefined && Math.abs(press.songMs - at) <= 1) {
          press.judgment = judgment;
          press.offMs = off;
          return press;
        }
      }
      return undefined;
    },
    recent: (count) => presses.slice(-count),
    get total() {
      return total;
    },
    get bent() {
      return bent;
    },
    get leastSlackMs() {
      return least;
    },
    reset() {
      presses = [];
      total = bent = shown = 0;
      least = undefined;
    },
  };
}

/** Counts of `values` in `bins` equal bins from `min` to `max`; values outside go in the end bins. */
export function histogram(
  values: readonly number[],
  min: number,
  max: number,
  bins: number,
): number[] {
  const counts = Array.from({ length: bins }, () => 0);
  if (!(max > min) || bins < 1) return counts;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const at = Math.floor(((value - min) / (max - min)) * bins);
    counts[Math.max(0, Math.min(bins - 1, at))]!++;
  }
  return counts;
}

/** Mean and standard deviation. */
export function meanOf(values: readonly number[]): {
  mean: number;
  sd: number;
  n: number;
} {
  const n = values.length;
  if (n === 0) return { mean: 0, sd: 0, n: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  return {
    mean,
    sd: Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n,
    ),
    n,
  };
}

/** Hit errors of one kind of play, newest last. */
export interface ErrorBucket {
  add(off: number): void;
  values(): readonly number[];
  reset(): void;
}
export function createErrorBucket(limit = KEEP_HITS): ErrorBucket {
  let values: number[] = [];
  return {
    add(off) {
      if (!Number.isFinite(off)) return;
      values.push(off);
      if (values.length > limit) values.shift();
    },
    values: () => values,
    reset() {
      values = [];
    },
  };
}

/** Hits by ear and by eye before the difference between them is offered as a visual offset. */
export const EYE_MIN_HITS = 20;
/**
 * What playing with the sound off says about the picture. By ear a player follows the sound; with the sound off
 * (muted, the song still running) they can only follow the arrows. The same player on the same keyboard, so
 * whatever they hit later by eye than by ear is the picture arriving late: drawing that much earlier lines the
 * two up. Undefined until both have `EYE_MIN_HITS`.
 */
export function visualFromEye(
  ear: readonly number[],
  eye: readonly number[],
): number | undefined {
  if (ear.length < EYE_MIN_HITS || eye.length < EYE_MIN_HITS) return;
  return Math.round(meanOf(eye).mean - meanOf(ear).mean);
}

/** A session's log: JSON lines, the newest `limit` kept, and what has not been written out yet. */
export interface TimingLog {
  readonly id: string;
  /** One event: its kind and what it carries. `t` (the page clock, ms) is added. */
  add(kind: string, data?: Record<string, unknown>): void;
  /** The lines not yet taken, and takes them. */
  take(): string[];
  /** Puts lines back in front (a write that failed). */
  untake(lines: readonly string[]): void;
  /** Every line kept, for a download. */
  text(): string;
  readonly size: number;
}
export const KEEP_LINES = 20_000;

export function createTimingLog(
  id: string,
  now: () => number,
  limit = KEEP_LINES,
): TimingLog {
  let lines: string[] = [],
    pending: string[] = [];
  const round = (value: unknown): unknown =>
    typeof value === "number"
      ? Number.isFinite(value)
        ? Math.round(value * 1000) / 1000
        : null
      : Array.isArray(value)
        ? value.map(round)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([key, item]) => [key, round(item)]),
            )
          : value;
  return {
    id,
    add(kind, data = {}) {
      const line = JSON.stringify({
        t: Math.round(now() * 10) / 10,
        kind,
        ...(round(data) as Record<string, unknown>),
      });
      lines.push(line);
      if (lines.length > limit) lines = lines.slice(-limit);
      pending.push(line);
      if (pending.length > limit) pending = pending.slice(-limit);
    },
    take() {
      const out = pending;
      pending = [];
      return out;
    },
    untake(back) {
      pending = [...back, ...pending].slice(-limit);
    },
    text: () => (lines.length ? `${lines.join("\n")}\n` : ""),
    get size() {
      return lines.length;
    },
  };
}

/** Hosts a local dev server answers on: this machine and the private ranges a phone on the same network uses. */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^192\.168\.\d+\.\d+$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)
  );
}

/** Where a local dev server takes a session's lines. */
export const TIMING_LOG_PATH = "/api/dev/timing-log";

/**
 * Writes the log out: every `everyMs`, the lines not yet written are sent to `send`. A send that fails keeps its
 * lines for the next try; after `tries` failures in a row there is no server to write to, and it stops asking.
 */
export function createLogWriter(
  log: TimingLog,
  send: (lines: string[]) => Promise<boolean>,
  tries = 3,
): {
  flush(): Promise<void>;
  readonly state: "idle" | "writing" | "off";
  readonly written: number;
} {
  let failures = 0,
    busy = false,
    written = 0;
  return {
    async flush() {
      if (busy || failures >= tries) return;
      const lines = log.take();
      if (lines.length === 0) return;
      busy = true;
      const ok = await send(lines).catch(() => false);
      busy = false;
      if (ok) {
        failures = 0;
        written += lines.length;
      } else {
        failures++;
        log.untake(lines);
      }
    },
    get state() {
      return failures >= tries ? "off" : written > 0 ? "writing" : "idle";
    },
    get written() {
      return written;
    },
  };
}
