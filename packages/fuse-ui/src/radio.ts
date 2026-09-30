import { MUSIC_TRACKS } from "./assets.js";
export type MusicPlayer = Pick<
  HTMLAudioElement,
  "src" | "volume" | "play" | "pause" | "load" | "onended" | "onerror"
>;
/** Shared opt-in player, adapted from Ball Bros' radio in 06b5fc2d. No stored preferences. */
export function createRadio(
  document: Document,
  baseUrl: string,
  player: MusicPlayer,
  muted = false,
) {
  const element = document.createElement("div"),
    button = document.createElement("button"),
    next = document.createElement("button"),
    title = document.createElement("span"),
    volume = document.createElement("input"),
    label = document.createElement("label");
  element.className = "controls radio";
  button.type = next.type = "button";
  button.textContent = "Play radio";
  next.textContent = "Next track";
  title.textContent = MUSIC_TRACKS[0].title;
  title.setAttribute("aria-live", "polite");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "18";
  volume.setAttribute("aria-label", "Music volume");
  label.textContent = "Music ";
  label.append(volume);
  element.append(button, next, title, label);
  let index = 0,
    playing = false,
    disposed = false,
    attempt = 0;
  player.volume = 0.18;
  const stop = () => {
    attempt++;
    playing = false;
    player.pause();
    button.textContent = "Play radio";
    button.setAttribute("aria-pressed", "false");
  };
  const select = () => {
    player.src = baseUrl + MUSIC_TRACKS[index]!.path.slice(1);
    title.textContent = MUSIC_TRACKS[index]!.title;
  };
  const play = () => {
    if (muted || disposed) return;
    if (!player.src) select();
    const token = ++attempt;
    playing = true;
    button.textContent = "Pause radio";
    button.setAttribute("aria-pressed", "true");
    void player.play().catch(() => {
      if (disposed || token !== attempt) return;
      stop();
      title.textContent = "Playback unavailable · retry or next";
    });
  };
  button.onclick = () => (playing ? stop() : play());
  next.onclick = () => {
    if (muted || disposed) return;
    const resume = playing;
    stop();
    index = (index + 1) % MUSIC_TRACKS.length;
    select();
    if (resume) play();
  };
  volume.oninput = () => {
    player.volume = Number(volume.value) / 100;
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
  if (muted) {
    button.disabled = next.disabled = volume.disabled = true;
    title.textContent = "Audio muted by preview URL";
  }
  return {
    element,
    pause: stop,
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      player.onended = player.onerror = null;
      button.onclick = next.onclick = volume.oninput = null;
      player.src = "";
      player.load();
    },
  };
}
