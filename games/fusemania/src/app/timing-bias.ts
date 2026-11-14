/**
 * Timing bias: what a played song says about this player's input offset.
 *
 * Every step that is hit is judged by how far the press was from the note. A player whose presses are centred on
 * the notes has errors scattered around zero; a device that hears late (Bluetooth), a slow keyboard or a habit of
 * leaning ahead shows as errors scattered around something else. When that something is clear, the result offers to
 * move the input offset by it, which is what **CALIBRATE** measures with a click, measured here on real play.
 *
 * It must not be fooled, so a run only counts when:
 *
 * - enough steps were hit (`BIAS_MIN_HITS`), with stray presses cut as outliers;
 * - the hits were consistent (`BIAS_MAX_SPREAD_MS`) and the bias is well clear of what chance gives that many hits
 *   (`BIAS_SIGMAS` standard errors) and large enough to matter (`BIAS_MIN_MS`);
 * - both halves of the song lean the same way: a chart that drifts or has one section out of sync does not.
 *
 * A whole chart that is a little early or late looks exactly like a player who is, within one song. So runs are
 * remembered per song (`history`), and a run that disagrees with what the other songs agree on is put down to its
 * chart and proposes nothing.
 */
import {
  BOO,
  MARVELOUS,
  STAR,
  isAttack,
  type PlayerView,
} from "../engine/index.js";

/** Steps hit (after the outlier cut) before a run says anything. */
export const BIAS_MIN_HITS = 40;
/** A bias smaller than this is not worth a prompt: it is well inside a Marvelous (22 ms). */
export const BIAS_MIN_MS = 8;
/** Hits scattered wider than this (standard deviation, ms) are too inconsistent to read an offset from. */
export const BIAS_MAX_SPREAD_MS = 50;
/** The bias must be this many standard errors from zero. */
export const BIAS_SIGMAS = 3;
/** Each half of the song must show at least this share of the whole song's bias, on the same side. */
export const BIAS_HALF_SHARE = 0.4;
/** Two songs whose estimates are this close agree. */
export const AGREE_MS = 15;
/** Songs remembered. */
export const HISTORY_SONGS = 6;
/** A remembered run older than this is forgotten. */
export const HISTORY_MS = 7 * 24 * 3600 * 1000;
/** A remembered run made with an audio output this much slower or faster was on another device (ms). */
export const DEVICE_MS = 20;
/** Outliers are cut at three standard deviations; this floor keeps a very steady player's hits from being cut. */
const LEAST_CUT_MS = 15;
/** The standard deviation of a normal distribution, from its median absolute deviation. */
const MAD_TO_SIGMA = 1.4826;

/** One hit: when the note was (song ms) and how far off the press was (negative: early). */
export interface Hit {
  at: number;
  off: number;
}

export type BiasVerdict =
  /** A clear bias. */
  | "clear"
  /** Too few hits. */
  | "few"
  /** Hits too scattered. */
  | "scattered"
  /** Centred, or not clear of chance. */
  | "centred"
  /** The two halves of the song disagree. */
  | "unsteady";

