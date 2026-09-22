import { MUSIC_TRACKS } from "fuse-ui/assets";
export interface Radio {
  element: HTMLElement;
  enable(value: boolean): void;
  destroy(): void;
}
export type MusicPlayer = Pick<
  HTMLAudioElement,
  "src" | "volume" | "play" | "pause" | "load" | "onended" | "onerror"
>;
/** Explicit opt-in radio. It never auto-starts on each controller or leaks across SPA remounts. */
export function createRadio(
  document: Document,
  baseUrl: string,
  player: MusicPlayer,
): Radio {
  const element = document.createElement("div"),
    button = document.createElement("button"),
    next = document.createElement("button"),
    title = document.createElement("span");
  element.className = "radio";
  button.className = next.className = "quiet-button";
  button.textContent = "RADIO OFF";
  next.textContent = "NEXT ♫";
  next.setAttribute("aria-label", "Next radio track");
  title.setAttribute("aria-live", "polite");
  element.append(button, title, next);
  let index = 0,
    playing = false,
    disposed = false,
    enabled = true,
    attempt = 0;
  player.volume = 0.18;
  const select = () => {
    const track = MUSIC_TRACKS[index]!;
    player.src = baseUrl + track.path.slice(1);
    title.textContent = track.title;
  };
  const stop = () => {
    attempt++;
    playing = false;
    player.pause();
    button.textContent = "RADIO OFF";
  };
  const play = () => {
    if (!enabled || disposed) return;
    const current = ++attempt;
    playing = true;
    button.textContent = "RADIO ON";
    void player.play().catch(() => {
      if (disposed || current !== attempt) return;
      stop();
      title.textContent = "Playback unavailable · retry or next";
    });
  };
  button.onclick = () => {
    if (playing) stop();
    else play();
  };
  next.onclick = () => {
    const resume = playing;
    stop();
    index = (index + 1) % MUSIC_TRACKS.length;
    select();
    if (resume) play();
  };
  player.onended = () => {
    if (playing && !disposed) next.click();
  };
  player.onerror = () => {
    if (!disposed) {
      stop();
      title.textContent = "Track unavailable · try next";
    }
  };
  select();
  return {
    element,
    enable(value) {
      enabled = value;
      element.hidden = !value;
      if (!value) stop();
    },
    destroy() {
      disposed = true;
      stop();
      player.onended = player.onerror = null;
      button.onclick = next.onclick = null;
      player.src = "";
      player.load();
    },
  };
}
