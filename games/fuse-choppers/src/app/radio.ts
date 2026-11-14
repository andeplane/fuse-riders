import { MUSIC_TRACKS } from "fuse-ui/assets";
import type { MusicPlayer } from "fuse-ui/radio";
import type { Store } from "./session.js";

export const RADIO_KEY = "fuse-choppers-radio-v1";

export function createChopperRadio(options: {
  document: Document;
  player: MusicPlayer;
  store: Pick<Store, "getItem" | "setItem">;
  baseUrl: string;
  muted: boolean;
  autoStart: boolean;
}) {
  const { document: doc, player, store, baseUrl } = options;
  const forcedMute = options.muted;
  let muted = forcedMute;
  let index = 0,
    playing = options.autoStart,
    repeat = false,
    level = 0.22,
    unlocked = false,
    disposed = false,
    attempt = 0;
  const saved: unknown = (() => {
    try {
      return JSON.parse(store.getItem(RADIO_KEY) ?? "null") as unknown;
    } catch {
      return undefined;
    }
  })();
  if (saved && typeof saved === "object") {
    const state = saved as Record<string, unknown>;
    const track = MUSIC_TRACKS.findIndex((entry) => entry.id === state.track);
    if (track >= 0) index = track;
    if (typeof state.playing === "boolean") playing = state.playing;
    if (typeof state.repeat === "boolean") repeat = state.repeat;
    if (typeof state.volume === "number" && Number.isFinite(state.volume))
      level = Math.max(0, Math.min(1, state.volume));
  }
  const element = doc.createElement("dialog");
  element.className = "fc-radio";
  element.setAttribute("aria-label", "Fuse Choppers Radio");
  const heading = doc.createElement("h2");
  heading.textContent = "FUSE CHOPPERS RADIO";
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  const select = doc.createElement("select");
  select.setAttribute("aria-label", "Radio track");
  for (const [i, track] of MUSIC_TRACKS.entries()) {
    const option = doc.createElement("option");
    option.value = String(i);
    option.textContent = track.title;
    option.selected = i === index;
    select.append(option);
  }
  const makeButton = (text: string, action: () => void) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.onclick = action;
    return button;
  };
  const save = () => {
    if (muted || disposed) return;
    try {
      store.setItem(
        RADIO_KEY,
        JSON.stringify({
          track: MUSIC_TRACKS[index]!.id,
          playing,
          repeat,
          volume: level,
        }),
      );
    } catch {
      return;
    }
  };
  const render = () => {
    play.textContent = playing && !muted ? "PAUSE" : "PLAY";
    play.setAttribute("aria-pressed", String(playing && !muted));
    loop.setAttribute("aria-pressed", String(repeat));
    loop.textContent = repeat ? "REPEAT SONG ON" : "REPEAT SONG OFF";
    status.textContent = muted
      ? "Audio muted by preview URL"
      : MUSIC_TRACKS[index]!.title;
  };
  const stop = () => {
    attempt++;
    player.pause();
  };
  const start = () => {
    if (muted || disposed || !playing || !unlocked) return;
    const token = ++attempt;
    const src = baseUrl + MUSIC_TRACKS[index]!.path.slice(1);
    if (selected !== src) {
      player.src = src;
      selected = src;
    }
    void player.play().catch(() => {
      if (disposed || token !== attempt) return;
      playing = false;
      stop();
      render();
      status.textContent =
        "Playback unavailable. Press PLAY to retry or choose another track.";
    });
  };
  let selected = "";
  const choose = (next: number) => {
    if (muted || disposed) return;
    stop();
    index = (next + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    for (const option of select.querySelectorAll("option"))
      option.selected = option.value === String(index);
    selected = "";
    render();
    save();
    start();
  };
  const previous = makeButton("PREVIOUS", () => choose(index - 1));
  const play = makeButton("PLAY", () => {
    if (muted || disposed) return;
    unlocked = true;
    playing = !playing;
    if (playing) start();
    else stop();
    render();
    save();
  });
  const next = makeButton("NEXT", () => choose(index + 1));
  const loop = makeButton("REPEAT SONG OFF", () => {
    if (muted || disposed) return;
    repeat = !repeat;
    render();
    save();
  });
  const volume = doc.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = String(Math.round(level * 100));
  volume.setAttribute("aria-label", "Music volume");
  const label = doc.createElement("label");
  label.textContent = "MUSIC VOLUME";
  label.append(volume);
  player.volume = level;
  volume.oninput = () => {
    if (muted || disposed) return;
    level = Number(volume.value) / 100;
    player.volume = level;
    save();
  };
  select.onchange = () => choose(Number(select.value));
  player.onended = () => {
    if (playing) choose(repeat ? index : index + 1);
  };
  player.onerror = () => {
    if (disposed || muted) return;
    playing = false;
    selected = "";
    stop();
    render();
    status.textContent =
      "Track unavailable. Press PLAY to retry or choose another track.";
  };
  const transport = doc.createElement("div");
  transport.className = "fc-radio-transport";
  transport.append(previous, play, next);
  const close = makeButton("BACK TO GAME", () => element.close());
  element.append(heading, status, select, transport, loop, label, close);
  for (const control of [previous, play, next, loop, select, volume])
    control.disabled = muted;
  render();
  return {
    element,
    setMuted(value: boolean) {
      if (forcedMute || disposed) return;
      muted = value;
      if (value) stop();
      else start();
      render();
    },
    unlock() {
      if (unlocked || disposed) return;
      unlocked = true;
      start();
    },
    destroy() {
      disposed = true;
      stop();
      player.onended = player.onerror = null;
      player.src = "";
      player.load();
      element.remove();
    },
  };
}
