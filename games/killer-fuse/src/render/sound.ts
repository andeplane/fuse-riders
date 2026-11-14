/**
 * Every sound of the arena, synthesised with WebAudio: there are no effect files. The context is only made after
 * the first press (key, pointer, finger or gamepad — browsers refuse earlier) and never while muted. The
 * synthesised music bed is a sixteen-step loop scheduled a little ahead of the clock from the render loop; the
 * page switches it off when it has a music file to play instead (`src/app/music.ts`).
 */
import type { SoundCue, SoundName } from "./effects.js";

type Wave = OscillatorType;

export interface Note {
  readonly wave: Wave;
  readonly from: number;
  /** Frequency to slide to by the end; the same as `from` when absent. */
  readonly to?: number;
  /** Seconds after the cue starts, and how long it sounds. */
  readonly at: number;
  readonly length: number;
  readonly gain: number;
}

export interface Hiss {
  readonly at: number;
  readonly length: number;
  readonly gain: number;
  /** Band centre in Hz at the start and the end. */
  readonly from: number;
  readonly to: number;
}

export interface Recipe {
  readonly notes?: readonly Note[];
  readonly hiss?: readonly Hiss[];
  /** Least seconds between two plays, so six flapping units do not become a buzz. */
  readonly gap?: number;
}

const arp = (
  wave: Wave,
  pitches: readonly number[],
  step: number,
  length: number,
  gain: number,
  at = 0,
): Note[] =>
  pitches.map((from, index) => ({
    wave,
    from,
    at: at + index * step,
    length,
    gain,
  }));

const C4 = 261.63,
  D4 = 293.66,
  E4 = 329.63,
  F4 = 349.23,
  G4 = 392,
  A4 = 440,
  B4 = 493.88;
const up = (pitch: number, octaves = 1): number => pitch * 2 ** octaves;

