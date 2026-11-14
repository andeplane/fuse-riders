/**
 * The music. Every sound of the arena is synthesised (`src/render/sound.ts`); the music is the one thing that may
 * come from a file, and the files are optional. `public/killer-fuse/audio/music/manifest.json` lists the ones that
 * are actually there, so a game with no music makes no request for one and logs no 404; with no file for the
 * moment it wants, the arena simply keeps its synthesised bed.
 *
 * Music plays through a media element and not the Web Audio graph, as every other game here does: the phone's
 * volume keys reach it, it streams instead of holding a decoded minute of PCM, and it survives the effects context
 * being suspended. "Volume" is the element's own, so a crossfade and a duck are volume ramps on a timer.
 *
 * Nothing starts before the browser's autoplay unlock (`unlock`, from the first press anywhere), nothing plays
 * while muted, and a muted page never even fetches the manifest.
 */
import type { MapId } from "../online/index.js";

/** The moments a track may be written for. The file is this name with `.mp3` or `.ogg`. */
export const MUSIC_TRACKS = [
  "lobby",
  "match-day",
  "match-dusk",
  "match-night",
  "victory",
  "defeat",
] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];

/** The formats the manifest may name; anything else is ignored. */
export const MUSIC_EXTENSIONS = [".mp3", ".ogg"] as const;

/** Victory and defeat are stings: they play once and stop. Everything else loops. */
const LOOPS: ReadonlySet<MusicTrack> = new Set<MusicTrack>([
  "lobby",
  "match-day",
  "match-dusk",
  "match-night",
]);

/**
 * What a track falls back to when nobody wrote its file: one match track covers all three maps, so a single
 * `match-day.mp3` is enough to score the whole game.
 */
const FALLBACK: Readonly<Partial<Record<MusicTrack, MusicTrack>>> = {
  "match-dusk": "match-day",
  "match-night": "match-day",
};

const MATCH: Readonly<Record<MapId, MusicTrack>> = {
  1: "match-day",
  2: "match-dusk",
  3: "match-night",
};

/** Seconds a crossfade takes, and how often the fade timer moves it. */
export const FADE_SECONDS = 1.6;
export const FADE_TICK_MS = 50;
/** A loud effect holds the music down to this much of its level, for this long. */
export const DUCK_LEVEL = 0.45;
export const DUCK_SECONDS = 0.9;
/** The music's share of the mix when it is on; the effects are the renderer's own. */
export const MUSIC_LEVEL = 0.34;

const isTrack = (name: string): name is MusicTrack =>
  (MUSIC_TRACKS as readonly string[]).includes(name);

/**
 * The tracks `raw` says are there, as track name to file name. The shape is `{ "files": ["lobby.mp3", …] }`:
 * whoever drops a file in writes its name here. Anything else in the list — a name no track is called, a format
 * no browser here plays, a path with a folder in it — is left out rather than throwing, because a mistyped
 * manifest should cost the music, not the page.
 */
export function parseMusicManifest(
  raw: unknown,
): ReadonlyMap<MusicTrack, string> {
  const found = new Map<MusicTrack, string>();
  if (typeof raw !== "object" || raw === null) return found;
  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files)) return found;
  for (const entry of files) {
    if (
      typeof entry !== "string" ||
      entry.includes("/") ||
      entry.includes("\\")
    )
      continue;
    const extension = MUSIC_EXTENSIONS.find((end) =>
      entry.toLowerCase().endsWith(end),
    );
    if (!extension) continue;
    const name = entry.slice(0, entry.length - extension.length);
    if (isTrack(name) && !found.has(name)) found.set(name, entry);
  }
  return found;
}

/** The track to play for `wanted` given the files there are: itself, what it falls back to, or none. */
export function resolveTrack(
  wanted: MusicTrack | null,
  have: ReadonlySet<MusicTrack>,
): MusicTrack | null {
  let track = wanted;
  const seen = new Set<MusicTrack>();
  while (track && !have.has(track)) {
    if (seen.has(track)) return null;
    seen.add(track);
    track = FALLBACK[track] ?? null;
  }
  return track;
}

/** Where the game is, as far as the music cares. */
export interface MusicScene {
  readonly stage: "lobby" | "running" | "between" | "over";
  /** The map being played, when there is a game. */
  readonly mapId: MapId | undefined;
  /** How the set ended for this device: a watcher gets the victory track. */
  readonly outcome: "won" | "lost" | undefined;
}

/** The track a moment asks for, before the files it has are taken into account. */
export function sceneTrack(scene: MusicScene): MusicTrack {
  if (scene.stage === "over")
    return scene.outcome === "lost" ? "defeat" : "victory";
  if (scene.stage === "lobby" || scene.mapId === undefined) return "lobby";
  return MATCH[scene.mapId];
}

/** The part of a media element the music uses, so a test can hand over a typed fake instead of one. */
export interface MusicElement {
  volume: number;
  loop: boolean;
  currentTime: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

/** Only what the manifest fetch needs of a `Response`. */
export interface MusicResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export interface MusicDeps {
  /** The music folder, ending in a slash. */
  readonly url: string;
  readonly fetch: (url: string) => Promise<MusicResponse>;
  readonly element: (src: string) => MusicElement;
  /** Starts a repeating timer and gives back the way to stop it. */
  readonly repeat: (ms: number, run: () => void) => () => void;
  /** Seconds, for the duck; only differences matter. */
  readonly now: () => number;
}

/**
 * The music director: which track the moment wants, crossfaded into whatever is playing, ducked under a loud
 * effect, silent while muted or switched off, and silent altogether while there are no files.
 */
export class Music {
  private readonly elements = new Map<MusicTrack, MusicElement>();
  private files: ReadonlyMap<MusicTrack, string> = new Map();
  private asked: MusicTrack | null = null;
  private current: MusicTrack | null = null;
  private muted: boolean;
  private on: boolean;
  private level = MUSIC_LEVEL;
  private unlocked = false;
  private loading: Promise<void> | undefined;
  private stopFade: (() => void) | undefined;
  private duckedUntil = -1;
  private destroyed = false;

