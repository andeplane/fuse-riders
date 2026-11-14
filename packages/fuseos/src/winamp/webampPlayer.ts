/**
 * The narrow slice of the `webamp` package this app depends on: a URL track and the
 * handful of instance methods the desktop drives. Kept separate from the real
 * `Webamp` class so the app never imports it outside `main.tsx` (loaded lazily, on first
 * use) and so tests can pass a fake that implements only this shape.
 */
export type WebampTrack = {
  url: string;
  defaultName?: string;
  /** Tags given up front; without them Webamp fetches the file to read ID3 tags. */
  metaData?: { artist: string; title: string; album?: string };
  /** Seconds, given up front; without it Webamp fetches enough of the file to measure it. */
  duration?: number;
};

export type WebampStatus = "PLAYING" | "PAUSED" | "STOPPED";

/** What Webamp hands back per queued track: the url it was given and, for a file the user picked in Webamp's own dialog, its name. */
export type WebampPlaylistTrack = { url: string; defaultName?: string | null };

export interface WebampPlayer {
  /** Mounts the skinned player as a child of `node`, centred within it; its windows then drag inside `node`. */
  renderInto(node: HTMLElement): Promise<void>;
  appendTracks(tracks: WebampTrack[]): void;
  play(): void;
  pause(): void;
  stop(): void;
  nextTrack(): void;
  previousTrack(): void;
  /** 0 to 100, as Webamp's own slider; optional so a player without one still fits. */
  setVolume?(volume: number): void;
  /** Loads and plays the track at `index` in the playlist. */
  setCurrentTrack(index: number): void;
  /** Every queued track, in playlist order; the real method returns much more per track. */
  getPlaylistTracks(): WebampPlaylistTrack[];
  getMediaStatus(): WebampStatus;
  /** Fires whenever the loaded track changes; null when playback stops with nothing loaded. */
  onTrackDidChange(
    callback: (track: { url: string } | null) => void,
  ): () => void;
  /** Fires when the user closes Webamp from its own title bar or menu. */
  onClose(callback: () => void): () => void;
  /** Fires when the user presses Webamp's own minimize button; hiding it is the host's job. */
  onMinimize(callback: () => void): () => void;
  /** Stops audio and releases what Webamp can; the package itself documents that a full teardown is not possible. */
  dispose(): void;
}
