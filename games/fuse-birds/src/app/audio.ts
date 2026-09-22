import type { Fact } from "../engine/view.js";
export interface ToneSink {
  resume(): Promise<void>;
  tone(
    from: number,
    to: number,
    seconds: number,
    wave: OscillatorType,
    gain: number,
  ): void;
  close(): void;
}
export function browserToneSink(): ToneSink {
  const context = new AudioContext();
  return {
    resume: () => context.resume(),
    tone(from, to, seconds, wave, level) {
      const oscillator = context.createOscillator(),
        gain = context.createGain(),
        at = context.currentTime;
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(from, at);
      oscillator.frequency.exponentialRampToValueAtTime(to, at + seconds);
      gain.gain.setValueAtTime(level, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + seconds);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    },
    close: () => {
      void context.close().catch(() => {});
    },
  };
}
/** Optional presentation-only audio; the headless engine never imports or waits for it. */
export class BirdsAudio {
  private sink?: ToneSink;
  private lastBlast = -Infinity;
  constructor(
    public enabled: boolean,
    private make: () => ToneSink = browserToneSink,
  ) {}
  unlock(): void {
    if (!this.enabled) return;
    try {
      this.sink ??= this.make();
      void this.sink.resume().catch(() => {});
    } catch {
      /* Visual feedback remains complete if audio is unavailable. */
    }
  }
  play(fact: Fact, now: number): void {
    if (!this.enabled || !this.sink) return;
    if (fact.type === "shot") this.sink.tone(650, 110, 0.16, "sine", 0.045);
    else if (fact.type === "blast" && now - this.lastBlast > 30) {
      this.lastBlast = now;
      this.sink.tone(150, 35, 0.32, "triangle", 0.12);
    } else if (fact.type === "pickup")
      this.sink.tone(520, 1050, 0.2, "sine", 0.06);
    else if (fact.type === "result")
      this.sink.tone(330, 880, 0.7, "triangle", 0.055);
  }
  destroy(): void {
    this.sink?.close();
    this.sink = undefined;
  }
}
