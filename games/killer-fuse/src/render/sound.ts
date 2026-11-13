/**
 * Every sound of the arena, synthesised with WebAudio: there are no audio files. The context is only made after
 * the first key or pointer press (browsers refuse earlier) and never while muted. Music is a sixteen-step loop
 * scheduled a little ahead of the clock from the render loop.
 */
import type { SoundCue, SoundName } from "./effects.js";

type Wave = OscillatorType;

interface Note {
  readonly wave: Wave;
  readonly from: number;
  /** Frequency to slide to by the end; the same as `from` when absent. */
  readonly to?: number;
  /** Seconds after the cue starts, and how long it sounds. */
  readonly at: number;
  readonly length: number;
  readonly gain: number;
}

interface Hiss {
  readonly at: number;
  readonly length: number;
  readonly gain: number;
  /** Band centre in Hz at the start and the end. */
  readonly from: number;
  readonly to: number;
}

interface Recipe {
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
  gateEnter: { notes: arp("triangle", [G4, up(D4)], 0.06, 0.08, 0.2) },
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
};

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

export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<SoundName, number>();
  private unlocked = false;
  private playing = false;
  private nextStep = 0;
  private stepAt = 0;
  private readonly unlock = (): void => {
    this.unlocked = true;
    this.wake();
  };

  constructor(private muted: boolean) {
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) void this.context?.suspend();
    else this.wake();
  }

  /** Whether the music bed should run: on during a round, off once it is won. */
  setPlaying(playing: boolean): void {
    if (playing && !this.playing) this.nextStep = 0;
    this.playing = playing;
    if (this.music && this.context)
      this.music.gain.setTargetAtTime(
        playing ? 0.5 : 0,
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
      music.gain.value = this.playing ? 0.5 : 0;
      music.connect(master);
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
    if (!context || !this.master || this.muted || context.state !== "running")
      return;
    const recipe = RECIPES[cue.name];
    const now = context.currentTime;
    if (now - (this.lastPlayed.get(cue.name) ?? -9) < (recipe.gap ?? 0.02))
      return;
    this.lastPlayed.set(cue.name, now);
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, cue.pan));
    pan.connect(this.master);
    for (const note of recipe.notes ?? [])
      this.note(note, now, cue.volume, pan);
    for (const hiss of recipe.hiss ?? []) this.hiss(hiss, now, cue.volume, pan);
  }

  /** Schedules the music a fifth of a second ahead. Call it every display frame. */
  tick(): void {
    const context = this.context;
    const out = this.music;
    if (!context || !out || this.muted || !this.playing) return;
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
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.music = null;
  }
}
