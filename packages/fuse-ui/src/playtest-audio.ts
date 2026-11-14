export interface WavSegment {
  sequence: number;
  startMs: number;
  endMs: number;
  blob: Blob;
}
/** Independently complete PCM16 mono WAV; offsets use the same rounded duration the server validates. */
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
  offsetMs(): number {
    return this.elapsed + Math.round((this.count * 1000) / this.sampleRate);
  }
  durationMs(): number {
    return this.emitted + (this.count * 1000) / this.sampleRate;
  }
  flush(): void {
    if (!this.count) return;
    const startMs = this.elapsed;
    this.elapsed += Math.round((this.count * 1000) / this.sampleRate);
    this.emitted += (this.count * 1000) / this.sampleRate;
    const chunk = {
      sequence: this.sequence++,
      startMs,
      endMs: this.elapsed,
      blob: pcmWav(this.samples.slice(0, this.count), this.sampleRate),
    };
    this.count = 0;
    this.emit(chunk);
  }
}

export interface MicrophoneCapture {
  offsetMs(): number;
  stop(): Promise<void>;
}
export interface MicrophoneDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
  createNode(context: AudioContext, name: string): AudioWorkletNode;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  schedule(run: () => void, ms: number): () => void;
}
// Batch to the page instead of posting each 128-sample render quantum. Output is silence; the microphone is never monitored.
const PROCESSOR = `class FusePlaytestPcm extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.count = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') { this.flush(); this.port.postMessage('flushed'); } }; }
  flush() { if (this.count) { const block = this.buffer.slice(0, this.count); this.port.postMessage(block, [block.buffer]); this.count = 0; } }
  process(inputs) { const channels = inputs[0]; if (channels && channels.length) {
    for (let i = 0; i < channels[0].length; i++) { let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.buffer[this.count++] = sample / channels.length;
      if (this.count === this.buffer.length) this.flush(); } } return true; }
} registerProcessor('fuse-playtest-pcm', FusePlaytestPcm);`;

export async function startPcmMicrophone(
  dependencies: MicrophoneDependencies,
  emit: (chunk: WavSegment) => void,
  stopped: (reason: string) => void,
): Promise<MicrophoneCapture> {
  const stream = await dependencies.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
    video: false,
  });
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let url: string | undefined;
  try {
    context = dependencies.createContext();
    const chunks = new PcmChunks(context.sampleRate, emit);
    url = dependencies.createUrl(
      new Blob([PROCESSOR], { type: "text/javascript" }),
    );
    await context.audioWorklet.addModule(url);
    dependencies.revokeUrl(url);
    url = undefined;
    source = context.createMediaStreamSource(stream);
    node = dependencies.createNode(context, "fuse-playtest-pcm");
    let flushed: (() => void) | undefined;
    let stopping = false;
    let stopPromise: Promise<void> | undefined;
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "flushed") flushed?.();
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
    source.connect(node);
    node.connect(context.destination);
    await context.resume();
    const activeNode = node,
      activeSource = source;
    return {
      offsetMs: () => chunks.offsetMs(),
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
    if (url) dependencies.revokeUrl(url);
    source?.disconnect();
    node?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    await context?.close().catch(() => undefined);
    throw error;
  }
}
