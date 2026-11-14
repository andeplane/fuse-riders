/**
 * The narrow slice of the `webamp` package this app depends on: an object URL track and
 * the handful of instance methods the window drives. Kept separate from the real
 * `Webamp` class so the app never imports it outside `App.tsx` (loaded lazily, on first
 * use) and so tests can pass a fake that implements only this shape.
 */
export type WebampTrack = { url: string; defaultName?: string };

export type WebampStatus = "PLAYING" | "PAUSED" | "STOPPED";

export interface WebampPlayer {
  /** Mounts the skinned player as a child of `node`, centred within it. */
  renderInto(node: HTMLElement): Promise<void>;
  appendTracks(tracks: WebampTrack[]): void;
  play(): void;
  pause(): void;
  stop(): void;
  nextTrack(): void;
  previousTrack(): void;
  setCurrentTrack?(index: number): void;
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
