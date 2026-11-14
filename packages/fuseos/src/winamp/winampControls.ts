import type { WebampPlayer, WebampTrack } from "./webampPlayer";

/** What Winamp is doing right now: how many tracks are queued, their display names in playlist order, the loaded one's name and whether it is playing. */
export type WinampStatus = {
  trackCount: number;
  /** Every queued track's display name, in playlist order. */
  tracks: string[];
  currentTrack: string | undefined;
  playing: boolean;
};

/**
 * The transport the desktop's Winamp drives, over the same Webamp instance the mouse uses. The
 * player publishes one in the Winamp registry so the Office Assistant ("play music") presses
 * exactly the buttons a user sees. Picking a local file still needs the user's own file dialog
 * (Webamp's eject button), which nothing can drive.
 */
export interface WinampControls {
  status(): WinampStatus;
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
  /** Sets the volume, 0 to 100; absent when the player has no volume control. */
  setVolume?(percent: number): void;
  /** Appends files to the playlist under their own names and plays the first of them (Napster's downloads). */
  playFiles(files: readonly { track: WebampTrack; name: string }[]): void;
}

/**
 * `trackNames` maps a track's url to the name it was queued under (the soundtrack's "Title (Game)"),
 * since Webamp only ever hands back the url; a file the user picked in Webamp's own dialog carries
 * its file name from Webamp instead.
 */
export function createWinampControls(
  player: WebampPlayer,
  trackNames: Map<string, string>,
): { controls: WinampControls; dispose: () => void } {
  let currentUrl: string | undefined;
  const nameOf = (track: { url: string; defaultName?: string | null }) =>
    trackNames.get(track.url) ?? track.defaultName ?? track.url;
  const unsubscribe = player.onTrackDidChange((track) => {
    currentUrl = track?.url;
  });
  const controls: WinampControls = {
    status: () => {
      const playlist = player.getPlaylistTracks();
      const current = playlist.find((track) => track.url === currentUrl);
      return {
        trackCount: playlist.length,
        tracks: playlist.map(nameOf),
        currentTrack: current
          ? nameOf(current)
          : currentUrl
            ? trackNames.get(currentUrl)
            : undefined,
        playing: player.getMediaStatus() === "PLAYING",
      };
    },
    play: () => player.play(),
    pause: () => player.pause(),
    stop: () => player.stop(),
    next: () => player.nextTrack(),
    previous: () => player.previousTrack(),
    ...(player.setVolume
      ? { setVolume: (percent: number) => player.setVolume?.(percent) }
      : {}),
    playFiles: (files) => {
      if (files.length === 0) return;
      const first = player.getPlaylistTracks().length;
      files.forEach(({ track, name }) => trackNames.set(track.url, name));
      player.appendTracks(files.map(({ track }) => track));
      player.setCurrentTrack(first);
      player.play();
    },
  };
  return { controls, dispose: unsubscribe };
}
