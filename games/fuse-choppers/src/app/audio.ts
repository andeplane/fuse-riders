import type { FxKind } from "../engine/view.js";

/**
 * Little synthesized sounds for the effects a frame carries, played once per effect id. Nothing is loaded; a page
 * opened with `?mute` never makes a sound, and no choice is stored.
 */
export interface Sfx {
  play(kind: FxKind | "shot" | "count" | "go" | "crown"): void;
  resume(): void;
}

/** Where the sounds come from: the browser's audio, and a timer for the notes of a jingle. */
export interface SfxDependencies {
  open(): AudioContext | undefined;
  later(run: () => void, ms: number): void;
}
const browser: SfxDependencies = {
  open: () =>
    typeof AudioContext === "undefined" ? undefined : new AudioContext(),
  later: (run, ms) => void setTimeout(run, ms),
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
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
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
  return {
    resume() {
      void ctx()?.resume();
    },
    play(kind) {
      switch (kind) {
        case "explode":
        case "droneDown":
          noise(0.7, 0.5, 900);
          tone(120, 0.5, "sawtooth", 0.18, 0.3);
          break;
        case "hit":
        case "bump":
          tone(420, 0.12, "square", 0.08, 0.5);
          break;
        case "shot":
          tone(880, 0.07, "square", 0.04, 0.6);
          break;
        case "pickup":
          tone(660, 0.08, "triangle", 0.12);
          deps.later(() => tone(990, 0.12, "triangle", 0.12), 70);
          break;
        case "shock":
          tone(90, 0.5, "sine", 0.3, 3);
          noise(0.3, 0.2, 2400);
          break;
        case "shieldPop":
          tone(1200, 0.25, "sine", 0.12, 0.4);
          break;
        case "shatter":
          noise(0.2, 0.2, 1600);
          break;
        case "bolt":
          tone(300, 0.15, "sawtooth", 0.05, 2);
          break;
        case "exit":
        case "crown":
          [523, 659, 784, 1046].forEach((f, i) =>
            deps.later(() => tone(f, 0.16, "square", 0.07), i * 90),
          );
          break;
        case "count":
          tone(440, 0.12, "square", 0.06);
          break;
        case "go":
          tone(880, 0.3, "square", 0.08);
          break;
        default:
          break;
      }
    },
  };
}
