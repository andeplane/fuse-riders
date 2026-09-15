import { AudioDirector, MUSIC_TRACKS, type AudioChannel, type GameSynth, type SynthNote } from './audio-director.js';
import { assetUrl } from './asset-url.js';
import { safeStorage, type SafeStorage } from './safe-storage.js';

export const AUDIO_SETTINGS_KEY = 'fuse-riders-audio';
export const DEFAULT_VOLUME: Record<AudioChannel, number> = { music: .22, effects: .45 };
export interface AudioSettings { muted: Record<AudioChannel, boolean>; volume: Record<AudioChannel, number> }
export interface GameAudioOptions {
  /** Plays music without waiting for a match, for the landing page and a room that has not connected yet. */
  background?: boolean;
  storage?: SafeStorage;
}
export interface GameAudio {
  director: AudioDirector;
  controls: HTMLElement;
  unlock: (confirm?: boolean) => void;
  /** Wires an existing button as a music on/off toggle that stays in sync with the audio panel. */
  bindMusicToggle: (button: HTMLButtonElement) => void;
}

const CHANNELS = ['music', 'effects'] as const;
const volumeOf = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
/** Mute and volume have to survive the full page load between the landing page and a room. */
export function loadAudioSettings(storage: SafeStorage): AudioSettings {
  const settings: AudioSettings = { muted: { music: false, effects: false }, volume: { ...DEFAULT_VOLUME } };
  try {
    const stored: unknown = JSON.parse(storage.getItem(AUDIO_SETTINGS_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object') return settings;
    const { muted, volume } = stored as { muted?: unknown; volume?: unknown };
    for (const channel of CHANNELS) {
      if (muted && typeof muted === 'object') settings.muted[channel] = (muted as Record<string, unknown>)[channel] === true;
      if (volume && typeof volume === 'object') settings.volume[channel] = volumeOf((volume as Record<string, unknown>)[channel], DEFAULT_VOLUME[channel]);
    }
  } catch { /* Corrupt or blocked storage falls back to the defaults. */ }
  return settings;
}

class WebAudioSynth implements GameSynth {
  private context?: AudioContext;
  private effects?: GainNode;
  private levels = { ...DEFAULT_VOLUME };
  private voices = new Set<OscillatorNode>();
  private element?: HTMLAudioElement;
  private trackPath = '';
  private loadedPath = '';
  constructor(private readonly stateChanged: (running: boolean) => void, private readonly trackEnded: () => void) {}
  async unlock(): Promise<boolean> {
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContext(); this.effects = undefined;
        this.context.onstatechange = () => this.stateChanged(this.context?.state === 'running');
      }
      if (!this.effects) {
        this.effects = this.context.createGain();
        this.effects.connect(this.context.destination); this.gain('effects', this.levels.effects);
      }
      // Before the await as well as after: a gesture's activation does not survive one, and WebKit needs
      // play() inside the gesture task. Afterwards covers a context that had to resume first.
      this.startTrack();
      await this.context.resume();
      this.startTrack(); // A track the browser refused to autoplay gets another go on every gesture.
      return this.context.state === 'running';
    } catch { return false; }
  }
  gain(channel: AudioChannel, value: number): void {
    this.levels[channel] = value;
    if (channel === 'music') {
      if (!this.element) return;
      this.element.volume = value;
      // Silent music does not stream. Pausing keeps the position, so turning it back on continues the
      // tune rather than restarting it, and a page left muted never downloads the playlist.
      if (value <= 0) this.element.pause(); else this.startTrack();
      return;
    }
    if (this.context && this.effects) this.effects.gain.setTargetAtTime(value, this.context.currentTime, .015);
  }
  note(channel: AudioChannel, note: SynthNote): void {
    if (channel !== 'effects' || !this.context || !this.effects || this.context.state !== 'running' || this.voices.size >= 32) return;
    const context = this.context; const oscillator = context.createOscillator(); const envelope = context.createGain();
    const start = context.currentTime + (note.delay ?? 0); const end = start + note.duration;
    oscillator.type = note.wave; oscillator.frequency.setValueAtTime(note.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency ?? note.frequency, end);
    envelope.gain.setValueAtTime(0, start); envelope.gain.linearRampToValueAtTime(note.level, start + .006);
    envelope.gain.exponentialRampToValueAtTime(.0001, end);
    oscillator.connect(envelope); envelope.connect(this.effects); this.voices.add(oscillator);
    oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(start); oscillator.stop(end + .01);
  }
  /**
   * Music plays through a plain media element, never the Web Audio graph. A phone's silent switch and its
   * volume keys only reach media elements — a decoded buffer routed through an AudioContext ignores both —
   * and streaming the file also drops the ~60 MB of PCM the old whole-track decode held.
   */
  music(path: string): void {
    const element = this.element ??= this.createElement();
    this.trackPath = path; element.volume = this.levels.music;
    this.startTrack();
  }
  private createElement(): HTMLAudioElement {
    const element = new Audio(); element.preload = 'auto'; element.className = 'game-music';
    element.addEventListener('ended', () => this.trackEnded());
    // Attached rather than detached: some browsers are stricter about playing an orphan element, and it
    // lives on <body> so the page swapping out its own root never takes the soundtrack with it.
    document.body.append(element);
    return element;
  }
  /** Loads the current track if it is not loaded and plays it, unless music is silent. */
  private startTrack(): void {
    const element = this.element;
    if (!element || !this.trackPath || this.levels.music <= 0) return;
    if (this.loadedPath !== this.trackPath) { this.loadedPath = this.trackPath; element.src = assetUrl(this.trackPath); }
    // Autoplay refusal rejects play(); the next gesture retries, so a refused track never blocks play.
    if (element.paused) void element.play().catch(() => {});
  }
  private stopMusic(): void {
    this.trackPath = ''; this.loadedPath = '';
    if (!this.element) return;
    // Dropping the source as well as pausing stops the download for a page that is going away.
    this.element.pause(); this.element.removeAttribute('src'); this.element.load();
  }
  stop(): void { for (const voice of this.voices) { voice.stop(); } this.voices.clear(); this.stopMusic(); }
}