const RECIPES: Readonly<Record<SoundName, Recipe>> = {
  flap: {
    hiss: [{ at: 0, length: 0.07, gain: 0.5, from: 1500, to: 500 }],
    notes: [
      { wave: "triangle", from: 300, to: 180, at: 0, length: 0.06, gain: 0.2 },
    ],
    gap: 0.05,
  },
  jump: {
    notes: [
      { wave: "square", from: 260, to: 540, at: 0, length: 0.09, gain: 0.22 },
    ],
    gap: 0.05,
  },
  // Feet back on stone: a short thud with a scuff of grit, no tail.
  land: {
    notes: [
      { wave: "sine", from: 170, to: 65, at: 0, length: 0.07, gain: 0.4 },
    ],
    hiss: [{ at: 0, length: 0.045, gain: 0.22, from: 1300, to: 420 }],
    gap: 0.07,
  },
  pickup: { notes: arp("square", [up(A4), up(E4, 2)], 0.05, 0.07, 0.22) },
  deposit: {
    notes: [
      ...arp("square", [up(C4), up(E4), up(G4), up(C4, 2)], 0.055, 0.09, 0.24),
      { wave: "triangle", from: up(C4, 3), at: 0.22, length: 0.25, gain: 0.18 },
    ],
  },
  kick: {
    notes: [
      { wave: "sine", from: 190, to: 60, at: 0, length: 0.11, gain: 0.6 },
    ],
    hiss: [{ at: 0, length: 0.03, gain: 0.35, from: 2500, to: 1200 }],
  },
  bounce: {
    notes: [
      { wave: "triangle", from: 330, to: 150, at: 0, length: 0.08, gain: 0.4 },
    ],
    hiss: [{ at: 0, length: 0.04, gain: 0.25, from: 1800, to: 900 }],
    gap: 0.06,
  },
  // A sword swung: a quick rising swish.
  attack: {
    hiss: [{ at: 0, length: 0.12, gain: 0.45, from: 900, to: 4200 }],
    notes: [
      { wave: "triangle", from: 420, to: 760, at: 0, length: 0.07, gain: 0.12 },
    ],
    gap: 0.04,
  },
  // Blade on blade: a bright ring that hangs for a moment.
  glance: {
    notes: [
      { wave: "square", from: up(E4, 3), at: 0, length: 0.05, gain: 0.22 },
      { wave: "triangle", from: up(B4, 2), at: 0, length: 0.3, gain: 0.3 },
      { wave: "sine", from: up(E4, 3), at: 0.02, length: 0.35, gain: 0.2 },
    ],
    hiss: [{ at: 0, length: 0.05, gain: 0.5, from: 6000, to: 3000 }],
    gap: 0.05,
  },
  // Feet on a head: a soft boing.
  stomp: {
    notes: [
      { wave: "sine", from: 180, to: 420, at: 0, length: 0.1, gain: 0.45 },
    ],
    gap: 0.05,
  },
  gateEnter: { notes: arp("triangle", [G4, up(D4)], 0.06, 0.08, 0.2) },
  // The doors shut: a low thunk and a latch.
  gateLock: {
    notes: [
      { wave: "sine", from: 150, to: 70, at: 0, length: 0.12, gain: 0.55 },
      { wave: "square", from: up(D4), at: 0.05, length: 0.04, gain: 0.14 },
    ],
    hiss: [{ at: 0, length: 0.04, gain: 0.3, from: 1500, to: 600 }],
  },
  gateUse: {
    notes: [
      { wave: "sawtooth", from: 180, to: 1400, at: 0, length: 0.32, gain: 0.2 },
      ...arp("square", [up(E4), up(A4), up(E4, 2)], 0.05, 0.16, 0.2, 0.3),
    ],
    hiss: [{ at: 0, length: 0.3, gain: 0.2, from: 500, to: 5000 }],
  },
  gateClaim: { notes: arp("square", [up(D4), up(A4)], 0.07, 0.09, 0.2) },
  kill: {
    notes: [
      { wave: "square", from: 520, to: 90, at: 0, length: 0.2, gain: 0.3 },
    ],
    hiss: [{ at: 0, length: 0.22, gain: 0.55, from: 3000, to: 300 }],
  },
  queenKill: {
    notes: [
      { wave: "sine", from: 140, to: 32, at: 0, length: 0.8, gain: 0.9 },
      ...arp(
        "square",
        [up(A4), up(F4), up(D4), A4, F4, D4, A4 / 2],
        0.075,
        0.14,
        0.26,
        0.05,
      ),
      { wave: "sawtooth", from: 880, to: 55, at: 0, length: 0.7, gain: 0.16 },
    ],
    hiss: [
      { at: 0, length: 0.6, gain: 0.8, from: 4000, to: 150 },
      { at: 0.12, length: 0.5, gain: 0.4, from: 800, to: 100 },
    ],
  },
  snailMount: {
    notes: [
      { wave: "sine", from: 280, to: 460, at: 0, length: 0.1, gain: 0.35 },
      { wave: "sine", from: 460, to: 320, at: 0.1, length: 0.14, gain: 0.35 },
    ],
  },
  // Caught in the snail's mouth: one snap.
  snailCatch: {
    notes: [
      { wave: "square", from: 260, to: 90, at: 0, length: 0.1, gain: 0.32 },
    ],
    hiss: [{ at: 0, length: 0.07, gain: 0.35, from: 1400, to: 400 }],
  },
  snailEat: {
    notes: [0, 0.16, 0.32].map((at) => ({
      wave: "square" as const,
      from: 150,
      to: 70,
      at,
      length: 0.09,
      gain: 0.3,
    })),
    hiss: [0, 0.16, 0.32].map((at) => ({
      at,
      length: 0.06,
      gain: 0.3,
      from: 900,
      to: 300,
    })),
  },
  respawn: {
    notes: arp("triangle", [A4, up(E4), up(A4), up(E4, 2)], 0.045, 0.1, 0.24),
  },
  regrow: {
    notes: arp(
      "triangle",
      [up(G4), up(B4), up(D4, 2), up(G4, 2)],
      0.09,
      0.3,
      0.16,
    ),
  },
  // The three, two, one over the arena: one dry blip a second, and the same blip an octave up on GO.
  countdown: {
    notes: [
      { wave: "square", from: up(E4), at: 0, length: 0.08, gain: 0.3 },
      { wave: "triangle", from: up(E4) / 2, at: 0, length: 0.1, gain: 0.18 },
    ],
    gap: 0.35,
  },
  go: {
    notes: [
      ...arp("square", [up(A4), up(E4, 2)], 0.055, 0.1, 0.32),
      { wave: "sine", from: 190, to: 70, at: 0, length: 0.14, gain: 0.5 },
    ],
    hiss: [{ at: 0, length: 0.12, gain: 0.3, from: 1200, to: 5000 }],
    gap: 0.35,
  },
  // Military: a hard minor fanfare.
  victoryMilitary: {
    notes: [
      ...arp("sawtooth", [A4, A4, A4], 0.13, 0.11, 0.26),
      { wave: "sawtooth", from: up(E4), at: 0.39, length: 0.3, gain: 0.28 },
      { wave: "sawtooth", from: up(D4), at: 0.7, length: 0.14, gain: 0.26 },
      { wave: "sawtooth", from: up(E4), at: 0.85, length: 0.9, gain: 0.3 },
      { wave: "square", from: A4 / 2, at: 0.39, length: 0.3, gain: 0.3 },
      { wave: "square", from: A4 / 2, at: 0.85, length: 0.9, gain: 0.3 },
      { wave: "square", from: up(A4), at: 0.85, length: 0.9, gain: 0.16 },
    ],
    hiss: [{ at: 0.85, length: 0.5, gain: 0.3, from: 6000, to: 2000 }],
  },
  // Economy: a bright major run up and a held chord.
  victoryEconomy: {
    notes: [
      ...arp(
        "square",
        [C4, E4, G4, up(C4), up(E4), up(G4), up(C4, 2)],
        0.085,
        0.12,
        0.22,
      ),
      ...[up(C4), up(E4), up(G4), up(C4, 2)].map((from) => ({
        wave: "triangle" as const,
        from,
        at: 0.62,
        length: 1,
        gain: 0.2,
      })),
    ],
  },
  // Snail: a slow, slightly silly climb with slides.
  victorySnail: {
    notes: [
      { wave: "triangle", from: F4, to: A4, at: 0, length: 0.26, gain: 0.34 },
      {
        wave: "triangle",
        from: A4,
        to: up(C4),
        at: 0.28,
        length: 0.26,
        gain: 0.34,
      },
      {
        wave: "triangle",
        from: up(C4),
        to: up(F4),
        at: 0.56,
        length: 0.3,
        gain: 0.34,
      },
      { wave: "square", from: up(F4), at: 0.9, length: 0.12, gain: 0.2 },
      { wave: "square", from: up(F4), at: 1.06, length: 0.7, gain: 0.22 },
      {
        wave: "sine",
        from: F4 / 2,
        to: F4 / 4,
        at: 0.9,
        length: 0.9,
        gain: 0.5,
      },
    ],
  },
  // The other side of a win: three steps down onto a held minor chord, and the floor drops out under it.
  defeat: {
    notes: [
      { wave: "square", from: up(A4), at: 0, length: 0.16, gain: 0.26 },
      { wave: "square", from: up(F4), at: 0.18, length: 0.16, gain: 0.26 },
      { wave: "square", from: up(D4), at: 0.36, length: 0.16, gain: 0.26 },
      ...[A4, up(C4), E4].map((from) => ({
        wave: "triangle" as const,
        from,
        at: 0.54,
        length: 0.9,
        gain: 0.2,
      })),
      {
        wave: "sawtooth",
        from: A4 / 2,
        to: A4 / 8,
        at: 0.54,
        length: 1,
        gain: 0.22,
      },
    ],
    hiss: [{ at: 0.54, length: 0.5, gain: 0.18, from: 1200, to: 200 }],
  },
};

