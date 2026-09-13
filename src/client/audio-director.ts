import type { ServerMessage } from '../shared/protocol.js';
import { CHIPTUNES, MUSIC_STEPS, musicStep } from './music-score.js';

export type AudioChannel = 'music' | 'effects';
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
  async unlock(): Promise<boolean> {
    this.unlocked = await this.synth.unlock();
    this.nextBeat = this.now();
    return this.unlocked;
  }
  get trackTitle(): string { return CHIPTUNES[this.trackIndex]!.title; }
  nextTrack(): void { this.trackIndex = (this.trackIndex + 1) % CHIPTUNES.length; this.beat = 0; this.nextBeat = this.now(); }
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
      this.playing = message.state.phase === 'playing' || message.state.phase === 'countdown';
      if (this.playing && scope !== this.musicScope) {
        if (this.musicScope) this.nextTrack();
        this.musicScope = scope;
      }
      return;
    }
    if (scope !== this.scope || message.tick <= this.baselineTick || message.tick < this.latestTick - 2) return;
    const key = `${message.tick}:${message.event.type}`;
    if (this.seen.has(key)) return;
    this.seen.add(key); if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
    this.cue(message.event.type);
  }
  update(): void {
    if (!this.unlocked || !this.playing) { this.nextBeat = this.now(); return; }
    const now = this.now();
    if (now < this.nextBeat) return;
    if (this.beat >= MUSIC_STEPS) this.nextTrack();
    const track = CHIPTUNES[this.trackIndex]!;
    this.nextBeat = now + track.stepMs; // Never catch up after a slow/background frame.
    for (const note of musicStep(track, this.beat++)) this.synth.note('music', note);
  }
  private cue(type: string): void {
    if (!this.unlocked) return;
    const note = (frequency: number, endFrequency: number, duration: number, wave: SynthNote['wave'] = 'square', delay = 0) => this.synth.note('effects', { frequency, endFrequency, duration, wave, delay, level: .24 });
    switch (type) {
      case 'bombPlaced': note(260, 1050, .12); break;
      case 'explosion': note(130, 28, .25, 'sawtooth'); note(68, 25, .3, 'triangle'); break;
      case 'playerEliminated': note(700, 90, .3); break;
      case 'pickupCollected': note(660, 660, .08); note(990, 990, .1, 'square', .08); note(1320, 1320, .13, 'square', .16); break;
      case 'roundEnded': note(523, 523, .12); note(659, 659, .12, 'square', .12); note(784, 784, .22, 'square', .24); break;
      case 'matchEnded': note(784, 784, .2); note(1047, 1047, .35, 'triangle', .2); break;
    }
  }
}
