import type { SystemSoundEvent } from "./soundEvents";
import { MemorySoundPrefsStore } from "./soundPrefsStore";
import type {
  GestureSource,
  SoundAudioContext,
  SoundBuffer,
  SoundBufferSource,
  SoundGainNode,
  SoundNode,
} from "./soundService";
import {
  documentGestures,
  SilentSoundService,
  WebAudioSoundService,
} from "./soundService";
import type { SynthRenderer } from "./synth";

class FakeBuffer implements SoundBuffer {
  data: Float32Array = new Float32Array(0);
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(source: Float32Array): void {
    this.data = source;
  }
}

class FakeSource implements SoundBufferSource {
  buffer: SoundBuffer | null = null;
  onended: ((event: Event) => void) | null = null;
  connectedTo: SoundNode | undefined;
  started = false;
  stopped = 0;
  connect(destination: SoundNode): void {
    this.connectedTo = destination;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped += 1;
    if (this.stopped > 1) throw new Error("already stopped");
  }
  /** The browser reports the end of playback. */
  end(): void {
    this.onended?.(new Event("ended"));
  }
}

class FakeGain implements SoundGainNode {
  gain = { value: 1 };
  connectedTo: SoundNode | undefined;
  connect(destination: SoundNode): void {
    this.connectedTo = destination;
  }
}