export function createGameAudio(deviceLabel = 'TV', options: GameAudioOptions = {}): GameAudio {
  const storage = options.storage ?? safeStorage(() => localStorage);
  const settings = loadAudioSettings(storage);
  const enable = document.createElement('button');
  const showState = (ok: boolean) => {
    const text = ok ? `${deviceLabel} audio enabled · test sound` : `Enable / resume ${deviceLabel} audio`;
    if (enable.textContent !== text) enable.textContent = text;
    enable.setAttribute('aria-pressed', String(ok));
  };
  const director: AudioDirector = new AudioDirector(new WebAudioSynth(showState, () => director.nextTrack()));
  const controls = document.createElement('details'); controls.className = 'audio-controls';
  const summary = document.createElement('summary'); summary.textContent = '♪ AUDIO'; controls.append(summary);
  const panel = document.createElement('div'); panel.className = 'audio-panel'; controls.append(panel);
  enable.type = 'button'; enable.textContent = `Enable ${deviceLabel} audio`; panel.append(enable);
  for (const channel of CHANNELS) { director.setVolume(channel, settings.volume[channel]); director.setMuted(channel, settings.muted[channel]); }
  const rendered = new Set<() => void>();
  const store = () => storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  const setMuted = (channel: AudioChannel, value: boolean) => {
    settings.muted[channel] = value; director.setMuted(channel, value); store();
    for (const render of rendered) render();
  };
  const setVolume = (channel: AudioChannel, value: number) => {
    settings.volume[channel] = value; director.setVolume(channel, value); store();
  };
  // update() is what actually starts a track, so every successful unlock has to drive it: the first one
  // usually lands on a gesture long after playBackground() asked for music.
  const unlock = (confirm = false) => { void director.unlock(confirm).then(ok => { showState(ok); if (ok) director.update(); }); };
  // Browsers refuse audio until the page is interacted with, so the first gesture anywhere starts the music.
  // These stay for the page's life rather than being released on the first success: a running AudioContext
  // is not proof the track plays, and an OS interruption can pause it much later. unlock() is idempotent.
  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) document.addEventListener(type, () => unlock(), { passive: true });
  enable.addEventListener('click', () => unlock(true));
  const next = document.createElement('button'); next.type = 'button'; next.textContent = `Next tune (${MUSIC_TRACKS.length} tracks)`;
  next.addEventListener('click', () => director.nextTrack()); panel.append(next);
  for (const channel of CHANNELS) {
    const label = channel === 'music' ? 'Music' : 'Effects';
    const row = document.createElement('label'); row.textContent = `${label} volume`;
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.value = String(Math.round(settings.volume[channel] * 100)); slider.setAttribute('aria-label', `${label} volume`);
    slider.addEventListener('input', () => setVolume(channel, Number(slider.value) / 100)); row.append(slider); panel.append(row);
    const mute = document.createElement('button'); mute.type = 'button'; mute.textContent = `Mute ${label.toLowerCase()}`;
    const render = () => mute.setAttribute('aria-pressed', String(settings.muted[channel]));
    rendered.add(render); render();
    mute.addEventListener('click', () => setMuted(channel, !settings.muted[channel])); panel.append(mute);
  }
  const bindMusicToggle = (button: HTMLButtonElement) => {
    const render = () => {
      // The label carries the state, so no aria-pressed: "Turn music on, pressed" reads as a contradiction.
      button.textContent = settings.muted.music ? '♫ MUSIC OFF' : '♫ MUSIC ON';
      button.dataset.muted = String(settings.muted.music);
    };
    rendered.add(render); render();
    button.addEventListener('click', () => { setMuted('music', !settings.muted.music); unlock(); });
  };
  // Alt-tabbing must not restart the soundtrack, so a hidden tab keeps its track and only drops effect cues.
  // Coming back re-resumes the context, which the browser may have suspended while the tab was away.
  document.addEventListener('visibilitychange', () => {
    director.setEffectsSilenced(document.hidden);
    if (!document.hidden) { director.resume(); unlock(); }
  });
  window.addEventListener('pagehide', () => director.disconnect());
  if (options.background) director.playBackground();
  unlock(); // Autoplay usually refuses here; the gesture listeners above pick it up.
  return { director, controls, unlock, bindMusicToggle };
}
