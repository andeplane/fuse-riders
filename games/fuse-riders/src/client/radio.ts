import type { SafeStorage } from "./safe-storage.js";

/**
 * Fuse Riders Radio: what plays and in what order, persisted between visits. Mute and volume are stored
 * separately with the other audio settings (`fuse-riders-audio`); this is the listening state on top.
 */
import { MUSIC_TRACKS } from "fuse-ui/assets";
export { MUSIC_TRACKS } from "fuse-ui/assets";
export type TrackId = (typeof MUSIC_TRACKS)[number]["id"];
/** `all` plays every track in order; `playlist` plays the listener's own list (falling back to all while it is empty). */
export type RadioSource = "all" | "playlist";
export interface RadioState {
  track: TrackId;
  /** Seconds into `track` to resume from after a page load or pause. */
  position: number;
  paused: boolean;
  loopSong: boolean;
  loopPlaylist: boolean;
  source: RadioSource;
  playlist: TrackId[];
}

export const RADIO_KEY = "fuse-riders-radio-v1";
/** Longer than any track; a larger stored position is corrupt rather than a real resume point. */
const MAX_POSITION = 60 * 60;
/** Previous within this many seconds of a track's start goes back a track; later it restarts the track. */
export const RESTART_THRESHOLD = 3;

export function defaultRadio(): RadioState {
  return {
    track: MUSIC_TRACKS[0].id,
    position: 0,
    paused: false,
    loopSong: false,
    loopPlaylist: true,
    source: "all",
    playlist: [],
  };
}

const trackIds: ReadonlySet<string> = new Set(
  MUSIC_TRACKS.map((track) => track.id),
);
export const isTrackId = (value: unknown): value is TrackId =>
  typeof value === "string" && trackIds.has(value);
export const trackById = (id: TrackId): (typeof MUSIC_TRACKS)[number] =>
  MUSIC_TRACKS.find((track) => track.id === id)!;

/** Validates stored radio state field by field: a missing or corrupt field takes its default, never the whole state. */
export function parseRadio(raw: string | null): RadioState {
  const state = defaultRadio();
  let value: unknown;
  try {
    value = raw === null ? undefined : JSON.parse(raw);
  } catch {
    return state;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return state;
  const stored = value as Record<string, unknown>;
  if (isTrackId(stored.track)) {
    state.track = stored.track;
    const position = stored.position;
    if (
      typeof position === "number" &&
      Number.isFinite(position) &&
      position >= 0 &&
      position <= MAX_POSITION
    )
      state.position = position;
  }
  for (const flag of ["paused", "loopSong", "loopPlaylist"] as const)
    if (typeof stored[flag] === "boolean") state[flag] = stored[flag];
  if (stored.source === "all" || stored.source === "playlist")
    state.source = stored.source;
  if (Array.isArray(stored.playlist))
    state.playlist = [...new Set(stored.playlist.filter(isTrackId))];
  return state;
}
/** Blocked storage reads as defaults: `safeStorage` never throws, and a plain fake might. */
export function loadRadio(storage: SafeStorage): RadioState {
  try {
    return parseRadio(storage.getItem(RADIO_KEY));
  } catch {
    return defaultRadio();
  }
}
export function saveRadio(storage: SafeStorage, state: RadioState): void {
  try {
    storage.setItem(RADIO_KEY, JSON.stringify(state));
  } catch {
    /* A full or blocked store keeps playing without persistence. */
  }
}

/** The order tracks play in for the current source. */
export function radioQueue(state: RadioState): readonly TrackId[] {
  return state.source === "playlist" && state.playlist.length
    ? state.playlist
    : MUSIC_TRACKS.map((track) => track.id);
}
/**
 * The track after the current one. A finished song repeats with loop song; a finished playlist stops
 * (undefined) unless loop playlist is on. All tracks always wrap, and a listener's Next always wraps.
 */
export function followingTrack(
  state: RadioState,
  reason: "ended" | "next",
): TrackId | undefined {
  if (reason === "ended" && state.loopSong) return state.track;
  const queue = radioQueue(state);
  const index = queue.indexOf(state.track);
  if (index < 0) return queue[0];
  if (index + 1 < queue.length) return queue[index + 1];
  const playlistEnded =
    reason === "ended" &&
    state.source === "playlist" &&
    state.playlist.length > 0 &&
    !state.loopPlaylist;
  return playlistEnded ? undefined : queue[0];
}
export function precedingTrack(state: RadioState): TrackId {
  const queue = radioQueue(state);
  const index = queue.indexOf(state.track);
  return index < 0
    ? queue[0]!
    : queue[(index - 1 + queue.length) % queue.length]!;
}
/** Adds a track to the end of the playlist, or removes it if already present. */
export function togglePlaylistTrack(
  playlist: readonly TrackId[],
  id: TrackId,
): TrackId[] {
  return playlist.includes(id)
    ? playlist.filter((entry) => entry !== id)
    : [...playlist, id];
}

export type RadioShortcut = "radio" | "muteAll" | "muteMusic" | "muteEffects";
export interface ShortcutKey {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  getModifierState?(key: string): boolean;
}
/**
 * Ctrl+A opens the radio, Ctrl+M mutes everything, Ctrl+Alt+M music only, Ctrl+Alt+E effects only. Uses physical
 * key codes so layouts agree. AltGr reports as Ctrl+Alt on Windows and types characters (AltGr+E is €), so it is never a shortcut.
 */
export function radioShortcut(key: ShortcutKey): RadioShortcut | undefined {
  if (
    !key.ctrlKey ||
    key.metaKey ||
    key.shiftKey ||
    key.getModifierState?.("AltGraph")
  )
    return undefined;
  if (key.altKey)
    return key.code === "KeyM"
      ? "muteMusic"
      : key.code === "KeyE"
        ? "muteEffects"
        : undefined;
  return key.code === "KeyA"
    ? "radio"
    : key.code === "KeyM"
      ? "muteAll"
      : undefined;
}
export const RADIO_SHORTCUT_HINT =
  "Ctrl+A radio · Ctrl+M mute all · Ctrl+Alt+M music · Ctrl+Alt+E effects";

/** `m:ss` for the radio display; unknown lengths show dashes. */
export function formatTrackTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return "-:--";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
