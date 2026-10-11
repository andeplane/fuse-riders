import type { Store } from "../session.js";
import { CueTracker, type Heard } from "./cues.js";
import { MARCH, type Song } from "./music.js";
import { SOUNDS, type Sound } from "./sounds.js";

/** What the director drives: WebAudio in the browser (`web-backend.ts`), a recorder in tests. */
export interface AudioBackend {
  /** A user gesture: make or resume the audio context, which browsers hold silent until one. */
  unlock(): void;
  play(sound: Sound): void;
  /** Loops `song` from its start, or stops the loop on null. */
  music(song: Song | null): void;
  /** Lowers the loop for `seconds`, under a jingle. */
  duck(seconds: number): void;
  /** The tab was hidden (silence everything) or shown again. */
  hide(hidden: boolean): void;
}

/** Where the two choices are kept: "0" is off, anything else (or nothing) on. */
export interface AudioKeys {
  music: string;
  effects: string;
}

/**
 * The page's sound: it hears every frame (`frame`), plays the cues that frame brings and keeps the stage's loop going;
 * the loop and the jingles are the music channel, the rest the effects channel. Nothing sounds before a user gesture
 * (`unlock`), since browsers refuse audio until one, nor while the tab is hidden. The MUSIC and EFFECTS choices are this browser's, kept in `store`; a
 * page opened with `?mute` (`muted`) never sounds, never touches the backend and neither reads nor writes them.
 */
export class AxeAudio {
  /** Cues heard so far, played or not: what a muted page shows a smoke test. */
  heard = 0;
  private readonly tracker = new CueTracker();
  private musicOn: boolean;
  private effectsOn: boolean;
  private unlocked = false;
  private hidden = false;
  private wanted: Song | null = null;
  private playing: Song | null = null;

  constructor(
    private readonly backend: AudioBackend,
    private readonly store: Pick<Store, "getItem" | "setItem">,
    private readonly keys: AudioKeys,
    readonly muted: boolean,
  ) {
    this.musicOn = !muted && store.getItem(keys.music) !== "0";
    this.effectsOn = !muted && store.getItem(keys.effects) !== "0";
  }

  get music(): boolean {
    return this.musicOn;
  }
  get effects(): boolean {
    return this.effectsOn;
  }
  /** What the page is doing for sound: "muted" by `?mute`, "waiting" for a gesture, "hidden" or "on". */
  get state(): "muted" | "waiting" | "hidden" | "on" {
    if (this.muted) return "muted";
    if (!this.unlocked) return "waiting";
    return this.hidden ? "hidden" : "on";
  }

  setMusic(on: boolean): void {
    if (this.muted || on === this.musicOn) return;
    this.musicOn = on;
    this.store.setItem(this.keys.music, on ? "1" : "0");
    this.sync();
  }
  setEffects(on: boolean): void {
    if (this.muted || on === this.effectsOn) return;
    this.effectsOn = on;
    this.store.setItem(this.keys.effects, on ? "1" : "0");
  }

  /** A user gesture. Every one reaches the backend, which resumes a context the browser suspended again. */
  unlock(): void {
    if (this.muted || this.hidden) return;
    this.unlocked = true;
    this.backend.unlock();
    this.sync();
  }

  hide(hidden: boolean): void {
    if (this.muted || hidden === this.hidden) return;
    this.hidden = hidden;
    if (!this.unlocked) return;
    this.backend.hide(hidden);
    this.sync();
  }

  /**
   * A new frame: its cues play, each on its channel if that is on. A `quiet` page hears them without playing them: a
   * phone that is only a shared screen's controller, whose room the screen sounds for.
   */
  frame(frame: Heard, quiet = false): void {
    const cues = this.tracker.next(frame);
    this.heard += cues.length;
    // The stage's loop runs while a stage is fought or tallied.
    this.wanted =
      !quiet && (frame.stage === "running" || frame.stage === "between")
        ? MARCH
        : null;
    this.sync();
    if (quiet || !this.live()) return;
    for (const cue of cues) {
      const sound: Sound = SOUNDS[cue];
      if (!(sound.channel === "music" ? this.musicOn : this.effectsOn))
        continue;
      this.play(sound);
      const { duck } = sound;
      if (duck && this.playing) this.safely((backend) => backend.duck(duck));
    }
  }

  private play(sound: Sound): void {
    this.safely((backend) => backend.play(sound));
  }

  /** A backend that fails costs the page that sound (or the loop), never the frame it came with. */
  private safely(act: (backend: AudioBackend) => void): void {
    try {
      act(this.backend);
    } catch {
      // Silent: audio never gets in the way of the game.
    }
  }

  /** The room has ended: the loop stops. */
  stop(): void {
    this.wanted = null;
    this.sync();
  }

  private live(): boolean {
    return !this.muted && this.unlocked && !this.hidden;
  }

  private sync(): void {
    if (!this.live()) return;
    const song = this.musicOn ? this.wanted : null;
    if (song === this.playing) return;
    // Taken as playing even if the backend throws, so a broken one is not asked again on every frame.
    this.playing = song;
    this.safely((backend) => backend.music(song));
  }
}
