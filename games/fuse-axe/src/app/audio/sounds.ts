/**
 * Every sound as data: a few synthesised voices each, so nothing is loaded and the WebAudio adapter only renders what
 * it is given. A voice is an oscillator, or white noise through a band-pass filter (a blade's whoosh, a thud's body).
 */
export interface Voice {
  wave: "square" | "triangle" | "sawtooth" | "sine" | "noise";
  /** Hz: the pitch, or the centre of the noise's band. */
  freq: number;
  /** What the pitch (or band) slides to by the end, as a multiple of `freq`. */
  slide?: number;
  /** Seconds after the sound starts that this voice does, and how long it lasts. */
  at?: number;
  dur: number;
  /** Peak gain, 0 to 1. */
  vol: number;
  /** Holds its level to the end, as a note does, instead of decaying at once, as a hit does. */
  sustain?: boolean;
}

/** A cue's voices, on the effects channel or, for a jingle, the music channel. */
export interface Sound {
  channel: "effects" | "music";
  voices: readonly Voice[];
}

const SEMITONES: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};
/** A note's pitch: `a4` is 440 Hz, `g#5` a sharp. */
export function hz(note: string): number {
  const match = /^([a-g])(#?)([0-8])$/.exec(note);
  if (!match) throw new Error(`not a note: ${note}`);
  const midi =
    12 * (Number(match[3]) + 1) + SEMITONES[match[1]!]! + match[2]!.length;
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * A melody, one token a beat: a note (`a4`, `g#5`), `-` holding the note before for another beat, or `.` for silence.
 * Each beat's voice, made by `voice` from the note's pitch and how many beats it lasts; null where none starts.
 */
export function melody(
  text: string,
  voice: (freq: number, beats: number) => Voice,
): (Voice | null)[] {
  const tokens = text.split(/\s+/).filter((token) => token && token !== "|");
  return tokens.map((token, i) => {
    if (token === "-" || token === ".") return null;
    let beats = 1;
    while (tokens[i + beats] === "-") beats++;
    return voice(hz(token), beats);
  });
}

/** A voice that decays from `vol` over `dur` seconds, sliding to `slide` times its pitch. */
const v = (
  wave: Voice["wave"],
  freq: number,
  dur: number,
  vol: number,
  slide?: number,
): Voice => ({ wave, freq, dur, vol, slide });
const fx = (...voices: Voice[]): Sound => ({ channel: "effects", voices });
/** A jingle's line: held notes `beat` seconds apart. */
const line = (wave: Voice["wave"], vol: number, beat: number, text: string) =>
  melody(text, (freq, beats) => ({
    ...v(wave, freq, beat * beats, vol),
    sustain: true,
  })).flatMap((voice, i) => (voice ? [{ ...voice, at: i * beat }] : []));

/**
 * Each cue's sound. The swing has each hero's weight: Brakka's broadsword a mid whoosh, Rhea's longsword lighter and
 * higher, Gorm's axe low and long with a grunt of air under it.
 */
export const SOUNDS = {
  "swing-brakka": fx(v("noise", 1800, 0.13, 0.32, 2)),
  "swing-rhea": fx(v("noise", 3200, 0.09, 0.26, 2)),
  "swing-gorm": fx(
    v("noise", 900, 0.2, 0.4, 2),
    v("sine", 90, 0.16, 0.12, 0.6),
  ),
  hit: fx(v("noise", 1400, 0.08, 0.4, 0.5), v("sine", 130, 0.09, 0.3, 0.5)),
  heavy: fx(v("noise", 900, 0.2, 0.5, 0.4), v("sine", 95, 0.22, 0.4, 0.4)),
  ko: fx(v("noise", 700, 0.35, 0.5, 0.3), v("sine", 150, 0.4, 0.4, 0.25)),
  hurt: fx(v("sawtooth", 190, 0.14, 0.12, 0.7), v("noise", 600, 0.06, 0.35)),
  knocked: fx(
    v("sawtooth", 170, 0.3, 0.13, 0.45),
    v("noise", 500, 0.25, 0.45, 0.5),
  ),
  // Subtle: a short rising creak as the mace goes up, a beat before it falls.
  windup: fx(v("triangle", 220, 0.16, 0.07, 1.6)),
  jump: fx(v("square", 240, 0.1, 0.05, 1.8)),
  land: fx(v("noise", 400, 0.06, 0.25), v("sine", 90, 0.07, 0.15, 0.6)),
  dash: fx(v("noise", 700, 0.18, 0.35, 2), v("sine", 80, 0.08, 0.15)),
  throw: fx(
    v("noise", 1100, 0.28, 0.35, 2),
    v("sawtooth", 150, 0.12, 0.08, 0.8),
  ),
  pot: fx(...line("triangle", 0.14, 0.07, "e6 b6 e7 -")),
  respawn: fx(v("square", 300, 0.3, 0.06, 3)),
  // A horn on a fifth, after the wave's own stinger.
  go: fx(
    ...line("sawtooth", 0.09, 0.25, ". a3 - -"),
    ...line("sawtooth", 0.07, 0.25, ". e4 - -"),
  ),
  locked: fx(
    ...line("sawtooth", 0.08, 0.14, "a2 d#3 a2 -"),
    v("noise", 300, 0.3, 0.3),
  ),
  cleared: fx(...line("square", 0.06, 0.08, "c5 e5 a5 -")),
  tick: fx(v("square", 880, 0.05, 0.05)),
  fanfare: {
    channel: "music",
    voices: [
      ...line("square", 0.07, 0.13, "a4 c#5 e5 a5 - - e5 a5 b5 c#6 - - - -"),
      ...line("triangle", 0.2, 0.13, "a2 - - e2 - - a2 - e2 a2 - - - -"),
    ],
  },
  gameover: {
    channel: "music",
    voices: [
      ...line("square", 0.06, 0.3, "e5 d5 c5 b4 a4 - g#4 a4 -"),
      ...line("triangle", 0.2, 0.3, "a2 - f2 - e2 - - a1 -"),
    ],
  },
} satisfies Record<string, Sound>;

/** Everything the page can hear: a swing (one a hero), a hit, a hero's moment, a wave's or a stage's. */
export type Cue = keyof typeof SOUNDS;
export const CUES = Object.keys(SOUNDS) as Cue[];
