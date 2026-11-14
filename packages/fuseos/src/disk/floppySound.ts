/**
 * The noise a 3½" drive makes when Explorer opens A:: a head seek, a few track steps, a spin.
 * Synthesized (filtered noise bursts over a motor hum) so no audio asset ships; it is a few hundred
 * bytes of code and plays through whatever AudioContext the page may create.
 */

export const FLOPPY_SEEK_MS = 1400;

/** The slice of the Web Audio API the seek uses, so a test can hand in a silent one. */
export interface SeekParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface SeekNode {
  connect(node: SeekNode): SeekNode;
}

export interface SeekBuffer {
  getChannelData(channel: number): Float32Array;
}

export interface SeekAudioContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: SeekNode;
  createGain(): SeekNode & { gain: SeekParam };
  createOscillator(): SeekNode & {
    type: OscillatorType;
    frequency: SeekParam;
    start(when: number): void;
    stop(when: number): void;
  };
  createBiquadFilter(): SeekNode & {
    type: BiquadFilterType;
    frequency: SeekParam;
    Q: SeekParam;
  };
  createBufferSource(): SeekNode & {
    buffer: SeekBuffer | null;
    start(when: number): void;
  };
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): SeekBuffer;
  close(): Promise<void>;
}

type AudioContextFactory = () => SeekAudioContext | undefined;

const defaultFactory: AudioContextFactory = () =>
  typeof AudioContext === "function" ? new AudioContext() : undefined;

/** Plays the seek and resolves when it is over; silently resolves after the delay where audio is unavailable. */
export function createFloppySeek(
  createContext: AudioContextFactory = defaultFactory,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): () => Promise<void> {
  return async () => {
    let context: SeekAudioContext | undefined;
    try {
      context = createContext();
    } catch {
      // Audio is a garnish: a browser that refuses an AudioContext still gets the delay.
      context = undefined;
    }
    if (context) {
      try {
        playSeek(context);
      } catch {
        // Same: a half-initialised context must not break opening the drive.
      }
    }
    await wait(FLOPPY_SEEK_MS);
    if (context) {
      void context.close().catch(() => undefined);
    }
  };
}

function noiseBuffer(context: SeekAudioContext, seconds: number): SeekBuffer {
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * seconds),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let seed = 0x2545f491;
  for (let index = 0; index < data.length; index += 1) {
    // A deterministic xorshift keeps the seek identical every time, like a real drive's.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[index] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

function playSeek(context: SeekAudioContext): void {
  const start = context.currentTime;
  const master = context.createGain();
  master.gain.value = 0.25;
  master.connect(context.destination);

  // Motor hum for the whole seek.
  const hum = context.createOscillator();
  hum.type = "sawtooth";
  hum.frequency.value = 60;
  const humGain = context.createGain();
  humGain.gain.setValueAtTime(0.0001, start);
  humGain.gain.exponentialRampToValueAtTime(0.08, start + 0.05);
  humGain.gain.exponentialRampToValueAtTime(0.0001, start + 1.35);
  hum.connect(humGain).connect(master);
  hum.start(start);
  hum.stop(start + 1.4);

  // Head steps: short bursts of band-passed noise, closing in as the head settles.
  const noise = noiseBuffer(context, 0.06);
  const stepTimes = [0.05, 0.14, 0.23, 0.32, 0.41, 0.6, 0.75, 0.9, 1.1];
  for (const offset of stepTimes) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800 + offset * 600;
    filter.Q.value = 2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.9, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.05);
    source.connect(filter).connect(gain).connect(master);
    source.start(start + offset);
  }
}
