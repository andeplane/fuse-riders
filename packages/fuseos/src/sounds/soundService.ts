import type { SystemSoundEvent } from "./soundEvents";
import { soundEventInfo } from "./soundEvents";
import type { SoundPrefs, SoundPrefsStore } from "./soundPrefsStore";
import { MemorySoundPrefsStore, soundEnabled } from "./soundPrefsStore";
import type { SynthRenderer } from "./synth";

/**
 * The slice of Web Audio the service uses, so a test can hand in a fake and the desktop an
 * `AudioContext` (or an `OfflineAudioContext`, which is how the handshake is verified headless).
 */
export type SoundNode = object;

export interface SoundGainNode {
  gain: { value: number };
  connect(destination: SoundNode): unknown;
}

export interface SoundBuffer {
  copyToChannel(source: Float32Array, channelNumber: number): void;
  readonly duration: number;
}

export interface SoundBufferSource {
  buffer: SoundBuffer | null;
  onended: ((event: Event) => void) | null;
  connect(destination: SoundNode): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface SoundAudioContext {
  readonly state: AudioContextState;
  readonly sampleRate: number;
  readonly destination: SoundNode;
  resume(): Promise<void>;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): SoundBuffer;
  createBufferSource(): SoundBufferSource;
  createGain(): SoundGainNode;
  /** Decodes a recorded clip (MP3); absent on a context that cannot, which then keeps to the synthesiser. */
  decodeAudioData?(data: ArrayBuffer): Promise<SoundBuffer>;
}

export type SoundPlayOptions = {
  /** Play even when the event's own toggle is off: the applet's preview button. The master switch and ?mute still win. */
  force?: boolean;
};

export interface SoundHandle {
  readonly event: SystemSoundEvent;
  /** False when nothing will be heard: muted, switched off, or no gesture has unlocked audio yet. */
  readonly audible: boolean;
  /** Cuts the sound short (the modem's Cancel). Harmless when it already ended or never started. */
  stop(): void;
  /** Resolves when the sound ends, is stopped, or was never going to play. */
  readonly finished: Promise<void>;
}

/**
 * What the desktop plays through. `play` never throws and never blocks: the synthesiser for a
 * sound is imported and rendered on its first use, and the audio graph is only created after
 * the browser has seen a click or key press (autoplay policy), so a sound asked for before that
 * is dropped, or held until then when its catalogue entry says so (the start-up chime).
 */
export interface SoundService {
  /** The OS was opened with `?mute`: nothing sounds, whatever the preferences say. */
  readonly muted: boolean;
  play(event: SystemSoundEvent, options?: SoundPlayOptions): SoundHandle;
  /** Stops everything that is sounding or waiting for the first gesture. */
  stopAll(): void;
  /** The master switch and the event's toggle, and not muted. */
  isEnabled(event: SystemSoundEvent): boolean;
  prefs(): SoundPrefs;
  setMaster(on: boolean): void;
  setEvent(event: SystemSoundEvent, on: boolean): void;
  /** Called after every preference change. */
  subscribe(listener: () => void): () => void;
}

/** Where the first user gesture comes from; the browser's document in production. */
export type GestureSource = {
  /** Calls `onGesture` once, on the first click, key press or touch; returns an unsubscribe. */
  subscribe(onGesture: () => void): () => void;
};

const GESTURE_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

export function documentGestures(target: EventTarget): GestureSource {
  return {
    subscribe(onGesture) {
      const handler = () => {
        unsubscribe();
        onGesture();
      };
      const unsubscribe = () => {
        for (const type of GESTURE_EVENTS)
          target.removeEventListener(type, handler);
      };
      for (const type of GESTURE_EVENTS)
        target.addEventListener(type, handler, { passive: true });
      return unsubscribe;
    },
  };
}

function silentHandle(event: SystemSoundEvent): SoundHandle {
  return {
    event,
    audible: false,
    stop: () => undefined,
    finished: Promise.resolve(),
  };
}

/** Reads the store once and keeps the current value, so `get` is referentially stable between changes (useSyncExternalStore needs that). */
class PrefsHolder {
  private readonly listeners = new Set<() => void>();
  private current: SoundPrefs;

  constructor(private readonly store: SoundPrefsStore) {
    this.current = store.get();
  }

  get(): SoundPrefs {
    return this.current;
  }

