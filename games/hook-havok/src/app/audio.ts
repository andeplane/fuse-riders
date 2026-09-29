import type { Cue } from "../render/feedback.js";
export interface Tone {
  from: number;
  to: number;
  duration: number;
  type: OscillatorType;
  /** Filtered white noise instead of an oscillator; from/to sweep the filter. */
  noise?: "lowpass" | "highpass";
  /** Loudness relative to the other cues (default 1). */
  gain?: number;
}
export const TONES: Record<Cue, Tone> = {
  power: { from: 420, to: 1120, duration: 0.18, type: "sine" },
  impact: { from: 190, to: 65, duration: 0.12, type: "triangle" },
  pop: { from: 920, to: 210, duration: 0.13, type: "sine" },
  jump: { from: 180, to: 410, duration: 0.11, type: "sine" },
  land: { from: 110, to: 48, duration: 0.09, type: "triangle" },
  fire: { from: 580, to: 240, duration: 0.07, type: "triangle" },
  attach: { from: 1250, to: 760, duration: 0.09, type: "sine" },
  release: { from: 330, to: 170, duration: 0.07, type: "sine" },
  respawn: { from: 280, to: 560, duration: 0.2, type: "sine" },
  // 11B bombs: a fuse hiss on the throw, a metal clink on a hard bounce, a boom.
  hiss: {
    from: 5200,
    to: 3400,
    duration: 0.42,
    type: "sine",
    noise: "highpass",
    gain: 0.45,
  },
  clink: { from: 2350, to: 1750, duration: 0.05, type: "square", gain: 0.35 },
  boom: {
    from: 1400,
    to: 60,
    duration: 0.6,
    type: "sine",
    noise: "lowpass",
    gain: 2.2,
  },
};
/** The same cue closer together than this plays once (bounces and chains). */
const REPEAT_MS: Partial<Record<Cue, number>> = {
  clink: 70,
  hiss: 120,
  boom: 60,
};
export interface ToneSink {
  resume(): Promise<void>;
  play(tone: Tone, volume: number): void;
  silence(): void;
  close(): void;
}
/** Effects are gesture-unlocked, bounded in the sink, and have no engine side effects. */
export class EffectsAudio {
  private sink?: ToneSink;
  private disposed = false;
  private ready = false;
  private generation = 0;
  private volume = 0.3;
  private last = new Map<Cue, number>();
  constructor(
    private muted: boolean,
    private create: () => ToneSink,
    private now: () => number = () => performance.now(),
  ) {}
  unlock(): void {
    if (this.muted || this.disposed || this.ready) return;
    try {
      const sink = (this.sink ??= this.create());
      const generation = this.generation;
      void sink
        .resume()
        .then(() => {
          if (!this.disposed && generation === this.generation)
            this.ready = true;
        })
        .catch(() => {});
    } catch {
      /* unsupported audio leaves the game playable */
    }
  }
  setVolume(volume: number): void {
    if (Number.isFinite(volume)) this.volume = Math.max(0, Math.min(1, volume));
    if (!this.volume) this.sink?.silence();
  }
  cue(cue: Cue): void {
    if (!this.ready || this.muted || this.disposed || this.volume <= 0) return;
    const gap = REPEAT_MS[cue],
      now = this.now();
    if (gap !== undefined) {
      if (now - (this.last.get(cue) ?? -Infinity) < gap) return;
      this.last.set(cue, now);
    }
    this.sink?.play(TONES[cue], this.volume);
  }
  pause(): void {
    this.generation++;
    this.ready = false;
    this.sink?.silence();
  }
  destroy(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.sink?.close();
    this.sink = undefined;
  }
}
export function browserToneSink(): ToneSink {
  const context = new AudioContext();
  const voices = new Set<AudioScheduledSourceNode>();
  let closed = false,
    noise: AudioBuffer | undefined;
  const silence = () => {
    for (const node of voices) {
      try {
        node.stop();
      } catch {
        /* already ended */
      }
    }
    voices.clear();
  };
  const source = (
    tone: Tone,
    now: number,
  ): [AudioScheduledSourceNode, AudioNode] => {
    if (!tone.noise) {
      const oscillator = context.createOscillator();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        tone.to,
        now + tone.duration,
      );
      return [oscillator, oscillator];
    }
    if (!noise) {
      noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = noise.getChannelData(0);
      // A fixed LCG: the same hiss every time, no Math.random.
      let seed = 0x2545f491;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        data[i] = seed / 0x80000000 - 1;
      }
    }
    const buffer = context.createBufferSource(),
      filter = context.createBiquadFilter();
    buffer.buffer = noise;
    filter.type = tone.noise;
    filter.frequency.setValueAtTime(tone.from, now);
    filter.frequency.exponentialRampToValueAtTime(tone.to, now + tone.duration);
    buffer.connect(filter);
    return [buffer, filter];
  };
  return {
    resume: () => context.resume(),
    play(tone, volume) {
      if (closed || context.state !== "running" || voices.size >= 6) return;
      const now = context.currentTime,
        [node, out] = source(tone, now),
        gain = context.createGain();
      const peak = Math.min(0.5, volume * 0.16 * (tone.gain ?? 1));
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);
      out.connect(gain);
      gain.connect(context.destination);
      voices.add(node);
      node.onended = () => {
        voices.delete(node);
        node.disconnect();
        if (out !== node) out.disconnect();
        gain.disconnect();
      };
      node.start(now);
      node.stop(now + tone.duration + 0.01);
    },
    silence,
    close() {
      if (closed) return;
      closed = true;
      silence();
      void context.close().catch(() => {});
    },
  };
}
