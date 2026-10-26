import type { AudioBackend } from "./director.js";
import type { Bus, Sound, Voice } from "./sounds.js";

const MASTER = 0.55;
// prettier-ignore
const LEVELS: Readonly<Record<Bus, number>> = { effects: 0.8, alerts: 1, music: 0.5 };
/** What a duck under a sting leaves of the effects and the music. */
const DUCKED = 0.35;

/**
 * Renders the director's sounds on a Web Audio graph: each sound through its own stereo panner into its bus (effects,
 * alerts, music), the buses into a master gain and a limiting compressor. The context is made on the first user
 * gesture. It decides nothing: what plays, how loud and how often is `director.ts`'s and `cues.ts`'s. A voice's nodes
 * come off the graph as it ends. `stats` counts what reached the graph, for a smoke test that cannot listen.
 */
export class WebAudioBackend implements AudioBackend {
  readonly stats = { contexts: 0, voices: 0, live: 0 };
  private context?: AudioContext;
  private noise?: AudioBuffer;
  private buses?: Record<Bus, GainNode>;
  private failed = false;
  private duckedUntil = 0;

  now(): number {
    return performance.now() / 1000;
  }

  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.context) {
        const context = new AudioContext();
        try {
          this.build(context);
        } catch (error) {
          // A context that will not build is closed, not leaked, and not made again on every later key.
          this.failed = true;
          context.close().catch(() => undefined);
          throw error;
        }
        this.context = context;
        this.stats.contexts++;
      }
      if (this.context.state !== "running")
        this.context.resume().catch(() => {
          // Not a gesture this browser accepts; the next one tries again.
        });
    } catch {
      // No Web Audio here: the game plays silent, and no later gesture tries again.
      if (!this.context) this.failed = true;
    }
  }

  ready(): boolean {
    return this.context?.state === "running" && !!this.buses;
  }

  play(sound: Sound, gain: number, pan: number): void {
    const { context, buses, noise } = this;
    if (!context || !buses || !noise || context.state !== "running") return;
    if (!Number.isFinite(gain) || !Number.isFinite(pan)) return;
    const at = context.currentTime + 0.005;
    const panner = new StereoPannerNode(context, { pan });
    panner.connect(buses[sound.bus]);
    let left = sound.voices.length;
    try {
      for (const voice of sound.voices) {
        this.stats.voices++;
        this.stats.live++;
        render(context, noise, voice, at, gain, panner, () => {
          this.stats.live--;
          if (--left === 0) panner.disconnect();
        });
      }
    } catch {
      panner.disconnect(); // A voice the graph would not take: the sound goes, its nodes with it.
    }
  }

  time(): number | undefined {
    return this.ready() ? this.context!.currentTime : undefined;
  }

  schedule(voice: Voice, at: number): void {
    const { context, buses, noise } = this;
    if (!context || !buses || !noise) return;
    this.stats.voices++;
    this.stats.live++;
    render(context, noise, voice, at, 1, buses.music, () => this.stats.live--);
  }

  duck(seconds: number): void {
    const { context, buses } = this;
    if (!context || !buses) return;
    const now = context.currentTime;
    // A shorter duck inside a longer one does not cut it short.
    this.duckedUntil = Math.max(this.duckedUntil, now + seconds);
    for (const bus of ["effects", "music"] as const) {
      const level = buses[bus].gain;
      level.cancelScheduledValues(now);
      level.setTargetAtTime(LEVELS[bus] * DUCKED, now, 0.03);
      level.setTargetAtTime(LEVELS[bus], this.duckedUntil, 0.3);
    }
  }

  hide(hidden: boolean): void {
    const context = this.context;
    if (!context || context.state === "closed") return;
    (hidden ? context.suspend() : context.resume()).catch(() => {
      // A context the browser will not switch now: the next gesture resumes it.
    });
  }

  private build(context: AudioContext): void {
    // The limiter: a hard, fast compressor just under full scale, so a pile-up never clips.
    // prettier-ignore
    const limiter = new DynamicsCompressorNode(context, { threshold: -6, knee: 0, ratio: 20, attack: 0.002, release: 0.15 });
    limiter.connect(context.destination);
    const master = new GainNode(context, { gain: MASTER });
    master.connect(limiter);
    const bus = (b: Bus) => new GainNode(context, { gain: LEVELS[b] });
    this.buses = {
      effects: bus("effects"),
      alerts: bus("alerts"),
      music: bus("music"),
    };
    for (const node of Object.values(this.buses)) node.connect(master);
    const length = context.sampleRate,
      noise = context.createBuffer(1, length, context.sampleRate),
      data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
  }
}

/** One voice's nodes, from `start` at `gain` into `out`; they come off the graph as it ends, then `ended` runs. */
export function render(
  context: BaseAudioContext,
  noise: AudioBuffer,
  voice: Voice,
  start: number,
  gain: number,
  out: AudioNode,
  ended: () => void,
): void {
  const at = start + (voice.at ?? 0),
    end = at + voice.dur,
    vol = Math.max(0.0002, voice.vol * gain),
    envelope = context.createGain(),
    level = envelope.gain;
  level.setValueAtTime(0.0001, at);
  level.exponentialRampToValueAtTime(vol, at + 0.004);
  if (voice.sustain) {
    level.setValueAtTime(vol, Math.max(at + 0.004, end - 0.03));
    level.linearRampToValueAtTime(0, end);
  } else level.exponentialRampToValueAtTime(0.0001, end);
  envelope.connect(out);
  const nodes: AudioNode[] = [envelope];
  let source: AudioScheduledSourceNode, pitch: AudioParam;
  let begin: (() => void) | undefined;
  if (voice.wave === "noise") {
    const hiss = context.createBufferSource(),
      band = context.createBiquadFilter();
    hiss.buffer = noise;
    hiss.loop = true;
    band.type = "bandpass";
    band.Q.value = 1.1;
    hiss.connect(band).connect(envelope);
    nodes.push(band);
    [source, pitch] = [hiss, band.frequency];
    // From a random point of the loop, so a volley of the same shot is not one wave stacked up louder.
    begin = () => hiss.start(at, Math.random() * 0.9);
  } else {
    const tone = context.createOscillator();
    tone.type = voice.wave;
    tone.connect(envelope);
    [source, pitch] = [tone, tone.frequency];
  }
  pitch.setValueAtTime(voice.freq, at);
  if (voice.slide)
    pitch.exponentialRampToValueAtTime(voice.freq * voice.slide, end);
  nodes.push(source);
  source.onended = () => {
    for (const node of nodes) node.disconnect();
    ended();
  };
  (begin ?? (() => source.start(at)))();
  source.stop(end + 0.02);
}