  update(patch: (prefs: SoundPrefs) => SoundPrefs): void {
    this.current = patch(this.current);
    this.store.set(this.current);
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** A service that keeps preferences but never makes a sound: the default before `main.tsx` provides the real one, and the tests'. */
export class SilentSoundService implements SoundService {
  private readonly holder: PrefsHolder;

  constructor(
    readonly muted = false,
    store: SoundPrefsStore = new MemorySoundPrefsStore(),
  ) {
    this.holder = new PrefsHolder(store);
  }

  play(event: SystemSoundEvent): SoundHandle {
    return silentHandle(event);
  }

  stopAll(): void {
    // Nothing is ever sounding.
  }

  isEnabled(event: SystemSoundEvent): boolean {
    return !this.muted && soundEnabled(this.holder.get(), event);
  }

  prefs(): SoundPrefs {
    return this.holder.get();
  }

  setMaster(on: boolean): void {
    this.holder.update((prefs) => ({ ...prefs, master: on }));
  }

  setEvent(event: SystemSoundEvent, on: boolean): void {
    this.holder.update((prefs) => ({
      ...prefs,
      events: { ...prefs.events, [event]: on },
    }));
  }

  subscribe(listener: () => void): () => void {
    return this.holder.subscribe(listener);
  }
}

export type WebAudioSoundServiceDeps = {
  /** Makes the audio context on first use; undefined when the browser has no Web Audio. */
  createContext: () => SoundAudioContext | undefined;
  prefs: SoundPrefsStore;
  muted: boolean;
  /** Dynamic import of the synthesiser; `loadSynth` from `./synth`. */
  loadSynth: (event: SystemSoundEvent) => Promise<SynthRenderer>;
  /**
   * The bytes of a real recording for the event, fetched on its first play (`recordings.ts`); undefined when the
   * event has none. A recording that fails to load or decode falls back to the synthesiser.
   */
  loadRecording?: (event: SystemSoundEvent) => Promise<ArrayBuffer | undefined>;
  gestures: GestureSource;
};

type Playing = {
  event: SystemSoundEvent;
  stopped: boolean;
  source?: SoundBufferSource;
  resolve: () => void;
};

export class WebAudioSoundService implements SoundService {
  readonly muted: boolean;
  private readonly holder: PrefsHolder;
  private context: SoundAudioContext | undefined;
  private readonly buffers = new Map<SystemSoundEvent, Promise<SoundBuffer>>();
  private readonly active = new Set<Playing>();
  private deferred: Playing[] = [];
  private unlocked = false;

  constructor(private readonly deps: WebAudioSoundServiceDeps) {
    this.muted = deps.muted;
    this.holder = new PrefsHolder(deps.prefs);
    deps.gestures.subscribe(() => this.unlock());
  }

  /** True once a gesture has been seen; exposed for the tests and the applet's hint. */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  play(event: SystemSoundEvent, options: SoundPlayOptions = {}): SoundHandle {
    const prefs = this.holder.get();
    const allowed =
      !this.muted &&
      prefs.master &&
      (options.force || soundEnabled(prefs, event));
    if (!allowed) return silentHandle(event);
    let resolve: () => void = () => undefined;
    const finished = new Promise<void>((done) => {
      resolve = done;
    });
    const playing: Playing = { event, stopped: false, resolve };
    if (this.unlocked) {
      void this.start(playing);
    } else if (soundEventInfo(event).deferUntilUnlocked) {
      this.deferred.push(playing);
    } else {
      resolve();
      return silentHandle(event);
    }
    return {
      event,
      audible: true,
      finished,
      stop: () => this.stopOne(playing),
    };
  }

  stopAll(): void {
    for (const playing of [...this.active, ...this.deferred])
      this.stopOne(playing);
  }

  isEnabled(event: SystemSoundEvent): boolean {
    return !this.muted && soundEnabled(this.holder.get(), event);
  }

  prefs(): SoundPrefs {
    return this.holder.get();
  }

  setMaster(on: boolean): void {
    this.holder.update((prefs) => ({ ...prefs, master: on }));
    if (!on) this.stopAll();
  }

  setEvent(event: SystemSoundEvent, on: boolean): void {
    this.holder.update((prefs) => ({
      ...prefs,
      events: { ...prefs.events, [event]: on },
    }));
    if (!on)
      for (const playing of [...this.active, ...this.deferred])
        if (playing.event === event) this.stopOne(playing);
  }

  subscribe(listener: () => void): () => void {
    return this.holder.subscribe(listener);
  }

  private unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const waiting = this.deferred;
    this.deferred = [];
    for (const playing of waiting) void this.start(playing);
  }

  private stopOne(playing: Playing): void {
    if (playing.stopped) return;
    playing.stopped = true;
    this.deferred = this.deferred.filter((entry) => entry !== playing);
    this.active.delete(playing);
    try {
      playing.source?.stop();
    } catch {
      // Already ended; the browser throws for a second stop.
    }
    playing.resolve();
  }

  private ensureContext(): SoundAudioContext | undefined {
    this.context ??= this.deps.createContext();
    const context = this.context;
    if (context?.state === "suspended") context.resume().catch(() => undefined);
    return context;
  }

  private buffer(
    context: SoundAudioContext,
    event: SystemSoundEvent,
  ): Promise<SoundBuffer> {
    let pending = this.buffers.get(event);
    if (!pending) {
      pending = this.recorded(context, event).then(
        (recorded) => recorded ?? this.synthesised(context, event),
      );
      this.buffers.set(event, pending);
      pending.catch(() => this.buffers.delete(event));
    }
    return pending;
  }

  /** The event's real recording, decoded, or undefined to synthesise it instead. */
  private async recorded(
    context: SoundAudioContext,
    event: SystemSoundEvent,
  ): Promise<SoundBuffer | undefined> {
    if (!this.deps.loadRecording || !context.decodeAudioData) return undefined;
    try {
      const data = await this.deps.loadRecording(event);
      return data ? await context.decodeAudioData(data) : undefined;
    } catch {
      return undefined;
    }
  }

  private synthesised(
    context: SoundAudioContext,
    event: SystemSoundEvent,
  ): Promise<SoundBuffer> {
    return this.deps.loadSynth(event).then((render) => {
      const samples = render(context.sampleRate);
      const buffer = context.createBuffer(
        1,
        samples.length,
        context.sampleRate,
      );
      buffer.copyToChannel(samples, 0);
      return buffer;
    });
  }

  private async start(playing: Playing): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      playing.resolve();
      return;
    }
    let buffer: SoundBuffer;
    try {
      buffer = await this.buffer(context, playing.event);
    } catch {
      playing.resolve();
      return;
    }
    if (playing.stopped) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = soundEventInfo(playing.event).gain;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      this.active.delete(playing);
      playing.resolve();
    };
    playing.source = source;
    this.active.add(playing);
    source.start();
  }
}
