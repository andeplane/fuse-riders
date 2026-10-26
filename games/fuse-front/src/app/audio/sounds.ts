/**
 * Every effect as data: a few synthesised voices each, so nothing is downloaded and the Web Audio adapter
 * (`web-backend.ts`) only renders what it is given. A voice is an oscillator, or white noise through a band-pass
 * filter (a gun's crack, a blast's body). Punchy and metallic: square and saw for machines, noise for guns and blasts.
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

export type Bus = "effects" | "alerts" | "music";

/** A cue's voices and the bus they go to; `duck` lowers the effects and music for that many seconds (stings). */
export interface Sound {
  bus: Bus;
  voices: readonly Voice[];
  duck?: number;
}

// prettier-ignore
const v = (wave: Voice["wave"], freq: number, dur: number, vol: number, slide?: number, at?: number): Voice =>
  ({ wave, freq, dur, vol, slide, at });
const fx = (...voices: Voice[]): Sound => ({ bus: "effects", voices });
// prettier-ignore
const alert = (duck: number, ...voices: Voice[]): Sound => ({ bus: "alerts", voices, duck });
/** Held notes `beat` seconds apart from `at`, Hz each: horns, fanfares, chimes. */
// prettier-ignore
const notes = (wave: Voice["wave"], vol: number, beat: number, freqs: readonly number[], at = 0): Voice[] =>
  freqs.map((freq, i) => ({ ...v(wave, freq, beat * 0.95, vol, undefined, at + i * beat), sustain: true }));
/** A blast: a band of noise falling under a sine thump. `s` 0..1 scales it. */
const blast = (s: number, at = 0): Voice[] => [
  v("noise", 900 + 1200 * s, 0.25 + 0.6 * s, 0.35 + 0.25 * s, 0.12, at),
  v("sine", 120, 0.2 + 0.4 * s, 0.4 + 0.3 * s, 0.3, at),
];
/** Metal pinging as it falls apart. */
const clank = (freq: number, vol: number, at = 0): Voice[] => [
  v("square", freq, 0.12, vol, 0.6, at),
  v("triangle", freq * 2.7, 0.18, vol * 0.6, 0.8, at + 0.03),
];
const hold = (voice: Voice): Voice => ({ ...voice, sustain: true });

/** Hz of the A minor notes the stings use. */
// prettier-ignore
const [A3, C4, D4, E4, G4, A4, C5, E5, A5] = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 659.3, 880];

