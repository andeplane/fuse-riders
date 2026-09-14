import type { ServerMessage } from '../shared/protocol.js';
import { CHIPTUNES, MUSIC_STEPS, musicStep, musicStepDuration } from './music-score.js';

export type AudioChannel = 'music' | 'effects';
/**
 * How far ahead of the current frame music steps are handed to the synth. The
 * frame callback that drives {@link AudioDirector.update} is coarse (a 60 Hz
 * frame is 16.7 ms, a 30 Hz frame 33.3 ms, the online interval driver 50 ms), so
 * a step whose deadline falls between two frames must be scheduled by the frame
 * before it with the delay that places it exactly on its deadline. One lookahead
 * is shorter than the shortest step of any track, so a frame schedules at most
 * two steps.
 */
export const MUSIC_LOOKAHEAD_MS = 60;
export interface SynthNote { frequency: number; endFrequency?: number; duration: number; delay?: number; wave: 'square' | 'triangle' | 'sawtooth'; level: number }
export interface GameSynth {
  unlock(): Promise<boolean>;
  note(channel: AudioChannel, note: SynthNote): void;
  gain(channel: AudioChannel, value: number): void;
  stop(): void;
}
export class AudioDirector {
  private unlocked = false;
  private scope = '';
  private matchId = '';
  private round = -1;
  private baselineTick = 0;
  private latestTick = 0;
  private seen = new Set<string>();
  private playing = false;
  private nextBeat = 0;
  private beat = 0;
  private trackIndex = 0;
  private musicScope = '';
  private settings = { music: { muted: false, volume: .22 }, effects: { muted: false, volume: .45 } };
  constructor(private readonly synth: GameSynth, private readonly now: () => number) {
    for (const channel of ['music', 'effects'] as const) this.applyGain(channel);
  }
  async unlock(confirm = false): Promise<boolean> {
    this.unlocked = await this.synth.unlock();
    this.nextBeat = this.now();
    if (this.unlocked && confirm) this.synth.note('effects', { frequency: 660, endFrequency: 990, duration: .16, wave: 'triangle', level: .24 });
    return this.unlocked;
  }
  get trackTitle(): string { return CHIPTUNES[this.trackIndex]!.title; }
  /** A deliberate track change (playlist button, new round) restarts the beat clock at the current time. */
  nextTrack(): void { this.advanceTrack(true); }
  /** Rolling over at the end of an arrangement keeps the existing deadline so the tempo does not slip between tracks. */
  private advanceTrack(restartClock: boolean): void {
    this.trackIndex = (this.trackIndex + 1) % CHIPTUNES.length; this.beat = 0;
    if (restartClock) this.nextBeat = this.now();
  }
  setMuted(channel: AudioChannel, muted: boolean): void { this.settings[channel].muted = muted; this.applyGain(channel); }
  setVolume(channel: AudioChannel, value: number): void {
    this.settings[channel].volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    this.applyGain(channel);
  }
  private applyGain(channel: AudioChannel): void { const setting = this.settings[channel]; this.synth.gain(channel, setting.muted ? 0 : setting.volume); }
  disconnect(): void { this.scope = ''; this.seen.clear(); this.playing = false; this.beat = 0; this.synth.stop(); }
  message(message: ServerMessage): void {
    if (message.type !== 'snapshot' && message.type !== 'event') return;
    const scope = `${message.matchId}:${message.round}`;
    if (message.type === 'snapshot') {
      if (message.matchId === this.matchId && message.round < this.round) return;
      this.matchId = message.matchId; this.round = message.round;
      if (scope !== this.scope) {
        this.scope = scope; this.baselineTick = message.tick; this.seen.clear();
      } else if (message.tick < this.latestTick) return;
      this.latestTick = message.tick;
      this.playing = true; // Connected lobbies and intermissions also have music.
      if ((message.state.phase === 'playing' || message.state.phase === 'countdown') && scope !== this.musicScope) {
        if (this.musicScope) this.nextTrack();
        this.musicScope = scope;
      }
      return;
    }
    if (scope !== this.scope || message.tick <= this.baselineTick || message.tick < this.latestTick - 2) return;
    const key = `${message.tick}:${message.event.type}`;
    if (this.seen.has(key)) return;
    this.seen.add(key); if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
    this.cue(message.event.type === 'bombPlaced' && message.event.gun ? 'cannon' : message.event.type);
  }
  /**
   * Frame-driven step scheduler. Deadlines advance from the previous deadline,
   * never from the frame timestamp that noticed them, so the lateness of a frame
   * cannot accumulate into a slow tempo; every step is handed to the synth with
   * the delay that starts it exactly on its deadline instead of at the audio
   * clock's current time. A frame arriving more than one step late (a hidden tab
   * or a stalled main thread) resynchronises the clock to the current time
   * rather than firing a burst of catch-up steps.
   */
  update(): void {
    if (!this.unlocked || !this.playing) { this.nextBeat = this.now(); return; }
    const now = this.now();
    if (now - this.nextBeat > musicStepDuration(CHIPTUNES[this.trackIndex]!, this.beat)) this.nextBeat = now;
    const horizon = now + MUSIC_LOOKAHEAD_MS;
    while (this.nextBeat <= horizon) {
      if (this.beat >= MUSIC_STEPS) this.advanceTrack(false);
      const track = CHIPTUNES[this.trackIndex]!;
      const delay = Math.max(0, (this.nextBeat - now) / 1000);
      this.nextBeat += musicStepDuration(track, this.beat);
      for (const note of musicStep(track, this.beat)) this.synth.note('music', { ...note, delay });
      this.beat++;
    }
  }
  private cue(type: string): void {
    if (!this.unlocked) return;
    const note = (frequency: number, endFrequency: number, duration: number, wave: SynthNote['wave'] = 'square', delay = 0) => this.synth.note('effects', { frequency, endFrequency, duration, wave, delay, level: .24 });
    switch (type) {
      case 'cannon': note(180, 35, .32, 'sawtooth'); note(90, 24, .4, 'triangle'); note(900, 90, .09); break;
      case 'bombPlaced': note(260, 1050, .12); break;
      case 'explosion': note(130, 28, .25, 'sawtooth'); note(68, 25, .3, 'triangle'); break;
      case 'playerEliminated': note(700, 90, .3); break;
      case 'pickupCollected': note(660, 660, .08); note(990, 990, .1, 'square', .08); note(1320, 1320, .13, 'square', .16); break;
      case 'roundEnded': note(523, 523, .12); note(659, 659, .12, 'square', .12); note(784, 784, .22, 'square', .24); break;
      case 'matchEnded': note(784, 784, .2); note(1047, 1047, .35, 'triangle', .2); break;
    }
  }
}
