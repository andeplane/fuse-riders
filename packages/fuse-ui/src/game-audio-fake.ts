import type {
  AudioLike,
  BufferSourceLike,
  FilterLike,
  GainLike,
  GameAudioDependencies,
  MusicElement,
  NodeLike,
  OscillatorLike,
  ParamLike,
} from "./game-audio.js";
import { createMemoryStorage } from "./safe-storage.js";

/** Typed fakes for the browser's audio, for tests of this module and of the games' sounds. Not used in the app. */
function param(): ParamLike {
  return {
    value: 1,
    setValueAtTime(value) {
      this.value = value;
    },
    linearRampToValueAtTime(value) {
      this.value = value;
    },
    exponentialRampToValueAtTime(value) {
      this.value = value;
    },
    cancelScheduledValues() {},
  };
}
const node = (): NodeLike => ({
  connect: () => undefined,
  disconnect: () => undefined,
});

export function createAudioRig(state: AudioContextState = "running") {
  const log = { oscillators: 0, noises: 0, resumes: 0, opens: 0, sources: 0 };
  const gains: GainLike[] = [];
  const context: AudioLike = {
    state,
    currentTime: 0,
    sampleRate: 100,
    destination: node(),
    resume: async () => {
      log.resumes++;
      (context as { state: AudioContextState }).state = "running";
    },
    suspend: async () => {
      (context as { state: AudioContextState }).state = "suspended";
    },
    createGain: () => {
      const g: GainLike = { ...node(), gain: param() };
      gains.push(g);
      return g;
    },
    createOscillator: (): OscillatorLike => {
      log.oscillators++;
      return {
        ...node(),
        type: "sine",
        frequency: param(),
        start() {},
        stop() {},
      };
    },
    createBiquadFilter: (): FilterLike => ({
      ...node(),
      type: "lowpass",
      frequency: param(),
    }),
    createBuffer: (_c, length) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: (): BufferSourceLike => {
      log.noises++;
      return { ...node(), buffer: null, start() {} };
    },
    createMediaElementSource: () => {
      log.sources++;
      return node();
    },
  };
  const elements: (MusicElement & { plays: number; pauses: number })[] = [];
  const timers: (() => void)[] = [];
  const storage = createMemoryStorage();
  const deps: GameAudioDependencies = {
    open: () => {
      log.opens++;
      return context;
    },
    createElement: () => {
      const el = {
        src: "",
        loop: false,
        preload: "none" as MusicElement["preload"],
        onended: null,
        onerror: null,
        plays: 0,
        pauses: 0,
        play: async () => {
          el.plays++;
        },
        pause: () => {
          el.pauses++;
        },
      };
      elements.push(el);
      return el;
    },
    later: (run) => void timers.push(run),
    random: () => 0,
    storage,
  };
  return { context, deps, log, elements, timers, storage, gains };
}
