export interface WavSegment {
  sequence: number;
  startMs: number;
  endMs: number;
  blob: Blob;
  /** Frozen when samples enter this segment, never inferred during upload. */
  gameId?: string;
}
/** Independently complete PCM16 mono WAV; nonempty chunks occupy at least one timeline millisecond. */
export function pcmWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(
      44 + i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class PcmChunks {
  private readonly samples: Float32Array;
  private count = 0;
  private sequence = 0;
  private elapsed = 0;
  private emitted = 0;
  constructor(
    readonly sampleRate: number,
    private readonly emit: (chunk: WavSegment) => void,
    private gameId?: string,
  ) {
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96000
    )
      throw new Error("Microphone sample rate must be between 8 and 96 kHz.");
    this.samples = new Float32Array(sampleRate * 10);
  }
  push(block: Float32Array): void {
    let offset = 0;
    while (offset < block.length) {
      const take = Math.min(
        block.length - offset,
        this.samples.length - this.count,
      );
      this.samples.set(block.subarray(offset, offset + take), this.count);
      this.count += take;
      offset += take;
      if (this.count === this.samples.length) this.flush();
    }
  }
  setGame(gameId: string): void {
    if (gameId === this.gameId) return;
    this.flush();
    this.gameId = gameId;
  }
  offsetMs(): number {
    return (
      this.elapsed +
      (this.count
        ? Math.max(1, Math.round((this.count * 1000) / this.sampleRate))
        : 0)
    );
  }
  durationMs(): number {
    return this.emitted + (this.count * 1000) / this.sampleRate;
  }
  flush(): void {
    if (!this.count) return;
    const startMs = this.elapsed;
    // Match server WAV validation, including sub-ms tails at focus boundaries.
    this.elapsed += Math.max(
      1,
      Math.round((this.count * 1000) / this.sampleRate),
    );
    this.emitted += (this.count * 1000) / this.sampleRate;
    const chunk = {
      sequence: this.sequence++,
      startMs,
      endMs: this.elapsed,
      blob: pcmWav(this.samples.slice(0, this.count), this.sampleRate),
      ...(this.gameId ? { gameId: this.gameId } : {}),
    };
    this.count = 0;
    this.emit(chunk);
  }
}

export interface MicrophoneCapture {
  offsetMs(): number;
  setGame(gameId: string): void;
  stop(): Promise<void>;
}
export interface CaptureGameFocus {
  current(): string;
  subscribe(changed: (gameId: string) => void): () => void;
}
export interface CaptureSource {
  disconnect(): void;
}
export interface CaptureNode {
  port: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(message: unknown): void;
    close(): void;
  };
  onprocessorerror: ((event: ErrorEvent) => void) | null;
  disconnect(): void;
}
export interface CaptureContext {
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly audioWorklet: Pick<AudioWorklet, "addModule">;
  addEventListener(type: "statechange", listener: () => void): void;
  resume(): Promise<void>;
  close(): Promise<void>;
}
export interface CaptureStream {
  getAudioTracks(): readonly Pick<MediaStreamTrack, "addEventListener">[];
  getTracks(): readonly Pick<MediaStreamTrack, "stop">[];
}
export interface MicrophoneDependencies<
  Context extends CaptureContext = AudioContext,
  Node extends CaptureNode = AudioWorkletNode,
  Stream extends CaptureStream = MediaStream,
> {
  getUserMedia(constraints: MediaStreamConstraints): Promise<Stream>;
  createContext(): Context;
  createNode(context: Context, name: string): Node;
  connect(context: Context, node: Node, stream: Stream): CaptureSource;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  schedule(run: () => void, ms: number): () => void;
}
// Batch to the page instead of posting each 128-sample render quantum. Output is silence; the microphone is never monitored.
export const PCM_PROCESSOR = `class FusePlaytestPcm extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.count = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') { this.flush(); this.port.postMessage('flushed'); }
      else if (e.data?.type === 'game' && typeof e.data.gameId === 'string') {
        this.flush(); this.port.postMessage(e.data);
      }
    }; }
  flush() { if (this.count) { const block = this.buffer.slice(0, this.count); this.port.postMessage(block, [block.buffer]); this.count = 0; } }
  process(inputs) { const channels = inputs[0]; if (channels && channels.length) {
    for (let i = 0; i < channels[0].length; i++) { let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.buffer[this.count++] = sample / channels.length;
      if (this.count === this.buffer.length) this.flush(); } } return true; }
} registerProcessor('fuse-playtest-pcm', FusePlaytestPcm);`;

