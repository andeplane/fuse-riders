import type { SafeStorage } from "./safe-storage.js";

/**
 * Shared sound for the arcade games: one master bus with a remembered mute and two volumes (music, effects),
 * procedural effects (`tone`, `noise`, `jingle`) that cost no files, lazily loaded looping music that never holds
 * up the game starting, ducking so a goal horn cuts through the song, and a start that waits for the first key or
 * touch because browsers only allow sound after one. Each game owns its own sounds and songs; this owns the rest.
 *
 * Everything the browser provides arrives through `GameAudioDependencies`, so tests drive it with typed fakes.
 * A page opened with `?mute` (previews and tests, see AGENTS.md) never opens audio and never writes a choice down.
 */

/** The slice of an audio parameter this module drives. */
export interface ParamLike {
  value: number;
  setValueAtTime(value: number, at: number): unknown;
  linearRampToValueAtTime(value: number, at: number): unknown;
  exponentialRampToValueAtTime(value: number, at: number): unknown;
  cancelScheduledValues(at: number): unknown;
}
/** A node that can be wired to another; the browser's `AudioNode`s satisfy it. */
export interface NodeLike {
  connect(destination: NodeLike): unknown;
  disconnect(): unknown;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface OscillatorLike extends NodeLike {
  type: OscillatorType;
  frequency: ParamLike;
  start(at: number): unknown;
  stop(at: number): unknown;
}
export interface FilterLike extends NodeLike {
  type: BiquadFilterType;
  frequency: ParamLike;
}
export interface BufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface BufferSourceLike extends NodeLike {
  buffer: BufferLike | null;
  start(at?: number): unknown;
}
/** The slice of `AudioContext` this module uses. */
export interface AudioLike {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: NodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainLike;
  createOscillator(): OscillatorLike;
  createBiquadFilter(): FilterLike;
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): BufferLike;
  createBufferSource(): BufferSourceLike;
  createMediaElementSource(element: MusicElement): NodeLike;
}
/** The slice of an `HTMLAudioElement` the music player drives. */
export type MusicElement = Pick<
  HTMLAudioElement,
  "src" | "loop" | "preload" | "onended" | "onerror" | "play" | "pause"
>;

export interface GameAudioDependencies {
  /** Opens the page's one audio context; `undefined` where the browser has none. */
  open(): AudioLike | undefined;
  /** A fresh element for a song (never created until music is wanted). */
  createElement(): MusicElement;
  later(run: () => void, ms: number): void;
  random(): number;
  storage: SafeStorage;
}

