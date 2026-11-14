import type {
  AudioClock,
  AudioLike,
  BufferLike,
  BufferSourceLike,
  ClockedSong,
  FilterLike,
  GainLike,
  GameAudioDependencies,
  MusicElement,
  NodeLike,
  OscillatorLike,
  PannerLike,
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

/** The fake context: a test moves its clock, its state and its latencies by assigning to them. */
export type FakeAudioContext = {
  -readonly [K in keyof AudioLike]: AudioLike[K];
};
/** A buffer source that remembers what was done to it. */
export interface FakeBufferSource extends BufferSourceLike {
  /** Where it was connected, until it is disconnected. */
  output: NodeLike | undefined;
  /** What `start` was called with. */
  started: { at: number; offset: number } | undefined;
  stopped: boolean;
  /** Ends it the way the browser does when the buffer runs out. */
  end(): void;
}

export function createAudioRig(state: AudioContextState = "running") {
  const log = {
    oscillators: 0,
    noises: 0,
    resumes: 0,
    opens: 0,
    sources: 0,
    fetches: 0,
  };
  const gains: GainLike[] = [];
  /** Every stereo panner made: one per shaped song. */
  const panners: PannerLike[] = [];
  /** Every buffer source made: the noises and the clocked songs. */
  const buffers: FakeBufferSource[] = [];
  /** What `fetchAudio` serves, by URL; `addSong` fills it with a file that decodes. */
  const files = new Map<string, ArrayBuffer>();
  const lengths = new WeakMap<ArrayBuffer, number>();
  const context: FakeAudioContext = {
    state,
    currentTime: 0,
    sampleRate: 100,
    destination: node(),
    resume: async () => {
      log.resumes++;
      context.state = "running";
    },
    suspend: async () => {
      context.state = "suspended";
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
    createStereoPanner: () => {
      const p: PannerLike = { ...node(), pan: param() };
      panners.push(p);
      return p;
    },
    createBuffer: (_c, length, sampleRate) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      log.noises++;
      const source: FakeBufferSource = {
        buffer: null,
        onended: null,
        output: undefined,
        started: undefined,
        stopped: false,
        connect(destination) {
          source.output = destination;
        },
        disconnect() {
          source.output = undefined;
        },
        start(at = context.currentTime, offset = 0) {
          source.started = { at, offset };
        },
        stop() {
          source.stopped = true;
        },
        end() {
          source.onended?.(new Event("ended"));
        },
      };
      buffers.push(source);
      return source;
    },
    createMediaElementSource: () => {
      log.sources++;
      return node();
    },
    decodeAudioData: async (data): Promise<BufferLike> => {
      const duration = lengths.get(data);
      if (duration === undefined) throw new Error("not audio");
      return { duration, getChannelData: () => new Float32Array(0) };
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
    fetchAudio: async (url) => {
      log.fetches++;
      const file = files.get(url);
      if (!file) throw new Error("not found");
      return file;
    },
  };
  /** Serves a file at `url` that decodes to `seconds` of audio. */
  const addSong = (url: string, seconds: number) => {
    const file = new ArrayBuffer(8);
    lengths.set(file, seconds);
    files.set(url, file);
  };
  return {
    context,
    deps,
    log,
    elements,
    timers,
    storage,
    gains,
    panners,
    buffers,
    files,
    addSong,
  };
}

/** An audio clock a test sets by hand: `time` and `lag` in seconds. */
export interface FakeAudioClock extends AudioClock {
  /** What `now()` returns. */
  time: number;
  /** What `latency()` returns. */
  lag: number;
  running: boolean;
}
export function createFakeAudioClock(
  start: { time?: number; lag?: number; running?: boolean } = {},
): FakeAudioClock {
  const clock: FakeAudioClock = {
    time: start.time ?? 0,
    lag: start.lag ?? 0,
    running: start.running ?? true,
    now: () => clock.time,
    latency: () => clock.lag,
  };
  return clock;
}

/** A clocked song that plays nothing and remembers how it was scheduled. */
export interface FakeClockedSong extends ClockedSong {
  /** Every `play`, as it was asked for. */
  readonly plays: { at: number; offset: number }[];
  stops: number;
  /** The newest `shape`. */
  shaped: { level: number; pan: number };
  /**
   * The song position (seconds) scheduled at audio-clock time `at`: negative while a delayed start waits, undefined
   * when nothing is playing. What is heard at clock time `t` is `scheduled(t - latency)`.
   */
  scheduled(at: number): number | undefined;
  /** The song ran out. */
  end(): void;
}
/**
 * A fake of `GameAudio.loadSong`'s song, following the same rules against `clock` (a play past the end plays
 * nothing). It does not end by itself: call `end()`.
 */
export function createFakeClockedSong(
  duration: number,
  clock: AudioClock,
): FakeClockedSong {
  let live: { at: number; offset: number } | undefined;
  const song: FakeClockedSong = {
    duration,
    plays: [],
    stops: 0,
    shaped: { level: 1, pan: 0 },
    get playing() {
      return live !== undefined;
    },
    play(at, offset) {
      song.plays.push({ at, offset });
      const started = Math.max(at, clock.now(), at - Math.min(0, offset));
      live =
        offset + (started - at) < duration && Number.isFinite(started)
          ? { at, offset }
          : undefined;
    },
    stop() {
      if (live) song.stops++;
      live = undefined;
    },
    shape(level, pan) {
      song.shaped = { level, pan };
    },
    scheduled: (at) => (live ? live.offset + (at - live.at) : undefined),
    end() {
      live = undefined;
    },
  };
  return song;
}