/**
 * A sting plays alone: whatever else was sounding is hushed under it and the music ducked, as the arcade's win
 * tune does. Each side of a finished game hears one of these.
 */
export const STINGS: ReadonlySet<SoundName> = new Set<SoundName>([
  "victoryMilitary",
  "victoryEconomy",
  "victorySnail",
  "defeat",
]);

/** Loud enough for the music to step back under it, without taking the stage the way a sting does. */
const LOUD: ReadonlySet<SoundName> = new Set<SoundName>([
  "kill",
  "queenKill",
  "gateUse",
  "go",
]);

/** What one admitted cue does: its recipe, how loud and where, and what it does to the rest of the mix. */
export interface Voicing {
  readonly recipe: Recipe;
  readonly volume: number;
  /** -1 to 1, clamped from the cue. */
  readonly pan: number;
  readonly sting: boolean;
  /** The music should duck under this one. */
  readonly duck: boolean;
}

/**
 * Whether a cue sounds now, and how. Kept apart from WebAudio so the rate limiting and the mixing decisions can
 * be tested without a browser: six Queens flapping on the same step is one flap, and a sting silences the rest.
 */
export class SfxGate {
  private readonly last = new Map<SoundName, number>();

  /** The voicing for `cue` at `now` seconds, or null when its name played too recently. */
  admit(cue: SoundCue, now: number): Voicing | null {
    const recipe = RECIPES[cue.name];
    if (now - (this.last.get(cue.name) ?? -9) < (recipe.gap ?? 0.02))
      return null;
    this.last.set(cue.name, now);
    const sting = STINGS.has(cue.name);
    return {
      recipe,
      volume: Math.max(0, Math.min(1, cue.volume)),
      pan: Math.max(-1, Math.min(1, cue.pan)),
      sting,
      duck: sting || LOUD.has(cue.name),
    };
  }