class FakeAudioContext implements SoundAudioContext {
  state: AudioContextState = "suspended";
  readonly sampleRate = 8000;
  readonly destination: SoundNode = { name: "speakers" };
  resumed = 0;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly buffers: FakeBuffer[] = [];
  resume(): Promise<void> {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }
  createBuffer(
    _channels: number,
    length: number,
    sampleRate: number,
  ): SoundBuffer {
    const buffer = new FakeBuffer(length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource(): SoundBufferSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain(): SoundGainNode {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

class ManualGestures implements GestureSource {
  private listener: (() => void) | undefined;
  subscribe(onGesture: () => void): () => void {
    this.listener = onGesture;
    return () => {
      this.listener = undefined;
    };
  }
  click(): void {
    this.listener?.();
  }
}

const renderer: SynthRenderer = (sampleRate) =>
  new Float32Array(sampleRate).fill(0.5);

function setup(options: { muted?: boolean; noAudio?: boolean } = {}) {
  const context = new FakeAudioContext();
  const gestures = new ManualGestures();
  const prefs = new MemorySoundPrefsStore();
  const loadSynth = vi.fn(() => Promise.resolve(renderer));
  const createContext = vi.fn(() => (options.noAudio ? undefined : context));
  const service = new WebAudioSoundService({
    createContext,
    prefs,
    muted: options.muted ?? false,
    loadSynth,
    gestures,
  });
  return { service, context, gestures, prefs, loadSynth, createContext };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe(WebAudioSoundService.name, () => {
  it("creates the audio graph on first play after a gesture, rendering each sound once", async () => {
    const { service, context, gestures, loadSynth, createContext } = setup();
    expect(service.isUnlocked).toBe(false);
    gestures.click();
    expect(service.isUnlocked).toBe(true);
    expect(createContext).not.toHaveBeenCalled();

    const handle = service.play("ding");
    expect(handle.audible).toBe(true);
    await flush();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(context.resumed).toBe(1);
    expect(loadSynth).toHaveBeenCalledWith("ding");
    const [source] = context.sources;
    expect(source?.started).toBe(true);
    expect(source?.buffer).toBe(context.buffers[0]);
    expect(context.buffers[0]?.data).toHaveLength(8000);
    expect(source?.connectedTo).toBe(context.gains[0]);
    expect(context.gains[0]?.connectedTo).toBe(context.destination);
    expect(context.gains[0]?.gain.value).toBe(0.7);

    service.play("ding");
    await flush();
    expect(loadSynth).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(2);

    let ended = false;
    void handle.finished.then(() => {
      ended = true;
    });
    source?.end();
    await flush();
    expect(ended).toBe(true);
  });

  it("drops sounds asked for before the first gesture, except the start-up chime, which waits for it", async () => {
    const { service, context, gestures } = setup();
    service.setEvent("startup", true);
    const dropped = service.play("floppy");
    expect(dropped.audible).toBe(false);
    const startup = service.play("startup");
    expect(startup.audible).toBe(true);
    await flush();
    expect(context.sources).toHaveLength(0);
    gestures.click();
    await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.gains[0]?.gain.value).toBe(0.8);
  });

  it("keeps the start-up chime silent by default, even after the first gesture", async () => {
    const { service, context, gestures } = setup();
    expect(service.isEnabled("startup")).toBe(false);
    expect(service.play("startup").audible).toBe(false);
    gestures.click();
    await flush();
    expect(context.sources).toHaveLength(0);
    expect(service.isEnabled("ding")).toBe(true);
  });

  it("a deferred sound can be stopped before it ever starts", async () => {
    const { service, context, gestures } = setup();
    service.setEvent("startup", true);
    const startup = service.play("startup");
    startup.stop();
    await expect(startup.finished).resolves.toBeUndefined();
    gestures.click();
    await flush();
    expect(context.sources).toHaveLength(0);
  });

  it("stop cuts a playing sound and tolerates a second stop and the browser's ended event", async () => {
    const { service, context, gestures } = setup();
    gestures.click();
    const modem = service.play("modem");
    await flush();
    modem.stop();
    modem.stop();
    expect(context.sources[0]?.stopped).toBe(1);
    await expect(modem.finished).resolves.toBeUndefined();
    context.sources[0]?.end();
    service.stopAll();
  });

  it("stopping before the synthesiser has loaded never starts the source", async () => {
    const { service, context, gestures } = setup();
    gestures.click();
    const handle = service.play("modem");
    handle.stop();
    await flush();
    expect(context.sources).toHaveLength(0);
  });

  it("honours ?mute, the master switch and the event toggles; force bypasses only the toggle", async () => {
    const muted = setup({ muted: true });
    muted.gestures.click();
    expect(muted.service.muted).toBe(true);
    expect(muted.service.isEnabled("ding")).toBe(false);
    expect(muted.service.play("ding", { force: true }).audible).toBe(false);

    const { service, context, gestures } = setup();
    gestures.click();
    service.setEvent("ding", false);
    expect(service.isEnabled("ding")).toBe(false);
    expect(service.isEnabled("error")).toBe(true);
    expect(service.play("ding").audible).toBe(false);
    expect(service.play("ding", { force: true }).audible).toBe(true);
    service.setMaster(false);
    expect(service.play("error").audible).toBe(false);
    expect(service.play("error", { force: true }).audible).toBe(false);
    service.setMaster(true);
    expect(service.play("error").audible).toBe(true);
    await flush();
    expect(context.sources.filter((source) => source.started)).toHaveLength(2);
  });

  it("switching the master or an event off stops what is sounding", async () => {
    const { service, context, gestures } = setup();
    gestures.click();
    service.play("modem");
    service.play("floppy");
    await flush();
    service.setEvent("modem", false);
    expect(context.sources[0]?.stopped).toBe(1);
    expect(context.sources[1]?.stopped).toBe(0);
    service.setMaster(false);
    expect(context.sources[1]?.stopped).toBe(1);
  });

  it("persists preferences and notifies subscribers", () => {
    const { service, prefs } = setup();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    service.setEvent("floppy", false);
    expect(prefs.get()).toEqual({ master: true, events: { floppy: false } });
    expect(service.prefs()).toBe(service.prefs());
    service.setMaster(false);
    expect(prefs.get().master).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    service.setMaster(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is quiet without Web Audio or when a synthesiser fails to load", async () => {
    const silent = setup({ noAudio: true });
    silent.gestures.click();
    const handle = silent.service.play("ding");
    await expect(handle.finished).resolves.toBeUndefined();

    const { service, context, gestures, loadSynth } = setup();
    gestures.click();
    loadSynth.mockRejectedValueOnce(new Error("offline"));
    await expect(service.play("ding").finished).resolves.toBeUndefined();
    expect(context.sources).toHaveLength(0);
    // The failed load is forgotten, so the next play tries again.
    service.play("ding");
    await flush();
    expect(context.sources).toHaveLength(1);
  });

  it("does not resume a context that is already running", async () => {
    const { service, context, gestures } = setup();
    context.state = "running";
    gestures.click();
    service.play("ding");
    await flush();
    expect(context.resumed).toBe(0);
  });
});

describe(SilentSoundService.name, () => {
  it("keeps preferences but never sounds", () => {
    const service = new SilentSoundService();
    const listener = vi.fn();
    service.subscribe(listener);
    expect(service.muted).toBe(false);
    expect(service.play("modem").audible).toBe(false);
    service.setEvent("modem", false);
    service.setMaster(false);
    service.stopAll();
    expect(service.prefs()).toEqual({
      master: false,
      events: { modem: false },
    });
    expect(service.isEnabled("ding")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(new SilentSoundService(true).muted).toBe(true);
  });
});

describe(documentGestures.name, () => {
  it("fires once on the first pointer, key or touch and then unsubscribes", () => {
    const target = new EventTarget();
    const onGesture = vi.fn();
    documentGestures(target).subscribe(onGesture);
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("pointerdown"));
    expect(onGesture).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    const unsubscribe = documentGestures(target).subscribe(second);
    unsubscribe();
    target.dispatchEvent(new Event("touchend"));
    expect(second).not.toHaveBeenCalled();
  });
});

/** A context that can decode recordings: each decode is one 2.5 s buffer, or a refusal for bytes that are not audio. */
class DecodingAudioContext extends FakeAudioContext {
  readonly decoded: ArrayBuffer[] = [];
  decodeAudioData(data: ArrayBuffer): Promise<SoundBuffer> {
    if (data.byteLength === 0)
      return Promise.reject(new Error("EncodingError"));
    this.decoded.push(data);
    const buffer = new FakeBuffer(20000, this.sampleRate);
    this.buffers.push(buffer);
    return Promise.resolve(buffer);
  }
}

describe("WebAudioSoundService with recordings", () => {
  function setupRecorded(
    loadRecording: (
      event: SystemSoundEvent,
    ) => Promise<ArrayBuffer | undefined>,
    context: FakeAudioContext = new DecodingAudioContext(),
  ) {
    const gestures = new ManualGestures();
    const loadSynth = vi.fn(() => Promise.resolve(renderer));
    const load = vi.fn(loadRecording);
    const service = new WebAudioSoundService({
      createContext: () => context,
      prefs: new MemorySoundPrefsStore(),
      muted: false,
      loadSynth,
      loadRecording: load,
      gestures,
    });
    gestures.click();
    return { service, context, loadSynth, load };
  }

  it("plays the decoded recording instead of the synthesiser, loading it once", async () => {
    const clip = new ArrayBuffer(8);
    const { service, context, loadSynth, load } = setupRecorded((event) =>
      Promise.resolve(event === "floppy" ? clip : undefined),
    );
    service.play("floppy");
    await flush();
    service.play("floppy");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect((context as DecodingAudioContext).decoded).toEqual([clip]);
    expect(loadSynth).not.toHaveBeenCalledWith("floppy");
    expect(context.sources[0]?.buffer?.duration).toBe(2.5);
    expect(context.sources).toHaveLength(2);
    // An event without a recording is synthesised as before.
    service.play("ding");
    await flush();
    expect(loadSynth).toHaveBeenCalledWith("ding");
  });

  it("falls back to the synthesiser when the clip cannot be fetched or decoded, or the context cannot decode", async () => {
    const failing = setupRecorded(() => Promise.reject(new Error("offline")));
    failing.service.play("seek");
    await flush();
    expect(failing.loadSynth).toHaveBeenCalledWith("seek");
    expect(failing.context.sources).toHaveLength(1);

    const garbled = setupRecorded(() => Promise.resolve(new ArrayBuffer(0)));
    garbled.service.play("seek");
    await flush();
    expect(garbled.loadSynth).toHaveBeenCalledWith("seek");

    const plain = setupRecorded(
      () => Promise.resolve(new ArrayBuffer(8)),
      new FakeAudioContext(),
    );
    plain.service.play("seek");
    await flush();
    expect(plain.load).not.toHaveBeenCalled();
    expect(plain.loadSynth).toHaveBeenCalledWith("seek");
  });
});
