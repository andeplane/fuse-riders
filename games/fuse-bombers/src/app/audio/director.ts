import { MUSIC_TRACKS } from "fuse-ui/assets";
import type { RoundView, TickEvent } from "../../engine/index.js";
import { CueLimiter, planCues, type Cue, type CueKind } from "./cues.js";

export type MusicKind = "lobby" | "round" | "sudden-death" | "victory";

type TrackId = (typeof MUSIC_TRACKS)[number]["id"];
const TRACKS: Readonly<Record<MusicKind, TrackId>> = {
  lobby: "coin-op-swing",
  round: "arcade-adventure",
  "sudden-death": "final-chase",
  victory: "pixel-sax-parade",
};

/** Each kind's track in the arcade games' shared catalogue, as a path under the site base (`music/…`). */
export const MUSIC_FILES = Object.fromEntries(
  Object.entries(TRACKS).map(([kind, id]) => [
    kind,
    MUSIC_TRACKS.find((track) => track.id === id)!.path.slice(1),
  ]),
) as Readonly<Record<MusicKind, string>>;

export const MUTE_KEY = "fuse-bombers-muted";

/** What the director drives: WebAudio in the browser, a recorder in tests. */
export interface AudioBackend {
  /** Seconds on the effects clock. */
  now(): number;
  /** Called on user gestures until audio runs; browsers keep audio blocked until then. */
  unlock(): void;
  play(cue: Cue): void;
  /** Crossfades to `kind`'s track, or fades out on null. */
  music(kind: MusicKind | null): void;
  /** Fuse hiss, 0 = silent. */
  sizzle(level: number): void;
  setMuted(muted: boolean): void;
  /** The tab was hidden: pause the music and stop every sound (the fuse hiss would hold its level). */
  suspend(): void;
  /** Undoes `suspend`; the director follows with `music` to restart the wanted track. */
  resume(): void;
}

/** localStorage that may be missing or throw (private mode, blocked site data). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `?mute` (any value but `0`/`false`) disables all audio for this load without touching the stored choice. */
export function mutedByQuery(search: string): boolean {
  const value = new URLSearchParams(search).get("mute");
  return value !== null && value !== "0" && value !== "false";
}

/** Cues held back by a limiter keep this long before they are too late to matter. */
const PENDING_SECONDS = 0.15;

/**
 * Turns round events into throttled cues, owns the mute setting and remembers which music should play. With
 * `disabled` (`?mute`) it never touches the backend or the storage.
 */
export class AudioDirector {
  readonly disabled: boolean;
  private mutedNow: boolean;
  private hidden = false;
  private unlocked = false;
  private wanted: MusicKind | null = null;
  private sizzleLevel = 0;
  private readonly limiter = new CueLimiter();
  private readonly pending = new Map<CueKind, { cue: Cue; since: number }>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly backend: AudioBackend,
    private readonly storage: StorageLike | undefined,
    disabled = false,
  ) {
    this.disabled = disabled;
    this.mutedNow = disabled || this.read() === "1";
    if (!disabled && this.mutedNow) backend.setMuted(true);
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  setMuted(muted: boolean): void {
    if (this.disabled || muted === this.mutedNow) return;
    this.mutedNow = muted;
    try {
      this.storage?.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Blocked storage: the choice still holds for this page load.
    }
    this.backend.setMuted(muted);
    if (muted) this.pending.clear();
    else if (!this.hidden) this.backend.music(this.wanted);
    for (const listener of this.listeners) listener();
  }

  /** Runs `listener` after every mute change; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unlock(): void {
    if (this.disabled || this.hidden) return;
    this.unlocked = true;
    this.backend.unlock();
  }

  /** Follows the tab's visibility: silent while hidden, back on show unless muted. */
  setHidden(hidden: boolean): void {
    if (this.disabled || hidden === this.hidden) return;
    this.hidden = hidden;
    this.pending.clear();
    if (hidden) this.backend.suspend();
    else if (!this.mutedNow) {
      if (this.unlocked) this.backend.resume();
      this.backend.music(this.wanted); // before a gesture, as at load: `play` may wait for one
    }
  }

  music(kind: MusicKind | null): void {
    if (kind === this.wanted) return;
    this.wanted = kind;
    if (!this.disabled && !this.mutedNow && !this.hidden)
      this.backend.music(kind);
  }

  get currentMusic(): MusicKind | null {
    return this.wanted;
  }

  roundStarted(): void {
    this.pending.clear();
    this.limiter.reset();
    this.setSizzle(0);
    this.music("round");
  }

  roundEvents(events: readonly TickEvent[], view: RoundView): void {
    if (events.some((event) => event.type === "sudden-death-started"))
      this.music("sudden-death");
    this.setSizzle(sizzleFor(view));
    if (this.disabled || this.mutedNow || this.hidden) return;
    const now = this.backend.now();
    for (const cue of planCues(events)) {
      const held = this.pending.get(cue.kind)?.cue;
      const merged = held
        ? {
            ...cue,
            size: Math.max(cue.size, held.size),
            pitch: Math.max(cue.pitch, held.pitch),
          }
        : cue;
      this.pending.set(cue.kind, {
        cue: merged,
        since: this.pending.get(cue.kind)?.since ?? now,
      });
    }
    for (const [kind, { cue, since }] of this.pending) {
      if (this.limiter.allow(kind, now)) this.backend.play(cue);
      else if (now - since < PENDING_SECONDS) continue;
      this.pending.delete(kind);
    }
  }

  /** The round scene shut down: nothing of it keeps sounding. */
  roundDetached(): void {
    this.pending.clear();
    this.setSizzle(0);
  }

  private setSizzle(level: number): void {
    // Small steps are not worth a parameter change; reaching silence always is.
    const step = Math.abs(level - this.sizzleLevel);
    if (step === 0 || (step < 0.02 && level !== 0)) return;
    this.sizzleLevel = level;
    if (!this.disabled) this.backend.sizzle(level);
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(MUTE_KEY) ?? null;
    } catch {
      return null;
    }
  }
}

/** The fuse hisses over its second half, louder as it burns down; silent in sudden death and after the round. */
export function sizzleFor(view: RoundView): number {
  if (view.phase !== "playing") return 0;
  const progress = view.tick / view.fuseTicks;
  return progress < 0.5 ? 0 : Math.min(1, (progress - 0.5) * 2);
}
