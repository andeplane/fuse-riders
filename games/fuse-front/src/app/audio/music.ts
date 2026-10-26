/**
 * The music: a procedural military/industrial groove on a sixteenth-note grid, eight bars in A minor
 * (Am Am F G | Am Am Dm E), built from layers that the match's mood switches on and off at bar lines (`Sequencer`),
 * and the mood itself (`MoodTracker`): the lobby's theme, calm laning, an intensity layer while fights rage near this
 * seat's hero, tension once its structures fall or sudden death begins, then a victory or defeat outro. Every voice
 * is data (`sounds.ts`), handed to the audio clock a little ahead of time; nothing is downloaded.
 */
import { SURGE_AFTER } from "../../engine/index.js";
import type { Voice } from "./sounds.js";

/** 112 beats a minute, four steps a beat, sixteen a bar, eight bars a loop. */
export const STEP = 60 / 112 / 4;
export const BAR = 16;
export const LOOP = 8 * BAR;

// prettier-ignore
const ROOTS = [110, 110, 87.31, 98, 110, 110, 73.42, 82.41]; // A2 A2 F2 G2 A2 A2 D2 E2
/** Each bar's chord above its root: minor, minor, major, major, minor, minor, minor, major. */
const THIRDS = [3, 3, 4, 4, 3, 3, 3, 4];
const up = (freq: number, semitones: number) => freq * 2 ** (semitones / 12);
const chord = (bar: number) => {
  const root = ROOTS[bar]! * 4;
  return [root, up(root, THIRDS[bar]!), up(root, 7)];
};

// prettier-ignore
const v = (wave: Voice["wave"], freq: number, dur: number, vol: number, slide?: number): Voice =>
  ({ wave, freq, dur, vol, slide });
/** A pattern of one character a step: `x` plays, `.` rests; repeated to fill a bar. */
const hits = (pattern: string, step: number) =>
  pattern[step % pattern.length] === "x";

/** Each layer's voices on a step of the loop (bar and step within it). */
// prettier-ignore
export const LAYERS = {
  kick: (s: number) => (hits("x.......x.......", s) ? [v("sine", 140, 0.16, 0.5, 0.3)] : []),
  hats: (s: number) => (hits("..x.", s) ? [v("noise", 8000, 0.03, 0.05)] : []),
  bass: (s: number, bar: number) =>
    hits("x.x.x.xxx.x.x..x", s) ? [v("square", ROOTS[bar]!, STEP * 1.6, 0.11, 0.98)] : [],
  // Fights: a backbeat, a busier kick and hats, and saw stabs on the off-beats.
  snare: (s: number) => (hits("....x.......x...", s) ? [v("noise", 1800, 0.12, 0.2), v("triangle", 190, 0.08, 0.1, 0.6)] : []),
  drive: (s: number) =>
    (hits("......x...x....x", s) ? [v("sine", 130, 0.12, 0.35, 0.3)] : []).concat(hits(".x.x", s) ? [v("noise", 9000, 0.02, 0.03)] : []),
  stabs: (s: number, bar: number) =>
    hits("...x..x....x..x.", s) ? chord(bar).map((f) => v("sawtooth", f, STEP * 0.9, 0.035)) : [],
  // Tension: a low drone each bar and a ticking clock a semitone apart.
  drone: (s: number, bar: number) => (s === 0 ? [v("sawtooth", ROOTS[bar]! / 2, BAR * STEP, 0.07, 1.06)] : []),
  tick: (s: number) => (hits("x.x.", s) ? [v("square", s % 8 ? 1865 : 1760, 0.02, 0.02)] : []),
  // The lobby: a soft pad and arpeggio over a heartbeat kick.
  pad: (s: number, bar: number) => (s === 0 ? chord(bar).map((f) => ({ ...v("triangle", f / 2, BAR * STEP, 0.035), sustain: true })) : []),
  arp: (s: number, bar: number) => (hits("x.x.", s) ? [v("sine", chord(bar)[(s / 2) % 3]! * 2, STEP * 1.5, 0.03)] : []),
  pulse: (s: number) => (s === 0 ? [v("sine", 90, 0.3, 0.25, 0.5)] : []),
} satisfies Record<string, (step: number, bar: number) => Voice[]>;

export type Layer = keyof typeof LAYERS;
export type Mood = "menu" | "calm" | "fight" | "tension" | "victory" | "defeat";

/** What each looping mood plays; the outros are one-shots. */
export const MOODS: Readonly<
  Record<Exclude<Mood, "victory" | "defeat">, readonly Layer[]>
> = {
  menu: ["pad", "arp", "pulse"],
  calm: ["kick", "hats", "bass"],
  fight: ["kick", "hats", "bass", "snare", "drive", "stabs"],
  tension: ["kick", "hats", "bass", "snare", "drone", "tick"],
};

