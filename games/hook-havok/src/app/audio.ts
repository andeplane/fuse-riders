import type { Cue } from "../render/feedback.js";
export interface Tone {
  from: number;
  to: number;
  duration: number;
  type: OscillatorType;
}
export const TONES: Record<Cue, Tone> = {
  jump: { from: 180, to: 410, duration: 0.11, type: "sine" },
  land: { from: 110, to: 48, duration: 0.09, type: "triangle" },
  fire: { from: 580, to: 240, duration: 0.07, type: "triangle" },
  attach: { from: 1250, to: 760, duration: 0.09, type: "sine" },
  release: { from: 330, to: 170, duration: 0.07, type: "sine" },
  respawn: { from: 280, to: 560, duration: 0.2, type: "sine" },
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
  constructor(
    private muted: boolean,
    private create: () => ToneSink,
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
    if (this.ready && !this.muted && !this.disposed && this.volume > 0)
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
  const voices = new Set<OscillatorNode>();
  let closed = false;
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
  return {
    resume: () => context.resume(),
    play(tone, volume) {
      if (closed || context.state !== "running" || voices.size >= 6) return;
      const oscillator = context.createOscillator(),
        gain = context.createGain(),
        now = context.currentTime;
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        tone.to,
        now + tone.duration,
      );
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume * 0.16, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      voices.add(oscillator);
      oscillator.onended = () => {
        voices.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + tone.duration + 0.01);
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
