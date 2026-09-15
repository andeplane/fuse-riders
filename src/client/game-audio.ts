import { AudioDirector, MUSIC_TRACKS, type AudioChannel, type GameSynth, type SynthNote } from './audio-director.js';
import { assetUrl } from './asset-url.js';
import { RADIO_KEY, RADIO_SHORTCUT_HINT, formatTrackTime, loadRadio, parseRadio, radioQueue, radioShortcut, saveRadio, trackById, type RadioSource, type TrackId } from './radio.js';
import { safeStorage, type SafeStorage } from './safe-storage.js';
import { bindMediaSession, type MediaSessionPort } from './radio-media-session.js';

export const AUDIO_SETTINGS_KEY = 'fuse-riders-audio';
export const DEFAULT_VOLUME: Record<AudioChannel, number> = { music: .22, effects: .45 };
export interface AudioSettings { muted: Record<AudioChannel, boolean>; volume: Record<AudioChannel, number> }
export interface GameAudioOptions {
  /** Plays music without waiting for a match, for the landing page and a room that has not connected yet. */
  background?: boolean;
  storage?: SafeStorage;
  /** Shows or hides the radio for Ctrl+A; by default the `controls` dropdown toggles. */
  toggleRadio?: () => void;
  /** The OS media session to mirror the radio onto; defaults to the browser's, or none. */
  mediaSession?: MediaSessionPort;
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
  /** Resume point for a track whose metadata has not loaded yet; a media element cannot seek before then. */
  private pendingSeek?: number;
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
  music(path: string, offset: number): void {
    const element = this.element ??= this.createElement();
    this.trackPath = path; element.volume = this.levels.music;
    // Resuming the loaded track where it paused must not seek: a server without range requests cannot seek,
    // and the element would restart from the top. Only a real jump (restart, a different resume point) seeks.
    if (this.loadedPath === path && element.readyState >= HTMLMediaElement.HAVE_METADATA) {
      // A seek queued for a track that never loaded (music was off) must not outlive it, or position() stays unknown.
      this.pendingSeek = undefined;
      if (Math.abs(element.currentTime - offset) > .5) element.currentTime = offset;
    } else this.pendingSeek = offset;
    this.startTrack();
  }
  pauseMusic(): void { this.trackPath = ''; this.element?.pause(); }
  position(): number | undefined {
    const element = this.element;
    // Only the track this synth is playing has a position: after a switch while music was off, the element still holds the old one.
    return element && this.loadedPath && this.loadedPath === this.trackPath && this.pendingSeek === undefined && element.readyState >= HTMLMediaElement.HAVE_METADATA ? element.currentTime : undefined;
  }
  duration(): number | undefined {
    const length = this.element?.duration;
    return this.loadedPath && this.loadedPath === this.trackPath && length !== undefined && Number.isFinite(length) ? length : undefined;
  }
  private createElement(): HTMLAudioElement {
    const element = new Audio(); element.preload = 'auto'; element.className = 'game-music';
    element.addEventListener('ended', () => this.trackEnded());
    // A resume point at or past the end plays nothing and ends at once, which advances the radio.
    element.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek === undefined) return;
      element.currentTime = Number.isFinite(element.duration) ? Math.min(this.pendingSeek, element.duration) : this.pendingSeek;
      this.pendingSeek = undefined;
    });
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
    this.trackPath = ''; this.loadedPath = ''; this.pendingSeek = undefined;
    if (!this.element) return;
    // Dropping the source as well as pausing stops the download for a page that is going away.
    this.element.pause(); this.element.removeAttribute('src'); this.element.load();
  }
  stop(): void { for (const voice of this.voices) { voice.stop(); } this.voices.clear(); this.stopMusic(); }
}

