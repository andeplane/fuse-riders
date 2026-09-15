import { assetUrl } from './asset-url.js';

/**
 * Fuse Riders Radio on the OS media surfaces (iOS lock screen and Control Center, CarPlay, a Tesla's media
 * widget, Android notifications): the Media Session API gets the track title and artwork, and its hardware
 * and on-screen buttons drive the radio's own queue, so loop song, the playlist and the saved position all
 * still apply (#135).
 */
export type MediaAction = 'play' | 'pause' | 'previoustrack' | 'nexttrack';
export interface MediaArtwork { src: string; sizes: string; type: string }
export interface MediaTrack { title: string; artist: string; album: string; artwork: MediaArtwork[] }
export interface MediaPosition { duration: number; position: number; playbackRate: number }
/** The slice of `navigator.mediaSession` the radio needs, so tests inject a typed fake. */
export interface MediaSessionPort {
  setMetadata(track: MediaTrack): void;
  setPlaybackState(state: 'playing' | 'paused'): void;
  setActionHandler(action: MediaAction, handler: (() => void) | null): void;
  /** No argument clears the position (unknown length); the port swallows a browser's refusal. */
  setPositionState(position?: MediaPosition): void;
}
/** What the radio reports to the OS. `playing` means audible right now: unlocked, not paused, not muted. */
export interface MediaRadio {
  title(): string;
  playing(): boolean;
  position(): number;
  duration(): number | undefined;
  subscribe(listener: () => void): () => void;
}
export interface MediaActions { play(): void; pause(): void; previous(): void; next(): void }
export interface MediaBinding { refresh(): void; unbind(): void }
/** The radio controls a media action may use. */
export interface RadioTransport { paused(): boolean; togglePause(): void; previousTrack(): void; nextTrack(): void }
export interface MusicMute { muted(): boolean; unmute(): void }

export const RADIO_ARTIST = 'Fuse Riders Radio';
export const RADIO_ALBUM = 'Fuse Riders';
export const RADIO_ARTWORK_PATH = '/radio-artwork.png';
export const radioArtwork = (): MediaArtwork[] => [{ src: assetUrl(RADIO_ARTWORK_PATH), sizes: '512x512', type: 'image/png' }];

const ACTIONS: readonly MediaAction[] = ['play', 'pause', 'previoustrack', 'nexttrack'];

/** Mirrors the radio onto a media session and routes its actions back. Without a port (no API) nothing happens. */
export function bindMediaSession(port: MediaSessionPort | undefined, radio: MediaRadio, actions: MediaActions, artwork: MediaArtwork[] = radioArtwork()): MediaBinding {
  if (!port) return { refresh() {}, unbind() {} };
  let title = ''; let playing: boolean | undefined; let known = false;
  const refresh = () => {
    if (radio.title() !== title) { title = radio.title(); port.setMetadata({ title, artist: RADIO_ARTIST, album: RADIO_ALBUM, artwork }); }
    if (radio.playing() !== playing) { playing = radio.playing(); port.setPlaybackState(playing ? 'playing' : 'paused'); }
    const duration = radio.duration();
    if (duration !== undefined && Number.isFinite(duration) && duration > 0) { known = true; port.setPositionState({ duration, position: Math.max(0, Math.min(duration, radio.position())), playbackRate: 1 }); }
    else if (known) { known = false; port.setPositionState(); }
  };
  const handlers: Record<MediaAction, () => void> = { play: actions.play, pause: actions.pause, previoustrack: actions.previous, nexttrack: actions.next };
  for (const action of ACTIONS) port.setActionHandler(action, () => { handlers[action](); refresh(); });
  const unsubscribe = radio.subscribe(refresh);
  refresh();
  return { refresh, unbind() { unsubscribe(); for (const action of ACTIONS) port.setActionHandler(action, null); } };
}

/**
 * What the OS buttons mean for the radio. Play is "make it sound": it unmutes music a listener silenced and
 * resumes a paused radio, then retries the unlock. Pause only pauses, never toggles back on; a second
 * pause from a car or lock screen must not start the music again.
 */
export function radioMediaActions(radio: RadioTransport, music: MusicMute, unlock: () => void): MediaActions {
  return {
    play: () => { if (music.muted()) music.unmute(); if (radio.paused()) radio.togglePause(); unlock(); },
    pause: () => { if (!radio.paused()) radio.togglePause(); },
    previous: () => radio.previousTrack(),
    next: () => radio.nextTrack(),
  };
}
