import type {
  WebampPlayer,
  WebampStatus,
  WebampTrack,
} from "../winamp/webampPlayer";

/** A Webamp player stand-in that records what it was asked to do; no audio, no DOM skin. */
export type FakeWebampPlayer = WebampPlayer & {
  tracks: WebampTrack[];
  renderedInto: HTMLElement[];
  disposed: boolean;
  /** The playlist index of the loaded track, -1 before anything loads. */
  currentIndex: number;
};

export function createFakeWebampPlayer(): FakeWebampPlayer {
  let status: WebampStatus = "STOPPED";
  const listeners = new Set<(track: { url: string } | null) => void>();
  const notify = () => {
    const current = player.tracks[player.currentIndex];
    listeners.forEach((listener) =>
      listener(current ? { url: current.url } : null),
    );
  };
  const player: FakeWebampPlayer = {
    tracks: [],
    renderedInto: [],
    disposed: false,
    currentIndex: -1,
    async renderInto(node) {
      player.renderedInto.push(node);
    },
    appendTracks(tracks) {
      player.tracks.push(...tracks);
    },
    setTracksToPlay(tracks) {
      player.tracks = [...tracks];
      player.currentIndex = tracks.length > 0 ? 0 : -1;
      status = tracks.length > 0 ? "PLAYING" : "STOPPED";
      notify();
    },
    play() {
      status = "PLAYING";
      if (player.currentIndex === -1 && player.tracks.length > 0)
        player.currentIndex = 0;
      notify();
    },
    pause() {
      status = "PAUSED";
    },
    stop() {
      status = "STOPPED";
    },
    nextTrack() {
      if (player.tracks.length === 0) return;
      player.currentIndex = (player.currentIndex + 1) % player.tracks.length;
      status = "PLAYING";
      notify();
    },
    previousTrack() {
      if (player.tracks.length === 0) return;
      player.currentIndex =
        (player.currentIndex - 1 + player.tracks.length) % player.tracks.length;
      status = "PLAYING";
      notify();
    },
    setCurrentTrack(index) {
      if (index < 0 || index >= player.tracks.length) return;
      player.currentIndex = index;
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
      status = "STOPPED";
      listeners.clear();
    },
  };
  return player;
}