/** What the player has chosen, stored under `AUDIO_KEY` and shared by every game on this origin. */
export interface AudioPrefs {
  muted: boolean;
  /** 0 to 1. */
  music: number;
  /** 0 to 1. */
  effects: number;
}
export const AUDIO_KEY = "fuse-audio-v1";
export const DEFAULT_PREFS: AudioPrefs = {
  muted: false,
  music: 0.4,
  effects: 0.8,
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function readPrefs(storage: SafeStorage): AudioPrefs {
  try {
    const saved: unknown = JSON.parse(storage.getItem(AUDIO_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return { ...DEFAULT_PREFS };
    const state = saved as Record<string, unknown>;
    const level = (key: "music" | "effects") =>
      typeof state[key] === "number" && Number.isFinite(state[key])
        ? clamp01(state[key])
        : DEFAULT_PREFS[key];
    return {
      muted: state.muted === true,
      music: level("music"),
      effects: level("effects"),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export interface Song {
  id: string;
  title: string;
  /** Where the file is served from, relative to the site root, for example `music/fuse-volley/beach-bounce.mp3`. */
  path: string;
}
export interface ToneOptions {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  /** The frequency at the end as a multiple of the start; 1 holds the pitch. */
  slide?: number;
  /** Seconds from now. */
  delay?: number;
}
export interface NoiseOptions {
  duration: number;
  volume?: number;
  /** Low-pass cutoff in Hz. */
  cutoff?: number;
  delay?: number;
}
export interface DuckOptions {
  /** How much of the music stays while ducked, 0 to 1. */
  keep?: number;
  /** Milliseconds held down before it swells back. */
  hold?: number;
}

export interface GameAudio {
  readonly prefs: Readonly<AudioPrefs>;
  /** True for `?mute` pages: nothing opens, nothing is stored, controls are disabled. */
  readonly forcedMute: boolean;
  /** Whether sound can come out right now. */
  readonly audible: boolean;
  /** The browser lets a page make sound only after a key or a touch: call this from one. Cheap to repeat. */
  unlock(): void;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
  setVolume(which: "music" | "effects", level: number): void;
  tone(options: ToneOptions): void;
  noise(options: NoiseOptions): void;
  /** `notes` in Hz, one every `gap` ms. */
  jingle(
    notes: readonly number[],
    gap: number,
    options?: { type?: OscillatorType; volume?: number; duration?: number },
  ): void;
  /** Pulls the music down for a moment so an effect cuts through. */
  duck(options?: DuckOptions): void;
  /** Songs load only once the player is unlocked and music is audible, so game start never waits for them. */
  setSongs(songs: readonly Song[], baseUrl: string): void;
  readonly nowPlaying: Song | undefined;
  startMusic(): void;
  stopMusic(): void;
  nextSong(): void;
  /** Hear changes to the mute and the volumes (the controls and tests). Returns how to stop listening. */
  onChange(listener: () => void): () => void;
  /** Quiet while the tab is hidden, back when it returns. */
  setHidden(hidden: boolean): void;
}

export function createGameAudio(
  deps: GameAudioDependencies,
  options: { forceMute?: boolean } = {},
): GameAudio {
  const forcedMute = options.forceMute === true;
  const prefs = forcedMute ? { ...DEFAULT_PREFS } : readPrefs(deps.storage);
  const listeners = new Set<() => void>();
  let context: AudioLike | undefined,
    effects: GainLike | undefined,
    musicBus: GainLike | undefined,
    duckBus: GainLike | undefined,
    unlocked = false,
    hidden = false,
    wantMusic = false,
    songs: readonly Song[] = [],
    baseUrl = "/",
    songIndex = 0,
    song: Song | undefined,
    element: MusicElement | undefined,
    duckToken = 0,
    failures = 0;

  const ensure = (): AudioLike | undefined => {
    if (forcedMute) return undefined;
    if (!context) {
      context = deps.open();
      if (context) {
        effects = context.createGain();
        musicBus = context.createGain();
        duckBus = context.createGain();
        duckBus.connect(musicBus);
        musicBus.connect(context.destination);
        effects.connect(context.destination);
        applyLevels();
      }
    }
    return context;
  };
  const audible = () =>
    !forcedMute &&
    !prefs.muted &&
    !hidden &&
    unlocked &&
    context?.state === "running";
  const applyLevels = () => {
    if (!context || !effects || !musicBus) return;
    const at = context.currentTime;
    const silent = prefs.muted ? 0 : 1;
    effects.gain.setValueAtTime(prefs.effects * silent, at);
    musicBus.gain.setValueAtTime(prefs.music * 0.7 * silent, at);
  };
  const changed = () => {
    applyLevels();
    for (const listener of [...listeners]) listener();
  };
  const save = () => {
    if (forcedMute) return;
    try {
      deps.storage.setItem(AUDIO_KEY, JSON.stringify(prefs));
    } catch {
      // A store that refuses writes only costs the remembered choice.
    }
  };

  const loadSong = () => {
    const audio = ensure();
    if (!audio || !musicBus || !duckBus || songs.length === 0) return;
    const next = songs[songIndex % songs.length]!;
    if (!element) {
      element = deps.createElement();
      element.preload = "none";
      audio.createMediaElementSource(element).connect(duckBus);
    }
    song = next;
    element.loop = songs.length === 1;
    element.src = baseUrl + next.path;
    element.onended = () => {
      songIndex = (songIndex + 1) % songs.length;
      loadSong();
      playSong();
    };
    // A song that will not load is skipped once, then the music stays quiet rather than looping on errors.
    element.onerror = () => {
      if (element && failures++ < songs.length - 1) {
        songIndex = (songIndex + 1) % songs.length;
        loadSong();
        playSong();
      }
    };
  };
  const playSong = () => {
    if (!element || !audible() || !wantMusic) return;
    void element.play().then(
      () => {
        failures = 0;
      },
      () => {
        // Blocked or missing: the next key or touch tries again through unlock().
      },
    );
  };
  const syncMusic = () => {
    if (!wantMusic || prefs.music <= 0) {
      element?.pause();
      return;
    }
    if (!audible()) {
      element?.pause();
      return;
    }
    if (!element) loadSong();
    playSong();
  };

  const output = (): GainLike | undefined => (audible() ? effects : undefined);
  const self: GameAudio = {
    prefs,
    forcedMute,
    get audible() {
      return audible();
    },
    unlock() {
      if (forcedMute) return;
      const audio = ensure();
      if (!audio) return;
      unlocked = true;
      if (audio.state === "running") {
        syncMusic();
        return;
      }
      // iOS only lets a song start inside the gesture itself, so it starts now; the bus stays silent until the
      // context resumes.
      if (wantMusic && prefs.music > 0 && !prefs.muted && !hidden) {
        if (!element) loadSong();
        void element?.play().catch(() => undefined);
      }
      void audio.resume().then(
        () => syncMusic(),
        () => {
          // Resume is refused until a real gesture; the next one retries.
        },
      );
    },
    setMuted(muted) {
      if (forcedMute || prefs.muted === muted) return;
      prefs.muted = muted;
      save();
      changed();
      syncMusic();
    },
    toggleMuted() {
      self.setMuted(!prefs.muted);
    },
    setVolume(which, level) {
      if (forcedMute) return;
      prefs[which] = clamp01(level);
      // Moving a slider is a choice to hear it.
      if (prefs.muted && prefs[which] > 0) prefs.muted = false;
      save();
      changed();
      syncMusic();
    },
    tone({
      frequency,
      duration,
      type = "sine",
      volume = 0.1,
      slide = 1,
      delay = 0,
    }) {
      const out = output();
      if (!context || !out) return;
      const osc = context.createOscillator(),
        gain = context.createGain(),
        at = context.currentTime + delay;
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, at);
      if (slide !== 1)
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(30, frequency * slide),
          at + duration,
        );
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume),
        at + 0.008,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(gain);
      gain.connect(out);
      osc.start(at);
      osc.stop(at + duration + 0.02);
    },
    noise({ duration, volume = 0.1, cutoff = 3000, delay = 0 }) {
      const out = output();
      if (!context || !out) return;
      const length = Math.max(1, Math.floor(context.sampleRate * duration)),
        buffer = context.createBuffer(1, length, context.sampleRate),
        data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++)
        data[i] = (deps.random() * 2 - 1) * (1 - i / length);
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain();
      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      gain.gain.value = volume;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      source.start(context.currentTime + delay);
    },
    jingle(
      notes,
      gap,
      { type = "square", volume = 0.06, duration = 0.18 } = {},
    ) {
      notes.forEach((frequency, i) =>
        deps.later(
          () => self.tone({ frequency, duration, type, volume }),
          i * gap,
        ),
      );
    },
    duck({ keep = 0.35, hold = 450 } = {}) {
      if (!context || !duckBus || !audible()) return;
      const token = ++duckToken,
        at = context.currentTime;
      duckBus.gain.cancelScheduledValues(at);
      duckBus.gain.setValueAtTime(duckBus.gain.value, at);
      duckBus.gain.linearRampToValueAtTime(clamp01(keep), at + 0.04);
      deps.later(() => {
        if (token !== duckToken || !context || !duckBus) return;
        const back = context.currentTime;
        duckBus.gain.cancelScheduledValues(back);
        duckBus.gain.setValueAtTime(clamp01(keep), back);
        duckBus.gain.linearRampToValueAtTime(1, back + 0.6);
      }, hold);
    },
    setSongs(next, base) {
      songs = next;
      baseUrl = base.endsWith("/") ? base : `${base}/`;
      songIndex = songs.length ? Math.floor(deps.random() * songs.length) : 0;
      song = undefined;
      failures = 0;
      if (element) {
        element.pause();
        element.onended = element.onerror = null;
        element = undefined;
      }
      syncMusic();
    },
    get nowPlaying() {
      return song;
    },
    startMusic() {
      wantMusic = true;
      syncMusic();
    },
    stopMusic() {
      wantMusic = false;
      element?.pause();
    },
    nextSong() {
      if (songs.length === 0) return;
      songIndex = (songIndex + 1) % songs.length;
      failures = 0;
      if (element) {
        element.pause();
        loadSong();
      }
      syncMusic();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setHidden(value) {
      if (hidden === value) return;
      hidden = value;
      // Pause the song itself too: not every browser stops a media element when its context is suspended.
      if (value) element?.pause();
      if (context && unlocked) {
        if (value) void context.suspend().catch(() => undefined);
        else
          void context.resume().then(
            () => syncMusic(),
            () => undefined,
          );
      }
    },
  };
  return self;
}

/** The browser's audio, an element per song, real timers and `Math.random`. */
export function browserAudioDependencies(
  storage: SafeStorage,
): GameAudioDependencies {
  return {
    open: () =>
      typeof AudioContext === "undefined" ? undefined : new AudioContext(),
    createElement: () => {
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      return audio;
    },
    later: (run, ms) => void setTimeout(run, ms),
    random: () => Math.random(),
    storage,
  };
}

/**
 * Starts sound from the first key, touch or pad press, and follows the tab hiding. Returns how to take the
 * listeners off again.
 */
export function bindAudioInput(
  audio: GameAudio,
  target: Document,
  win: Window,
): () => void {
  const unlock = () => audio.unlock();
  const visibility = () => audio.setHidden(target.hidden);
  const key = (event: KeyboardEvent) => {
    unlock();
    if (
      event.code === "KeyM" &&
      !event.repeat &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !(
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
    )
      audio.toggleMuted();
  };
  target.addEventListener("keydown", key);
  target.addEventListener("pointerdown", unlock, { passive: true });
  target.addEventListener("touchend", unlock, { passive: true });
  // Some browsers only count the release of a press as the gesture that allows sound.
  target.addEventListener("click", unlock, { passive: true });
  target.addEventListener("visibilitychange", visibility);
  win.addEventListener("gamepadconnected", unlock);
  return () => {
    target.removeEventListener("keydown", key);
    target.removeEventListener("pointerdown", unlock);
    target.removeEventListener("touchend", unlock);
    target.removeEventListener("click", unlock);
    target.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("gamepadconnected", unlock);
  };
}

/**
 * A small sound button: tap to mute or unmute, with the two volumes in a panel beside it. It belongs in a header
 * next to the portal button; `M` toggles the mute from a keyboard. The same element works on the TV and on phones.
 */
export function createAudioControl(doc: Document, audio: GameAudio) {
  const element = doc.createElement("div"),
    button = doc.createElement("button"),
    panel = doc.createElement("div"),
    more = doc.createElement("button");
  element.className = "fui-audio";
  button.type = more.type = "button";
  button.className = "fui-audio-toggle";
  more.className = "fui-audio-more";
  more.textContent = "⋯";
  more.setAttribute("aria-label", "Sound settings");
  more.setAttribute("aria-expanded", "false");
  panel.className = "fui-audio-panel";
  panel.hidden = true;
  const slider = (which: "music" | "effects", label: string) => {
    const row = doc.createElement("label"),
      input = doc.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(Math.round(audio.prefs[which] * 100));
    input.disabled = audio.forcedMute;
    input.oninput = () => audio.setVolume(which, Number(input.value) / 100);
    row.append(`${label} `, input);
    return { row, input, which };
  };
  const sliders = [slider("music", "Music"), slider("effects", "Effects")];
  panel.append(...sliders.map((entry) => entry.row));
  element.append(button, more, panel);
  const render = () => {
    const off = audio.forcedMute || audio.prefs.muted;
    button.textContent = off ? "🔇" : "🔊";
    button.setAttribute("aria-pressed", String(off));
    button.setAttribute(
      "aria-label",
      audio.forcedMute
        ? "Sound off for this preview"
        : off
          ? "Turn sound on"
          : "Turn sound off",
    );
    button.title = audio.forcedMute ? "Muted by ?mute" : "Sound (M)";
    button.disabled = audio.forcedMute;
    more.disabled = audio.forcedMute;
    for (const entry of sliders)
      entry.input.value = String(Math.round(audio.prefs[entry.which] * 100));
  };
  button.onclick = () => audio.toggleMuted();
  more.onclick = () => {
    panel.hidden = !panel.hidden;
    more.setAttribute("aria-expanded", String(!panel.hidden));
  };
  const stop = audio.onChange(render);
  render();
  return {
    element,
    destroy() {
      stop();
      button.onclick = more.onclick = null;
      for (const entry of sliders) entry.input.oninput = null;
    },
  };
}