  constructor(
    private readonly deps: MusicDeps,
    state: { readonly muted: boolean; readonly on: boolean },
  ) {
    this.muted = state.muted;
    this.on = state.on;
  }

  /** The tracks there are files for; empty until the manifest has been read. */
  get available(): ReadonlySet<MusicTrack> {
    return new Set(this.files.keys());
  }

  /** The track sounding now, for tests and the debug hook. */
  get playing(): MusicTrack | null {
    return this.current;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.apply();
  }

  setOn(on: boolean): void {
    this.on = on;
    this.apply();
  }

  /** 0 to 1; the music's share of the mix, under the duck. */
  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    this.apply();
  }

  /** The browser will let sound through now: the first press anywhere on the page. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.apply();
  }

  /** Holds the music down for a moment so a kill or a sting is heard over it. */
  duck(): void {
    this.duckedUntil = this.deps.now() + DUCK_SECONDS;
    this.apply();
  }

  /** The moment the game is at; the same scene twice does nothing. */
  show(scene: MusicScene): void {
    this.want(sceneTrack(scene));
  }

  /** The track to play, before fallbacks; `null` for silence. */
  want(track: MusicTrack | null): void {
    if (track === this.asked) return;
    this.asked = track;
    this.apply();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopFade?.();
    this.stopFade = undefined;
    for (const element of this.elements.values()) element.pause();
    this.elements.clear();
    this.current = null;
  }

  /**
   * Reads the manifest, once. A page that is muted or has the music off never asks for it, so a preview makes no
   * audio request at all; a manifest that is missing or malformed leaves the game with no music and no error.
   */
  private read(): void {
    if (this.loading || this.destroyed) return;
    this.loading = this.deps
      .fetch(`${this.deps.url}manifest.json`)
      .then(async (response) => {
        if (!response.ok) return;
        this.files = parseMusicManifest(await response.json());
        this.apply();
      })
      .catch(() => {
        // No manifest, or nothing that parses: the game plays its synthesised bed and nothing else.
      });
  }

  private silent(): boolean {
    return this.muted || !this.on || !this.unlocked || this.destroyed;
  }

  private target(): number {
    if (this.silent()) return 0;
    const ducked = this.deps.now() < this.duckedUntil;
    return this.level * (ducked ? DUCK_LEVEL : 1);
  }

  private element(track: MusicTrack): MusicElement | undefined {
    const file = this.files.get(track);
    if (!file) return undefined;
    let element = this.elements.get(track);
    if (!element) {
      element = this.deps.element(`${this.deps.url}${file}`);
      element.loop = LOOPS.has(track);
      element.volume = 0;
      this.elements.set(track, element);
    }
    return element;
  }

  private apply(): void {
    if (this.destroyed) return;
    if (this.silent()) {
      // Silence pauses rather than plays at nothing: a muted page never downloads a track.
      this.stopFade?.();
      this.stopFade = undefined;
      for (const element of this.elements.values()) element.pause();
      this.current = null;
      return;
    }
    this.read();
    const next = resolveTrack(this.asked, this.available);
    if (next !== this.current) {
      this.current = next;
      const element = next ? this.element(next) : undefined;
      // A track that is still fading out fades back in from where it is, rather than starting over.
      if (element && element.paused) element.currentTime = 0;
    }
    const element = this.current ? this.element(this.current) : undefined;
    if (element && element.paused)
      element.play().catch(() => {
        // Not a gesture this browser accepts yet; the next unlock or scene tries again.
      });
    this.fading();
  }

  private fading(): void {
    if (this.stopFade || this.elements.size === 0) return;
    this.stopFade = this.deps.repeat(FADE_TICK_MS, () => this.fade());
  }

  /** One step of every track toward where it belongs: the current one up, the rest down and then paused. */
  private fade(): void {
    const step = (FADE_TICK_MS / 1000 / FADE_SECONDS) * MUSIC_LEVEL;
    const wanted = this.target();
    let settled = true;
    for (const [track, element] of this.elements) {
      const target = track === this.current ? wanted : 0;
      const volume =
        element.volume < target
          ? Math.min(target, element.volume + step)
          : Math.max(target, element.volume - step);
      element.volume = volume;
      if (volume === 0 && track !== this.current) element.pause();
      if (volume !== target) settled = false;
    }
    // The duck wears off on its own, so a settled fade at a ducked level is not the end of the work.
    if (!settled || this.deps.now() < this.duckedUntil) return;
    this.stopFade?.();
    this.stopFade = undefined;
  }
}

/**
 * The presses a browser takes as the gesture that lets sound through. All of them, and for the page's life: iOS
 * counts the ends and not the starts, and `gamepadconnected` is the first button a pad sends.
 */
export const MUSIC_UNLOCK_EVENTS = [
  "pointerdown",
  "pointerup",
  "touchend",
  "click",
  "keydown",
  "gamepadconnected",
] as const;

/** The production dependencies: real media elements, a real timer and the page's `fetch`. */
export function browserMusicDeps(url: string): MusicDeps {
  return {
    url,
    fetch: (at) => fetch(at),
    element: (src) => new Audio(src),
    repeat: (ms, run) => {
      const id = setInterval(run, ms);
      return () => clearInterval(id);
    },
    now: () => performance.now() / 1000,
  };
}
