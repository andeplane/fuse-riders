/**
 * What a microphone can say about timing, as pure arithmetic on its samples.
 *
 * The page cannot see when a key was really pressed or when a tick really left the speaker; a microphone on the
 * same device hears both. Its own delay is unknown, but it is the same for the tick and for the key, so it drops
 * out of the one comparison that matters:
 *
 * - `true`: the key's sound minus the tick's sound, both as the microphone heard them. How far the finger really
 *   was from the tick, in the air, with no machine in between.
 * - `game`: how far from the tick the game placed the same press (what it judged, offsets included).
 * - `game − true` is everything the device adds that the offsets do not yet cover: the keyboard, the operating
 *   system, the browser's stamp, and output delay the browser does not know about. No player's habit of tapping
 *   early is in it, which is what tap calibration cannot separate.
 *
 * The samples arrive stamped with the audio clock's frame count, so a time here is a time on the clock the ticks
 * are scheduled on, and none of it depends on when the page got round to looking.
 *
 * Two bands are followed as envelopes in bins of a quarter of a millisecond: the tick's own pitch, and the band
 * under it where a key's thud is and the tick is not. The tick's sound is found on its schedule; a key's by the
 * press the game registered. A tick leaks a little into the key band, so the level a key has to reach is learned
 * from ticks nobody tapped on.
 *
 * Limits: the key is heard when it bottoms out, which is a few ms after a switch actuates; a quiet key under a
 * loud speaker is not heard at all (the counts say so); headphones are not heard by a microphone, so the ticks must
 * come from a speaker, or the earphone be held to the microphone.
 */

/** One envelope bin, in seconds, near enough: a whole number of samples. */
export const BIN_S = 0.00025;
/** Seconds of envelope kept. */
export const KEEP_S = 8;
/** The key band: above the rumble of a desk, below the tick. */
const KEY_LOW_HZ = 350,
  KEY_HIGH_HZ = 2400;
/** The tick has to stand this far above the band's quiet level to count, and a key this far above its own. */
const CLICK_OVER_NOISE = 6,
  KEY_OVER_NOISE = 8;
/** A key has to be this many times what a tick alone leaves in the key band. */
const KEY_OVER_LEAK = 3;
/** An onset is where the envelope first reaches this share of its peak. */
const ONSET_SHARE = 0.25;
/** Dips shorter than this inside a sound are the wave itself, not its start. */
const BRIDGE_S = 0.003;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}
function biquad(
  kind: "low" | "high" | "band",
  hz: number,
  q: number,
  sampleRate: number,
): Biquad {
  const w = (2 * Math.PI * hz) / sampleRate,
    cos = Math.cos(w),
    alpha = Math.sin(w) / (2 * q),
    a0 = 1 + alpha;
  const [b0, b1, b2] =
    kind === "low"
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : kind === "high"
        ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        : [alpha, 0, -alpha];
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}
function run(filter: Biquad, x: number): number {
  const y =
    filter.b0 * x +
    filter.b1 * filter.x1 +
    filter.b2 * filter.x2 -
    filter.a1 * filter.y1 -
    filter.a2 * filter.y2;
  filter.x2 = filter.x1;
  filter.x1 = x;
  filter.y2 = filter.y1;
  filter.y1 = y;
  return y;
}
const clear = (filter: Biquad) => {
  filter.x1 = filter.x2 = filter.y1 = filter.y2 = 0;
};

export type Band = "click" | "key";
export interface MicAnalyser {
  /** Samples whose first is frame `firstFrame` of the audio clock. A gap since the last ones is silence. */
  push(samples: Float32Array, firstFrame: number): void;
  /** Seconds one bin lasts. */
  readonly binS: number;
  /** The audio-clock seconds the kept envelope runs from and to; equal while nothing was heard. */
  readonly from: number;
  readonly until: number;
  /** The band's envelope between two audio-clock times, a value per bin; empty where nothing is kept. */
  envelope(band: Band, from: number, to: number): Float32Array;
  /** The band's quiet level: what it reads between sounds. */
  noise(band: Band): number;
  /** The loudest raw sample since the last call: for a level meter, and to see a muted microphone. */
  level(): number;
}

