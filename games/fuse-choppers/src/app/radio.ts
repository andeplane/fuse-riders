import { ALL_SONGS, MusicPlayer as createMusicPlayer } from "fuse-ui/music";
import type { MusicPlayer } from "fuse-ui/radio";
import type { Store } from "./session.js";
export const RADIO_KEY = "fuse-choppers-radio-v1";
/** Choppers' dialog and preferences; streaming and track loading belong to fuse-music. */
export function createChopperRadio(options: {
  document: Document;
  player: MusicPlayer;
  store: Pick<Store, "getItem" | "setItem">;
  baseUrl: string;
  muted: boolean;
  autoStart: boolean;
}) {
  const { document: doc, store } = options;
  let index = 0,
    playing = options.autoStart,
    repeat = false,
    level = 0.22;
  let muted = options.muted,
    unlocked = false,
    disposed = false;
  try {
    const saved: unknown = JSON.parse(store.getItem(RADIO_KEY) ?? "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const state = saved as Record<string, unknown>;
      const found = ALL_SONGS.findIndex((song) => song.id === state.track);
      if (found >= 0) index = found;
      if (typeof state.playing === "boolean") playing = state.playing;
      if (typeof state.repeat === "boolean") repeat = state.repeat;
      if (typeof state.volume === "number" && Number.isFinite(state.volume))
        level = Math.max(0, Math.min(1, state.volume));
    }
  } catch {
    /* Blocked or corrupt storage uses defaults. */
  }
  const player = createMusicPlayer(ALL_SONGS, {
    base: options.baseUrl,
    muted: options.muted,
    createMedia: () => options.player,
    onEnded: () => choose(repeat ? index : index + 1),
  });
  player.select(ALL_SONGS[index]!.id);
  player.setVolume(level);
  const element = doc.createElement("dialog"),
    heading = doc.createElement("h2"),
    status = doc.createElement("p"),
    select = doc.createElement("select");
  element.className = "fc-radio";
  element.setAttribute("aria-label", "Fuse Choppers Radio");
  heading.textContent = "FUSE CHOPPERS RADIO";
  status.setAttribute("role", "status");
  select.setAttribute("aria-label", "Radio track");
  for (const [i, song] of ALL_SONGS.entries()) {
    const option = doc.createElement("option");
    option.value = String(i);
    option.textContent = song.title;
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
          track: ALL_SONGS[index]!.id,
          playing,
          repeat,
          volume: level,
        }),
      );
    } catch {
      /* Playing needs no storage. */
    }
  };
  const start = () => {
    if (playing && unlocked && !muted && !disposed)
      player.play(ALL_SONGS[index]!.id);
  };
  const choose = (value: number) => {
    if (muted || disposed || !Number.isInteger(value)) return;
    index = (value + ALL_SONGS.length) % ALL_SONGS.length;
    player.pause();
    player.select(ALL_SONGS[index]!.id);
    start();
    render();
    save();
  };
  const previous = makeButton("PREVIOUS", () => choose(index - 1));
  const play = makeButton("PLAY", () => {
    if (muted || disposed) return;
    unlocked = true;
    playing = !playing;
    if (playing) start();
    else player.pause();
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
  const volume = doc.createElement("input"),
    label = doc.createElement("label");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = String(Math.round(level * 100));
  volume.setAttribute("aria-label", "Music volume");
  label.textContent = "MUSIC VOLUME";
  label.append(volume);
  volume.oninput = () => {
    if (muted || disposed) return;
    level = Number(volume.value) / 100;
    player.setVolume(level);
    save();
  };
  select.onchange = () => choose(Number(select.value));
  const render = () => {
    play.textContent = playing && !muted ? "PAUSE" : "PLAY";
    play.setAttribute("aria-pressed", String(playing && !muted));
    loop.textContent = repeat ? "REPEAT SONG ON" : "REPEAT SONG OFF";
    loop.setAttribute("aria-pressed", String(repeat));
    status.textContent = muted
      ? "Audio muted by preview URL"
      : player.error || ALL_SONGS[index]!.title;
    for (const option of select.querySelectorAll("option"))
      option.selected = option.value === String(index);
  };
  const unsubscribe = player.subscribe(() => {
    if (player.error) playing = false;
    render();
  });
  const transport = doc.createElement("div");
  transport.className = "fc-radio-transport";
  transport.append(previous, play, next);
  element.append(
    heading,
    status,
    select,
    transport,
    loop,
    label,
    makeButton("BACK TO GAME", () => element.close()),
  );
  for (const control of [previous, play, next, loop, select, volume])
    control.disabled = options.muted;
  render();
  return {
    element,
    setMuted(value: boolean) {
      if (options.muted || disposed) return;
      muted = value;
      player.setMuted(value);
      if (!value && !player.playing) start();
      render();
    },
    unlock() {
      if (unlocked || disposed) return;
      unlocked = true;
      start();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      player.destroy();
      element.remove();
    },
  };
}
