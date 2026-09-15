import type { ServerMessage } from '../shared/protocol.js';
import { RESTART_THRESHOLD, defaultRadio, followingTrack, precedingTrack, radioQueue, togglePlaylistTrack, trackById, type RadioSource, type RadioState, type TrackId } from './radio.js';

export { MUSIC_TRACKS } from './radio.js';
export type AudioChannel = 'music' | 'effects';
/** `position` is the periodic save of where this tab is; `all` also writes the listener's choices. */
export type RadioSave = 'position' | 'all';
export type RadioChoices = Pick<RadioState, 'loopSong' | 'loopPlaylist' | 'source' | 'playlist'>;
export interface SynthNote { frequency: number; endFrequency?: number; duration: number; delay?: number; wave: 'square' | 'triangle' | 'sawtooth'; level: number }
export interface GameSynth {
  unlock(): Promise<boolean>;
  note(channel: AudioChannel, note: SynthNote): void;
  /** Plays a recorded track from `offset` seconds on the music channel, replacing or seeking any current track. */
  music(path: string, offset: number): void;
  /** Pauses the current track where it is and disarms it, so nothing but a later `music` call plays it again. */
  pauseMusic(): void;
  /** Seconds into the loaded track, or undefined before one has loaded. */
  position(): number | undefined;
  /** Length of the loaded track in seconds, if known. */
  duration(): number | undefined;
  /** The media element is really producing the radio's track now: playing, not paused by anyone, volume above zero. */
  audible(): boolean;
  gain(channel: AudioChannel, value: number): void;
  stop(): void;
}
/**
 * Effects follow authoritative match messages. Music follows Fuse Riders Radio: the saved track resumes
 * from its saved position, and only a listener's action or a finished track changes it — rounds, matches,
 * reconnects and hidden tabs never do.
 */
