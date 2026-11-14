/**
 * The browser side of the microphone: asks for it (only ever from a button), wires it into the page's own audio
 * context so its samples are counted on the clock the song is scheduled on, and hands them to the page in blocks.
 * Nothing is recorded, kept or sent anywhere: the samples go to `mic.ts`, which keeps eight seconds of two
 * envelopes and the numbers it reads from them.
 *
 * The browser's echo canceller, noise suppressor and gain control are asked off: they exist to remove exactly
 * what this listens for (the speaker's own sound) and they move sounds in time.
 */

const PROCESSOR = "fm-mic-tap";
/** Samples per block sent to the page: about 21 ms at 48 kHz. */
const BLOCK = 1024;
/** The worklet: copies the microphone's samples out with the frame they belong to. Runs on the audio thread. */
const WORKLET = `
class FmMicTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(${BLOCK});
    this.filled = 0;
    this.first = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    if (this.filled === 0) this.first = currentFrame;
    if (this.first + this.filled !== currentFrame || this.filled + channel.length > ${BLOCK}) {
      if (this.filled > 0) this.port.postMessage({ first: this.first, samples: this.block.slice(0, this.filled) });
      this.filled = 0;
      this.first = currentFrame;
    }
    this.block.set(channel, this.filled);
    this.filled += channel.length;
    return true;
  }
}
registerProcessor("${PROCESSOR}", FmMicTap);
`;

export interface MicDevice {
  id: string;
  label: string;
}
export interface MicCapture {
  /** The microphone's name as the browser gives it. */
  readonly label: string;
  /** The delay the browser reports for the microphone, ms, where it reports one. */
  readonly reportedMs: number | undefined;
  /** Which processing the browser left on although asked not to (it should be empty). */
  readonly processing: readonly string[];
  readonly sampleRate: number;
  stop(): void;
}

/** A name that says the microphone is a wireless headset's: late, narrow, and it cannot hear the keyboard. */
export const wirelessMic = (label: string): boolean =>
  /airpods|bluetooth|hands-?free|headset|buds|wireless/i.test(label);

/** The microphones the browser will name (names are empty until one has been allowed). */
export async function listMics(
  media: Pick<MediaDevices, "enumerateDevices">,
): Promise<MicDevice[]> {
  const devices = await media.enumerateDevices().catch(() => []);
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId)
    .map((device) => ({ id: device.deviceId, label: device.label }));
}

/**
 * The tap's module, loaded once per context: a processor's name can be registered only once, so a second
 * microphone on the same context (another device, off and on again) must not load it again. A load that failed
 * is tried again.
 */
const tapModules = new WeakMap<AudioContext, Promise<void>>();
function tapModule(context: AudioContext): Promise<void> {
  let loading = tapModules.get(context);
  if (!loading) {
    const url = URL.createObjectURL(
      new Blob([WORKLET], { type: "text/javascript" }),
    );
    loading = context.audioWorklet.addModule(url).finally(() => {
      URL.revokeObjectURL(url);
    });
    tapModules.set(context, loading);
    loading.catch(() => tapModules.delete(context));
  }
  return loading;
}

/**
 * Opens a microphone into `context` and calls `onSamples` with each block and the audio-clock frame of its first
 * sample. Rejects when the browser has no microphone to give, the player says no, or the context cannot run a
 * worklet.
 */
export async function openMic(
  context: AudioContext,
  media: Pick<MediaDevices, "getUserMedia">,
  onSamples: (samples: Float32Array, firstFrame: number) => void,
  deviceId?: string,
): Promise<MicCapture> {
  const stream = await media.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  });
  const close = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  try {
    await tapModule(context);
    const source = context.createMediaStreamSource(stream),
      tap = new AudioWorkletNode(context, PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
      }),
      // The tap makes no sound; a path to the output keeps every browser running it.
      silence = context.createGain();
    silence.gain.value = 0;
    tap.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { first?: unknown; samples?: unknown };
      if (
        typeof data?.first === "number" &&
        data.samples instanceof Float32Array
      )
        onSamples(data.samples, data.first);
    };
    source.connect(tap);
    tap.connect(silence);
    silence.connect(context.destination);
    const track = stream.getAudioTracks()[0],
      settings = track?.getSettings() ?? {},
      latency = (settings as { latency?: unknown }).latency;
    const processing = (
      ["echoCancellation", "noiseSuppression", "autoGainControl"] as const
    ).filter((name) => settings[name] === true);
    return {
      label: track?.label ?? "",
      reportedMs:
        typeof latency === "number" && Number.isFinite(latency) && latency > 0
          ? latency * 1000
          : undefined,
      processing,
      sampleRate: context.sampleRate,
      stop() {
        tap.port.onmessage = null;
        source.disconnect();
        tap.disconnect();
        silence.disconnect();
        close();
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