  clear(): void {
    this.last.clear();
  }
}

/** The music bed: four bars of sixteenths, A minor, F, C, G. `0` is a rest. */
const STEP_SECONDS = 60 / 132 / 4;
const BASS = [A4 / 4, F4 / 4, C4 / 2, G4 / 4];
const BASS_HITS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
const CHORDS = [
  [A4, up(C4), up(E4)],
  [F4, A4, up(C4)],
  [G4, up(C4), up(E4)],
  [G4, B4, up(D4)],
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1];
const LEAD = [
  up(E4),
  0,
  0,
  0,
  up(D4),
  0,
  up(C4),
  0,
  up(E4),
  0,
  0,
  0,
  0,
  0,
  up(G4),
  0,
  up(F4),
  0,
  0,
  0,
  up(E4),
  0,
  up(C4),
  0,
  up(A4) / 2,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  up(G4),
  0,
  0,
  0,
  up(E4),
  0,
  up(C4),
  0,
  up(G4),
  0,
  0,
  up(A4),
  0,
  0,
  up(G4),
  0,
  up(D4),
  0,
  0,
  0,
  up(B4) / 2,
  0,
  up(D4),
  0,
  up(G4),
  0,
  0,
  0,
  0,
  0,
  0,
  0,
];

/**
 * The presses a browser accepts as the gesture that lets sound through. iOS counts `touchend`, `pointerup` and
 * `click` but not their starts, so all of them are listened for, and for the page's life: an `AudioContext` can
 * fall back to "suspended" (a call, a lock) and needs the next press to wake it again. `gamepadconnected` fires
 * on the first button a pad sends, which is the only press a pad makes that reaches the window.
 */
const UNLOCK_EVENTS = [
  "pointerdown",
  "pointerup",
  "touchstart",
  "touchend",
  "click",
  "keydown",
  "gamepadconnected",
] as const;

export interface SoundOptions {
  readonly muted: boolean;
  /** Called when something loud sounds, so the page can hold its music down for a moment. */
  readonly duck?: () => void;
}

