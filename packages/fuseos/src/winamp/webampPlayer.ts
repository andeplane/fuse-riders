/**
 * The narrow slice of the `webamp` package this app depends on: a URL track and the
 * handful of instance methods the window drives. Kept separate from the real
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

export interface WebampPlayer {
  /** Mounts the skinned player as a child of `node`, centred within it. */
  renderInto(node: HTMLElement): Promise<void>;
  appendTracks(tracks: WebampTrack[]): void;
  /** Replaces the whole playlist and starts playing its first track. */
  setTracksToPlay(tracks: WebampTrack[]): void;
  play(): void;
  pause(): void;
  stop(): void;
  nextTrack(): void;
  previousTrack(): void;
  /** Loads the track at `index`; it starts only if the player is already playing, so a caller wanting sound follows with `play()`. */
  setCurrentTrack(index: number): void;
  /** Every queued track, in playlist order; only `url` is used (to key names against a track's own bookkeeping), but the real method returns much more per track. */
  getPlaylistTracks(): { url: string }[];
  getMediaStatus(): WebampStatus;
  /** Fires whenever the loaded track changes; null when playback stops with nothing loaded. */
  onTrackDidChange(
    callback: (track: { url: string } | null) => void,
  ): () => void;
  /** Stops audio and releases what Webamp can; the package itself documents that a full teardown is not possible. */
  dispose(): void;
}