/** Follows a microphone's two bands. `clickHz` is the tick's pitch. */
export function createMicAnalyser(config: {
  sampleRate: number;
  clickHz: number;
}): MicAnalyser {
  const { sampleRate } = config,
    binFrames = Math.max(1, Math.round(sampleRate * BIN_S)),
    binS = binFrames / sampleRate,
    size = Math.ceil(KEEP_S / binS);
  const filters = {
    click: [
      biquad("band", config.clickHz, 3, sampleRate),
      biquad("band", config.clickHz, 3, sampleRate),
    ],
    key: [
      biquad("high", KEY_LOW_HZ, 0.707, sampleRate),
      biquad("low", KEY_HIGH_HZ, 0.707, sampleRate),
      biquad("low", KEY_HIGH_HZ, 0.707, sampleRate),
    ],
  };
  const rings = { click: new Float32Array(size), key: new Float32Array(size) };
  /** The first bin kept and the one being filled; `next` is the frame expected. */
  let first = 0,
    bin = -1,
    next = -1,
    peak = 0;
  // Quiet level: the lower fifth of the last few seconds' 50 ms peaks.
  const blockBins = Math.round(0.05 / binS),
    blocks = { click: [] as number[], key: [] as number[] },
    blockPeak = { click: 0, key: 0 },
    floors = { click: 0, key: 0 };
  let blockFill = 0;
  const open = (to: number) => {
    // Bins from the one after `bin` up to `to` start at zero.
    for (let index = Math.max(bin + 1, to - size + 1); index <= to; index++) {
      rings.click[index % size] = 0;
      rings.key[index % size] = 0;
    }
    if (bin < 0 || to - bin >= size) first = to;
    bin = to;
    first = Math.max(first, bin - size + 1);
  };
  const closeBlock = () => {
    for (const band of ["click", "key"] as const) {
      const list = blocks[band];
      list.push(blockPeak[band]);
      if (list.length > 60) list.shift();
      blockPeak[band] = 0;
      const sorted = [...list].sort((a, b) => a - b);
      floors[band] = sorted[Math.floor(sorted.length / 5)] ?? 0;
    }
    blockFill = 0;
  };
  return {
    binS,
    push(samples, firstFrame) {
      if (!Number.isFinite(firstFrame) || firstFrame < 0) return;
      if (firstFrame !== next) {
        for (const filter of [...filters.click, ...filters.key]) clear(filter);
        // Frames that go back are a new clock: start over.
        if (firstFrame < next) bin = -1;
      }
      for (let index = 0; index < samples.length; index++) {
        const x = samples[index]!,
          at = Math.floor((firstFrame + index) / binFrames);
        if (at !== bin) {
          if (bin >= 0 && at > bin) {
            blockFill += Math.min(at - bin, blockBins);
            if (blockFill >= blockBins) closeBlock();
          }
          open(at);
        }
        const size0 = Math.abs(x);
        if (size0 > peak) peak = size0;
        let click = x,
          key = x;
        for (const filter of filters.click) click = run(filter, click);
        for (const filter of filters.key) key = run(filter, key);
        click = Math.abs(click);
        key = Math.abs(key);
        const slot = at % size;
        if (click > rings.click[slot]!) rings.click[slot] = click;
        if (key > rings.key[slot]!) rings.key[slot] = key;
        if (click > blockPeak.click) blockPeak.click = click;
        if (key > blockPeak.key) blockPeak.key = key;
      }
      next = firstFrame + samples.length;
    },
    get from() {
      return bin < 0 ? 0 : first * binS;
    },
    get until() {
      return bin < 0 ? 0 : (bin + 1) * binS;
    },
    envelope(band, from, to) {
      if (bin < 0) return new Float32Array(0);
      const start = Math.max(first, Math.ceil(from / binS)),
        end = Math.min(bin, Math.floor(to / binS));
      if (end < start) return new Float32Array(0);
      const out = new Float32Array(end - start + 1),
        ring = rings[band];
      for (let index = start; index <= end; index++)
        out[index - start] = ring[index % size]!;
      return out;
    },
    noise: (band) => floors[band],
    level() {
      const value = peak;
      peak = 0;
      return value;
    },
  };
}

/**
 * Where a sound starts in an envelope: the peak is found, and the start is the earliest bin at `ONSET_SHARE` of it
 * that is joined to the peak without a silence longer than `BRIDGE_S`. Undefined when the peak is under `floor`.
 * Returns the bin and the peak.
 */
