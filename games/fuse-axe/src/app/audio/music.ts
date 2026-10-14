import { melody, type Voice } from "./sounds.js";

/** A loop on an eighth-note grid: each step's voices, `step` seconds apart. */
export interface Song {
  name: string;
  step: number;
  steps: readonly (readonly Voice[])[];
}

/** 132 beats a minute, two steps a beat: a march. */
const STEP = 60 / 132 / 2;
const DRUMS: Readonly<Record<string, Voice>> = {
  k: { wave: "sine", freq: 150, slide: 0.35, dur: 0.12, vol: 0.35 },
  s: { wave: "noise", freq: 1800, dur: 0.1, vol: 0.22 },
  h: { wave: "noise", freq: 8000, dur: 0.03, vol: 0.08 },
};
const words = (text: string) =>
  text.split(/\s+/).filter((token) => token && token !== "|");

/**
 * A song from three tracks of one token a step: the lead's `melody`, the bass's chord roots a half bar each (played
 * as an octave bounce under it) and the drums (`k`ick, `s`nare, `h`at, `.` none). The tracks must be one length.
 */
export function song(
  name: string,
  lead: string,
  chords: string,
  drums: string,
): Song {
  const tune = melody(lead, (freq, beats) => ({
    wave: "square",
    freq,
    dur: beats * STEP * 0.9,
    vol: 0.05,
    sustain: true,
  }));
  const bass = melody(
    words(chords)
      .map((root) => `${root}2 ${root}3 ${root}2 ${root}3`)
      .join(" "),
    (freq) => ({
      wave: "triangle",
      freq,
      dur: STEP * 0.8,
      vol: 0.16,
      sustain: true,
    }),
  );
  const beat = words(drums).map((hit) => DRUMS[hit] ?? null);
  if (bass.length !== tune.length || beat.length !== tune.length)
    throw new Error(
      `${name}: lead ${tune.length}, bass ${bass.length}, drums ${beat.length} steps`,
    );
  return {
    name,
    step: STEP,
    steps: tune.map((note, i) =>
      [note, bass[i], beat[i]].filter((voice) => !!voice),
    ),
  };
}

const BEAT = "k h s h k h s h",
  FILL = "k h s h s s s s",
  SECTION_DRUMS = `${BEAT} | `.repeat(7) + FILL;
/** Ashen Village's march in A minor: the theme twice, then the bridge that turns back to it. */
const THEME = `
  a4 - a4 c5 e5 - e5 - | d5 c5 b4 c5 a4 - - . | c5 - c5 f5 a5 - a5 - | g5 f5 e5 f5 d5 - - . |
  a4 - a4 c5 e5 - a5 - | g5 e5 c5 e5 a5 - - . | f5 e5 d5 c5 d5 e5 f5 g5 | e5 - g#5 - b5 - e5 . |`;
const THEME_CHORDS = "a a | a a | f f | g g | a a | a a | f g | e e |";
const BRIDGE = `
  d5 - f5 - a5 - f5 d5 | e5 - c5 - a4 - c5 e5 | d5 f5 a5 d6 c6 - a5 . | b5 - g#5 - e5 - - . |
  a5 - a5 g5 f5 - e5 f5 | g5 - g5 f5 e5 - d5 e5 | c5 e5 a5 e5 c5 e5 a5 b5 | g#5 - e5 - b4 - e5 . |`;
const BRIDGE_CHORDS = "d d | a a | d d | e e | f f | g g | a a | e e |";
export const MARCH: Song = song(
  "march",
  [THEME, THEME, BRIDGE].join(" "),
  [THEME_CHORDS, THEME_CHORDS, BRIDGE_CHORDS].join(" "),
  [SECTION_DRUMS, SECTION_DRUMS, SECTION_DRUMS].join(" "),
);

/**
 * Hands out a looping song's voices a little ahead of when they sound, from `start` seconds on the audio clock. A
 * sequencer left behind (a stalled timer, a suspended tab) skips to the present rather than play its backlog at once.
 */
export class Sequencer {
  private next = 0;
  constructor(
    private readonly song: Song,
    private readonly start: number,
  ) {}
  /** Every voice due before `now + ahead` not yet handed out, each with the time it sounds. */
  due(now: number, ahead: number): { at: number; voice: Voice }[] {
    const { step, steps } = this.song,
      out: { at: number; voice: Voice }[] = [];
    const at = (index: number) => this.start + index * step;
    if (at(this.next) < now)
      this.next = Math.ceil((now - this.start) / step - 1e-9);
    for (; at(this.next) < now + ahead; this.next++)
      for (const voice of steps[this.next % steps.length]!)
        out.push({ at: at(this.next), voice });
    return out;
  }
}