export class AudioDirector {
  private unlocked = false;
  private scope = '';
  private matchId = '';
  private round = -1;
  private baselineTick = 0;
  private latestTick = 0;
  private seen = new Set<string>();
  private playing = false;
  private background = false;
  private silenced = false;
  /** Path handed to the synth, or '' while no track is playing. */
  private musicPath = '';
  private settings = { music: { muted: false, volume: .22 }, effects: { muted: false, volume: .45 } };
  private readonly listeners = new Set<() => void>();
  /** Last known length of the current track, kept while it is paused so lock-screen scrubbers do not reset. */
  private knownDuration?: number;
  constructor(private readonly synth: GameSynth, private readonly radio: RadioState = defaultRadio(), private readonly persist: (state: Readonly<RadioState>, kind: RadioSave) => void = () => {}) {
    for (const channel of ['music', 'effects'] as const) this.applyGain(channel);
  }
  async unlock(confirm = false): Promise<boolean> {
    // Once audio has been unlocked it stays unlocked: iOS cannot resume the effects context from a lock-screen action,
    // and that failure must not stop the music element, which plays without it.
    const ok = await this.synth.unlock(); this.unlocked ||= ok;
    if (ok && confirm) this.synth.note('effects', { frequency: 660, endFrequency: 990, duration: .16, wave: 'triangle', level: .24 });
    return ok;
  }
  get state(): Readonly<RadioState> { return this.radio; }
  get trackTitle(): string { return trackById(this.radio.track).title; }
  isMuted(channel: AudioChannel): boolean { return this.settings[channel].muted; }
  /** Live position while a track plays, otherwise the point it resumes from. */
  position(): number { return (this.musicPath ? this.synth.position() : undefined) ?? this.radio.position; }
  duration(): number | undefined { const live = this.musicPath ? this.synth.duration() : undefined; if (live !== undefined) this.knownDuration = live; return live ?? this.knownDuration; }
  /** True only while the media element is audibly playing this radio's track, whatever the effects context is doing. */
  audible(): boolean { return this.musicPath !== '' && this.synth.audible(); }
  /** Called after every radio or mute change, so a panel can redraw. */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** Plays music with no match attached, so the landing page and a room that has not connected yet still have a soundtrack. */
  playBackground(): void { this.background = true; this.playing = true; this.update(); }
  /** Restarts background music after something stopped it; a match instead resumes from its next snapshot. */
  resume(): void { if (this.background) this.playBackground(); }
  /**
   * A hidden tab keeps its music — alt-tabbing away must not restart the track — but drops effect cues,
   * because a room the viewer cannot see goes on launching and exploding without them.
   */
  setEffectsSilenced(value: boolean): void { this.silenced = value; }
  /** Next track, wrapping; also the old Next tune. */
  nextTrack(): void { this.select(followingTrack(this.radio, 'next')!); }
  /** Restarts the song, or goes back a track when it has only just started. */
  previousTrack(): void { this.select(this.position() > RESTART_THRESHOLD ? this.radio.track : precedingTrack(this.radio)); }
  play(id: TrackId, source?: RadioSource): void { if (source) this.radio.source = source; this.select(id); }
  togglePause(): void { this.radio.paused = !this.radio.paused; this.update(); this.changed(); }
  /** Called by the synth when a track plays to its end: loop song repeats it, an unlooped playlist stops. */
  trackEnded(): void {
    // Disarm the finished track first: otherwise the next gesture's unlock would replay it under a paused radio.
    this.synth.pauseMusic(); this.musicPath = '';
    const following = followingTrack(this.radio, 'ended');
    if (following) this.select(following); else this.select(radioQueue(this.radio)[0]!, true);
  }
  /**
   * The OS paused the element itself (headphones out, another app took audio, a car's stop button): the radio
   * follows, disarming the track so the next tap on the page or a returning tab does not start it again.
   */
  mediaPaused(): void {
    if (this.radio.paused || !this.musicPath) return;
    this.radio.position = this.position(); this.radio.paused = true;
    this.synth.pauseMusic(); this.musicPath = ''; this.changed();
  }
  /** The OS resumed the element itself (a lock-screen or car play the page did not handle): the radio follows. */
  mediaResumed(): void {
    if (!this.radio.paused) return;
    this.radio.paused = false; this.update(); this.changed();
  }
  setLoopSong(loop: boolean): void { this.radio.loopSong = loop; this.changed(); }
  setLoopPlaylist(loop: boolean): void { this.radio.loopPlaylist = loop; this.changed(); }
  setSource(source: RadioSource): void { this.radio.source = source; this.changed(); }
  togglePlaylist(id: TrackId): void { this.radio.playlist = togglePlaylistTrack(this.radio.playlist, id); this.changed(); }
  /** Takes choices another tab saved, leaving what this tab plays alone; nothing is written back. */
  adoptChoices(choices: RadioChoices): void {
    this.radio.loopSong = choices.loopSong; this.radio.loopPlaylist = choices.loopPlaylist;
    this.radio.source = choices.source; this.radio.playlist = [...choices.playlist];
    this.emit();
  }
  setMuted(channel: AudioChannel, muted: boolean): void { this.settings[channel].muted = muted; this.applyGain(channel); this.emit(); }
  setVolume(channel: AudioChannel, value: number): void {
    this.settings[channel].volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    this.applyGain(channel);
  }
  /** Records the live position so the next page load resumes from it. */
  save(): void { this.radio.position = this.position(); this.persist(this.radio, 'position'); }
  private applyGain(channel: AudioChannel): void { const setting = this.settings[channel]; this.synth.gain(channel, setting.muted ? 0 : setting.volume); }
  disconnect(): void { this.save(); this.scope = ''; this.seen.clear(); this.playing = false; this.musicPath = ''; this.synth.stop(); }
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
      return; // The current track plays on across rounds; only its end or the listener changes it.
    }
    if (scope !== this.scope || message.tick <= this.baselineTick || message.tick < this.latestTick - 2) return;
    const key = `${message.tick}:${message.event.type}`;
    if (this.seen.has(key)) return;
    this.seen.add(key); if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
    this.cue(message.event.type === 'bombPlaced' && message.event.gun ? 'cannon' : message.event.type);
  }
  /** Starts the radio's track once audio is unlocked and something wants music; safe to call every frame. */
  update(): void {
    if (this.radio.paused) {
      if (this.musicPath) { this.radio.position = this.position(); this.synth.pauseMusic(); this.musicPath = ''; }
      return;
    }
    if (!this.unlocked || !this.playing) return;
    const { path } = trackById(this.radio.track);
    if (path !== this.musicPath) { this.musicPath = path; this.synth.music(path, this.radio.position); }
  }
  private select(id: TrackId, paused = false): void {
    if (this.musicPath) { this.synth.pauseMusic(); this.musicPath = ''; }
    this.radio.track = id; this.radio.position = 0; this.radio.paused = paused; this.knownDuration = undefined;
    this.update(); this.changed();
  }
  private changed(): void { this.radio.position = this.position(); this.persist(this.radio, 'all'); this.emit(); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private cue(type: string): void {
    if (!this.unlocked || this.silenced) return;
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