export function onset(
  values: Float32Array,
  floor: number,
  binS: number,
): { bin: number; peak: number } | undefined {
  let top = -1,
    peak = 0;
  for (let index = 0; index < values.length; index++)
    if (values[index]! > peak) {
      peak = values[index]!;
      top = index;
    }
  if (top < 0 || peak <= 0 || peak < floor) return;
  const level = Math.max(floor * 0.5, peak * ONSET_SHARE),
    bridge = Math.max(1, Math.round(BRIDGE_S / binS));
  let start = top,
    quiet = 0;
  for (let index = top - 1; index >= 0 && quiet < bridge; index--) {
    if (values[index]! >= level) {
      start = index;
      quiet = 0;
    } else quiet++;
  }
  return { bin: start, peak };
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
/** The median and the spread (1.4826 times the median distance from it: a standard deviation's worth). */
export function centre(values: readonly number[]): {
  median: number;
  spread: number;
  n: number;
} {
  const middle = median(values);
  return {
    median: middle,
    spread: 1.4826 * median(values.map((value) => Math.abs(value - middle))),
    n: values.length,
  };
}

/** A tick the song will play: which one, and the audio-clock time (seconds) its first sample is scheduled at. */
export interface ExpectedClick {
  index: number;
  at: number;
}
/** A press as the game registered it. */
export interface RegisteredPress {
  /** The audio-clock time (seconds) of the browser's stamp, latency not taken off. */
  at: number;
  /** The tick it was nearest to, and how far after it the game placed the press (ms, offsets applied). */
  click: number;
  gameMs: number;
}
/** One press both the microphone and the game have. */
export interface HeardPress {
  click: number;
  /** Key sound minus tick sound, ms: where the finger really was. */
  trueMs: number;
  /** Where the game placed it. */
  gameMs: number;
  /** The stamp minus the key's sound as the microphone delivered it, ms (the microphone's own delay is in it). */
  stampMs: number;
  /** The key's sound on the audio clock, seconds. */
  keyAt: number;
}
export interface MicReport {
  /** Ticks looked for, and found. */
  clicks: number;
  clicksHeard: number;
  /** Scheduled tick to its sound at the microphone, ms: output delay plus the microphone's own. */
  roundTrip: { median: number; spread: number; n: number };
  /** Presses looked for, and those whose key was heard. */
  presses: number;
  pressesHeard: number;
  /** What the finger did, what the game saw, and the difference (game minus true), ms. */
  trueMs: { median: number; spread: number; n: number };
  gameMs: { median: number; spread: number; n: number };
  residualMs: { median: number; spread: number; n: number };
  /** The stamp against the key's sound: its spread is the jitter of the whole input path. */
  stampMs: { median: number; spread: number; n: number };
  /** What a key has to reach in its band, and what the tick leaves there. */
  keyFloor: number;
  leak: number;
  /** The newest presses heard, oldest first. */
  recent: readonly HeardPress[];
}

/** Ticks the round trip is settled on before it is trusted to find the rest. */
export const ROUND_TRIP_CLICKS = 4;
/** Presses heard before the residual is offered as a correction. */
export const MIC_MIN_PRESSES = 12;
/** A residual spread wider than this is not one number. */
export const MIC_MAX_SPREAD_MS = 12;
const KEEP_PRESSES = 400;

export interface MicSession {
  /** A tick is coming. Ticks may be named more than once; the newest schedule stands. */
  expectClick(click: ExpectedClick): void;
  /** The game registered a press. */
  press(press: RegisteredPress): void;
  /** Looks at what the microphone has heard since: call it now and then (every frame is fine). */
  settle(): void;
  report(): MicReport;
  /** The song was rescheduled or the microphone restarted: forget the ticks, keep nothing. */
  reset(): void;
}

/**
 * Matches the microphone's two bands to the ticks the song scheduled and the presses the game registered.
 * `beatS` is the time between ticks: a tick's sound is looked for no further than that after its schedule.
 */
export function createMicSession(
  analyser: MicAnalyser,
  beatS: number,
  hooks: {
    /** A tick was heard, this many ms after its schedule. */
    click?(index: number, tripMs: number): void;
    /** A press's key was heard. */
    heard?(press: HeardPress): void;
  } = {},
): MicSession {
  const clicks = new Map<number, number>(),
    /** Tick index to the time it was scheduled at, for every tick named. */
    schedule = new Map<number, number>(),
    /** Tick index to its sound's time, where it was found. */
    arrivals = new Map<number, number>(),
    trips: number[] = [],
    leaks: number[] = [],
    pending: RegisteredPress[] = [],
    heard: HeardPress[] = [];
  let looked = 0,
    found = 0,
    presses = 0,
    /** What the stamp leads the key's sound by, once a few presses have shown it. */
    lead: number | undefined;
  const leads: number[] = [];
  const settledTrip = () =>
    trips.length >= ROUND_TRIP_CLICKS ? median(trips) : undefined;
  const leak = () => {
    if (leaks.length === 0) return 0;
    const sorted = [...leaks].sort((a, b) => a - b);
    return sorted[
      Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))
    ]!;
  };
  const keyFloor = () =>
    Math.max(
      analyser.noise("key") * KEY_OVER_NOISE,
      leak() * KEY_OVER_LEAK,
      1e-5,
    );
  const reach = Math.min(Math.max(0.05, beatS - 0.03), 0.6);
  const settleClicks = () => {
    for (const [index, at] of [...clicks].sort((a, b) => a[1] - b[1])) {
      const trip = settledTrip(),
        from = trip === undefined ? at : at + trip - 0.025,
        to = trip === undefined ? at + reach : at + trip + 0.025;
      if (to + 0.045 > analyser.until) break;
      clicks.delete(index);
      if (from < analyser.from) continue;
      looked++;
      const values = analyser.envelope("click", from, to),
        start = onset(
          values,
          Math.max(analyser.noise("click") * CLICK_OVER_NOISE, 1e-5),
          analyser.binS,
        );
      if (!start) continue;
      found++;
      const arrival =
        Math.ceil(from / analyser.binS) * analyser.binS +
        start.bin * analyser.binS;
      arrivals.set(index, arrival);
      if (arrivals.size > 600) arrivals.delete(arrivals.keys().next().value!);
      trips.push(arrival - at);
      if (trips.length > 64) trips.shift();
      hooks.click?.(index, (arrival - at) * 1000);
      // What the tick leaves in the key band, where nobody tapped near it.
      const tapped = pending.some(
        (press) => Math.abs(press.at - arrival) < 0.2,
      );
      if (
        !tapped &&
        !heard.some((press) => Math.abs(press.keyAt - arrival) < 0.2)
      ) {
        let most = 0;
        for (const value of analyser.envelope(
          "key",
          arrival - 0.003,
          arrival + 0.04,
        ))
          if (value > most) most = value;
        leaks.push(most);
        if (leaks.length > 24) leaks.shift();
      }
    }
  };
  const settlePresses = () => {
    while (pending.length > 0) {
      const press = pending[0]!,
        // Before the lead is known the key is looked for widely; then close to where the others were.
        from = lead === undefined ? press.at - 0.25 : press.at - lead - 0.03,
        to = lead === undefined ? press.at + 0.15 : press.at - lead + 0.03;
      if (to + 0.01 > analyser.until) break;
      pending.shift();
      const scheduled = schedule.get(press.click),
        trip = settledTrip();
      if (from < analyser.from || scheduled === undefined || trip === undefined)
        continue;
      presses++;
      const start = onset(
        analyser.envelope("key", from, to),
        keyFloor(),
        analyser.binS,
      );
      if (!start) continue;
      const keyAt =
        Math.ceil(from / analyser.binS) * analyser.binS +
        start.bin * analyser.binS;
      leads.push(press.at - keyAt);
      if (leads.length > 32) leads.shift();
      if (leads.length >= 6) lead = median(leads);
      // The tick's own sound, placed by the settled round trip: one tick's detection may have a key in it.
      const tickAt = scheduled + trip;
      const found: HeardPress = {
        click: press.click,
        trueMs: (keyAt - tickAt) * 1000,
        gameMs: press.gameMs,
        stampMs: (press.at - keyAt) * 1000,
        keyAt,
      };
      heard.push(found);
      if (heard.length > KEEP_PRESSES) heard.shift();
      hooks.heard?.(found);
    }
  };
  return {
    expectClick(click) {
      if (!Number.isFinite(click.at) || schedule.get(click.index) === click.at)
        return;
      schedule.set(click.index, click.at);
      if (schedule.size > 600) schedule.delete(schedule.keys().next().value!);
      arrivals.delete(click.index);
      clicks.set(click.index, click.at);
    },
    press(press) {
      if (
        Number.isFinite(press.at) &&
        Number.isFinite(press.gameMs) &&
        pending.length < 256
      )
        pending.push(press);
    },
    settle() {
      settleClicks();
      settlePresses();
    },
    report() {
      // A press found far from the rest is another sound: the same three-spread cut the calibration uses.
      const all = centre(heard.map((press) => press.gameMs - press.trueMs)),
        cut = 3 * Math.max(2, all.spread),
        kept = heard.filter(
          (press) => Math.abs(press.gameMs - press.trueMs - all.median) <= cut,
        );
      return {
        clicks: looked,
        clicksHeard: found,
        roundTrip: centre(trips.map((trip) => trip * 1000)),
        presses,
        pressesHeard: heard.length,
        trueMs: centre(kept.map((press) => press.trueMs)),
        gameMs: centre(kept.map((press) => press.gameMs)),
        residualMs: centre(kept.map((press) => press.gameMs - press.trueMs)),
        stampMs: centre(kept.map((press) => press.stampMs)),
        keyFloor: keyFloor(),
        leak: leak(),
        recent: heard.slice(-24),
      };
    },
    reset() {
      clicks.clear();
      schedule.clear();
      arrivals.clear();
      trips.length = leaks.length = pending.length = heard.length = 0;
      leads.length = 0;
      looked = found = presses = 0;
      lead = undefined;
    },
  };
}

/** Whether a microphone's residual is steady enough to act on. */
export const micUsable = (report: MicReport): boolean =>
  report.residualMs.n >= MIC_MIN_PRESSES &&
  report.residualMs.spread <= MIC_MAX_SPREAD_MS;
