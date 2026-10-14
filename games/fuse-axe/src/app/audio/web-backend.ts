import type { AudioBackend } from "./director.js";
import { Mixer, type Bus, type Repeat } from "./mixer.js";
import type { Song } from "./music.js";
import type { Sound, Voice } from "./sounds.js";

const MASTER = 0.6,
  LOOP = 0.55,
  DUCKED = 0.12;

const every: Repeat = (tick, ms) => {
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
};

/**
 * Renders the director's sounds on a Web Audio graph: effects, jingles and the loop (which ducks) into a master gain
 * and a compressor. The context is made on the first user gesture. It decides nothing: what plays, and when, is
 * `director.ts`'s, `sounds.ts`'s, `music.ts`'s and `mixer.ts`'s (the cap on voices, the loop's pump and how long a duck
 * lasts included); it only keeps the graph clean, taking a voice's nodes off it as the voice ends.
 */
export class WebAudioBackend implements AudioBackend {
  private context?: AudioContext;
  /** Made last by `build`, so there is one only on a context that built. */
  private mixer?: Mixer;
  /** The loop the director asked for, started once a context builds. */
  private song: Song | null = null;
  private failed = false;

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
        this.mixer?.music(this.song);
      }
      if (this.context.state !== "running")
        this.context.resume().catch(() => {
          // Not a gesture this browser accepts; the next one tries again.
        });
    } catch {
      // No Web Audio here: the game plays silent.
    }
  }

  play(sound: Sound): void {
    this.mixer?.play(sound);
  }

  music(song: Song | null): void {
    this.song = song;
    this.mixer?.music(song);
  }

  duck(seconds: number): void {
    this.mixer?.duck(seconds);
  }

  hide(hidden: boolean): void {
    const context = this.context;
    if (!context || context.state === "closed") return;
    (hidden ? context.suspend() : context.resume()).catch(() => {
      // A context the browser will not switch now: the next gesture resumes it.
    });
  }

  private build(context: AudioContext): void {
    const master = context.createGain(),
      squash = context.createDynamicsCompressor();
    master.gain.value = MASTER;
    master.connect(squash).connect(context.destination);
    const buses: Record<Bus, GainNode> = {
      effects: context.createGain(),
      loop: context.createGain(),
    };
    buses.loop.gain.value = LOOP;
    buses.effects.connect(master);
    buses.loop.connect(master);
    const length = context.sampleRate,
      noise = context.createBuffer(1, length, context.sampleRate),
      data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.mixer = new Mixer(
      {
        get time() {
          return context.currentTime;
        },
        get running() {
          return context.state === "running";
        },
        voice: (voice, at, bus, ended) =>
          render(context, noise, voice, at, buses[bus], ended),
        duck: (until) => {
          const gain = buses.loop.gain,
            now = context.currentTime;
          gain.cancelScheduledValues(now);
          gain.setTargetAtTime(LOOP * DUCKED, now, 0.04);
          gain.setTargetAtTime(LOOP, until, 0.3);
        },
      },
      every,
    );
  }
}

/** One voice's nodes, from `at` into `out`; they come off the graph as it ends, and then `ended` is called. */
function render(
  context: AudioContext,
  noise: AudioBuffer,
  voice: Voice,
  at: number,
  out: AudioNode,
  ended: () => void,
): void {
  const end = at + voice.dur,
    gain = context.createGain(),
    level = gain.gain;
  level.setValueAtTime(0.0001, at);
  level.exponentialRampToValueAtTime(voice.vol, at + 0.005);
  if (voice.sustain) {
    level.setValueAtTime(voice.vol, Math.max(at + 0.005, end - 0.03));
    level.linearRampToValueAtTime(0, end);
  } else level.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(out);
  const nodes: AudioNode[] = [gain];
  let source: AudioScheduledSourceNode, pitch: AudioParam;
  if (voice.wave === "noise") {
    const hiss = context.createBufferSource(),
      band = context.createBiquadFilter();
    hiss.buffer = noise;
    hiss.loop = true;
    band.type = "bandpass";
    band.Q.value = 1.2;
    hiss.connect(band).connect(gain);
    nodes.push(band);
    [source, pitch] = [hiss, band.frequency];
  } else {
    const tone = context.createOscillator();
    tone.type = voice.wave;
    tone.connect(gain);
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
  source.start(at);
  source.stop(end + 0.02);
}
