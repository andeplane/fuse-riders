import {
  DRAKE_STEPS,
  QUAKE,
  SIGIL,
  STEPS_PER_SECOND,
  VORHAL_STEPS,
} from "../../engine/view-kit.js";

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

/**
 * A cue's voices, on the effects channel or, for a jingle, the music channel; played over the loop it ducks it for
 * `duck` seconds. A cue that comes only after the loop has stopped (the game over) has none to give.
 */
export interface Sound {
  channel: "effects" | "music";
  voices: readonly Voice[];
  duck?: number;
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
/** `voice` held at its level to the end, for a sound as long as what it marks. */
const held = (voice: Voice): Voice => ({ ...voice, sustain: true });
/** `voice` starting `at` seconds in. */
const after = (at: number, voice: Voice): Voice => ({ ...voice, at });
/** Dry clicks `gap` seconds apart from `at`, one a pitch of `freqs`: bones knocking, sparks spitting. */
const clicks = (at: number, gap: number, vol: number, ...freqs: number[]) =>
  freqs.map((freq, i) => after(at + i * gap, v("noise", freq, 0.035, vol)));
const secs = (steps: number) => steps / STEPS_PER_SECOND;
const FLAME = secs(DRAKE_STEPS.breathe - DRAKE_STEPS.inhale),
  ROAR = secs(VORHAL_STEPS.roar);
/** A level of a hero's Magic charge: a chime a step up the A minor arpeggio from the level before. */
const charge = (note: string) =>
  fx(v("triangle", hz(note), 0.08, 0.1), v("sine", 2 * hz(note), 0.05, 0.03));
/** A later stage's opening horn over a drum, in place of the first's GO. */
const sting = (lead: string, bass: string): Sound => ({
  channel: "music",
  voices: [
    v("noise", 200, 0.3, 0.25, 0.5),
    ...line("sawtooth", 0.08, 0.16, lead),
    ...line("triangle", 0.2, 0.16, bass),
  ],
  duck: 1.4,
});

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
  go: {
    ...fx(
      ...line("sawtooth", 0.09, 0.25, ". a3 - -"),
      ...line("sawtooth", 0.07, 0.25, ". e4 - -"),
    ),
    duck: 0.9,
  },
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
    duck: 2.2,
  },
  gameover: {
    channel: "music",
    voices: [
      ...line("square", 0.06, 0.3, "e5 d5 c5 b4 a4 - g#4 a4 -"),
      ...line("triangle", 0.2, 0.3, "a2 - f2 - e2 - - a1 -"),
    ],
  },
  // The run won: the last stage's tally has had its fanfare, and this one goes higher and holds.
  victory: {
    channel: "music",
    voices: [
      ...line(
        "square",
        0.07,
        0.15,
        "e5 . e5 a5 - - c#6 - b5 a5 - c#6 e6 - - - - -",
      ),
      ...line("square", 0.04, 0.15, ". . . . . . . . . . . . c#6 - - - - -"),
      ...line(
        "triangle",
        0.2,
        0.15,
        "a2 - - e3 - - a2 - - e2 - - a2 - - - - -",
      ),
    ],
  },
  // A boss's health bar appears: low brass a semitone apart over two drums.
  boss: {
    channel: "music",
    voices: [
      v("noise", 180, 0.4, 0.3, 0.5),
      after(0.8, v("noise", 180, 0.5, 0.3, 0.5)),
      ...line("sawtooth", 0.09, 0.2, "a2 - a#2 - a2 - - -"),
      ...line("square", 0.05, 0.2, "e4 - f4 - d#4 - - -"),
    ],
    duck: 1.8,
  },
  // Wyrmbone Pass climbs on a fifth, the Drowned Crypt sinks a semitone, Vorhal's Keep opens on the tritone.
  stage2: sting(". d4 a4 - d5 - - -", "d2 - - - - - - -"),
  stage3: sting(". e4 f4 - e4 - b3 -", "e2 - - - - - - -"),
  stage4: sting(". a3 d#4 - e4 - a4 -", "a1 - - - - - - -"),

  // The lancer: a hard jab, a rising whoosh as it leaps, the spear driven into the ground as it lands.
  thrust: fx(
    v("noise", 2600, 0.08, 0.32, 0.6),
    v("square", 520, 0.05, 0.05, 0.7),
  ),
  leap: fx(v("noise", 500, 0.24, 0.28, 3), v("triangle", 150, 0.2, 0.07, 1.8)),
  plunge: fx(
    v("noise", 700, 0.18, 0.42, 0.4),
    v("sine", 80, 0.22, 0.32, 0.5),
    after(0.02, v("square", 900, 0.06, 0.04, 0.8)),
  ),
  // The beasts: a clawbeak's tail cracking round; a drake drawing breath, then its flame, as long as it burns.
  lash: fx(v("noise", 4200, 0.06, 0.38, 0.5), v("noise", 1200, 0.2, 0.26, 2)),
  inhale: fx(held(v("noise", 300, secs(DRAKE_STEPS.inhale), 0.16, 4))),
  flame: fx(
    held(v("noise", 500, FLAME, 0.3, 0.6)),
    v("sawtooth", 70, FLAME, 0.06, 0.8),
    ...clicks(0.1, 0.17, 0.12, 3000, 2400, 3400),
  ),
  // A hero's beast: climbed on (a thump and the saddle's creak), hopping, climbed off.
  board: fx(
    v("noise", 400, 0.06, 0.25),
    v("sawtooth", 130, 0.12, 0.07, 0.7),
    after(0.04, v("triangle", 520, 0.09, 0.05, 0.8)),
  ),
  hop: fx(v("square", 150, 0.14, 0.06, 1.6), v("noise", 300, 0.08, 0.26)),
  dismount: fx(
    v("noise", 900, 0.1, 0.22, 1.6),
    v("square", 300, 0.08, 0.04, 1.4),
  ),
  // An ogre: the slam with its shockwave rolling on along the floor, the hammer heaved round, a twin's bellow.
  slam: {
    ...fx(
      v("sine", 70, 0.45, 0.4, 0.5),
      v("noise", 400, 0.22, 0.35, 0.3),
      after(0.04, v("noise", 160, secs(QUAKE.steps) + 0.15, 0.15, 0.6)),
    ),
    duck: 0.6,
  },
  heave: fx(v("noise", 600, 0.3, 0.42, 2.5), v("sine", 70, 0.25, 0.2, 0.7)),
  enrage: {
    ...fx(
      v("sawtooth", 98, 0.7, 0.12, 1.3),
      v("sawtooth", 104, 0.7, 0.1, 1.25),
      v("noise", 350, 0.5, 0.25, 0.7),
    ),
    duck: 0.8,
  },
  // A bonewalker clawing up out of the earth, falling to a pile, pulling itself together, shattered.
  rise: fx(
    v("noise", 250, 0.5, 0.22, 2.2),
    ...clicks(0.12, 0.13, 0.18, 1400, 1700, 1200),
  ),
  collapse: fx(
    v("noise", 500, 0.12, 0.3, 0.5),
    ...clicks(0, 0.06, 0.25, 3500, 2900, 3800, 2500, 3200),
  ),
  reassemble: fx(
    ...clicks(0, 0.08, 0.2, 1500, 1900, 2300, 2800, 3400),
    v("noise", 2000, 0.45, 0.08, 1.8),
  ),
  shatter: fx(
    v("noise", 5000, 0.12, 0.4, 0.6),
    v("noise", 2400, 0.25, 0.3, 0.4),
    ...clicks(0.08, 0.07, 0.18, 4200, 3100),
  ),
  // Vorhal: the greatsword's cuts, the spell raised (a tritone swelling), its sigils glinting and the pillars of fire
  // erupting from them, the summons tolling, the roar at half his hit points and his fall.
  cut: fx(v("noise", 1300, 0.22, 0.4, 2.2), v("sine", 75, 0.2, 0.18, 0.6)),
  hex: fx(
    held(v("triangle", hz("a3"), 0.6, 0.07, 1.5)),
    held(v("triangle", hz("d#4"), 0.6, 0.05, 1.5)),
    v("noise", 800, 0.5, 0.1, 2),
  ),
  sigil: fx(...line("sine", 0.1, 0.06, "a#5 e6 a#6 -")),
  pillar: {
    ...fx(
      v("noise", 300, secs(SIGIL.burn) + 0.2, 0.42, 1.8),
      v("sine", 55, 0.5, 0.32, 0.6),
      v("noise", 2500, 0.3, 0.12, 0.5),
    ),
    duck: 0.9,
  },
  summon: {
    ...fx(
      v("sine", hz("a1"), 1.2, 0.35, 0.95),
      v("triangle", hz("a2"), 1, 0.12),
      v("square", hz("d#3"), 0.8, 0.03),
    ),
    duck: 1.2,
  },
  roar: {
    ...fx(
      held(v("noise", 420, ROAR, 0.32, 0.5)),
      v("sawtooth", 82, ROAR, 0.16, 0.7),
      v("sawtooth", 87, ROAR, 0.13, 0.65),
    ),
    duck: ROAR + 0.2,
  },
  "vorhal-falls": {
    ...fx(
      v("sawtooth", 140, 1.6, 0.14, 0.35),
      v("noise", 250, 1.4, 0.35, 0.4),
      v("sine", 60, 1.2, 0.38, 0.5),
    ),
    duck: 1.8,
  },
  // A hero's Magic: each level of the charge a chime higher; the spell cast (the storm crackling, the fire's whoosh,
  // the earth rumbling) and its blow landing on the screen (thunder, a blaze, a tremor).
  charge1: charge("a4"),
  charge2: charge("c5"),
  charge3: charge("e5"),
  charge4: charge("a5"),
  charge5: charge("c6"),
  charge6: charge("e6"),
  "cast-storm": fx(
    ...clicks(0, 0.07, 0.2, 6000, 4800, 7000, 5200, 6500),
    v("square", 1800, 0.35, 0.03, 0.5),
  ),
  "cast-fire": fx(
    v("noise", 400, 0.5, 0.3, 5),
    v("sawtooth", 110, 0.4, 0.05, 2),
  ),
  "cast-earth": fx(
    held(v("noise", 120, 0.6, 0.28, 1.5)),
    v("sine", 50, 0.6, 0.25, 1.2),
  ),
  thunder: {
    ...fx(
      v("noise", 2500, 0.08, 0.4, 0.5),
      after(0.04, v("noise", 180, 1.1, 0.4, 0.5)),
      v("sine", 50, 0.9, 0.1, 0.6),
    ),
    duck: 1.2,
  },
  blaze: {
    ...fx(
      v("noise", 700, 0.9, 0.4, 0.4),
      v("noise", 2400, 0.4, 0.2, 0.6),
      v("sawtooth", 80, 0.6, 0.06, 0.6),
    ),
    duck: 1,
  },
  tremor: {
    ...fx(v("sine", 45, 1, 0.45, 0.7), v("noise", 150, 1, 0.4, 0.6)),
    duck: 1.1,
  },
  // Camp: the fire spitting now and then, and meat eaten.
  crackle: fx(
    v("noise", 2800, 0.03, 0.08, 0.6),
    after(0.05, v("noise", 1600, 0.02, 0.05)),
  ),
  munch: fx(
    v("sine", 140, 0.06, 0.1, 0.7),
    ...[0, 0.14, 0.28].map((at) => after(at, v("noise", 480, 0.06, 0.26, 0.6))),
  ),
} satisfies Record<string, Sound>;

/** Everything the page can hear: a swing (one a hero), a hit, a hero's moment, a wave's or a stage's. */
export type Cue = keyof typeof SOUNDS;
export const CUES = Object.keys(SOUNDS) as Cue[];

/** The most voices sounding at once: a crowded fight lets the sounds it has no room for go. */
export const MAX_VOICES = 32;
/** Whether `sound` may start with `live` voices sounding: past the cap an effect is dropped, a jingle always sounds. */
export const fits = (sound: Sound, live: number): boolean =>
  sound.channel === "music" || live + sound.voices.length <= MAX_VOICES;
