import { AudioDirector, type AudioChannel, type GameSynth, type SynthNote } from './audio-director.js';

class WebAudioSynth implements GameSynth {
  private context?: AudioContext;
  private channels?: Record<AudioChannel, GainNode>;
  private levels = { music: .22, effects: .45 };
  private voices = new Set<OscillatorNode>();
  constructor(private readonly stateChanged: (running: boolean) => void) {}
  async unlock(): Promise<boolean> {
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContext(); this.channels = undefined;
        this.context.onstatechange = () => this.stateChanged(this.context?.state === 'running');
      }
      if (!this.channels) {
        this.channels = { music: this.context.createGain(), effects: this.context.createGain() };
        for (const channel of ['music', 'effects'] as const) {
          this.channels[channel].connect(this.context.destination); this.gain(channel, this.levels[channel]);
        }
      }
      await this.context.resume(); return this.context.state === 'running';
    } catch { return false; }
  }
  gain(channel: AudioChannel, value: number): void {
    this.levels[channel] = value;
    if (this.context && this.channels) this.channels[channel].gain.setTargetAtTime(value, this.context.currentTime, .015);
  }
  note(channel: AudioChannel, note: SynthNote): void {
    if (!this.context || !this.channels || this.context.state !== 'running' || this.voices.size >= 32) return;
    const context = this.context; const oscillator = context.createOscillator(); const envelope = context.createGain();
    const start = context.currentTime + (note.delay ?? 0); const end = start + note.duration;
    oscillator.type = note.wave; oscillator.frequency.setValueAtTime(note.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency ?? note.frequency, end);
    envelope.gain.setValueAtTime(0, start); envelope.gain.linearRampToValueAtTime(note.level, start + .006);
    envelope.gain.exponentialRampToValueAtTime(.0001, end);
    oscillator.connect(envelope); envelope.connect(this.channels[channel]); this.voices.add(oscillator);
    oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(start); oscillator.stop(end + .01);
  }
  stop(): void { for (const voice of this.voices) { voice.stop(); } this.voices.clear(); }
}

export function createGameAudio(): { director: AudioDirector; controls: HTMLElement; unlock: () => void } {
  const enable = document.createElement('button');
  const showState = (ok: boolean) => {
    const text = ok ? 'TV audio enabled · test sound' : 'Enable / resume TV audio';
    if (enable.textContent !== text) enable.textContent = text;
    enable.setAttribute('aria-pressed', String(ok));
  };
  const director = new AudioDirector(new WebAudioSynth(showState), () => performance.now());
  const controls = document.createElement('details'); controls.className = 'audio-controls';
  const summary = document.createElement('summary'); summary.textContent = '♪ AUDIO'; controls.append(summary);
  const panel = document.createElement('div'); panel.className = 'audio-panel'; controls.append(panel);
  enable.type = 'button'; enable.textContent = 'Enable TV audio'; panel.append(enable);
  const unlock = (confirm = false) => { void director.unlock(confirm).then(showState); };
  enable.addEventListener('click', () => unlock(true));
  const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next tune (8 original tracks)';
  next.addEventListener('click', () => director.nextTrack()); panel.append(next);
  const musicInfo = document.createElement('small'); musicInfo.textContent = '64-bar arrangements · arcade + swing jazz'; panel.append(musicInfo);
  for (const channel of ['music', 'effects'] as const) {
    const label = channel === 'music' ? 'Music' : 'Effects';
    const row = document.createElement('label'); row.textContent = `${label} volume`;
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = channel === 'music' ? '22' : '45'; slider.setAttribute('aria-label', `${label} volume`);
    slider.addEventListener('input', () => director.setVolume(channel, Number(slider.value) / 100)); row.append(slider); panel.append(row);
    const mute = document.createElement('button'); mute.type = 'button'; mute.textContent = `Mute ${label.toLowerCase()}`; mute.setAttribute('aria-pressed', 'false');
    mute.addEventListener('click', () => { const muted = mute.getAttribute('aria-pressed') !== 'true'; director.setMuted(channel, muted); mute.setAttribute('aria-pressed', String(muted)); }); panel.append(mute);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) director.disconnect(); });
  window.addEventListener('pagehide', () => director.disconnect());
  return { director, controls, unlock };
}
