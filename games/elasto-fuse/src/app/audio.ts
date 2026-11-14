import type { Cue } from "../render/cues.js";

/**
 * Little synthesized sounds for what the scene says happened since the last frame (`Scene.draw`'s cues), and an
 * engine hum that follows the gas and the driven wheel. Nothing is loaded; a page opened with `?mute` never opens
 * the browser's audio, and no choice is stored.
 */
export interface Sfx {
  play(cue: Cue): void;
  /**
   * The engine now: `rev` is how fast the driven wheel turns (0 to 1), `gas` whether the throttle is open; `running`
   * false (no bike of this device's on the track) lets it fall silent.
   */
  engine(rev: number, gas: boolean, running: boolean): void;
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

/** The hum's pitch in Hz for a wheel speed and throttle: idle, up through the revs, a little more under load. */
export const humPitch = (rev: number, gas: boolean): number =>
  52 + Math.max(0, Math.min(1, rev)) * 118 + (gas ? 14 : 0);
/** The hum's volume, 0 when the engine is not `running`. */
export const humVolume = (
  rev: number,
  gas: boolean,
  running: boolean,
): number =>
  running
    ? 0.012 + (gas ? 0.022 : 0) + Math.max(0, Math.min(1, rev)) * 0.014
    : 0;

export function createSfx(
  muted: boolean,
  deps: SfxDependencies = browser,
): Sfx {
  let context: AudioContext | undefined;
  let hum:
    { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode } | undefined;
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
    delay = 0,
  ) => {
    const audio = ctx();
    if (!audio || audio.state !== "running") return;
    const osc = audio.createOscillator(),
      gain = audio.createGain(),
      at = audio.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequency * slide),
      at + duration,
    );
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
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
      deps.later(() => tone(note, 0.18, "square", volume), i * gap),
    );
  return {
    resume() {
      void ctx()?.resume();
    },
    engine(rev, gas, running) {
      const audio = ctx();
      if (!audio || audio.state !== "running") return;
      if (!hum) {
        if (!running) return;
        // A saw and the octave under it through a low-pass: a small two-stroke, not a buzzer.
        const osc = audio.createOscillator(),
          sub = audio.createOscillator(),
          filter = audio.createBiquadFilter(),
          gain = audio.createGain();
        osc.type = "sawtooth";
        sub.type = "square";
        filter.type = "lowpass";
        filter.frequency.value = 520;
        gain.gain.value = 0;
        osc.connect(filter);
        sub.connect(filter);
        filter.connect(gain).connect(audio.destination);
        osc.start();
        sub.start();
        hum = { osc, sub, gain };
      }
      const pitch = humPitch(rev, gas),
        at = audio.currentTime;
      hum.osc.frequency.setTargetAtTime(pitch, at, 0.05);
      hum.sub.frequency.setTargetAtTime(pitch / 2, at, 0.05);
      hum.gain.gain.setTargetAtTime(humVolume(rev, gas, running), at, 0.06);
    },
    play(cue) {
      switch (cue.kind) {
        case "apple":
          tone(880, 0.09, "triangle", 0.07, 1.5);
          tone(1320, 0.12, "sine", 0.05, 1.2, 0.07);
          break;
        case "crash":
          noise(0.35, 0.2, 900);
          tone(140, 0.3, "sawtooth", 0.08, 0.3);
          break;
        case "finish":
          jingle([523, 659, 784, 1046, 1318], 100, 0.06);
          break;
        case "count":
          tone(440, 0.12, "square", 0.045);
          break;
        case "go":
          tone(880, 0.3, "square", 0.05);
          break;
        default:
          break;
      }
    },
  };
}
