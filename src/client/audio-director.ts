import type { ServerMessage } from '../shared/protocol.js';

export type AudioChannel = 'music' | 'effects';
export interface SynthNote { frequency: number; endFrequency?: number; duration: number; delay?: number; wave: 'square' | 'triangle' | 'sawtooth'; level: number }
export interface GameSynth {
  unlock(): Promise<boolean>;
  note(channel: AudioChannel, note: SynthNote): void;
  gain(channel: AudioChannel, value: number): void;
  stop(): void;
}
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
// Original 8-bar A-minor arcade motif, composed for Fuse Riders.
const melody = [76, 0, 79, 81, 83, 81, 79, 76, 74, 0, 76, 79, 81, 79, 76, 74,
  72, 76, 79, 0, 84, 83, 79, 76, 74, 77, 81, 0, 83, 81, 77, 74,
  76, 79, 81, 84, 83, 0, 81, 79, 76, 74, 72, 0, 74, 76, 79, 83,
  84, 83, 81, 79, 76, 79, 74, 77, 76, 0, 71, 74, 76, 0, 0, 0];
const bass = [45, 43, 41, 43, 45, 43, 41, 40];
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
  private settings = { music: { muted: false, volume: .22 }, effects: { muted: false, volume: .45 } };
  constructor(private readonly synth: GameSynth, private readonly now: () => number) {
    for (const channel of ['music', 'effects'] as const) this.applyGain(channel);
  }
  async unlock(): Promise<boolean> {
    this.unlocked = await this.synth.unlock();
    this.nextBeat = this.now();
    return this.unlocked;
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
      this.playing = message.state.phase === 'playing' || message.state.phase === 'countdown';
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
    this.nextBeat = now + 125; // No catch-up loop after backgrounding or a slow frame.
    const index = this.beat++ % melody.length;
    const note = melody[index]!;
    if (note) this.synth.note('music', { frequency: midi(note), duration: .09, wave: 'square', level: .13 });
    if (index % 2 === 0) this.synth.note('music', { frequency: midi(bass[Math.floor(index / 8)]!), duration: .18, wave: 'triangle', level: .4 });
    if (index % 4 === 0) this.synth.note('music', { frequency: 135, endFrequency: 42, duration: .075, wave: 'triangle', level: .6 });
    else if (index % 2 === 1) this.synth.note('music', { frequency: 1400, endFrequency: 500, duration: .025, wave: 'square', level: .04 });
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
