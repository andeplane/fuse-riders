import type { Cue } from "../render/effects.js";

/**
 * Little synthesized sounds for what the arena says happened since the last frame (`Scene.draw`'s cues). Nothing is
 * loaded; a page opened with `?mute` never opens the browser's audio, and no choice is stored.
 */
export interface Sfx {
  play(cue: Cue): void;
  /** The browser lets a page make sound only after a key or a touch: call this from one. */
  resume(): void;
}

/** Where the sounds come from: the browser's audio, a timer for the notes of a jingle, and the hiss's samples. */
export interface SfxDependencies {
  open(): AudioContext | undefined;
  later(run: () => void, ms: number): void;
  random(): number;
}
const browser: SfxDependencies = {
  open: () =>
    typeof AudioContext === "undefined" ? undefined : new AudioContext(),
  later: (run, ms) => void setTimeout(run, ms),
  random: () => Math.random(),
};

export function createSfx(
  muted: boolean,
  deps: SfxDependencies = browser,
): Sfx {
  let context: AudioContext | undefined;
  const ctx = () => {
    if (muted) return undefined;
    context ??= deps.open();
    return context;
  };
  const tone = (
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slide = 1,
  ) => {
    const audio = ctx();
    if (!audio || audio.state !== "running") return;
    const osc = audio.createOscillator(),
      gain = audio.createGain(),
      at = audio.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequency * slide),
      at + duration,
    );
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  };
  const noise = (duration: number, volume: number, cutoff: number) => {
    const audio = ctx();
    if (!audio || audio.state !== "running") return;
    const length = Math.floor(audio.sampleRate * duration),
      buffer = audio.createBuffer(1, length, audio.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++)
      data[i] = (deps.random() * 2 - 1) * (1 - i / length);
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      gain = audio.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  };
  const jingle = (notes: readonly number[], gap: number, volume: number) =>
    notes.forEach((note, i) =>
      deps.later(() => tone(note, 0.16, "square", volume), i * gap),
    );
  return {
    resume() {
      void ctx()?.resume();
    },
    play(cue) {
      switch (cue.kind) {
        case "jump":
          tone(cue.grounded ? 330 : 440, 0.09, "square", 0.04, 1.6);
          break;
        case "bubble":
          tone(620, 0.12, "sine", 0.07, 1.5);
          break;
        case "pop":
          tone(900, 0.07, "triangle", 0.09, 0.4);
          noise(0.08, 0.08, 3000);
          break;
        case "harden":
          tone(1250, 0.1, "triangle", 0.05, 1.2);
          break;
        case "bounce":
          // Quiet taps stay quiet: a rolling ball must not rattle.
          if (cue.speed >= 0.5)
            tone(
              170 + Math.min(260, cue.speed * 70),
              0.07,
              "triangle",
              Math.min(0.1, 0.03 + cue.speed * 0.02),
              0.7,
            );
          break;
        case "goal":
          jingle(
            cue.suddenDeath ? [523, 659, 784, 1046, 1318] : [523, 659, 784],
            90,
            0.07,
          );
          break;
        case "zap":
          tone(1400, 0.45, "sawtooth", 0.07, 0.08);
          noise(0.4, 0.14, 2200);
          break;
        case "count":
          tone(440, 0.12, "square", 0.06);
          break;
        case "go":
          tone(880, 0.3, "square", 0.08);
          break;
        case "over":
          jingle([659, 784, 1046, 1318, 1568], 110, 0.07);
          break;
        default:
          // A trail ring is only seen.
          break;
      }
    },
  };
}