export interface Bias {
  /** Mean signed error of the hits kept, ms: positive = presses land late. */
  biasMs: number;
  /** Their standard deviation, ms. */
  spreadMs: number;
  /** Hits kept after the outlier cut, and hits given. */
  used: number;
  total: number;
  /** The mean of the first and of the second half of the hits kept, in song order. */
  halves: [number, number];
  verdict: BiasVerdict;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const mean = (values: readonly number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

/** What a run's hits say. */
export function measureBias(hits: readonly Hit[]): Bias {
  const valid = hits.filter(
    (hit) => Number.isFinite(hit.at) && Number.isFinite(hit.off),
  );
  const offs = valid.map((hit) => hit.off),
    centre = median(offs),
    mad = median(offs.map((off) => Math.abs(off - centre))),
    cut = Math.max(LEAST_CUT_MS, 3 * MAD_TO_SIGMA * mad),
    kept = valid
      .filter((hit) => Math.abs(hit.off - centre) <= cut)
      .sort((a, b) => a.at - b.at),
    keptOffs = kept.map((hit) => hit.off),
    biasMs = mean(keptOffs),
    spreadMs = Math.sqrt(mean(keptOffs.map((off) => (off - biasMs) ** 2))),
    half = kept.length >> 1,
    halves: [number, number] = [
      mean(keptOffs.slice(0, half)),
      mean(keptOffs.slice(half)),
    ];
  const error = spreadMs / Math.sqrt(Math.max(1, kept.length));
  const steady = halves.every(
    (part) =>
      Math.sign(part) === Math.sign(biasMs) &&
      Math.abs(part) >= BIAS_HALF_SHARE * Math.abs(biasMs),
  );
  const verdict: BiasVerdict =
    kept.length < BIAS_MIN_HITS
      ? "few"
      : spreadMs > BIAS_MAX_SPREAD_MS
        ? "scattered"
        : Math.abs(biasMs) < BIAS_MIN_MS ||
            Math.abs(biasMs) < BIAS_SIGMAS * error
          ? "centred"
          : steady
            ? "clear"
            : "unsteady";
  return {
    biasMs,
    spreadMs,
    used: kept.length,
    total: valid.length,
    halves,
    verdict,
  };
}

/** A run that was remembered: the input offset that would have centred it. */
export interface RunEstimate {
  song: string;
  /** The offset in use plus the bias measured, ms. */
  estimateMs: number;
  used: number;
  /** Wall-clock ms when it was played. */
  at: number;
  /** The audio output latency the browser reported, ms: a different one is a different device. */
  deviceMs: number;
}

/** `history` with `run` in it: the newest run of each song, the newest `HISTORY_SONGS` songs. */
export function remember(
  history: readonly RunEstimate[],
  run: RunEstimate,
): RunEstimate[] {
  return [run, ...history.filter((each) => each.song !== run.song)].slice(
    0,
    HISTORY_SONGS,
  );
}

export type Proposal =
  /** Move the input offset to `offsetMs`. */
  | {
      kind: "apply";
      offsetMs: number;
      /** How far the presses land from the notes now, ms (positive: late). */
      biasMs: number;
      /** Songs behind the number, this one included. */
      songs: number;
    }
  /** This song alone is off from what the others agree on: the chart, not the player. */
  | { kind: "chart"; biasMs: number; songs: number }
  | { kind: "none" };

/**
 * What to offer after a run with a clear bias. `others` are remembered runs of other songs on this device.
 *
 * - Another song that agrees with this run (within `AGREE_MS`) makes it the player or the device: the offset
 *   offered is the median of the runs that agree.
 * - No song agrees and at least two others agree with each other: this chart is the odd one. Nothing is offered.
 * - Otherwise (the first song, or others that say nothing in common) the offer rests on this run alone.
 */
export function propose(
  run: RunEstimate,
  others: readonly RunEstimate[],
  currentMs: number,
  maxMs: number,
): Proposal {
  const usable = others.filter(
    (each) =>
      each.song !== run.song &&
      Math.abs(run.at - each.at) <= HISTORY_MS &&
      Math.abs(each.deviceMs - run.deviceMs) <= DEVICE_MS,
  );
  const near = (a: number, b: number) => Math.abs(a - b) <= AGREE_MS;
  const agreeing = usable.filter((each) =>
    near(each.estimateMs, run.estimateMs),
  );
  const biasMs = run.estimateMs - currentMs;
  if (agreeing.length === 0) {
    const elsewhere = usable.some((each) =>
      usable.some(
        (other) => other !== each && near(each.estimateMs, other.estimateMs),
      ),
    );
    if (elsewhere) return { kind: "chart", biasMs, songs: usable.length };
  }
  const target = Math.round(
    median([run.estimateMs, ...agreeing.map((each) => each.estimateMs)]),
  );
  const offsetMs = Math.max(-maxMs, Math.min(maxMs, target)),
    change = offsetMs - currentMs;
  // The agreed number can be closer to the offset in use than this run was, or on its other side.
  if (Math.abs(change) < BIAS_MIN_MS || Math.sign(change) !== Math.sign(biasMs))
    return { kind: "none" };
  return {
    kind: "apply",
    offsetMs,
    biasMs: change,
    songs: agreeing.length + 1,
  };
}

const signed = (ms: number) =>
  `${ms > 0 ? "+" : ms < 0 ? "−" : ""}${Math.abs(ms)} ms`;

/** The question the result asks. */
export function proposalText(proposal: Proposal, hits: number): string {
  if (proposal.kind === "none") return "";
  const ms = Math.round(Math.abs(proposal.biasMs)),
    side = proposal.biasMs > 0 ? "late" : "early";
  if (proposal.kind === "chart")
    return `You hit about ${ms} ms ${side} on this song only: your other songs are centred, so this chart is probably off. Input offset left alone.`;
  const basis =
    proposal.songs > 1
      ? `across your last ${proposal.songs} songs`
      : `on average (${hits} steps)`;
  return `You hit about ${ms} ms ${side} ${basis}. Set the input offset to ${signed(proposal.offsetMs)}?`;
}

/** Where remembered runs are kept. */
export interface TimingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const TIMING_KEY = "fusemania-timing-v1";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Anything as a history: the entries that are whole, bounded. */
export function parseHistory(raw: unknown): RunEstimate[] {
  if (!Array.isArray(raw)) return [];
  const runs: RunEstimate[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const { song, estimateMs, used, at, deviceMs } = item as Record<
      string,
      unknown
    >;
    if (
      typeof song !== "string" ||
      song.length === 0 ||
      song.length > 200 ||
      !finite(estimateMs) ||
      Math.abs(estimateMs) > 1000 ||
      !finite(used) ||
      !finite(at) ||
      !finite(deviceMs) ||
      runs.some((each) => each.song === song)
    )
      continue;
    runs.push({ song, estimateMs, used, at, deviceMs });
    if (runs.length === HISTORY_SONGS) break;
  }
  return runs;
}
export function loadHistory(store: TimingStore): RunEstimate[] {
  try {
    return parseHistory(JSON.parse(store.getItem(TIMING_KEY) ?? "null"));
  } catch {
    return [];
  }
}
export function saveHistory(
  store: TimingStore,
  history: readonly RunEstimate[],
): void {
  try {
    store.setItem(TIMING_KEY, JSON.stringify(parseHistory(history)));
  } catch {
    // A store that refuses writes only costs the memory of other songs.
  }
}

/**
 * Collects this device's own hits from the picture, frame by frame. A hit is a step judged Marvelous to Boo since
 * the frame before; steps a Star played, and steps hit while an attack bent, hid or delayed the arrows, are left
 * out because they say nothing about the player's timing. Two steps hit in one frame count once, and a hit whose
 * frame also brought a miss, a mine or a hold's end is not counted: the view carries the newest judgment only.
 */
export interface HitCollector {
  /** `run` names the match and the offset in use: a change of either starts over. */
  observe(player: PlayerView, run: string): void;
  hits(): readonly Hit[];
  reset(): void;
}
export function createHitCollector(limit = 4000): HitCollector {
  let hits: Hit[] = [],
    current = "",
    judgedBefore = -1;
  const judged = (player: PlayerView) => {
    let sum = 0;
    for (let judgment = MARVELOUS; judgment <= BOO; judgment++)
      sum += player.counts[judgment] ?? 0;
    return sum;
  };
  return {
    observe(player, run) {
      const total = judged(player);
      if (run !== current) {
        current = run;
        hits = [];
        judgedBefore = total;
        // A page that opens on a match in progress starts counting from here.
        return;
      }
      if (total < judgedBefore) hits = [];
      const fresh = total > judgedBefore;
      judgedBefore = total;
      if (
        !fresh ||
        player.judged < MARVELOUS ||
        player.judged > BOO ||
        hits.length >= limit
      )
        return;
      const at = player.judgedAt;
      const bent = player.effects.some(
        (effect) =>
          (effect[0] === STAR || isAttack(effect[0])) &&
          effect[1] <= at + 250 &&
          at - 250 < effect[2],
      );
      if (!bent) hits.push({ at, off: player.judgedOff });
    },
    hits: () => hits,
    reset() {
      hits = [];
      current = "";
      judgedBefore = -1;
    },
  };
}
