import { ALL_SONGS, MusicPlayer as createMusicPlayer } from "fuse-ui/music";
import type { MusicPlayer } from "fuse-ui/radio";
export type { MusicPlayer } from "fuse-ui/radio";
export interface Radio {
  element: HTMLElement;
  enable(value: boolean): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}
/** Game-specific controls over the common music player and full default catalogue. */
export function createRadio(
  document: Document,
  baseUrl: string,
  media: MusicPlayer,
): Radio {
  const element = document.createElement("div"),
    button = document.createElement("button"),
    next = document.createElement("button"),
    title = document.createElement("span");
  element.className = "radio";
  button.className = next.className = "quiet-button";
  button.type = next.type = "button";
  next.textContent = "NEXT ♫";
  next.setAttribute("aria-label", "Next radio track");
  title.setAttribute("aria-live", "polite");
  element.append(button, title, next);
  const player = createMusicPlayer(ALL_SONGS, {
    base: baseUrl,
    createMedia: () => media,
  });
  let enabled = true;
  const render = () => {
    button.textContent = player.playing ? "RADIO ON" : "RADIO OFF";
    title.textContent = player.error || player.song?.title || "";
  };
  const unsubscribe = player.subscribe(render);
  button.onclick = () => {
    if (enabled) {
      if (player.playing) player.pause();
      else player.play();
    }
  };
  next.onclick = () => {
    const index = ALL_SONGS.findIndex((song) => song.id === player.song?.id);
    player.select(ALL_SONGS[(index + 1) % ALL_SONGS.length]!.id);
  };
  render();
  return {
    element,
    setMuted: (value) => player.setMuted(value),
    enable(value) {
      enabled = value;
      element.hidden = !value;
      if (!value) player.pause();
    },
    destroy() {
      unsubscribe();
      player.destroy();
      button.onclick = next.onclick = null;
    },
  };
}
