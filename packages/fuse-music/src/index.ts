import { ALL_SONGS, type Song } from "./catalog.js";
export { ALL_SONGS, type Song } from "./catalog.js";

export type MusicMedia = Pick<
  HTMLAudioElement,
  "src" | "volume" | "play" | "pause" | "load" | "onended" | "onerror"
> &
  Partial<
    Pick<
      HTMLAudioElement,
      | "currentTime"
      | "duration"
      | "paused"
      | "ended"
      | "readyState"
      | "onloadedmetadata"
      | "onpause"
      | "onplay"
      | "removeAttribute"
    >
  >;
export interface MusicOptions {
  base?: string;
  muted?: boolean;
  createMedia?: () => MusicMedia;
  /** A richer host may own its queue and OS media controls. */
  onEnded?: () => void;
  onPause?: () => void;
  onPlay?: () => void;
  retryOnGesture?: boolean;
}

/** Lazy streaming player. It owns music only; games retain their effects and UI. */
export function MusicPlayer(
  songs: readonly Song[] = ALL_SONGS,
  options: MusicOptions = {},
) {
  let media: MusicMedia | undefined;
  let index = 0,
    volume = 0.18,
    muted = Boolean(options.muted),
    playing = false;
  let disposed = false,
    attempt = 0,
    error = "",
    pendingSeek: number | undefined;
  let ownPause = false,
    ownPlay = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const base =
    options.base === "./" || options.base === ""
      ? "../"
      : (options.base ?? "/");
  const path = () =>
    `${base.endsWith("/") ? base : `${base}/`}${songs[index]!.path.replace(/^\//, "")}`;
  const pauseMedia = () => {
    attempt++;
    if (media?.paused === false) ownPause = true;
    media?.pause();
  };
  const start = () => {
    if (disposed || muted || !playing || volume <= 0 || !songs.length) return;
    if (!media) {
      media = (options.createMedia ?? (() => new Audio()))();
      media.onended = () => {
        if (playing) (options.onEnded ?? (() => self.next()))();
      };
      media.onpause = () => {
        if (ownPause) {
          ownPause = false;
          return;
        }
        if (media?.ended) return;
        if (options.onPause) options.onPause();
        else {
          playing = false;
          changed();
        }
      };
      media.onplay = () => {
        if (ownPlay) {
          ownPlay = false;
          return;
        }
        if (options.onPlay) options.onPlay();
        else {
          playing = true;
          changed();
        }
      };
      media.onerror = () => {
        if (disposed) return;
        pauseMedia();
        loaded = "";
        playing = false;
        error = "Track unavailable. Choose another song or retry.";
        changed();
      };
      media.onloadedmetadata = () => {
        if (media && pendingSeek !== undefined) {
          media.currentTime =
            media.duration !== undefined && Number.isFinite(media.duration)
              ? Math.min(pendingSeek, media.duration)
              : pendingSeek;
          pendingSeek = undefined;
        }
      };
    }
    media.volume = volume;
    // The host normalizes src to an absolute URL, so compare against our own selection.
    const source = path();
    if (loaded !== source) {
      loaded = source;
      ownPause = ownPlay = false;
      media.src = source;
    }
    if (media.paused === false) return;
    if (media.paused === true) ownPlay = true;
    const token = ++attempt;
    void media.play().then(
      () => {
        if (disposed || token !== attempt) return;
        error = "";
        changed();
      },
      () => {
        if (disposed || token !== attempt) return;
        ownPlay = false;
        if (!options.retryOnGesture) playing = false;
        error = "Playback unavailable · retry or next";
        changed();
      },
    );
  };
  let loaded = "";
  const self = {
    songs,
    get song() {
      return songs[index];
    },
    get playing() {
      return playing;
    },
    get error() {
      return error;
    },
    get volume() {
      return volume;
    },
    get position() {
      return pendingSeek ?? media?.currentTime ?? 0;
    },
    get duration() {
      const duration =
        loaded && loaded === path() ? media?.duration : undefined;
      return duration !== undefined && Number.isFinite(duration)
        ? duration
        : undefined;
    },
    get audible() {
      return Boolean(playing && !muted && volume > 0 && media && !media.paused);
    },
    play(id = songs[index]?.id, position?: number) {
      if (disposed || options.muted || !songs.length) return;
      const next = songs.findIndex((song) => song.id === id);
      if (next < 0) return;
      if (position !== undefined)
        position = Number.isFinite(position) ? Math.max(0, position) : 0;
      if (next !== index) {
        pauseMedia();
        index = next;
        pendingSeek = position ?? 0;
      } else if (position !== undefined)
        pendingSeek = Math.max(0, Number.isFinite(position) ? position : 0);
      playing = true;
      error = "";
      if (
        media &&
        loaded === path() &&
        (media.readyState ?? 0) >= 1 &&
        pendingSeek !== undefined
      ) {
        // Avoid re-seeking an unchanged resume point: servers without byte ranges can restart a song on any seek.
        if (Math.abs((media.currentTime ?? 0) - pendingSeek) > 0.5)
          media.currentTime =
            media.duration !== undefined && Number.isFinite(media.duration)
              ? Math.min(pendingSeek, media.duration)
              : pendingSeek;
        pendingSeek = undefined;
      }
      start();
      changed();
    },
    pause() {
      if (disposed) return;
      playing = false;
      pauseMedia();
      changed();
    },
    select(id: string) {
      if (disposed) return;
      const next = songs.findIndex((song) => song.id === id);
      if (next < 0) return;
      if (playing) {
        self.play(id, 0);
        return;
      }
      pauseMedia();
      index = next;
      pendingSeek = 0;
      error = "";
      changed();
    },
    next() {
      if (!songs.length || disposed) return;
      self.play(songs[(index + 1) % songs.length]!.id, 0);
    },
    previous() {
      if (!songs.length || disposed) return;
      self.play(songs[(index - 1 + songs.length) % songs.length]!.id, 0);
    },
    unlock() {
      start();
    },
    setMuted(value: boolean) {
      if (options.muted || disposed || muted === value) return;
      muted = value;
      if (value) pauseMedia();
      else start();
      changed();
    },
    setVolume(value: number) {
      if (disposed || !Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (media) media.volume = volume;
      if (volume === 0) pauseMedia();
      else start();
      changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      playing = false;
      pauseMedia();
      loaded = "";
      pendingSeek = undefined;
      if (media) {
        if (media.removeAttribute) media.removeAttribute("src");
        else media.src = "";
        media.load();
      }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      pauseMedia();
      if (media) {
        media.onended =
          media.onerror =
          media.onloadedmetadata =
          media.onpause =
          media.onplay =
            null;
        if (media.removeAttribute) media.removeAttribute("src");
        else media.src = "";
        media.load();
      }
      listeners.clear();
    },
  };
  return self;
}
export type Player = ReturnType<typeof MusicPlayer>;