// prettier-ignore
export const SOUNDS = {
  // Guns: grunts' rifles crack, torches whoosh, tanks boom, sentries ping, heroes' heavier rifles, towers thud.
  rifle: fx(v("noise", 2600, 0.06, 0.22, 0.5), v("square", 180, 0.04, 0.06)),
  flamer: fx(v("noise", 700, 0.22, 0.2, 2.2)),
  cannon: fx(v("noise", 500, 0.3, 0.38, 0.2), v("sine", 90, 0.25, 0.4, 0.5), v("square", 60, 0.08, 0.08)),
  sentry: fx(v("square", 1200, 0.05, 0.08, 0.7), v("noise", 4000, 0.04, 0.1)),
  heroShot: fx(v("noise", 1800, 0.09, 0.3, 0.4), v("square", 140, 0.06, 0.1)),
  tower: fx(v("noise", 380, 0.4, 0.4, 0.25), v("sine", 70, 0.35, 0.45, 0.6), v("sawtooth", 140, 0.18, 0.08, 1.6, 0.02)),
  // Deaths and ruins.
  robotDeath: fx(...clank(900, 0.1), v("noise", 1500, 0.15, 0.15, 0.4)),
  tankDeath: fx(...blast(0.7), ...clank(400, 0.08, 0.08)),
  heroDeath: fx(...blast(0.8), v("sawtooth", 330, 0.6, 0.1, 0.25)),
  structure: fx(...blast(1), ...blast(0.6, 0.18), ...clank(300, 0.08, 0.3), ...clank(500, 0.06, 0.45)),
  mineBlast: fx(...blast(0.6), v("square", 1400, 0.05, 0.08)),
  // This seat's own moments, and the match's.
  gold: alert(0, ...notes("square", 0.07, 0.06, [1319, 1976])),
  levelUp: alert(0.6, ...notes("triangle", 0.12, 0.08, [C5, E5, 784, 1047])),
  myDeath: alert(1.4, ...notes("sawtooth", 0.1, 0.22, [A4, 415.3, G4, 349.2]), v("sine", 60, 1, 0.3, 0.5)),
  respawn: alert(0, v("sine", 220, 0.5, 0.15, 4), ...notes("square", 0.06, 0.08, [A4, A5], 0.3)),
  flagTaken: alert(1, ...notes("square", 0.09, 0.1, [G4, C5, E5]), hold(v("square", 784, 0.5, 0.09, undefined, 0.3))),
  flagLost: alert(1, ...notes("sawtooth", 0.08, 0.14, [E4, 311.1, D4])),
  structureLost: alert(1.6, ...notes("sawtooth", 0.1, 0.3, [A3, 207.7, 196])),
  underAttack: alert(1, ...notes("square", 0.08, 0.16, [A5, E5, A5, E5])),
  victory: alert(3, ...notes("square", 0.1, 0.14, [C5, E5, 784, 1047]), ...notes("triangle", 0.15, 0.56, [C4 / 2, G4 / 2]),
    hold(v("square", 1047, 1.2, 0.1, undefined, 0.56))),
  defeat: alert(3, ...notes("sawtooth", 0.1, 0.3, [E4, D4, C4, 246.9]), v("sine", 55, 2, 0.35, 0.8)),
  wave: alert(0, hold(v("sawtooth", 110, 0.9, 0.05, 1.02))),
  // Spells: each kit's four.
  shockwave: fx(v("sine", 80, 0.5, 0.6, 0.4), v("noise", 300, 0.5, 0.35, 0.3)),
  rally: fx(...notes("sawtooth", 0.09, 0.18, [A3, E4, A4])),
  ironHide: fx(v("triangle", 300, 0.6, 0.15, 1.5), v("square", 600, 0.3, 0.05, 1.5)),
  orbitalDrop: fx(v("sine", 1800, 0.7, 0.12, 0.08), ...blast(0.9, 0.6)),
  snipe: fx(v("noise", 5000, 0.08, 0.4, 0.3), v("sine", 2400, 0.4, 0.06, 0.5)),
  cloak: fx(v("sine", 1200, 0.6, 0.08, 2.5), v("triangle", 1800, 0.5, 0.05, 0.4)),
  stickyMine: fx(v("square", 900, 0.05, 0.08), v("square", 1300, 0.05, 0.06, 1, 0.08)),
  hijack: fx(v("sawtooth", 200, 0.4, 0.1, 3), v("square", 1500, 0.1, 0.05, 1, 0.35)),
  repair: fx(hold(v("sawtooth", 140, 0.6, 0.07, 1.1)), v("noise", 3000, 0.3, 0.08)),
  turretDrop: fx(v("sine", 400, 0.3, 0.1, 0.3), ...clank(250, 0.12, 0.3)),
  fortify: fx(...clank(200, 0.12), ...clank(260, 0.1, 0.12)),
  overclock: fx(v("sawtooth", 100, 0.8, 0.08, 6)),
  dash: fx(v("noise", 1200, 0.25, 0.3, 3)),
  flare: fx(v("noise", 3000, 0.08, 0.3), v("sine", 1500, 0.6, 0.06, 0.6, 0.05)),
  spotter: fx(...notes("sine", 0.08, 0.1, [1760, 1760])),
  blitz: fx(...notes("square", 0.07, 0.05, [A4, C5, E5, A5]), v("noise", 900, 0.3, 0.2, 2)),
  // Items' actives.
  shield: fx(v("triangle", 1400, 0.35, 0.12, 0.8), v("sine", 2100, 0.3, 0.05, 0.8)),
  blink: fx(v("sine", 400, 0.15, 0.12, 6), v("sine", 2400, 0.15, 0.08, 0.2, 0.12)),
  item: fx(v("triangle", 880, 0.2, 0.08, 1.5)),
  // The interface's own (never placed).
  click: alert(0, v("square", 1800, 0.025, 0.04)),
  hover: alert(0, v("sine", 2600, 0.02, 0.015)),
  buy: alert(0, ...notes("square", 0.06, 0.05, [1319, 1760, 2637])),
  sell: alert(0, ...notes("square", 0.06, 0.05, [1760, 1319])),
  confirm: alert(0, v("square", 660, 0.05, 0.06), v("square", 990, 0.06, 0.05, 1, 0.05)),
  invalid: alert(0, v("sawtooth", 110, 0.18, 0.1), v("square", 104, 0.18, 0.06)),
} satisfies Record<string, Sound>;

export type CueKind = keyof typeof SOUNDS;