export async function startPcmMicrophone<
  Context extends CaptureContext,
  Node extends CaptureNode,
  Stream extends CaptureStream,
>(
  dependencies: MicrophoneDependencies<Context, Node, Stream>,
  emit: (chunk: WavSegment) => void,
  stopped: (reason: string) => void,
  gameFocus?: CaptureGameFocus,
): Promise<MicrophoneCapture> {
  const stream = await dependencies.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
    video: false,
  });
  let context: Context | undefined;
  let source: CaptureSource | undefined;
  let node: Node | undefined;
  let url: string | undefined;
  let unsubscribeFocus: (() => void) | undefined;
  try {
    context = dependencies.createContext();
    const chunks = new PcmChunks(
      context.sampleRate,
      emit,
      gameFocus?.current(),
    );
    url = dependencies.createUrl(
      new Blob([PCM_PROCESSOR], { type: "text/javascript" }),
    );
    await context.audioWorklet.addModule(url);
    dependencies.revokeUrl(url);
    url = undefined;
    node = dependencies.createNode(context, "fuse-playtest-pcm");
    let flushed: (() => void) | undefined;
    let stopping = false;
    let stopPromise: Promise<void> | undefined;
    let requestedGame = gameFocus?.current();
    const activeNode = node;
    const setGame = (gameId: string) => {
      // FIFO in both port directions drains the old game's worklet buffer
      // before the encoder changes attribution, including rapid switches.
      if (!stopPromise && gameId !== requestedGame) {
        requestedGame = gameId;
        activeNode.port.postMessage({ type: "game", gameId });
      }
    };
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "flushed") flushed?.();
      else if (
        event.data &&
        typeof event.data === "object" &&
        "type" in event.data &&
        event.data.type === "game" &&
        "gameId" in event.data &&
        typeof event.data.gameId === "string" &&
        !stopping
      )
        chunks.setGame(event.data.gameId);
      else if (event.data instanceof Float32Array && !stopping) {
        chunks.push(event.data);
        if (chunks.durationMs() >= 60 * 60 * 1000)
          stopped("Recording stopped at the one-hour limit.");
      }
    };
    node.onprocessorerror = () =>
      stopped("Microphone capture failed. Stop and start a new recording.");
    for (const track of stream.getAudioTracks())
      track.addEventListener("ended", () => {
        if (!stopping) stopped("Microphone disconnected. Recording stopped.");
      });
    const activeContext = context;
    context.addEventListener("statechange", () => {
      if (!stopping && activeContext.state === "suspended")
        stopped("Microphone was suspended. Recording stopped.");
    });
    // Permission/module loading can span desktop transitions. Read current
    // focus again before samples flow, then observe changes during resume.
    if (requestedGame) chunks.setGame(requestedGame);
    unsubscribeFocus = gameFocus?.subscribe(setGame);
    source = dependencies.connect(context, node, stream);
    await context.resume();
    const activeSource = source;
    return {
      offsetMs: () => chunks.offsetMs(),
      setGame,
      stop() {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => {
          // Drain the processor before disconnecting; this also captures the final partial WAV.
          await new Promise<void>((resolve) => {
            const cancel = dependencies.schedule(resolve, 1000);
            flushed = () => {
              cancel();
              resolve();
            };
            activeNode.port.postMessage("flush");
          });
          stopping = true;
          unsubscribeFocus?.();
          activeSource.disconnect();
          activeNode.disconnect();
          activeNode.port.close();
          for (const track of stream.getTracks()) track.stop();
          chunks.flush();
          await activeContext.close();
        })();
        return stopPromise;
      },
    };
  } catch (error) {
    unsubscribeFocus?.();
    if (url) dependencies.revokeUrl(url);
    source?.disconnect();
    node?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    await context?.close().catch(() => undefined);
    throw error;
  }
}