export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  /** Everything but the music and the win sting, so the sting can cut it off as the arcade's does. */
  private effects: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly gate = new SfxGate();
  private muted: boolean;
  private readonly duck: (() => void) | undefined;
  private unlocked = false;
  private playing = false;
  /** The synthesised bed may be switched off, for silence or for a music file playing in its place. */
  private bed = true;
  private nextStep = 0;
  private stepAt = 0;
  private readonly unlock = (): void => {
    this.unlocked = true;
    this.wake();
  };

  constructor(options: SoundOptions) {
    this.muted = options.muted;
    this.duck = options.duck;
    for (const name of UNLOCK_EVENTS)
      window.addEventListener(name, this.unlock);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) void this.context?.suspend();
    else this.wake();
  }

  /** Whether the synthesised music bed may run at all: off while a music file is playing, or the music is off. */
  setBed(bed: boolean): void {
    if (bed === this.bed) return;
    this.bed = bed;
    if (!bed && this.music && this.context)
      this.music.gain.setTargetAtTime(0, this.context.currentTime, 0.25);
  }

  /** Whether the music bed should run: on during a round, off once it is won. */
  setPlaying(playing: boolean): void {
    if (playing && !this.playing) this.nextStep = 0;
    this.playing = playing;
    if (playing && this.effects && this.context)
      this.effects.gain.setTargetAtTime(1, this.context.currentTime, 0.02);
    if (this.music && this.context)
      this.music.gain.setTargetAtTime(
        playing && this.bed ? 0.5 : 0,
        this.context.currentTime,
        0.25,
      );
  }

  private wake(): void {
    if (this.muted || !this.unlocked) return;
    if (!this.context) {
      const context = new AudioContext();
      const squash = context.createDynamicsCompressor();
      squash.connect(context.destination);
      const master = context.createGain();
      master.gain.value = 0.5;
      master.connect(squash);
      const music = context.createGain();
      music.gain.value = this.playing && this.bed ? 0.5 : 0;
      music.connect(master);
      const effects = context.createGain();
      effects.connect(master);
      this.effects = effects;
      const noise = context.createBuffer(
        1,
        context.sampleRate,
        context.sampleRate,
      );
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.context = context;
      this.master = master;
      this.music = music;
      this.noise = noise;
    }
    void this.context.resume();
  }

  private note(
    note: Note,
    start: number,
    volume: number,
    out: AudioNode,
  ): void {
    const context = this.context;
    if (!context) return;
    const at = start + note.at;
    const osc = context.createOscillator();
    osc.type = note.wave;
    osc.frequency.setValueAtTime(note.from, at);
    if (note.to !== undefined)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, note.to),
        at + note.length,
      );
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(note.gain * volume, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + note.length);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + note.length + 0.02);
  }

  private hiss(
    hiss: Hiss,
    start: number,
    volume: number,
    out: AudioNode,
  ): void {
    const context = this.context;
    if (!context || !this.noise) return;
    const at = start + hiss.at;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(hiss.from, at);
    band.frequency.exponentialRampToValueAtTime(
      Math.max(40, hiss.to),
      at + hiss.length,
    );
    const gain = context.createGain();
    gain.gain.setValueAtTime(hiss.gain * volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + hiss.length);
    source.connect(band).connect(gain).connect(out);
    source.start(at, Math.random() * 0.5);
    source.stop(at + hiss.length + 0.02);
  }

  play(cue: SoundCue): void {
    const context = this.context;
    if (!context || !this.master || this.muted) return;
    if (context.state !== "running") {
      // Suspended after a lock or an interruption: ask again, and let the next cue be the one that is heard.
      if (this.unlocked) void context.resume();
      return;
    }
    const now = context.currentTime;
    const voicing = this.gate.admit(cue, now);
    if (!voicing) return;
    const pan = context.createStereoPanner();
    pan.pan.value = voicing.pan;
    if (voicing.sting && this.effects && this.music) {
      // The win and defeat stings play alone: whatever else was sounding stops.
      this.effects.gain.setTargetAtTime(0, now, 0.015);
      this.music.gain.setTargetAtTime(0, now, 0.015);
      pan.connect(this.master);
    } else pan.connect(this.effects ?? this.master);
    if (voicing.duck) this.duck?.();
    const { recipe } = voicing;
    for (const note of recipe.notes ?? [])
      this.note(note, now, voicing.volume, pan);
    for (const hiss of recipe.hiss ?? [])
      this.hiss(hiss, now, voicing.volume, pan);
  }

  /** Schedules the music a fifth of a second ahead. Call it every display frame. */
  tick(): void {
    const context = this.context;
    const out = this.music;
    if (!context || !out || this.muted || !this.playing || !this.bed) return;
    if (context.state !== "running") return;
    const now = context.currentTime;
    if (this.stepAt < now) this.stepAt = now + 0.05;
    while (this.stepAt < now + 0.2) {
      this.step(this.nextStep, this.stepAt, out);
      this.nextStep = (this.nextStep + 1) % 64;
      this.stepAt += STEP_SECONDS;
    }
  }

  private step(step: number, at: number, out: AudioNode): void {
    const bar = Math.floor(step / 16),
      beat = step % 16;
    const bass = BASS[bar] ?? 110;
    if (BASS_HITS[beat])
      this.note(
        {
          wave: "square",
          from: bass,
          at: 0,
          length: STEP_SECONDS * 1.6,
          gain: 0.3,
        },
        at,
        1,
        out,
      );
    const chord = CHORDS[bar] ?? [];
    const pitch = chord[ARP[beat] ?? 0];
    if (pitch)
      this.note(
        {
          wave: "triangle",
          from: pitch,
          at: 0,
          length: STEP_SECONDS * 0.9,
          gain: 0.14,
        },
        at,
        1,
        out,
      );
    const lead = LEAD[step] ?? 0;
    if (lead)
      this.note(
        {
          wave: "square",
          from: lead,
          at: 0,
          length: STEP_SECONDS * 2.4,
          gain: 0.1,
        },
        at,
        1,
        out,
      );
    if (beat % 4 === 0)
      this.note(
        { wave: "sine", from: 150, to: 45, at: 0, length: 0.11, gain: 0.55 },
        at,
        1,
        out,
      );
    if (beat % 4 === 2)
      this.hiss(
        { at: 0, length: 0.03, gain: 0.16, from: 7000, to: 5000 },
        at,
        1,
        out,
      );
    if (beat === 4 || beat === 12)
      this.hiss(
        { at: 0, length: 0.09, gain: 0.26, from: 2200, to: 900 },
        at,
        1,
        out,
      );
  }

  destroy(): void {
    for (const name of UNLOCK_EVENTS)
      window.removeEventListener(name, this.unlock);
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.music = null;
  }
}