/** A victory's rising major stabs to a held A major chord; a defeat's falling saw into a low rumble. Seconds in. */
// prettier-ignore
export const OUTROS: Readonly<Record<"victory" | "defeat", readonly { at: number; voice: Voice }[]>> = {
  victory: [
    ...[440, 554.4, 659.3].map((f, i) => ({ at: i * 0.2, voice: v("square", f, 0.18, 0.06) })),
    ...[220, 277.2, 329.6, 440].map((f) => ({ at: 0.6, voice: { ...v("sawtooth", f, 2.4, 0.04), sustain: true } })),
    { at: 0.6, voice: v("sine", 110, 1.6, 0.3, 0.5) },
  ],
  defeat: [
    ...[329.6, 293.7, 261.6, 246.9].map((f, i) => ({ at: i * 0.35, voice: v("sawtooth", f / 2, 0.4, 0.06, 0.97) })),
    { at: 1.4, voice: { ...v("triangle", 55, 2.6, 0.2, 0.9), sustain: true } },
    { at: 1.4, voice: v("noise", 200, 2, 0.12, 0.5) },
  ],
};

/**
 * Hands out the loop's voices a little ahead of when they sound, from `start` on the audio clock. A new set of layers
 * waits for the next bar line. A sequencer left behind (a stalled timer, a suspended tab) skips to the present rather
 * than play its backlog at once.
 */
export class Sequencer {
  private next = 0;
  private layers: readonly Layer[];
  private wanted: readonly Layer[];
  constructor(
    private readonly start: number,
    layers: readonly Layer[],
  ) {
    this.layers = this.wanted = layers;
  }
  /** Switches to `layers` at the next bar line. */
  play(layers: readonly Layer[]): void {
    this.wanted = layers;
  }
  get playing(): readonly Layer[] {
    return this.layers;
  }
  /** Every voice due before `now + ahead` not yet handed out, each with when it sounds. */
  due(now: number, ahead: number): { at: number; voice: Voice }[] {
    const out: { at: number; voice: Voice }[] = [];
    const at = (index: number) => this.start + index * STEP;
    if (at(this.next) < now) {
      const skipped = Math.ceil((now - this.start) / STEP - 1e-9);
      // A skip past a bar line still takes the new layers there.
      if (Math.floor(skipped / BAR) > Math.floor(this.next / BAR))
        this.layers = this.wanted;
      this.next = skipped;
    }
    for (; at(this.next) < now + ahead; this.next++) {
      const step = this.next % BAR,
        bar = Math.floor(this.next / BAR) % (LOOP / BAR);
      if (step === 0) this.layers = this.wanted;
      for (const layer of this.layers)
        for (const voice of LAYERS[layer](step, bar))
          out.push({ at: at(this.next), voice });
    }
    return out;
  }
}

/** Heat a combat event near this seat's hero adds; the fight layer starts at `FIGHT_ON` and stops below `FIGHT_OFF`. */
export const HEAT = { event: 1, halfLife: 4, on: 8, off: 2, max: 30 };
/** Seconds a structure's fall keeps the music tense, and the least a mood holds before another replaces it. */
export const LOST_SECONDS = 45;
export const DWELL_SECONDS = 6;

/** The page as the music sees it: the landing or lobby, a match under way at `step`, or one won or lost. */
export type Scene =
  | { kind: "menu" }
  | { kind: "match"; step: number }
  | { kind: "over"; won: boolean };

/**
 * The music's mood from the scene and what happens near this seat's hero, with hysteresis: fights heat it up and the
 * heat decays, a fallen structure keeps it tense for a while, sudden death (`SURGE_AFTER`) for good, and a mood holds
 * `DWELL_SECONDS` before calm, fight and tension trade places. Times are seconds on any one clock.
 */
export class MoodTracker {
  private heat = 0;
  private heatAt = 0;
  private lostAt = -Infinity;
  private mood: Mood | null = null;
  private since = -Infinity;

  /** A combat event near this seat's hero. */
  combat(now: number): void {
    this.heat = Math.min(HEAT.max, this.cooled(now) + HEAT.event);
    this.heatAt = now;
  }
  /** Forgets the heat and any loss: a new scene. */
  reset(): void {
    [this.heat, this.lostAt] = [0, -Infinity];
  }
  /** One of this seat's team's structures fell. */
  lost(now: number): void {
    this.lostAt = now;
  }
  next(scene: Scene, now: number): Mood {
    let want: Mood;
    if (scene.kind === "menu") want = "menu";
    else if (scene.kind === "over") want = scene.won ? "victory" : "defeat";
    else {
      const heat = this.cooled(now);
      const fighting = heat >= (this.mood === "fight" ? HEAT.off : HEAT.on);
      const tense =
        scene.step >= SURGE_AFTER || now - this.lostAt < LOST_SECONDS;
      want = tense ? "tension" : fighting ? "fight" : "calm";
      const looping =
        this.mood === "calm" ||
        this.mood === "fight" ||
        this.mood === "tension";
      if (looping && want !== this.mood && now - this.since < DWELL_SECONDS)
        want = this.mood!;
    }
    if (want !== this.mood) [this.mood, this.since] = [want, now];
    if (scene.kind !== "match") this.reset();
    return want;
  }
  private cooled(now: number): number {
    return this.heat * 0.5 ** ((now - this.heatAt) / HEAT.halfLife);
  }
}
