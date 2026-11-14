import type { WebampPlayer, WebampStatus, WebampTrack } from '../winamp/webampPlayer';

/** A Webamp player stand-in that records what it was asked to do; no audio, no DOM skin. */
export type FakeWebampPlayer = WebampPlayer & {
  tracks: WebampTrack[];
  renderedInto: HTMLElement[];
  disposed: boolean;
};

export function createFakeWebampPlayer(): FakeWebampPlayer {
  let status: WebampStatus = 'STOPPED';
  let currentIndex = -1;
  const listeners = new Set<(track: { url: string } | null) => void>();
  const notify = () => {
    const current = player.tracks[currentIndex];
    listeners.forEach((listener) => listener(current ? { url: current.url } : null));
  };
  const player: FakeWebampPlayer = {
    tracks: [],
    renderedInto: [],
    disposed: false,
    async renderInto(node) {
      player.renderedInto.push(node);
    },
    appendTracks(tracks) {
      player.tracks.push(...tracks);
    },
    play() {
      status = 'PLAYING';
      if (currentIndex === -1 && player.tracks.length > 0) currentIndex = 0;
      notify();
    },
    pause() {
      status = 'PAUSED';
    },
    stop() {
      status = 'STOPPED';
    },
    nextTrack() {
      if (player.tracks.length === 0) return;
      currentIndex = (currentIndex + 1) % player.tracks.length;
      status = 'PLAYING';
      notify();
    },
    previousTrack() {
      if (player.tracks.length === 0) return;
      currentIndex = (currentIndex - 1 + player.tracks.length) % player.tracks.length;
      status = 'PLAYING';
      notify();
    },
    getPlaylistTracks: () => player.tracks,
    getMediaStatus: () => status,
    onTrackDidChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    dispose() {
      player.disposed = true;
      status = 'STOPPED';
      listeners.clear();
    },
  };
  return player;
}
