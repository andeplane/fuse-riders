import type { WebampPlayer } from "./webampPlayer";

/** What one Winamp window is doing right now: how many tracks are queued, their display names in playlist order, the loaded one's name and whether it is playing. */
export type WinampStatus = {
  trackCount: number;
  /** Every queued track's display name, in playlist order. */
  tracks: string[];
  currentTrack: string | undefined;
  playing: boolean;
};

/**
 * The transport a Winamp window drives, over the same Webamp instance the mouse uses. The window's view model
 * publishes one in the Winamp registry so the Office Assistant ("play music") presses exactly the buttons a
 * user sees. Picking a local file still needs the user's own file dialog, which nothing can drive.
 */
export interface WinampControls {
  status(): WinampStatus;
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
}

/** `trackNames` maps a track's url (blob: or a site path) to the name it was created from, since Webamp only ever hands back the url. */
export function createWinampControls(
  player: WebampPlayer,
  trackNames: Map<string, string>,
): { controls: WinampControls; dispose: () => void } {
  let currentUrl: string | undefined;
  const unsubscribe = player.onTrackDidChange((track) => {
    currentUrl = track?.url;
  });
  const controls: WinampControls = {
    status: () => {
      const playlist = player.getPlaylistTracks();
      return {
        trackCount: playlist.length,
        tracks: playlist.map((track) => trackNames.get(track.url) ?? track.url),
        currentTrack: currentUrl ? trackNames.get(currentUrl) : undefined,
        playing: player.getMediaStatus() === "PLAYING",
      };
    },
    play: () => player.play(),
    pause: () => player.pause(),
    stop: () => player.stop(),
    next: () => player.nextTrack(),
    previous: () => player.previousTrack(),
  };
  return { controls, dispose: unsubscribe };
}
