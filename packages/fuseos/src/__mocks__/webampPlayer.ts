import type {
  WebampPlayer,
  WebampPlaylistTrack,
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
  /** Loads the track at `index` without starting it, as a click in Webamp's playlist would. */
  setCurrentTrack(index: number): void;
  /** What a user does in Webamp's own eject dialog: the files join the queue as blob tracks and the first starts. */
  pickFiles(names: string[]): void;
  /** The user closes Webamp from its own title bar. */
  pressClose(): void;
  /** The user presses Webamp's own minimize button. */
  pressMinimize(): void;
};

export function createFakeWebampPlayer(): FakeWebampPlayer {
  let status: WebampStatus = "STOPPED";
  const trackListeners = new Set<(track: { url: string } | null) => void>();
  const closeListeners = new Set<() => void>();
  const minimizeListeners = new Set<() => void>();
  const notify = () => {
    const current = player.tracks[player.currentIndex];
    trackListeners.forEach((listener) =>
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
    pickFiles(names) {
      const first = player.tracks.length;
      player.tracks.push(
        ...names.map((name) => ({ url: `blob:${name}`, defaultName: name })),
      );
      player.currentIndex = first;
      status = "PLAYING";
      notify();
    },
    getPlaylistTracks: (): WebampPlaylistTrack[] =>
      player.tracks.map((track) => ({
        url: track.url,
        defaultName: track.defaultName ?? null,
      })),
    getMediaStatus: () => status,
    onTrackDidChange(callback) {
      trackListeners.add(callback);
      return () => trackListeners.delete(callback);
    },
    onClose(callback) {
      closeListeners.add(callback);
      return () => closeListeners.delete(callback);
    },
    onMinimize(callback) {
      minimizeListeners.add(callback);
      return () => minimizeListeners.delete(callback);
    },
    pressClose() {
      [...closeListeners].forEach((listener) => listener());
    },
    pressMinimize() {
      [...minimizeListeners].forEach((listener) => listener());
    },
    dispose() {
      player.disposed = true;
      status = "STOPPED";
      trackListeners.clear();
      closeListeners.clear();
      minimizeListeners.clear();
    },
  };
  return player;
}
