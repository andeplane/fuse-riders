import type { AudioBackend } from "./director.js";
import { fits, type Sound, type Voice } from "./sounds.js";

const MASTER = 0.6;

/**
 * Renders the director's sounds on a Web Audio graph: every voice into a master gain and a compressor. The context is
 * made on the first user gesture. It decides nothing: what plays, and when, is `director.ts`'s and `sounds.ts`'s (the
 * cap on voices, `fits`, included); it only keeps the graph clean, taking a voice's nodes off it as the voice ends.
 */
export class WebAudioBackend implements AudioBackend {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  /** Voices scheduled and not yet ended. */
  private readonly live = new Set<AudioScheduledSourceNode>();
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
    const context = this.context;
    // A suspended context holds its clock still: what is scheduled on it all sounds at once when it resumes.
    if (!context || !this.master || context.state !== "running") return;
    if (!fits(sound, this.live.size)) return;
    for (const voice of sound.voices)
      this.voice(voice, context.currentTime + (voice.at ?? 0), this.master);
  }

  hide(hidden: boolean): void {
    const context = this.context;
    if (!context || context.state === "closed") return;
    (hidden ? context.suspend() : context.resume()).catch(() => {
      // A context the browser will not switch now: the next gesture resumes it.
    });
  }

  private build(context: AudioContext): void {
    const squash = context.createDynamicsCompressor();
    this.master = context.createGain();
    this.master.gain.value = MASTER;
    this.master.connect(squash).connect(context.destination);
    const length = context.sampleRate;
    this.noise = context.createBuffer(1, length, context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  private voice(voice: Voice, at: number, out: AudioNode): void {
    const context = this.context!,
      end = at + voice.dur,
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
      const noise = context.createBufferSource(),
        band = context.createBiquadFilter();
      noise.buffer = this.noise!;
      noise.loop = true;
      band.type = "bandpass";
      band.Q.value = 1.2;
      noise.connect(band).connect(gain);
      nodes.push(band);
      [source, pitch] = [noise, band.frequency];
    } else {
      const tone = context.createOscillator();
      tone.type = voice.wave;
      tone.connect(gain);
      [source, pitch] = [tone, tone.frequency];
    }
    pitch.setValueAtTime(voice.freq, at);
    if (voice.slide)
      pitch.exponentialRampToValueAtTime(voice.freq * voice.slide, end);
    source.start(at);
    source.stop(end + 0.02);
    nodes.push(source);
    this.live.add(source);
    source.onended = () => {
      this.live.delete(source);
      for (const node of nodes) node.disconnect();
    };
  }
}