/** The real `navigator.mediaSession`, or undefined where the browser has none. */
export function browserMediaSession(): MediaSessionPort | undefined {
  const session = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
  if (!session || typeof MediaMetadata === 'undefined') return undefined;
  return {
    setMetadata: track => { session.metadata = new MediaMetadata(track); },
    setPlaybackState: state => { session.playbackState = state; },
    // A browser that lacks an action throws on registration; an unknown one is simply not offered.
    setActionHandler: (action, handler) => { try { session.setActionHandler(action, handler); } catch { /* unsupported action */ } },
    setPositionState: position => { try { session.setPositionState?.(position); } catch { /* a rejected state, e.g. a position past the duration */ } },
  };
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
};
/** Text fields keep Ctrl+A for select-all; sliders and buttons do not need it. */
const editable = (target: EventTarget | null): boolean => target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  || (target instanceof HTMLElement && target.isContentEditable)
  || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'].includes(target.type));

/**
 * One Fuse Riders Radio per page: a car-radio panel over persisted audio settings and radio state. Every page
 * is a full load, so continuity between the landing page, rooms and the TV is the saved track and position.
 */
export function createGameAudio(deviceLabel = 'TV', options: GameAudioOptions = {}): GameAudio {
  const storage = options.storage ?? safeStorage(() => localStorage);
  const settings = loadAudioSettings(storage);
  const enable = element('button', 'audio-enable'); enable.type = 'button'; enable.textContent = `Enable ${deviceLabel} audio`;
  let running = false;
  const showState = (ok: boolean) => {
    running = ok;
    const text = ok ? `${deviceLabel} audio enabled · test sound` : `Enable / resume ${deviceLabel} audio`;
    if (enable.textContent !== text) enable.textContent = text;
    enable.setAttribute('aria-pressed', String(ok));
    render(); // The display dims while audio is not running.
  };
  const director: AudioDirector = new AudioDirector(new WebAudioSynth(showState, () => director.trackEnded()), loadRadio(storage),
    // A periodic save records only where this tab is, merged over the stored choices, so a second open tab cannot revert
    // a playlist or loop change made in the first. Choice changes write everything.
    (state, kind) => saveRadio(storage, kind === 'all' ? state : { ...loadRadio(storage), track: state.track, position: state.position, paused: state.paused }));
  const controls = element('details', 'audio-controls');
  const summary = element('summary', '', '♫ RADIO'); summary.title = 'Fuse Riders Radio (Ctrl+A)';
  const panel = element('div', 'audio-panel radio'); panel.setAttribute('aria-label', 'Fuse Riders Radio');
  controls.append(summary, panel);
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
  // Lock screen, CarPlay and car browsers show the track and drive the radio's own queue (#135). `running` is only
  // known after an unlock, so the panel's render and its clock both refresh the session.
  const media = bindMediaSession(options.mediaSession ?? browserMediaSession(), {
    title: () => director.trackTitle, playing: () => running && !director.state.paused && !settings.muted.music,
    position: () => director.position(), duration: () => director.duration(), subscribe: listener => director.subscribe(listener),
  }, {
    play: () => { if (settings.muted.music) setMuted('music', false); if (director.state.paused) director.togglePause(); unlock(); },
    pause: () => { if (!director.state.paused) director.togglePause(); },
    previous: () => director.previousTrack(), next: () => director.nextTrack(),
  });
  // update() is what actually starts a track, so every successful unlock has to drive it: the first one
  // usually lands on a gesture long after playBackground() asked for music.
  const unlock = (confirm = false) => { void director.unlock(confirm).then(ok => { showState(ok); if (ok) director.update(); }); };
  // Browsers refuse audio until the page is interacted with, so the first gesture anywhere starts the music.
  // These stay for the page's life rather than being released on the first success: a running AudioContext
  // is not proof the track plays, and an OS interruption can pause it much later. unlock() is idempotent.
  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) document.addEventListener(type, () => unlock(), { passive: true });
  enable.addEventListener('click', () => unlock(true));

  // Head unit: display and transport keys.
  const lcd = element('div', 'radio-lcd'); lcd.setAttribute('role', 'group'); lcd.setAttribute('aria-label', 'Now playing');
  const band = element('div', 'radio-band'); band.append(element('span', '', 'FUSE RIDERS RADIO'), element('span', '', 'FM 88.8'));
  const title = element('div', 'radio-title'); const titleText = element('span');
  const equalizer = element('span', 'radio-eq'); equalizer.setAttribute('aria-hidden', 'true'); equalizer.append(...Array.from({ length: 4 }, () => element('i')));
  title.append(titleText, equalizer);
  const readout = element('div', 'radio-readout'); const trackNumber = element('span'), time = element('span'), flags = element('span');
  readout.append(trackNumber, time, flags); lcd.append(band, title, readout);
  const key = (className: string, text: string, label: string, action: () => void) => {
    const button = element('button', className, text); button.type = 'button'; button.setAttribute('aria-label', label); button.title = label;
    button.addEventListener('click', () => { unlock(); action(); }); return button;
  };
  const playPause = key('radio-play', '▶', 'Play', () => director.togglePause());
  const transport = element('div', 'radio-transport');
  transport.append(key('', '⏮', 'Previous track', () => director.previousTrack()), playPause, key('', '⏭', 'Next track', () => director.nextTrack()));
  const unit = element('div', 'radio-unit'); unit.append(lcd, transport);

  const toggle = (text: string, action: () => void) => { const button = element('button', 'radio-toggle', text); button.type = 'button'; button.addEventListener('click', action); return button; };
  const loopSong = toggle('LOOP SONG', () => director.setLoopSong(!director.state.loopSong));
  const loopPlaylist = toggle('LOOP PLAYLIST', () => director.setLoopPlaylist(!director.state.loopPlaylist));
  const sources: Record<RadioSource, HTMLButtonElement> = { all: toggle('ALL TRACKS', () => director.setSource('all')), playlist: toggle('MY PLAYLIST', () => director.setSource('playlist')) };
  const modes = element('div', 'radio-modes'); modes.append(sources.all, sources.playlist, loopSong, loopPlaylist);

  const mixer = element('div', 'radio-mixer');
  for (const channel of CHANNELS) {
    const label = channel === 'music' ? 'Music' : 'Effects';
    const row = element('label', '', `${label} volume`);
    const slider = element('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.value = String(Math.round(settings.volume[channel] * 100)); slider.setAttribute('aria-label', `${label} volume`);
    slider.addEventListener('input', () => setVolume(channel, Number(slider.value) / 100)); row.append(slider);
    const mute = element('button', 'radio-toggle', `Mute ${label.toLowerCase()}`); mute.type = 'button';
    const renderMute = () => mute.setAttribute('aria-pressed', String(settings.muted[channel]));
    rendered.add(renderMute); renderMute();
    mute.addEventListener('click', () => setMuted(channel, !settings.muted[channel]));
    mixer.append(row, mute);
  }

  const tracks = element('ol', 'radio-tracks'), playlist = element('ol', 'radio-tracks'), playlistHeading = element('h3');
  const trackRow = (id: TrackId, source: RadioSource) => {
    const { title: name } = trackById(id); const listed = director.state.playlist.includes(id);
    const play = key('radio-track', name, `Play ${name}`, () => director.play(id, source));
    if (director.state.track === id) play.setAttribute('aria-current', 'true');
    const edit = element('button', 'radio-track-edit', listed ? '−' : '+'); edit.type = 'button';
    const editLabel = listed ? `Remove ${name} from playlist` : `Add ${name} to playlist`;
    edit.setAttribute('aria-label', editLabel); edit.title = editLabel; edit.setAttribute('aria-pressed', String(listed));
    edit.addEventListener('click', () => director.togglePlaylist(id));
    const row = element('li'); row.append(play, edit); return row;
  };
  panel.append(unit, enable, modes, mixer, element('h3', '', 'TRACKS'), tracks, playlistHeading, playlist, element('small', 'radio-hint', RADIO_SHORTCUT_HINT));

  const renderTime = () => { const text = `${formatTrackTime(director.position())} / ${formatTrackTime(director.duration())}`; if (time.textContent !== text) time.textContent = text; media.refresh(); };
  let listsKey = '';
  function render(): void {
    const state = director.state; const queue = radioQueue(state); const index = queue.indexOf(state.track);
    if (titleText.textContent !== director.trackTitle) titleText.textContent = director.trackTitle;
    trackNumber.textContent = index < 0 ? '--/--' : `${String(index + 1).padStart(2, '0')}/${String(queue.length).padStart(2, '0')}`;
    flags.textContent = [state.loopSong ? 'RPT1' : '', queue === state.playlist ? `LIST${state.loopPlaylist ? '⟳' : ''}` : 'ALL'].filter(Boolean).join(' ');
    const action = state.paused ? 'Play' : 'Pause';
    playPause.textContent = state.paused ? '▶' : '⏸'; playPause.setAttribute('aria-label', action); playPause.title = action;
    lcd.classList.toggle('idle', state.paused || settings.muted.music || !running);
    loopSong.setAttribute('aria-pressed', String(state.loopSong)); loopPlaylist.setAttribute('aria-pressed', String(state.loopPlaylist));
    for (const source of ['all', 'playlist'] as const) sources[source].setAttribute('aria-pressed', String(state.source === source));
    // Lists rebuild only when their content changes, so the clock and volume drags do not churn the DOM.
    const key = `${state.track}|${state.source}|${state.playlist.join()}`;
    if (key !== listsKey) {
      listsKey = key;
      tracks.replaceChildren(...MUSIC_TRACKS.map(track => trackRow(track.id, 'all')));
      playlistHeading.textContent = `MY PLAYLIST (${state.playlist.length})`;
      playlist.replaceChildren(...(state.playlist.length ? state.playlist.map(id => trackRow(id, 'playlist')) : [element('li', 'radio-empty', 'Add tracks with + to build your playlist.')]));
    }
    renderTime();
  }
  director.subscribe(render); render(); // Mute changes reach it through the director as well.

  const bindMusicToggle = (button: HTMLButtonElement) => {
    const render = () => {
      // The label carries the state, so no aria-pressed: "Turn music on, pressed" reads as a contradiction.
      button.textContent = settings.muted.music ? '♫ MUSIC OFF' : '♫ MUSIC ON';
      button.dataset.muted = String(settings.muted.music);
    };
    rendered.add(render); render();
    button.addEventListener('click', () => { setMuted('music', !settings.muted.music); unlock(); });
  };
  // Ctrl+A radio, Ctrl+M everything, Ctrl+Alt+M music, Ctrl+Alt+E effects. Capture phase, ahead of game keys.
  window.addEventListener('keydown', event => {
    const shortcut = radioShortcut(event);
    if (!shortcut || editable(event.target)) return;
    event.preventDefault(); if (event.repeat) return;
    if (shortcut === 'radio') (options.toggleRadio ?? (() => { controls.open = !controls.open; }))();
    else if (shortcut === 'muteAll') { const muted = !(settings.muted.music && settings.muted.effects); setMuted('music', muted); setMuted('effects', muted); }
    else { const channel = shortcut === 'muteMusic' ? 'music' : 'effects'; setMuted(channel, !settings.muted[channel]); }
  }, { capture: true });
  setInterval(renderTime, 500);
  setInterval(() => director.save(), 2000);
  // Another tab's playlist, loop and source choices take effect here; what each tab is playing stays its own.
  window.addEventListener('storage', event => {
    // Cleared storage (newValue null) is not a choice; unchanged choices (another tab's periodic save) need no redraw.
    if (event.key !== RADIO_KEY || event.newValue === null) return;
    const { loopSong, loopPlaylist, source, playlist } = parseRadio(event.newValue), state = director.state;
    if (loopSong === state.loopSong && loopPlaylist === state.loopPlaylist && source === state.source && playlist.join() === state.playlist.join()) return;
    director.adoptChoices({ loopSong, loopPlaylist, source, playlist });
  });
  // Alt-tabbing must not restart the soundtrack, so a hidden tab keeps its track and only drops effect cues.
  // Coming back re-resumes the context, which the browser may have suspended while the tab was away.
  document.addEventListener('visibilitychange', () => {
    director.setEffectsSilenced(document.hidden);
    if (document.hidden) director.save(); else { director.resume(); unlock(); }
  });
  window.addEventListener('pagehide', () => director.disconnect()); // Saves the position before stopping.
  if (options.background) director.playBackground();
  unlock(); // Autoplay usually refuses here; the gesture listeners above pick it up.
  return { director, controls, unlock, bindMusicToggle };
}
